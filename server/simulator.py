"""
CARE — Clinical Action and Response Engine
BIU Server: Simulator

Generates synthetic sensor data for demo scenarios.
Can run independently of Arduino hardware.
"""

import math
import random
import time
import threading
import logging
from datetime import datetime
from typing import Callable, Optional

from models import (
    BedProfile,
    AlarmPriority,
    AlarmType,
    VitalSigns,
)

logger = logging.getLogger("care.simulator")


class PatientSimulator:
    """
    Simulates a single patient bed with realistic vital signs.
    Generates data packets in the same format as the Arduino serial output.
    """

    def __init__(self, node_id: int, profile: BedProfile):
        self.node_id = node_id
        self.profile = profile
        self.running = False
        self.start_time = time.time()

        # ── Baseline Vitals ──────────────────────────────────────
        self._init_baselines()

        # ── Current values (fluctuate around baseline) ───────────
        self.hr = self.hr_baseline
        self.hr_raw = 512
        self.ecg = 512
        self.ecg_quality = 95
        self.temp = self.temp_baseline
        self.spo2_proxy = 600
        self.lead_off = False

        # Simulated device values
        self.vent_pressure = 20.0
        self.vent_tidal_volume = 500.0
        self.vent_rate = 14
        self.vent_fio2 = 0.4
        self.vent_connected = True
        self.vent_battery = 100.0

        self.dial_blood_flow = 250.0
        self.dial_venous_pressure = 120.0
        self.dial_arterial_pressure = -180.0
        self.dial_uf_rate = 200.0
        self.dial_blood_leak = False

        self.pump_rate = 100.0
        self.pump_volume_remaining = 500.0
        self.pump_occlusion = False

        # ── Scenario state ───────────────────────────────────────
        self.active_scenario: Optional[str] = None
        self.scenario_start_time: float = 0
        self.scenario_duration: float = 0
        self.planned_activity = False

        # ── Noise / variation parameters ─────────────────────────
        self.hr_noise = 2.0
        self.temp_noise = 0.05
        self.ecg_noise = 15
        self.spo2_noise = 10

        # ── Alarm cooldown (prevents same alarm every 100ms) ─────
        self._alarm_cooldowns: dict[str, float] = {}
        self.ALARM_COOLDOWN_S = 5.0  # Min seconds between same alarm type

    def _check_cooldown(self, alarm_name: str, now: float) -> bool:
        """Return True if this alarm is allowed (cooldown expired)."""
        last = self._alarm_cooldowns.get(alarm_name, 0)
        if now - last < self.ALARM_COOLDOWN_S:
            return False
        self._alarm_cooldowns[alarm_name] = now
        return True

    def _init_baselines(self):
        """Set profile-specific baseline vitals."""
        if self.profile == BedProfile.CARDIAC:
            self.hr_baseline = 78
            self.temp_baseline = 36.8
            self.spo2_baseline = 600
        elif self.profile == BedProfile.KIDNEY:
            self.hr_baseline = 82
            self.temp_baseline = 37.0
            self.spo2_baseline = 580
        elif self.profile == BedProfile.RESPIRATORY:
            self.hr_baseline = 85
            self.temp_baseline = 37.2
            self.spo2_baseline = 560
        else:
            self.hr_baseline = 75
            self.temp_baseline = 36.8
            self.spo2_baseline = 600

    def generate_packet(self) -> dict:
        """
        Generate one data packet (same format as Arduino serial JSON).
        Called every 100ms by the simulator loop.
        """
        now = time.time()
        elapsed = now - self.start_time
        ts = int(elapsed * 1000)  # Simulate Arduino millis()

        # ── Apply scenario effects ───────────────────────────────
        self._apply_scenario(now)

        # ── Physiological variation ──────────────────────────────
        self._simulate_variation(elapsed)

        # ── Evaluate alarms (with per-type cooldown) ─────────────
        raw_alarms, priority = self._evaluate_alarms()
        # Filter through cooldown — same alarm type can only fire once per N seconds
        alarms = [a for a in raw_alarms if self._check_cooldown(a, now)]

        # ── Build ECG waveform (simplified sine + QRS-like spike) ─
        ecg_phase = (elapsed * self.hr / 60.0) % 1.0
        if ecg_phase < 0.05:
            # QRS complex
            self.ecg = 512 + int(300 * math.sin(ecg_phase * 20 * math.pi))
        elif ecg_phase < 0.15:
            # T wave
            self.ecg = 512 + int(80 * math.sin((ecg_phase - 0.05) * 10 * math.pi))
        else:
            # Baseline with noise
            self.ecg = 512 + random.randint(-self.ecg_noise, self.ecg_noise)

        if self.lead_off:
            self.ecg = random.randint(0, 1023)
            self.ecg_quality = 0
        else:
            self.ecg_quality = min(100, max(0, self.ecg_quality + random.randint(-1, 2)))

        # ── Heartbeat raw (KY-039 simulation) ───────────────────
        beat_phase = (elapsed * self.hr / 60.0) % 1.0
        if beat_phase < 0.15:
            self.hr_raw = int(self.spo2_proxy + 100 * math.sin(beat_phase * math.pi / 0.15))
        else:
            self.hr_raw = int(self.spo2_proxy * 0.8 + random.randint(-5, 5))

        # ── Build packet ─────────────────────────────────────────
        packet = {
            "node": self.node_id,
            "ts": ts,
            "profile": self.profile.value,
            "hr": int(self.hr),
            "hr_raw": self.hr_raw,
            "ecg": self.ecg,
            "ecg_quality": self.ecg_quality,
            "temp": round(self.temp, 1),
            "spo2_proxy": int(self.spo2_proxy),
            "lead_off": self.lead_off,
            "alarm_flags": 0,
            "priority": priority,
            "alarms": alarms,
            # Extra simulated device data
            "sim_data": self._get_sim_device_data(),
            # Metadata
            "_simulated": True,
            "_server_time": datetime.now().isoformat(),
            "_scenario": self.active_scenario,
            "_planned_activity": self.planned_activity,
        }

        return packet

    def _simulate_variation(self, elapsed: float):
        """Add realistic physiological variation to vitals."""
        # Slow sinusoidal drift + random noise
        drift = math.sin(elapsed * 0.02) * 3  # Slow ~50s cycle

        self.hr = self.hr_baseline + drift + random.gauss(0, self.hr_noise)
        self.hr = max(0, min(300, self.hr))

        temp_drift = math.sin(elapsed * 0.005) * 0.2
        self.temp = self.temp_baseline + temp_drift + random.gauss(0, self.temp_noise)

        spo2_drift = math.sin(elapsed * 0.01) * 15
        self.spo2_proxy = int(
            self.spo2_baseline + spo2_drift + random.gauss(0, self.spo2_noise)
        )

        # Pump slowly drains
        if self.pump_volume_remaining > 0:
            self.pump_volume_remaining -= self.pump_rate / 36000  # Per 100ms

    def _get_sim_device_data(self) -> dict:
        """Return simulated device data specific to the profile."""
        data = {}

        if self.profile == BedProfile.RESPIRATORY:
            data["vent"] = {
                "pressure": round(self.vent_pressure + random.gauss(0, 0.5), 1),
                "tidal_volume": round(self.vent_tidal_volume + random.gauss(0, 10), 0),
                "rate": self.vent_rate,
                "fio2": self.vent_fio2,
                "connected": self.vent_connected,
                "battery": round(self.vent_battery, 1),
            }

        if self.profile == BedProfile.KIDNEY:
            data["dialysis"] = {
                "blood_flow": round(self.dial_blood_flow + random.gauss(0, 2), 0),
                "venous_pressure": round(self.dial_venous_pressure + random.gauss(0, 1), 0),
                "arterial_pressure": round(self.dial_arterial_pressure + random.gauss(0, 1), 0),
                "uf_rate": round(self.dial_uf_rate, 0),
                "blood_leak": self.dial_blood_leak,
            }

        data["pump"] = {
            "rate": self.pump_rate,
            "volume_remaining": round(max(0, self.pump_volume_remaining), 1),
            "occlusion": self.pump_occlusion,
        }

        return data

    def _evaluate_alarms(self) -> tuple[list[str], int]:
        """Evaluate alarm conditions and return (alarm_names, priority)."""
        alarms = []
        priority = 0

        # Heart rate
        if self.hr >= 150:
            alarms.append(AlarmType.HR_CRITICAL_HIGH.value)
            priority = max(priority, 3)
        elif self.hr >= 120:
            alarms.append(AlarmType.HR_HIGH.value)
            priority = max(priority, 2)

        if self.hr <= 40:
            alarms.append(AlarmType.HR_CRITICAL_LOW.value)
            priority = max(priority, 3)
        elif self.hr <= 50:
            alarms.append(AlarmType.HR_LOW.value)
            priority = max(priority, 2)

        # Temperature
        if self.temp >= 40.0:
            alarms.append(AlarmType.TEMP_CRITICAL.value)
            priority = max(priority, 3)
        elif self.temp >= 38.5:
            alarms.append(AlarmType.TEMP_HIGH.value)
            priority = max(priority, 1)

        if self.temp <= 34.0:
            alarms.append(AlarmType.TEMP_CRITICAL_LOW.value)
            priority = max(priority, 3)
        elif self.temp <= 35.0:
            alarms.append(AlarmType.TEMP_LOW.value)
            priority = max(priority, 1)

        # SpO2
        if self.spo2_proxy < 300:
            alarms.append(AlarmType.SPO2_CRITICAL.value)
            priority = max(priority, 3)
        elif self.spo2_proxy < 400:
            alarms.append(AlarmType.SPO2_LOW.value)
            priority = max(priority, 2)

        # Lead off
        if self.lead_off:
            alarms.append(AlarmType.LEAD_OFF.value)
            priority = max(priority, 2)

        # Ventilator (respiratory profile)
        if self.profile == BedProfile.RESPIRATORY:
            if not self.vent_connected:
                alarms.append(AlarmType.VENT_DISCONNECT.value)
                priority = max(priority, 3)
            if self.vent_pressure > 40:
                alarms.append(AlarmType.VENT_HIGH_PRESSURE.value)
                priority = max(priority, 2)
            if self.vent_battery < 20:
                alarms.append(AlarmType.VENT_BATTERY.value)
                priority = max(priority, 2)

        # Dialysis (kidney profile)
        if self.profile == BedProfile.KIDNEY:
            if self.dial_blood_leak:
                alarms.append(AlarmType.DIALYSIS_BLOOD_LEAK.value)
                priority = max(priority, 3)
            if abs(self.dial_venous_pressure) > 250:
                alarms.append(AlarmType.DIALYSIS_PRESSURE_DROP.value)
                priority = max(priority, 3)

        # Pump
        if self.pump_volume_remaining <= 0:
            alarms.append(AlarmType.PUMP_EMPTY.value)
            priority = max(priority, 1)
        if self.pump_occlusion:
            alarms.append(AlarmType.PUMP_OCCLUSION.value)
            priority = max(priority, 2)

        return alarms, priority

    # ── Scenario Triggers ────────────────────────────────────────

    def trigger_scenario(self, scenario: str, duration: float = 30.0):
        """
        Trigger a demo scenario.
        Scenarios modify the baseline vitals for a set duration.
        """
        self.active_scenario = scenario
        self.scenario_start_time = time.time()
        self.scenario_duration = duration
        logger.info(f"Scenario '{scenario}' triggered on node {self.node_id} "
                     f"for {duration}s")

    def _apply_scenario(self, now: float):
        """Apply active scenario effects to vitals."""
        if not self.active_scenario:
            return

        elapsed = now - self.scenario_start_time

        # Check if scenario has ended
        if elapsed > self.scenario_duration:
            self._end_scenario()
            return

        progress = elapsed / self.scenario_duration  # 0.0 → 1.0

        if self.active_scenario == "motion_artifact":
            # Shake sensor: spiky HR, noisy SpO2, all readings unstable
            self.hr_noise = 20.0
            self.spo2_noise = 80
            self.ecg_noise = 100
            self.spo2_proxy = int(self.spo2_baseline + random.randint(-200, 200))
            self.ecg_quality = max(0, self.ecg_quality - 10)

        elif self.active_scenario == "lead_off":
            # ECG lead disconnected
            self.lead_off = True
            self.ecg_quality = 0

        elif self.active_scenario == "desaturation":
            # Gradual SpO2 drop — TRUE event, signal quality stays good
            self.spo2_baseline = int(600 - progress * 350)  # Drop to ~250
            self.hr_baseline = int(78 + progress * 40)  # Compensatory tachycardia
            self.ecg_quality = min(100, self.ecg_quality + 1)  # Signal stays clean

        elif self.active_scenario == "tachycardia":
            # Gradual HR increase
            self.hr_baseline = int(78 + progress * 100)  # Up to ~178

        elif self.active_scenario == "bradycardia":
            # Gradual HR decrease
            self.hr_baseline = int(78 - progress * 45)  # Down to ~33

        elif self.active_scenario == "fever":
            # Temperature rise
            self.temp_baseline = 36.8 + progress * 4.0  # Up to ~40.8

        elif self.active_scenario == "hypothermia":
            # Temperature drop
            self.temp_baseline = 36.8 - progress * 3.5  # Down to ~33.3

        elif self.active_scenario == "flatline":
            # No heartbeat
            self.hr = 0
            self.hr_baseline = 0
            self.spo2_proxy = int(600 - progress * 400)

        elif self.active_scenario == "vent_disconnect":
            # Ventilator disconnection (respiratory)
            self.vent_connected = False
            self.vent_pressure = 0
            self.vent_tidal_volume = 0
            # SpO2 drops after a few seconds
            if elapsed > 3.0:
                self.spo2_baseline = int(600 - (elapsed - 3) * 50)

        elif self.active_scenario == "vent_high_pressure":
            # Airway pressure spike (cough)
            if elapsed < 2.0:
                self.vent_pressure = 45 + random.gauss(0, 2)
            else:
                self.vent_pressure = 20 + random.gauss(0, 0.5)

        elif self.active_scenario == "dialysis_blood_leak":
            # Blood leak alarm
            self.dial_blood_leak = True
            self.hr_baseline = int(82 + progress * 30)  # Stress response

        elif self.active_scenario == "dialysis_pressure":
            # Venous pressure rising
            self.dial_venous_pressure = 120 + progress * 150  # Up to ~270

        elif self.active_scenario == "repeated_spo2":
            # Repeated false SpO2 alarms (probe issue)
            cycle = int(elapsed / 3.0)  # Every 3 seconds
            if cycle % 2 == 0:
                self.spo2_proxy = 350  # Alarm zone
                self.spo2_noise = 5
            else:
                self.spo2_proxy = 580  # Normal
                self.spo2_noise = 10

        elif self.active_scenario == "multi_bed_crisis":
            # Simultaneous deterioration
            self.hr_baseline = int(78 + progress * 70)
            self.spo2_baseline = int(600 - progress * 250)
            self.temp_baseline = 36.8 + progress * 2.5

    def _end_scenario(self):
        """Reset to normal baselines after scenario ends."""
        logger.info(f"Scenario '{self.active_scenario}' ended on node {self.node_id}")
        self.active_scenario = None
        self._init_baselines()
        self.hr_noise = 2.0
        self.temp_noise = 0.05
        self.ecg_noise = 15
        self.spo2_noise = 10
        self.lead_off = False
        self.vent_connected = True
        self.vent_pressure = 20.0
        self.vent_tidal_volume = 500.0
        self.dial_blood_leak = False
        self.dial_venous_pressure = 120.0
        self.pump_occlusion = False
        self.ecg_quality = 95

    def set_planned_activity(self, active: bool, activity_type: str = ""):
        """Mark start/end of a planned activity (suctioning, bathing, etc.)."""
        self.planned_activity = active
        if active:
            logger.info(f"Planned activity '{activity_type}' started on node {self.node_id}")
        else:
            logger.info(f"Planned activity ended on node {self.node_id}")

    def set_vitals(self, **kwargs):
        """Manually set vital values (for simulator panel sliders)."""
        for key, value in kwargs.items():
            if key == "hr":
                self.hr_baseline = value
            elif key == "temp":
                self.temp_baseline = value
            elif key == "spo2":
                self.spo2_baseline = value
            elif key == "vent_pressure":
                self.vent_pressure = value
            elif key == "vent_connected":
                self.vent_connected = value
            elif key == "dial_blood_flow":
                self.dial_blood_flow = value
            elif key == "dial_venous_pressure":
                self.dial_venous_pressure = value
            elif key == "vent_tidal_volume":
                self.vent_tidal_volume = value
            elif key == "lead_off":
                self.lead_off = value


class SimulatorManager:
    """
    Manages patient simulators for all 3 beds.
    Generates packets at 10Hz (every 100ms) like the real Arduinos.
    """

    def __init__(self, on_data: Optional[Callable] = None):
        self.on_data = on_data
        self.simulators: dict[int, PatientSimulator] = {}
        self.running = False
        self.thread: Optional[threading.Thread] = None

    def setup_default_beds(self):
        """Create the 3 default bed simulators."""
        self.simulators[1] = PatientSimulator(1, BedProfile.CARDIAC)
        self.simulators[2] = PatientSimulator(2, BedProfile.KIDNEY)
        self.simulators[3] = PatientSimulator(3, BedProfile.RESPIRATORY)
        logger.info("Created 3 default bed simulators: cardiac, kidney, respiratory")

    def start(self):
        """Start the simulation loop."""
        self.running = True
        self.thread = threading.Thread(
            target=self._sim_loop,
            name="simulator",
            daemon=True,
        )
        self.thread.start()
        logger.info("Simulator started (10Hz)")

    def stop(self):
        """Stop the simulation loop."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=2.0)
        logger.info("Simulator stopped")

    def _sim_loop(self):
        """Generate packets from all simulators at 10Hz."""
        while self.running:
            start = time.time()

            for sim in self.simulators.values():
                packet = sim.generate_packet()
                if self.on_data:
                    self.on_data(packet)

            # Sleep to maintain ~10Hz
            elapsed = time.time() - start
            sleep_time = max(0, 0.1 - elapsed)
            time.sleep(sleep_time)

    def trigger_scenario(self, node_id: int, scenario: str, duration: float = 30.0):
        """Trigger a scenario on a specific bed."""
        if node_id in self.simulators:
            self.simulators[node_id].trigger_scenario(scenario, duration)
            return True
        return False

    def set_planned_activity(self, node_id: int, active: bool, activity_type: str = ""):
        """Set planned activity status on a bed."""
        if node_id in self.simulators:
            self.simulators[node_id].set_planned_activity(active, activity_type)
            return True
        return False

    def set_vitals(self, node_id: int, **kwargs):
        """Manually set vitals on a bed (simulator panel)."""
        if node_id in self.simulators:
            self.simulators[node_id].set_vitals(**kwargs)
            return True
        return False

    def get_available_scenarios(self) -> list[dict]:
        """Return list of available demo scenarios with descriptions."""
        return [
            {
                "id": "motion_artifact",
                "name": "Motion Artifact",
                "description": "Shake sensor — multiple alarms grouped as one 'possible motion disturbance' incident",
                "duration": 15,
                "profiles": ["all"],
            },
            {
                "id": "lead_off",
                "name": "Lead Disconnect",
                "description": "Pull ECG electrode — asystole alarm grouped with lead-off, safety path still fires",
                "duration": 20,
                "profiles": ["cardiac"],
            },
            {
                "id": "desaturation",
                "name": "True Desaturation",
                "description": "Gradual SpO2 drop with stable signal — ranked top priority, not collapsed",
                "duration": 30,
                "profiles": ["all"],
            },
            {
                "id": "tachycardia",
                "name": "Tachycardia",
                "description": "Gradual heart rate increase to critical levels",
                "duration": 25,
                "profiles": ["cardiac"],
            },
            {
                "id": "bradycardia",
                "name": "Bradycardia",
                "description": "Gradual heart rate decrease to critical levels",
                "duration": 25,
                "profiles": ["cardiac"],
            },
            {
                "id": "fever",
                "name": "Rising Fever",
                "description": "Temperature gradually rises past alarm thresholds",
                "duration": 40,
                "profiles": ["all"],
            },
            {
                "id": "flatline",
                "name": "Flatline / Asystole",
                "description": "No heartbeat detected — critical alarm with safety path",
                "duration": 15,
                "profiles": ["all"],
            },
            {
                "id": "vent_disconnect",
                "name": "Ventilator Disconnect",
                "description": "Ventilator tube disconnected — SpO2 drops after delay",
                "duration": 20,
                "profiles": ["respiratory"],
            },
            {
                "id": "vent_high_pressure",
                "name": "High Airway Pressure (Cough)",
                "description": "Brief pressure spike from cough — resolves quickly, tagged 'resolved in Xs'",
                "duration": 10,
                "profiles": ["respiratory"],
            },
            {
                "id": "dialysis_blood_leak",
                "name": "Dialysis Blood Leak",
                "description": "Blood leak detected — critical alarm, Tier 1 fixed rule",
                "duration": 15,
                "profiles": ["kidney"],
            },
            {
                "id": "dialysis_pressure",
                "name": "Dialysis Pressure Drop",
                "description": "Venous pressure rising dangerously",
                "duration": 20,
                "profiles": ["kidney"],
            },
            {
                "id": "repeated_spo2",
                "name": "Repeated SpO2 Alarms (Technician Loop)",
                "description": "SpO2 alarm repeats with stable vitals — Technician task created while Nurse alerts continue",
                "duration": 45,
                "profiles": ["all"],
            },
            {
                "id": "multi_bed_crisis",
                "name": "Multi-Bed Crisis",
                "description": "Simultaneous deterioration across all beds",
                "duration": 30,
                "profiles": ["all"],
            },
        ]
