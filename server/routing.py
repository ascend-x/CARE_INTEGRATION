"""
CARE — Clinical Action and Response Engine
BIU Server: Routing & Escalation Engine

Routes alerts to the right role. Escalates if unacknowledged.

SAFETY: Routing ADDS recipients, never removes default ones.
AI may suggest additional recipients but the defaults from the
bed profile are always included.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

from models import (
    Alarm,
    AlarmPriority,
    AlarmType,
    BedProfile,
    Incident,
    IncidentStatus,
    Role,
    TechTask,
    EscalationConfig,
    DutyStatus,
    DutyRosterState,
)
from bed_profiles import BedProfileManager

logger = logging.getLogger("care.routing")


class RoutingEngine:
    """
    Routes incidents to the right roles and manages escalation timers.
    """

    def __init__(
        self,
        profile_manager: BedProfileManager,
        escalation_config: Optional[EscalationConfig] = None,
        duty_roster: Optional[DutyRosterState] = None,
    ):
        self.profile_manager = profile_manager
        self.config = escalation_config or EscalationConfig()
        self.duty_roster = duty_roster

        # Track escalation state per incident
        self.escalation_state: dict[str, dict] = {}

        # Repeated alarm tracking for Technician tasks
        self.alarm_repeat_counts: dict[str, dict[str, int]] = {}
        # bed_id → { alarm_type → count }

        # Active tech tasks
        self.tech_tasks: list[TechTask] = []

    def route_incident(self, incident: Incident) -> list[Role]:
        """
        Determine routing for an incident.
        Returns list of roles to notify.
        """
        bed_id = incident.bed_id
        all_roles: set[Role] = set()

        for alarm in incident.alarms:
            routing = self.profile_manager.get_routing(bed_id, alarm.alarm_type)
            roles = routing.get("roles", [Role.NURSE])
            all_roles.update(roles)

            # Also include copy_to roles
            copy_to = routing.get("copy_to", [])
            all_roles.update(copy_to)

        # Duty Handover & Unavailability Auto-Forwarding
        if self.duty_roster and self.duty_roster.duty_status != DutyStatus.ACTIVE:
            if Role.DOCTOR in all_roles:
                all_roles.add(Role.CHARGE_NURSE)
                status_desc = "IN SURGERY" if self.duty_roster.duty_status == DutyStatus.IN_PROCEDURE else "OFF-DUTY"
                incident.context_label = (
                    f"Auto-forwarded: {self.duty_roster.current_doctor} is {status_desc} "
                    f"➔ Covered by {self.duty_roster.covering_doctor}"
                )
                if "[COVERAGE:" not in incident.correlation_reason:
                    incident.correlation_reason = (
                        f"[COVERAGE: {self.duty_roster.covering_doctor}] {incident.correlation_reason}"
                    )
                logger.warning(
                    f"Attending {self.duty_roster.current_doctor} is {self.duty_roster.duty_status.value} — "
                    f"incident {incident.id} auto-forwarded to {self.duty_roster.covering_doctor} & Charge Nurse"
                )

        # During planned activity, still route to all default recipients
        # (CARE never removes recipients during planned activity)
        if incident.is_planned_activity:
            logger.info(
                f"Incident {incident.id} during planned activity — "
                f"routing to all default recipients, alarm NOT suppressed"
            )

        incident.routed_to = list(all_roles)

        # Initialize escalation timer
        self._init_escalation(incident)

        # Track repeated alarms for tech tasks
        self._track_repeated_alarms(incident)

        logger.info(
            f"Incident {incident.id} routed to: "
            f"{[r.value for r in incident.routed_to]}"
        )
        return incident.routed_to

    def check_escalations(self) -> list[dict]:
        """
        Check all active incidents for escalation.
        Called periodically (e.g., every 5 seconds).

        Returns list of escalation events:
        [{"incident_id": ..., "new_roles": [...], "level": ...}]
        """
        events = []
        now = datetime.now()

        for incident_id, state in list(self.escalation_state.items()):
            incident: Incident = state.get("incident")
            if not incident:
                continue

            # Skip if already acknowledged or resolved
            if incident.status in (
                IncidentStatus.ACKNOWLEDGED,
                IncidentStatus.RESOLVED,
            ):
                continue

            # Calculate timeout based on priority
            timeout_s = self._get_timeout(incident.priority, state["level"])
            deadline = state["timer_start"] + timedelta(seconds=timeout_s)

            if now >= deadline:
                # Time to escalate
                new_level = state["level"] + 1
                if new_level > self.config.max_escalation_level:
                    # Already at max — keep alerting at current level
                    state["timer_start"] = now  # Reset timer
                    continue

                # Get next escalation targets
                new_roles = self.profile_manager.get_escalation_path(
                    incident.bed_id, incident.routed_to
                )

                if new_roles:
                    # ADD new recipients (never remove existing)
                    for role in new_roles:
                        if role not in incident.routed_to:
                            incident.routed_to.append(role)

                    incident.status = IncidentStatus.ESCALATED
                    incident.escalation_level = new_level

                    state["level"] = new_level
                    state["timer_start"] = now

                    event = {
                        "incident_id": incident_id,
                        "bed_id": incident.bed_id,
                        "new_roles": [r.value for r in new_roles],
                        "level": new_level,
                        "priority": incident.priority,
                    }
                    events.append(event)

                    logger.warning(
                        f"Escalation level {new_level} for incident {incident_id}: "
                        f"adding {[r.value for r in new_roles]}"
                    )

        return events

    def _init_escalation(self, incident: Incident):
        """Initialize the escalation timer for a new incident."""
        self.escalation_state[incident.id] = {
            "incident": incident,
            "level": 0,
            "timer_start": datetime.now(),
        }

    def _get_timeout(self, priority: AlarmPriority, level: int) -> int:
        """Get escalation timeout in seconds based on priority and level."""
        if level == 0:
            # Initial timeout
            if priority == AlarmPriority.CRITICAL:
                return self.config.critical_initial_timeout
            elif priority == AlarmPriority.MEDIUM:
                return self.config.medium_initial_timeout
            else:
                return self.config.low_initial_timeout
        else:
            # Subsequent escalations
            return self.config.escalation_step_timeout

    def _track_repeated_alarms(self, incident: Incident):
        """
        Track repeated alarms per bed for Technician task creation.
        If a specific alarm type repeats N times, create a tech task.
        """
        bed_id = incident.bed_id
        if bed_id not in self.alarm_repeat_counts:
            self.alarm_repeat_counts[bed_id] = {}

        for alarm in incident.alarms:
            alarm_key = alarm.alarm_type.value
            routing = self.profile_manager.get_routing(bed_id, alarm.alarm_type)
            tech_threshold = routing.get("tech_task_after_repeats")

            if tech_threshold:
                count = self.alarm_repeat_counts[bed_id].get(alarm_key, 0) + 1
                self.alarm_repeat_counts[bed_id][alarm_key] = count

                if count >= tech_threshold:
                    # Create Technician task
                    self._create_tech_task(bed_id, alarm, count)
                    # Reset counter
                    self.alarm_repeat_counts[bed_id][alarm_key] = 0

    def _create_tech_task(self, bed_id: str, alarm: Alarm, alarm_count: int):
        """Create a Technician task from repeated false alarms."""
        # Determine task type from alarm
        task_types = {
            AlarmType.SPO2_LOW: ("probe_check", "SpO2 probe check — repeated false alarms suggest sensor issue"),
            AlarmType.LEAD_OFF: ("lead_replacement", "ECG lead replacement — repeated disconnections"),
            AlarmType.ECG_NOISE: ("ecg_check", "ECG signal check — persistent noise"),
        }

        task_type, description = task_types.get(
            alarm.alarm_type,
            ("sensor_check", f"Sensor check — repeated {alarm.alarm_type.value} alarms"),
        )

        task = TechTask(
            bed_id=bed_id,
            task_type=task_type,
            description=description,
            alarm_type=alarm.alarm_type,
            alarm_count=alarm_count,
        )

        self.tech_tasks.append(task)

        logger.info(
            f"Technician task created: {task.id} — {task_type} on bed {bed_id} "
            f"(after {alarm_count} repeated {alarm.alarm_type.value} alarms). "
            f"Nurse alerts CONTINUE."
        )

        return task

    def get_pending_tech_tasks(self) -> list[TechTask]:
        """Get all open technician tasks."""
        return [t for t in self.tech_tasks if t.status == "open"]

    def complete_tech_task(self, task_id: str) -> Optional[TechTask]:
        """Mark a technician task as completed."""
        for task in self.tech_tasks:
            if task.id == task_id:
                task.status = "completed"
                task.completed_at = datetime.now()
                logger.info(f"Tech task {task_id} completed")
                return task
        return None

    def get_role_view(self, role: Role) -> list[Incident]:
        """
        Get incidents relevant to a specific role.
        Each role sees only what they need.
        """
        incidents = []
        for state in self.escalation_state.values():
            incident = state.get("incident")
            if incident and role in incident.routed_to:
                if incident.status in (
                    IncidentStatus.ACTIVE,
                    IncidentStatus.ESCALATED,
                ):
                    incidents.append(incident)

        # Sort by priority (highest first)
        incidents.sort(key=lambda i: (-i.priority, i.created_at))
        return incidents

    def on_acknowledge(self, incident_id: str, by: str, role: Role):
        """Handle incident acknowledgment."""
        if incident_id in self.escalation_state:
            state = self.escalation_state[incident_id]
            incident = state["incident"]
            incident.status = IncidentStatus.ACKNOWLEDGED
            incident.acknowledged_at = datetime.now()
            incident.acknowledged_by = by
            logger.info(f"Incident {incident_id} acknowledged by {by} ({role.value})")
