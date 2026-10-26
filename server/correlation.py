"""
CARE — Clinical Action and Response Engine
BIU Server: Correlation Engine

Groups related alarms from the same event into incidents.
Uses time windows and signal patterns.

SAFETY: Grouping is PRESENTATION ONLY. Every original alarm stays
visible, expandable, and logged. The group inherits the HIGHEST
priority of its members. No alarm is hidden.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

from models import (
    Alarm,
    AlarmType,
    AlarmPriority,
    BedProfile,
    Incident,
    IncidentStatus,
    TIER1_ALARMS,
    SignalQualityLevel,
)

logger = logging.getLogger("care.correlation")


# ─── Correlation Rules ──────────────────────────────────────────────

# Alarms that commonly co-occur from the same event
CORRELATION_GROUPS = {
    "motion_artifact": {
        "members": {
            AlarmType.HR_HIGH, AlarmType.HR_LOW,
            AlarmType.HR_CRITICAL_HIGH, AlarmType.HR_CRITICAL_LOW,
            AlarmType.SPO2_LOW, AlarmType.SPO2_CRITICAL,
            AlarmType.ECG_NOISE,
        },
        "min_count": 2,  # At least 2 of these within the time window
        "reason": "Multiple sensors disturbed simultaneously — possible motion artifact",
        "context": "possible motion disturbance",
    },
    "lead_off_cascade": {
        "members": {
            AlarmType.LEAD_OFF, AlarmType.FLATLINE,
            AlarmType.ECG_NOISE, AlarmType.HR_CRITICAL_LOW,
        },
        "min_count": 2,
        "reason": "ECG lead disconnection causing false flatline/bradycardia",
        "context": "probable lead disconnection",
    },
    "desaturation_cascade": {
        "members": {
            AlarmType.SPO2_LOW, AlarmType.SPO2_CRITICAL,
            AlarmType.SPO2_RAPID_DROP, AlarmType.HR_HIGH,
            AlarmType.HR_CRITICAL_HIGH,
        },
        "min_count": 2,
        "reason": "SpO2 drop with compensatory tachycardia — possible desaturation event",
        "context": "possible desaturation with compensatory response",
    },
    "vent_disconnect_cascade": {
        "members": {
            AlarmType.VENT_DISCONNECT, AlarmType.SPO2_LOW,
            AlarmType.SPO2_CRITICAL, AlarmType.SPO2_RAPID_DROP,
        },
        "min_count": 2,
        "reason": "Ventilator disconnect followed by SpO2 drop",
        "context": "ventilator disconnection with desaturation",
    },
    "dialysis_crisis": {
        "members": {
            AlarmType.DIALYSIS_BLOOD_LEAK,
            AlarmType.DIALYSIS_PRESSURE_DROP,
            AlarmType.HR_HIGH, AlarmType.HR_CRITICAL_HIGH,
        },
        "min_count": 2,
        "reason": "Dialysis alarm with hemodynamic response",
        "context": "dialysis complication with vital sign changes",
    },
}

# Time window for correlating alarms (seconds)
CORRELATION_WINDOW_S = 30
# Extended window during planned activity
PLANNED_ACTIVITY_WINDOW_S = 60
# Minimum seconds between same alarm type on same bed (cooldown)
ALARM_COOLDOWN_S = 3.0
# Maximum alarms stored per incident (keep most recent)
MAX_ALARMS_PER_INCIDENT = 20


class CorrelationEngine:
    """
    Groups alarms that likely come from the same event.

    RULES:
    1. Every original alarm stays visible and expandable.
    2. The group inherits the HIGHEST priority of its members.
    3. Tier 1 alarms are NEVER collapsed — they create their own
       incident even if correlated with others.
    4. Grouping adds context, never removes information.
    """

    def __init__(self):
        # Active incidents per bed
        self.active_incidents: dict[str, list[Incident]] = {}
        # Recent alarm buffer per bed (for time-window correlation)
        self.alarm_buffer: dict[str, list[Alarm]] = {}
        self.BUFFER_MAX_AGE_S = 60  # Flush alarms older than this
        # Cooldown tracker: {(bed_id, alarm_type): last_timestamp}
        self._last_alarm_time: dict[tuple[str, AlarmType], datetime] = {}

    def process_alarm(
        self,
        alarm: Alarm,
        is_planned_activity: bool = False,
    ) -> Optional[Incident]:
        """
        Process a new alarm: either add to an existing incident
        or create a new one.

        Returns the Incident this alarm belongs to, or None if
        the alarm was suppressed by cooldown.
        """
        bed_id = alarm.bed_id

        # Initialize per-bed structures
        if bed_id not in self.active_incidents:
            self.active_incidents[bed_id] = []
            self.alarm_buffer[bed_id] = []

        # ── Cooldown check: same alarm type within N seconds ─────
        cooldown_key = (bed_id, alarm.alarm_type)
        now = alarm.timestamp
        last = self._last_alarm_time.get(cooldown_key)
        if last and (now - last).total_seconds() < ALARM_COOLDOWN_S:
            # Still in cooldown — silently add to existing incident
            # but don't create new one and don't log
            matched = self._find_existing_for_type(alarm)
            if matched:
                self._add_alarm_to_incident(matched, alarm)
            return matched  # may be None, that's ok — alarm is just skipped
        self._last_alarm_time[cooldown_key] = now

        # Add to alarm buffer
        self.alarm_buffer[bed_id].append(alarm)
        self._flush_old_alarms(bed_id)

        # Determine correlation window
        window = (
            PLANNED_ACTIVITY_WINDOW_S if is_planned_activity
            else CORRELATION_WINDOW_S
        )

        # ── Tier 1: group with existing same-type Tier 1, or create ──
        if alarm.is_tier1:
            existing = self._find_existing_for_type(alarm)
            if existing:
                self._add_alarm_to_incident(existing, alarm)
                return existing
            incident = self._create_incident(alarm, "Tier 1 critical alarm — fixed safety rule")
            if is_planned_activity:
                incident.is_planned_activity = True
                incident.context_label += " (during planned activity — alarm NOT suppressed)"
            return incident

        # ── Try to correlate with existing active incidents ──────
        matched_incident = self._try_correlate_existing(alarm, window)
        if matched_incident:
            self._add_alarm_to_incident(matched_incident, alarm)
            if alarm.context_label:
                matched_incident.context_label = alarm.context_label
            return matched_incident

        # ── Try pattern-based correlation with recent alarms ─────
        pattern_match = self._try_pattern_correlation(alarm, bed_id, window)
        if pattern_match:
            return pattern_match

        # ── No correlation: create new incident ──────────────────
        incident = self._create_incident(alarm)
        if is_planned_activity:
            incident.is_planned_activity = True
            incident.context_label = "during planned activity"
        return incident

    def _find_existing_for_type(self, alarm: Alarm) -> Optional[Incident]:
        """Find an existing active or acknowledged incident that already contains this alarm type."""
        for incident in self.active_incidents.get(alarm.bed_id, []):
            if incident.status not in (IncidentStatus.ACTIVE, IncidentStatus.ACKNOWLEDGED, IncidentStatus.ESCALATED):
                continue
            # Respect 120s silence window for acknowledged incidents
            if incident.status == IncidentStatus.ACKNOWLEDGED and incident.acknowledged_at:
                elapsed = (datetime.now() - incident.acknowledged_at).total_seconds()
                if elapsed > 120:
                    incident.status = IncidentStatus.ACTIVE
            if any(a.alarm_type == alarm.alarm_type for a in incident.alarms):
                return incident
        return None

    def _add_alarm_to_incident(self, incident: Incident, alarm: Alarm):
        """Add alarm to incident, capping at MAX_ALARMS_PER_INCIDENT."""
        incident.alarms.append(alarm)
        # Keep only the most recent N alarms to prevent memory explosion
        if len(incident.alarms) > MAX_ALARMS_PER_INCIDENT:
            incident.alarms = incident.alarms[-MAX_ALARMS_PER_INCIDENT:]
        incident.update_priority()

    def _create_incident(self, alarm: Alarm, reason: str = "") -> Incident:
        """Create a new incident from a single alarm."""
        incident = Incident(
            bed_id=alarm.bed_id,
            profile=alarm.profile,
            alarms=[alarm],
            priority=alarm.priority,
            correlation_reason=reason or "Single alarm event",
            context_label=alarm.context_label,
        )
        self.active_incidents[alarm.bed_id].append(incident)
        logger.info(
            f"New incident {incident.id} on bed {alarm.bed_id}: "
            f"{alarm.alarm_type.value} (priority {alarm.priority})"
        )
        return incident

    def _try_correlate_existing(
        self, alarm: Alarm, window_s: float
    ) -> Optional[Incident]:
        """
        Try to add this alarm to an existing active incident
        based on time proximity and alarm type compatibility.
        """
        bed_id = alarm.bed_id
        now = alarm.timestamp
        cutoff = now - timedelta(seconds=window_s)

        for incident in self.active_incidents.get(bed_id, []):
            if incident.status not in (IncidentStatus.ACTIVE, IncidentStatus.ACKNOWLEDGED, IncidentStatus.ESCALATED):
                continue

            # Check time window
            if incident.created_at < cutoff:
                continue

            # Check if any correlation group links this alarm with incident alarms
            incident_types = {a.alarm_type for a in incident.alarms}
            for group_name, group in CORRELATION_GROUPS.items():
                if alarm.alarm_type in group["members"]:
                    overlap = incident_types & group["members"]
                    if overlap:
                        incident.correlation_reason = group["reason"]
                        incident.context_label = group["context"]
                        return incident

            # Same alarm type recurring → same incident
            if alarm.alarm_type in incident_types:
                incident.correlation_reason = f"Recurring {alarm.alarm_type.value} alarm"
                return incident

        return None

    def _try_pattern_correlation(
        self, alarm: Alarm, bed_id: str, window_s: float
    ) -> Optional[Incident]:
        """
        Look for pattern matches in the recent alarm buffer
        to create a new grouped incident.
        """
        now = alarm.timestamp
        cutoff = now - timedelta(seconds=window_s)

        recent = [
            a for a in self.alarm_buffer[bed_id]
            if a.timestamp >= cutoff and a.id != alarm.id
        ]

        if not recent:
            return None

        recent_types = {a.alarm_type for a in recent}
        all_types = recent_types | {alarm.alarm_type}

        for group_name, group in CORRELATION_GROUPS.items():
            overlap = all_types & group["members"]
            if len(overlap) >= group["min_count"]:
                # Found a pattern match — group these alarms
                matching_alarms = [
                    a for a in recent
                    if a.alarm_type in group["members"]
                ]
                matching_alarms.append(alarm)

                # Remove these alarms from other incidents
                # (they were individual incidents before)
                self._detach_alarms_from_incidents(
                    bed_id, [a.id for a in matching_alarms[:-1]]
                )

                incident = Incident(
                    bed_id=bed_id,
                    profile=alarm.profile,
                    alarms=matching_alarms,
                    correlation_reason=group["reason"],
                    context_label=group["context"],
                )
                incident.update_priority()
                self.active_incidents[bed_id].append(incident)

                logger.info(
                    f"Pattern match '{group_name}': {len(matching_alarms)} alarms "
                    f"grouped into incident {incident.id}"
                )
                return incident

        return None

    def _detach_alarms_from_incidents(self, bed_id: str, alarm_ids: list[str]):
        """Remove alarms from their old incidents (they're being regrouped)."""
        to_remove = []
        for incident in self.active_incidents.get(bed_id, []):
            incident.alarms = [a for a in incident.alarms if a.id not in alarm_ids]
            if not incident.alarms:
                to_remove.append(incident)

        for incident in to_remove:
            self.active_incidents[bed_id].remove(incident)

    def _flush_old_alarms(self, bed_id: str):
        """Remove old alarms from the buffer."""
        cutoff = datetime.now() - timedelta(seconds=self.BUFFER_MAX_AGE_S)
        self.alarm_buffer[bed_id] = [
            a for a in self.alarm_buffer[bed_id]
            if a.timestamp >= cutoff
        ]

    def acknowledge_incident(
        self, incident_id: str, by: str
    ) -> Optional[Incident]:
        """Acknowledge an incident. Returns the incident if found."""
        for bed_incidents in self.active_incidents.values():
            for incident in bed_incidents:
                if incident.id == incident_id:
                    incident.status = IncidentStatus.ACKNOWLEDGED
                    incident.acknowledged_at = datetime.now()
                    incident.acknowledged_by = by
                    logger.info(
                        f"Incident {incident_id} acknowledged by {by}"
                    )
                    return incident
        return None

    def resolve_incident(self, incident_id: str) -> Optional[Incident]:
        """Resolve an incident."""
        for bed_incidents in self.active_incidents.values():
            for incident in bed_incidents:
                if incident.id == incident_id:
                    incident.status = IncidentStatus.RESOLVED
                    incident.resolved_at = datetime.now()
                    for alarm in incident.alarms:
                        alarm.resolved = True
                        alarm.resolved_at = datetime.now()
                    logger.info(f"Incident {incident_id} resolved")
                    return incident
        return None

    def get_active_incidents(self, bed_id: Optional[str] = None) -> list[Incident]:
        """Get all active (unresolved) incidents, optionally filtered by bed."""
        incidents = []
        for bid, bed_incidents in self.active_incidents.items():
            if bed_id and bid != bed_id:
                continue
            for incident in bed_incidents:
                if incident.status in (IncidentStatus.ACTIVE, IncidentStatus.ACKNOWLEDGED, IncidentStatus.ESCALATED):
                    incidents.append(incident)
        # Sort by priority (highest first), then by timestamp (newest first)
        incidents.sort(
            key=lambda i: (-i.priority, i.created_at),
            reverse=False,
        )
        return incidents

    def cleanup_resolved(self, max_age_minutes: int = 30) -> int:
        """Remove resolved incidents older than max_age_minutes. Returns count removed."""
        cutoff = datetime.now() - timedelta(minutes=max_age_minutes)
        removed = 0
        for bed_id in list(self.active_incidents.keys()):
            before = len(self.active_incidents[bed_id])
            self.active_incidents[bed_id] = [
                i for i in self.active_incidents[bed_id]
                if not (
                    i.status == IncidentStatus.RESOLVED
                    and i.resolved_at
                    and i.resolved_at < cutoff
                )
            ]
            removed += before - len(self.active_incidents[bed_id])
        return removed
