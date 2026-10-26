"""
CARE — Clinical Action and Response Engine
BIU Server: Data Models

All data structures used across the system.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, IntEnum
from typing import Optional
from uuid import uuid4


# ─── Enums ──────────────────────────────────────────────────────────

class BedProfile(str, Enum):
    CARDIAC = "cardiac"
    KIDNEY = "kidney"
    RESPIRATORY = "respiratory"
    UNIFIED = "unified"


class AlarmPriority(IntEnum):
    NONE = 0
    LOW = 1
    MEDIUM = 2
    CRITICAL = 3


class AlarmType(str, Enum):
    # Heart Rate
    HR_CRITICAL_HIGH = "HR_CRITICAL_HIGH"
    HR_HIGH = "HR_HIGH"
    HR_LOW = "HR_LOW"
    HR_CRITICAL_LOW = "HR_CRITICAL_LOW"
    FLATLINE = "FLATLINE"
    # Temperature
    TEMP_HIGH = "TEMP_HIGH"
    TEMP_CRITICAL = "TEMP_CRITICAL"
    TEMP_LOW = "TEMP_LOW"
    TEMP_CRITICAL_LOW = "TEMP_CRITICAL_LOW"
    # ECG
    LEAD_OFF = "LEAD_OFF"
    ECG_NOISE = "ECG_NOISE"
    # SpO2
    SPO2_LOW = "SPO2_LOW"
    SPO2_CRITICAL = "SPO2_CRITICAL"
    SPO2_RAPID_DROP = "SPO2_RAPID_DROP"
    # Simulated device alarms (from simulator)
    VENT_DISCONNECT = "VENT_DISCONNECT"
    VENT_HIGH_PRESSURE = "VENT_HIGH_PRESSURE"
    VENT_LOW_PRESSURE = "VENT_LOW_PRESSURE"
    VENT_BATTERY = "VENT_BATTERY"
    DIALYSIS_BLOOD_LEAK = "DIALYSIS_BLOOD_LEAK"
    DIALYSIS_PRESSURE_DROP = "DIALYSIS_PRESSURE_DROP"
    DIALYSIS_AIR_DETECTED = "DIALYSIS_AIR_DETECTED"
    PUMP_EMPTY = "PUMP_EMPTY"
    PUMP_OCCLUSION = "PUMP_OCCLUSION"


class Role(str, Enum):
    DOCTOR = "doctor"
    NURSE = "nurse"
    TECHNICIAN = "technician"
    CHARGE_NURSE = "charge_nurse"
    RESPIRATORY_THERAPIST = "respiratory_therapist"


class DutyStatus(str, Enum):
    ACTIVE = "active"                   # 🟢 Active on ward
    IN_PROCEDURE = "in_procedure"       # 🟡 In surgery / procedure (auto-forward alerts)
    OFF_DUTY = "off_duty"               # 🔴 Off-duty / shift handover in progress


class IncidentStatus(str, Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    ESCALATED = "escalated"


class SignalQualityLevel(str, Enum):
    GOOD = "good"
    DEGRADED = "degraded"
    POOR = "poor"
    ARTIFACT = "artifact"
    LEAD_OFF = "lead_off"


class NodeStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    DEGRADED = "degraded"


# ─── Tier 1 Alarm Types (bypass AI, fixed rules only) ──────────────

TIER1_ALARMS = {
    BedProfile.CARDIAC: {
        AlarmType.FLATLINE,
        AlarmType.HR_CRITICAL_HIGH,   # Possible V-Fib
        AlarmType.HR_CRITICAL_LOW,
    },
    BedProfile.KIDNEY: {
        AlarmType.DIALYSIS_BLOOD_LEAK,
        AlarmType.DIALYSIS_PRESSURE_DROP,
        AlarmType.FLATLINE,
    },
    BedProfile.RESPIRATORY: {
        AlarmType.VENT_DISCONNECT,
        AlarmType.SPO2_CRITICAL,
        AlarmType.SPO2_RAPID_DROP,
        AlarmType.FLATLINE,
    },
    BedProfile.UNIFIED: {
        AlarmType.FLATLINE,
        AlarmType.HR_CRITICAL_HIGH,
        AlarmType.HR_CRITICAL_LOW,
        AlarmType.SPO2_CRITICAL,
        AlarmType.SPO2_RAPID_DROP,
        AlarmType.TEMP_CRITICAL,
    },
}


# ─── Data Classes ───────────────────────────────────────────────────

@dataclass
class VitalSigns:
    """Real-time vital signs from a node."""
    heart_rate: int = 0
    heart_rate_raw: int = 0
    ecg_value: int = 512
    ecg_quality: int = 100
    temperature: float = 0.0
    spo2_proxy: int = 512
    spo2: Optional[int] = None
    spo2_rapid_decline: bool = False
    lead_off: bool = False
    timestamp: datetime = field(default_factory=datetime.now)

    # Simulated device values (filled by simulator)
    # Ventilator
    vent_pressure: float = 0.0      # cmH2O
    vent_tidal_volume: float = 0.0  # mL
    vent_rate: int = 0              # breaths/min
    vent_fio2: float = 0.21         # fraction
    vent_connected: bool = True
    vent_battery: float = 100.0     # percent

    # Dialysis
    dial_blood_flow: float = 0.0    # mL/min
    dial_venous_pressure: float = 0.0
    dial_arterial_pressure: float = 0.0
    dial_uf_rate: float = 0.0       # mL/hr
    dial_blood_leak: bool = False

    # IV Pump
    pump_rate: float = 0.0          # mL/hr
    pump_volume_remaining: float = 0.0
    pump_occlusion: bool = False


@dataclass
class NodeData:
    """Raw data packet from an Arduino node."""
    node_id: int
    profile: BedProfile
    timestamp_arduino: int          # millis() from Arduino
    timestamp_server: datetime      # Server receive time
    clock_offset_ms: int = 0        # Estimated offset correction
    vitals: VitalSigns = field(default_factory=VitalSigns)
    alarm_flags: int = 0
    alarm_names: list[str] = field(default_factory=list)
    priority: AlarmPriority = AlarmPriority.NONE
    spo2_alarm_count: int = 0
    tech_task_triggered: bool = False
    raw_json: str = ""


@dataclass
class Alarm:
    """A single alarm event."""
    id: str = field(default_factory=lambda: str(uuid4())[:8])
    alarm_type: AlarmType = AlarmType.HR_HIGH
    node_id: int = 0
    bed_id: str = ""
    profile: BedProfile = BedProfile.CARDIAC
    priority: AlarmPriority = AlarmPriority.MEDIUM
    timestamp: datetime = field(default_factory=datetime.now)
    source: str = "arduino"          # "arduino" or "simulator"
    vitals_snapshot: Optional[VitalSigns] = None
    signal_quality: SignalQualityLevel = SignalQualityLevel.GOOD
    is_tier1: bool = False
    is_artifact: bool = False         # AI label: possible artifact
    artifact_confidence: float = 0.0  # 0.0-1.0
    context_label: str = ""           # e.g. "possible motion artifact"
    resolved: bool = False
    resolved_at: Optional[datetime] = None
    duration_ms: int = 0


@dataclass
class Incident:
    """A group of correlated alarms from the same event."""
    id: str = field(default_factory=lambda: str(uuid4())[:8])
    bed_id: str = ""
    profile: BedProfile = BedProfile.CARDIAC
    alarms: list[Alarm] = field(default_factory=list)
    priority: AlarmPriority = AlarmPriority.NONE  # Highest of members
    status: IncidentStatus = IncidentStatus.ACTIVE
    created_at: datetime = field(default_factory=datetime.now)
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    correlation_reason: str = ""      # Why these were grouped
    context_label: str = ""           # AI-generated context
    routed_to: list[Role] = field(default_factory=list)
    escalation_level: int = 0         # 0=initial, 1=charge nurse, 2=doctor
    escalation_timer_start: Optional[datetime] = None
    is_planned_activity: bool = False  # During a planned activity window

    @property
    def alarm_count(self) -> int:
        return len(self.alarms)

    def update_priority(self):
        """Group takes highest priority of its members."""
        if self.alarms:
            self.priority = max(a.priority for a in self.alarms)


@dataclass
class TechTask:
    """A technician task created from repeated false alarms or sensor issues."""
    id: str = field(default_factory=lambda: str(uuid4())[:8])
    bed_id: str = ""
    task_type: str = ""               # "probe_check", "lead_replacement", etc.
    description: str = ""
    created_at: datetime = field(default_factory=datetime.now)
    alarm_type: AlarmType = AlarmType.SPO2_LOW
    alarm_count: int = 0              # How many false alarms triggered this
    status: str = "open"              # "open", "in_progress", "completed"
    assigned_to: Optional[str] = None
    completed_at: Optional[datetime] = None


@dataclass
class BedState:
    """Complete state of a single bed."""
    bed_id: str = ""
    node_id: int = 0
    profile: BedProfile = BedProfile.CARDIAC
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    patient_mrn: Optional[str] = None
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    primary_diagnosis: Optional[str] = None
    clinical_conditions: list[str] = field(default_factory=list)
    attending_doctor: Optional[str] = None
    assigned_nurse: Optional[str] = None
    is_occupied: bool = True
    admitted_at: Optional[datetime] = None

    # Current state
    node_status: NodeStatus = NodeStatus.OFFLINE
    last_data_received: Optional[datetime] = None
    vitals: VitalSigns = field(default_factory=VitalSigns)
    signal_quality: SignalQualityLevel = SignalQualityLevel.GOOD

    # Active alarms and incidents
    active_alarms: list[Alarm] = field(default_factory=list)
    active_incidents: list[Incident] = field(default_factory=list)
    tech_tasks: list[TechTask] = field(default_factory=list)

    # Activity state
    planned_activity: bool = False
    planned_activity_start: Optional[datetime] = None
    planned_activity_type: str = ""

    # History (ring buffers, kept small)
    vitals_history: list[VitalSigns] = field(default_factory=list)
    alarm_history: list[Alarm] = field(default_factory=list)
    incident_history: list[Incident] = field(default_factory=list)

    # Statistics
    total_alarms: int = 0
    total_incidents: int = 0
    alarms_per_hour: float = 0.0


@dataclass
class EscalationConfig:
    """Escalation timing configuration (hospital-configurable)."""
    # Time in seconds before escalation at each level
    critical_initial_timeout: int = 30      # 30s for critical → escalate
    medium_initial_timeout: int = 120       # 2 min for medium → escalate
    low_initial_timeout: int = 300          # 5 min for low → escalate
    escalation_step_timeout: int = 60       # Time between escalation steps
    max_escalation_level: int = 2           # 0→1→2 then repeat at max


@dataclass
class DutyRosterState:
    """Clinical duty roster and physician coverage state."""
    current_doctor: str = "Dr. Sharma, MD"
    current_doctor_title: str = "Lead Intensivist / Attending"
    duty_status: DutyStatus = DutyStatus.ACTIVE
    covering_doctor: str = "Dr. Priya Patel, MD"
    covering_doctor_title: str = "Critical Care Fellow / On-Call"
    charge_nurse: str = "Nurse Sarah Jenkins, RN"
    shift_name: str = "Day ICU Shift (07:00 – 19:00)"
    status_note: str = "Primary attending active on ward"
    last_handover_at: Optional[datetime] = None
    handover_history: list[dict] = field(default_factory=list)


@dataclass
class SystemState:
    """Global system state."""
    beds: dict[str, BedState] = field(default_factory=dict)
    escalation_config: EscalationConfig = field(default_factory=EscalationConfig)
    duty_roster: DutyRosterState = field(default_factory=DutyRosterState)
    care_online: bool = True
    simulator_mode: bool = False            # True = generate synthetic data
    hardware_mode: bool = False             # True = read from serial
    start_time: datetime = field(default_factory=datetime.now)

    # Staff roster (simplified)
    staff: dict[Role, list[str]] = field(default_factory=lambda: {
        Role.DOCTOR: ["Dr. Sharma"],
        Role.NURSE: ["Nurse Priya", "Nurse Amit"],
        Role.TECHNICIAN: ["Tech Ravi"],
        Role.CHARGE_NURSE: ["CN Meera"],
        Role.RESPIRATORY_THERAPIST: ["RT Suresh"],
    })
