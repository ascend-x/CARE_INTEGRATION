"""
CARE — Clinical Action and Response Engine
BIU Server: Bed Profile Manager

Defines per-profile rules: Tier 1 devices, alarm thresholds,
routing tables, and escalation paths.

Profiles are TEMPLATES that clinicians configure.
"""

import logging
from models import (
    AlarmType,
    AlarmPriority,
    BedProfile,
    Role,
    TIER1_ALARMS,
)

logger = logging.getLogger("care.profiles")


# ─── Default Routing Tables ─────────────────────────────────────────
# For each (profile, alarm_type) → who gets notified and at what priority

ROUTING_RULES: dict[BedProfile, dict[AlarmType, dict]] = {
    # ── Cardiac Profile ──────────────────────────────────────────
    BedProfile.CARDIAC: {
        # Tier 1: fixed rules
        AlarmType.FLATLINE: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Code protocol — confirm with clinical team",
            "escalation_timeout_s": 30,
        },
        AlarmType.HR_CRITICAL_HIGH: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Possible V-Tach — also common artifact",
            "escalation_timeout_s": 30,
        },
        AlarmType.HR_CRITICAL_LOW: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Severe bradycardia",
            "escalation_timeout_s": 30,
        },
        # Medium priority
        AlarmType.HR_HIGH: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "Tachycardia — escalate to Doctor if unresolved",
            "escalation_timeout_s": 120,
        },
        AlarmType.HR_LOW: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "Bradycardia",
            "escalation_timeout_s": 120,
        },
        AlarmType.LEAD_OFF: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "ECG lead disconnected — if repeated, add Technician task",
            "escalation_timeout_s": 300,
            "tech_task_after_repeats": 3,
        },
        AlarmType.ECG_NOISE: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "ECG signal noisy",
            "escalation_timeout_s": 300,
        },
        AlarmType.TEMP_HIGH: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "Fever",
            "escalation_timeout_s": 300,
        },
        AlarmType.TEMP_CRITICAL: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.NURSE, Role.DOCTOR],
            "note": "Hyperthermia",
            "escalation_timeout_s": 60,
        },
        AlarmType.SPO2_LOW: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "SpO2 below threshold",
            "escalation_timeout_s": 120,
        },
        AlarmType.SPO2_CRITICAL: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.NURSE, Role.DOCTOR],
            "note": "Severe desaturation",
            "escalation_timeout_s": 30,
        },
        AlarmType.PUMP_EMPTY: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "IV pump empty — routine task",
            "escalation_timeout_s": 600,
        },
    },

    # ── Kidney / Dialysis Profile ────────────────────────────────
    BedProfile.KIDNEY: {
        # Tier 1: fixed rules
        AlarmType.DIALYSIS_BLOOD_LEAK: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Blood leak detected — immediate action required",
            "escalation_timeout_s": 15,
        },
        AlarmType.DIALYSIS_PRESSURE_DROP: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Dialysis pressure anomaly",
            "escalation_timeout_s": 30,
        },
        AlarmType.FLATLINE: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "No heartbeat",
            "escalation_timeout_s": 30,
        },
        # Medium/Low
        AlarmType.SPO2_LOW: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "SpO2 low — if repeated, add Technician task (probe check)",
            "escalation_timeout_s": 120,
            "tech_task_after_repeats": 5,
        },
        AlarmType.TEMP_HIGH: {
            "priority": AlarmPriority.MEDIUM,  # Higher for kidney (infection risk)
            "roles": [Role.NURSE],
            "note": "Fever — infection risk in dialysis patient",
            "escalation_timeout_s": 120,
        },
        AlarmType.TEMP_CRITICAL: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.NURSE, Role.DOCTOR],
            "note": "High fever — sepsis concern",
            "escalation_timeout_s": 30,
        },
        AlarmType.HR_HIGH: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "Tachycardia — fluid overload risk during dialysis",
            "escalation_timeout_s": 120,
        },
        AlarmType.HR_CRITICAL_HIGH: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Critical tachycardia",
            "escalation_timeout_s": 30,
        },
        AlarmType.PUMP_EMPTY: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "IV pump empty",
            "escalation_timeout_s": 600,
        },
        AlarmType.LEAD_OFF: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "ECG lead off (secondary monitor)",
            "escalation_timeout_s": 300,
        },
    },

    # ── Respiratory / Ventilator Profile ─────────────────────────
    BedProfile.RESPIRATORY: {
        # Tier 1: fixed rules
        AlarmType.VENT_DISCONNECT: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.RESPIRATORY_THERAPIST, Role.NURSE],
            "note": "Ventilator tube disconnected — immediate reconnection needed",
            "escalation_timeout_s": 15,
        },
        AlarmType.SPO2_CRITICAL: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE, Role.RESPIRATORY_THERAPIST],
            "note": "Severe desaturation",
            "escalation_timeout_s": 15,
        },
        AlarmType.SPO2_RAPID_DROP: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE, Role.RESPIRATORY_THERAPIST],
            "note": "Rapid SpO2 decline — possible disconnect or acute event",
            "escalation_timeout_s": 15,
        },
        AlarmType.FLATLINE: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "No heartbeat",
            "escalation_timeout_s": 30,
        },
        # Medium
        AlarmType.VENT_HIGH_PRESSURE: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "High airway pressure — may be cough, resolves in seconds",
            "escalation_timeout_s": 60,
            "auto_resolve_if_transient_s": 5,
        },
        AlarmType.VENT_BATTERY: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.TECHNICIAN],
            "copy_to": [Role.NURSE],
            "note": "Ventilator battery or power warning",
            "escalation_timeout_s": 300,
        },
        AlarmType.SPO2_LOW: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "SpO2 low — if vent values normal, likely sensor issue",
            "escalation_timeout_s": 60,
            "tech_task_after_repeats": 3,
        },
        AlarmType.HR_HIGH: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "Tachycardia",
            "escalation_timeout_s": 120,
        },
        AlarmType.TEMP_HIGH: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "Fever",
            "escalation_timeout_s": 300,
        },
        AlarmType.LEAD_OFF: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "ECG lead off",
            "escalation_timeout_s": 300,
        },
    },

    # ── Unified (Single Arduino — 4 Sensors: ECG + Pulse + SpO2 + Temp) ──
    BedProfile.UNIFIED: {
        # Tier 1: fixed rules (bypass AI)
        AlarmType.FLATLINE: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Asystole / cardiac flatline on unified node",
            "escalation_timeout_s": 30,
        },
        AlarmType.HR_CRITICAL_HIGH: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "V-Tach or extreme tachycardia (>150 BPM)",
            "escalation_timeout_s": 30,
        },
        AlarmType.HR_CRITICAL_LOW: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Severe bradycardia (<40 BPM)",
            "escalation_timeout_s": 30,
        },
        AlarmType.SPO2_CRITICAL: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Severe desaturation (<85% SpO2)",
            "escalation_timeout_s": 20,
        },
        AlarmType.SPO2_RAPID_DROP: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Sudden SpO2 drop — rapid desaturation",
            "escalation_timeout_s": 15,
        },
        AlarmType.TEMP_CRITICAL: {
            "priority": AlarmPriority.CRITICAL,
            "roles": [Role.DOCTOR, Role.NURSE],
            "note": "Hyperthermia (>40°C) or severe hypothermia (<34°C)",
            "escalation_timeout_s": 30,
        },
        # Tier 2: Medium / Low (AI Correlation & Escalation)
        AlarmType.HR_HIGH: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "Tachycardia (120-150 BPM)",
            "escalation_timeout_s": 120,
        },
        AlarmType.HR_LOW: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "Bradycardia (40-50 BPM)",
            "escalation_timeout_s": 120,
        },
        AlarmType.SPO2_LOW: {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": "Mild hypoxemia (85-90% SpO2)",
            "escalation_timeout_s": 120,
        },
        AlarmType.TEMP_HIGH: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "Fever (>38.5°C)",
            "escalation_timeout_s": 300,
        },
        AlarmType.TEMP_LOW: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "Hypothermia (<35°C)",
            "escalation_timeout_s": 300,
        },
        AlarmType.LEAD_OFF: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "ECG lead off — hardware buzzer sounds locally",
            "escalation_timeout_s": 300,
            "tech_task_after_repeats": 3,
        },
        AlarmType.ECG_NOISE: {
            "priority": AlarmPriority.LOW,
            "roles": [Role.NURSE],
            "note": "ECG motion artifact or noisy electrode",
            "escalation_timeout_s": 300,
        },
    },
}


class BedProfileManager:
    """
    Manages bed profiles and provides routing/threshold information.
    """

    def __init__(self):
        self.profiles: dict[str, BedProfile] = {}  # bed_id → profile
        self.custom_overrides: dict[str, dict] = {}  # bed_id → custom rules

    def set_profile(self, bed_id: str, profile: BedProfile):
        """Set or change the profile for a bed."""
        self.profiles[bed_id] = profile
        logger.info(f"Bed {bed_id} set to profile: {profile.value}")

    def get_profile(self, bed_id: str) -> BedProfile:
        """Get the profile for a bed."""
        return self.profiles.get(bed_id, BedProfile.CARDIAC)

    def get_routing(self, bed_id: str, alarm_type: AlarmType) -> dict:
        """
        Get routing information for an alarm type on a specific bed.
        Returns: {priority, roles, note, escalation_timeout_s, ...}
        """
        profile = self.get_profile(bed_id)
        rules = ROUTING_RULES.get(profile, {})
        rule = rules.get(alarm_type)

        if rule:
            return rule

        # Default fallback for alarm types not explicitly configured
        return {
            "priority": AlarmPriority.MEDIUM,
            "roles": [Role.NURSE],
            "note": f"Default routing for {alarm_type.value}",
            "escalation_timeout_s": 120,
        }

    def is_tier1(self, bed_id: str, alarm_type: AlarmType) -> bool:
        """Check if an alarm type is Tier 1 (bypass AI) for this bed's profile."""
        profile = self.get_profile(bed_id)
        tier1 = TIER1_ALARMS.get(profile, set())
        return alarm_type in tier1

    def get_escalation_path(self, bed_id: str, current_roles: list[Role]) -> list[Role]:
        """
        Get the next escalation targets given current recipients.
        Adds recipients, NEVER removes the current ones.
        """
        path = []
        if Role.NURSE in current_roles and Role.CHARGE_NURSE not in current_roles:
            path.append(Role.CHARGE_NURSE)
        if Role.CHARGE_NURSE in current_roles and Role.DOCTOR not in current_roles:
            path.append(Role.DOCTOR)
        return path

    def get_all_profiles_info(self) -> list[dict]:
        """Return summary of all profiles for the dashboard."""
        return [
            {
                "id": BedProfile.CARDIAC.value,
                "name": "Cardiac",
                "tier1_devices": "ECG + cardiac infusions",
                "tier1_alarms": [a.value for a in TIER1_ALARMS[BedProfile.CARDIAC]],
                "description": "Arrhythmia detection, tachycardia/bradycardia monitoring",
            },
            {
                "id": BedProfile.KIDNEY.value,
                "name": "Kidney / Dialysis",
                "tier1_devices": "Dialysis machine",
                "tier1_alarms": [a.value for a in TIER1_ALARMS[BedProfile.KIDNEY]],
                "description": "Dialysis monitoring, fluid balance, infection risk",
            },
            {
                "id": BedProfile.RESPIRATORY.value,
                "name": "Respiratory / Ventilator",
                "tier1_devices": "Ventilator",
                "tier1_alarms": [a.value for a in TIER1_ALARMS[BedProfile.RESPIRATORY]],
                "description": "Ventilator monitoring, SpO2, airway pressure",
            },
            {
                "id": BedProfile.UNIFIED.value,
                "name": "Unified BIU (Single Arduino)",
                "tier1_devices": "Arduino Uno + 4 Sensors (ECG, Heartbeat, SpO2, Temp)",
                "tier1_alarms": [a.value for a in TIER1_ALARMS[BedProfile.UNIFIED]],
                "description": "Multiplexed bedside node: dual optical/pulse, analog ECG, OneWire temp & hardware fail-safe buzzer",
            },
        ]
