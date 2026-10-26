"""
CARE — Clinical Action and Response Engine
BIU Server: Main Application

FastAPI server that ties everything together:
- Serial listener (hardware mode)
- Simulator (demo mode)
- Signal quality, correlation, routing engines
- REST API + WebSocket for the dashboard

Usage:
    # Simulator mode (no hardware needed):
    python main.py --simulate

    # Hardware mode (3 Arduinos connected):
    python main.py --serial /dev/ttyUSB0,/dev/ttyUSB1,/dev/ttyUSB2

    # Both (hardware + simulated devices):
    python main.py --serial /dev/ttyUSB0 --simulate
"""

import asyncio
import json
import sys
import os
import logging
import threading
import argparse
from datetime import datetime
from typing import Optional
from collections import deque
from contextlib import asynccontextmanager
from uuid import uuid4

from pydantic import BaseModel
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn

class PatientAdmissionRequest(BaseModel):
    patient_name: str
    patient_mrn: Optional[str] = None
    patient_age: Optional[int] = None
    patient_gender: Optional[str] = None
    profile: Optional[str] = "cardiac"
    primary_diagnosis: Optional[str] = ""
    clinical_conditions: Optional[list[str]] = []
    attending_doctor: Optional[str] = "Dr. Sharma"
    assigned_nurse: Optional[str] = "Nurse Priya"

# Local modules
from models import (
    Alarm,
    AlarmType,
    AlarmPriority,
    BedProfile,
    BedState,
    Incident,
    IncidentStatus,
    NodeStatus,
    Role,
    SignalQualityLevel,
    SystemState,
    TechTask,
    VitalSigns,
    TIER1_ALARMS,
    DutyStatus,
    DutyRosterState,
)
from serial_listener import SerialManager
from simulator import SimulatorManager
from signal_quality import SignalQualityEngine
from correlation import CorrelationEngine
from bed_profiles import BedProfileManager
from routing import RoutingEngine
from websocket_manager import ConnectionManager

# ─── Logging Setup ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)-20s] %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("care.main")

# ─── Global State ───────────────────────────────────────────────────
state = SystemState()
signal_engine = SignalQualityEngine()
correlation_engine = CorrelationEngine()
profile_manager = BedProfileManager()
routing_engine = RoutingEngine(profile_manager, duty_roster=state.duty_roster)
ws_manager = ConnectionManager()
serial_manager: Optional[SerialManager] = None
simulator_manager: Optional[SimulatorManager] = None

# Data buffers for waveform history (for the dashboard)
vitals_buffer: dict[str, deque] = {}
VITALS_BUFFER_SIZE = 300  # ~30 seconds at 10Hz

# Async event loop reference for cross-thread communication
_loop: Optional[asyncio.AbstractEventLoop] = None

# ─── Parse CLI Arguments ────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="CARE BIU Server")
    parser.add_argument(
        "--simulate", action="store_true", default=True,
        help="Enable simulator mode (generates synthetic data)"
    )
    parser.add_argument(
        "--serial", type=str, default="",
        help="Comma-separated serial ports (e.g., /dev/ttyUSB0,/dev/ttyUSB1)"
    )
    parser.add_argument(
        "--host", type=str, default="0.0.0.0",
        help="Server host (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port", type=int, default=8000,
        help="Server port (default: 8000)"
    )
    return parser.parse_args()


# ─── Data Processing Pipeline ───────────────────────────────────────

def on_data_received(packet: dict):
    """
    Main data processing pipeline.
    Called for every packet from serial or simulator.

    Flow:
    1. Parse → VitalSigns
    2. Signal Quality check
    3. Alarm evaluation
    4. Correlation (grouping)
    5. Routing
    6. Push to WebSocket
    """
    try:
        node_id = packet.get("node", 0)
        profile_str = packet.get("profile", "cardiac")
        profile = BedProfile(profile_str)
        bed_id = f"bed-{node_id}"

        # ── 1. Parse vitals ──────────────────────────────────────
        raw_spo2 = packet.get("spo2")
        raw_spo2_proxy = packet.get("spo2_proxy", 512)
        parsed_spo2 = int(raw_spo2) if raw_spo2 is not None else None

        vitals = VitalSigns(
            heart_rate=packet.get("hr", 0),
            heart_rate_raw=packet.get("hr_raw", 512),
            ecg_value=packet.get("ecg", 512),
            ecg_quality=packet.get("ecg_quality", 100),
            temperature=packet.get("temp", 0.0),
            spo2_proxy=raw_spo2_proxy,
            spo2=parsed_spo2,
            spo2_rapid_decline=packet.get("spo2_rapid_decline", False),
            lead_off=packet.get("lead_off", False),
            timestamp=datetime.now(),
        )

        # Parse simulated device data if present
        sim_data = packet.get("sim_data", {})
        if "vent" in sim_data:
            v = sim_data["vent"]
            vitals.vent_pressure = v.get("pressure", 0)
            vitals.vent_tidal_volume = v.get("tidal_volume", 0)
            vitals.vent_rate = v.get("rate", 0)
            vitals.vent_fio2 = v.get("fio2", 0.21)
            vitals.vent_connected = v.get("connected", True)
            vitals.vent_battery = v.get("battery", 100)
        if "dialysis" in sim_data:
            d = sim_data["dialysis"]
            vitals.dial_blood_flow = d.get("blood_flow", 0)
            vitals.dial_venous_pressure = d.get("venous_pressure", 0)
            vitals.dial_arterial_pressure = d.get("arterial_pressure", 0)
            vitals.dial_uf_rate = d.get("uf_rate", 0)
            vitals.dial_blood_leak = d.get("blood_leak", False)
        if "pump" in sim_data:
            p = sim_data["pump"]
            vitals.pump_rate = p.get("rate", 0)
            vitals.pump_volume_remaining = p.get("volume_remaining", 0)
            vitals.pump_occlusion = p.get("occlusion", False)

        # ── 2. Update bed state ──────────────────────────────────
        if bed_id not in state.beds:
            state.beds[bed_id] = BedState(
                bed_id=bed_id,
                node_id=node_id,
                profile=profile,
            )
            profile_manager.set_profile(bed_id, profile)

        bed = state.beds[bed_id]
        bed.vitals = vitals
        bed.node_status = NodeStatus.ONLINE
        bed.last_data_received = datetime.now()

        # Store vitals history
        if bed_id not in vitals_buffer:
            vitals_buffer[bed_id] = deque(maxlen=VITALS_BUFFER_SIZE)
        vitals_buffer[bed_id].append(vitals)

        # ── 3. Signal Quality ────────────────────────────────────
        sq_result = signal_engine.evaluate(node_id, vitals, profile)
        bed.signal_quality = sq_result["overall_quality"]

        # ── 4. Process alarms ────────────────────────────────────
        alarm_names = packet.get("alarms", [])
        for alarm_name in alarm_names:
            try:
                alarm_type = AlarmType(alarm_name)
            except ValueError:
                continue

            # Get routing info for priority
            routing_info = profile_manager.get_routing(bed_id, alarm_type)
            is_tier1 = profile_manager.is_tier1(bed_id, alarm_type)

            alarm = Alarm(
                alarm_type=alarm_type,
                node_id=node_id,
                bed_id=bed_id,
                profile=profile,
                priority=AlarmPriority(routing_info.get("priority", 2)),
                source="simulator" if packet.get("_simulated") else "arduino",
                vitals_snapshot=vitals,
                signal_quality=sq_result["overall_quality"],
                is_tier1=is_tier1,
                is_artifact=sq_result["is_artifact"],
                artifact_confidence=sq_result["artifact_confidence"],
                context_label=sq_result["context_label"] if sq_result["is_artifact"] else "",
            )

            # ── 5. Correlation ───────────────────────────────────
            incident = correlation_engine.process_alarm(
                alarm,
                is_planned_activity=bed.planned_activity,
            )

            # Skip if alarm was suppressed by cooldown
            if incident is None:
                continue

            # ── 6. Routing ──────────────────────────────────────
            if incident.status == IncidentStatus.ACTIVE and incident.alarm_count == 1:
                # New incident — route it
                routing_engine.route_incident(incident)

            # Update bed state
            bed.active_alarms = [
                a for a in bed.active_alarms
                if not a.resolved
            ][-20:]  # Cap active alarms list
            bed.active_alarms.append(alarm)
            bed.total_alarms += 1

            # Update active incidents (limit to 20 most recent)
            active = correlation_engine.get_active_incidents(bed_id)
            bed.active_incidents = active[-20:]

        # ── 7. Push to WebSocket ─────────────────────────────────
        if _loop:
            asyncio.run_coroutine_threadsafe(
                _push_updates(bed_id, bed, vitals, sq_result, packet),
                _loop
            )

    except Exception as e:
        logger.error(f"Data processing error: {e}", exc_info=True)


async def _push_updates(
    bed_id: str,
    bed: BedState,
    vitals: VitalSigns,
    sq_result: dict,
    raw_packet: dict,
):
    """Push real-time updates to WebSocket clients."""
    # Vitals update (high frequency)
    vitals_data = {
        "bed_id": bed_id,
        "node_id": bed.node_id,
        "profile": bed.profile.value,
        "hr": vitals.heart_rate,
        "hr_raw": vitals.heart_rate_raw,
        "ecg": vitals.ecg_value,
        "ecg_quality": vitals.ecg_quality,
        "temp": vitals.temperature,
        "spo2": vitals.spo2 if vitals.spo2 is not None else (min(100, max(50, round(vitals.spo2_proxy / 6.0))) if vitals.spo2_proxy else 98),
        "spo2_proxy": vitals.spo2_proxy,
        "lead_off": vitals.lead_off,
        "signal_quality": sq_result["overall_quality"].value,
        "is_artifact": sq_result["is_artifact"],
        "artifact_type": sq_result["artifact_type"],
        "context_label": sq_result["context_label"],
        "node_status": bed.node_status.value,
        "planned_activity": bed.planned_activity,
        # Simulated device data
        "vent_pressure": vitals.vent_pressure,
        "vent_tidal_volume": vitals.vent_tidal_volume,
        "vent_rate": vitals.vent_rate,
        "vent_fio2": vitals.vent_fio2,
        "vent_connected": vitals.vent_connected,
        "vent_battery": vitals.vent_battery,
        "dial_blood_flow": vitals.dial_blood_flow,
        "dial_venous_pressure": vitals.dial_venous_pressure,
        "dial_blood_leak": vitals.dial_blood_leak,
        "pump_rate": vitals.pump_rate,
        "pump_volume_remaining": vitals.pump_volume_remaining,
    }
    await ws_manager.broadcast("vitals", vitals_data)

    # Active alarms/incidents (lower frequency — only when changed)
    if raw_packet.get("alarms"):
        incidents_data = []
        for incident in bed.active_incidents:
            incidents_data.append({
                "id": incident.id,
                "bed_id": incident.bed_id,
                "profile": incident.profile.value,
                "priority": int(incident.priority),
                "status": incident.status.value,
                "alarm_count": incident.alarm_count,
                "correlation_reason": incident.correlation_reason,
                "context_label": incident.context_label,
                "created_at": incident.created_at.isoformat(),
                "routed_to": [r.value for r in incident.routed_to],
                "escalation_level": incident.escalation_level,
                "is_planned_activity": incident.is_planned_activity,
                "alarms": [
                    {
                        "id": a.id,
                        "type": a.alarm_type.value,
                        "priority": int(a.priority),
                        "is_tier1": a.is_tier1,
                        "is_artifact": a.is_artifact,
                        "artifact_confidence": a.artifact_confidence,
                        "context_label": a.context_label,
                        "signal_quality": a.signal_quality.value if isinstance(a.signal_quality, SignalQualityLevel) else a.signal_quality,
                        "timestamp": a.timestamp.isoformat(),
                    }
                    for a in incident.alarms[-10:]  # Send only last 10 alarms
                ],
            })

        await ws_manager.broadcast("incidents", {
            "bed_id": bed_id,
            "incidents": incidents_data,
        })


# ─── Escalation Checker ─────────────────────────────────────────────

async def escalation_checker():
    """Periodically check for escalations."""
    while True:
        await asyncio.sleep(5)
        try:
            events = routing_engine.check_escalations()
            for event in events:
                await ws_manager.broadcast("escalation", event)
        except Exception as e:
            logger.error(f"Escalation check error: {e}")


# ─── Cleanup Task ───────────────────────────────────────────────────

async def cleanup_task():
    """Periodically clean up resolved incidents."""
    while True:
        await asyncio.sleep(60)
        try:
            removed = correlation_engine.cleanup_resolved(max_age_minutes=30)
            if removed > 0:
                logger.info(f"Cleaned up {removed} resolved incidents")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


# ─── FastAPI App ─────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    global _loop, simulator_manager, serial_manager

    _loop = asyncio.get_event_loop()
    logger.info("=" * 60)
    logger.info("  CARE — Clinical Action and Response Engine")
    logger.info("  BIU Server starting...")
    logger.info("=" * 60)

    # Setup bed profiles
    profile_manager.set_profile("bed-1", BedProfile.CARDIAC)
    profile_manager.set_profile("bed-2", BedProfile.KIDNEY)
    profile_manager.set_profile("bed-3", BedProfile.RESPIRATORY)

    # Initialize bed states — Beds are templates, patients are assigned to beds
    bed_configs = [
        ("bed-1", 1, BedProfile.CARDIAC, "Eleanor Vance", "MRN-88412", 64, "Female", "Acute Anterior STEMI (Post-PCI)", ["Known Atrial Fibrillation", "High Fall Risk"], "Dr. Sharma", "Nurse Priya"),
        ("bed-2", 2, BedProfile.KIDNEY, "Marcus Chen", "MRN-91204", 58, "Male", "End-Stage Renal Disease on Hemodialysis", ["Fluid Overload Risk", "AV Fistula Right Arm"], "Dr. Sharma", "Nurse Amit"),
        ("bed-3", 3, BedProfile.RESPIRATORY, None, None, None, None, None, [], None, None),  # Unoccupied Bed 03
    ]
    for bed_id, node_id, profile, name, mrn, age, gender, diag, conds, doc, nurse in bed_configs:
        state.beds[bed_id] = BedState(
            bed_id=bed_id,
            node_id=node_id,
            profile=profile,
            patient_name=name,
            patient_id=mrn,
            patient_mrn=mrn,
            patient_age=age,
            patient_gender=gender,
            primary_diagnosis=diag,
            clinical_conditions=conds,
            attending_doctor=doc,
            assigned_nurse=nurse,
            is_occupied=bool(name),
            admitted_at=datetime.now() if name else None,
        )

    # Start simulator
    args = parse_args()
    if args.simulate:
        simulator_manager = SimulatorManager(on_data=on_data_received)
        simulator_manager.setup_default_beds()
        simulator_manager.start()
        state.simulator_mode = True
        logger.info("✓ Simulator mode enabled")

    # Start serial listeners
    if args.serial:
        ports = args.serial.split(",")
        serial_manager = SerialManager(on_data=on_data_received)
        for i, port in enumerate(ports):
            serial_manager.add_port(port.strip(), node_id=i + 1)
        serial_manager.start_all()
        state.hardware_mode = True
        logger.info(f"✓ Serial listeners started on: {ports}")

    # Start background tasks
    asyncio.create_task(escalation_checker())
    asyncio.create_task(cleanup_task())

    logger.info(f"✓ Server ready at http://{args.host}:{args.port}")
    logger.info(f"✓ Dashboard at http://{args.host}:{args.port}/")
    logger.info(f"✓ API docs at http://{args.host}:{args.port}/docs")

    yield

    # Shutdown
    logger.info("Shutting down...")
    if simulator_manager:
        simulator_manager.stop()
    if serial_manager:
        serial_manager.stop_all()


app = FastAPI(
    title="CARE — Clinical Action and Response Engine",
    description="AI-assisted alarm correlation and role-based escalation for ICUs",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── REST API Endpoints ─────────────────────────────────────────────

@app.get("/api/status")
async def get_system_status():
    """Get overall system status."""
    return {
        "care_online": state.care_online,
        "simulator_mode": state.simulator_mode,
        "hardware_mode": state.hardware_mode,
        "uptime_seconds": (datetime.now() - state.start_time).total_seconds(),
        "beds_count": len(state.beds),
        "active_connections": ws_manager.get_connection_count(),
        "serial_status": serial_manager.get_status() if serial_manager else {},
    }


@app.get("/api/beds")
async def get_all_beds():
    """Get all beds with current status."""
    beds = []
    for bed_id, bed in state.beds.items():
        beds.append(_bed_to_dict(bed))
    return {"beds": beds}


@app.get("/api/beds/{bed_id}")
async def get_bed(bed_id: str):
    """Get detailed info for a specific bed."""
    bed = state.beds.get(bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")
    return _bed_to_dict(bed)


@app.post("/api/beds/{bed_id}/admit")
async def admit_patient(bed_id: str, req: PatientAdmissionRequest):
    """Admit a patient and allocate a bed template with clinical conditions."""
    bed = state.beds.get(bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")

    try:
        prof = BedProfile(req.profile.lower())
    except (ValueError, AttributeError):
        prof = BedProfile.CARDIAC

    bed.patient_name = req.patient_name
    bed.patient_id = req.patient_mrn or f"MRN-{uuid4().hex[:6].upper()}"
    bed.patient_mrn = bed.patient_id
    bed.patient_age = req.patient_age
    bed.patient_gender = req.patient_gender
    bed.primary_diagnosis = req.primary_diagnosis
    bed.clinical_conditions = req.clinical_conditions or []
    bed.attending_doctor = req.attending_doctor or "Dr. Sharma"
    bed.assigned_nurse = req.assigned_nurse or "Nurse Priya"
    bed.is_occupied = True
    bed.admitted_at = datetime.now()
    bed.profile = prof

    profile_manager.set_profile(bed_id, prof)

    # If simulator is active, apply profile and baseline vitals to simulator node
    if simulator_manager and bed.node_id in simulator_manager.simulators:
        sim = simulator_manager.simulators[bed.node_id]
        sim.profile = prof
        sim._init_baselines()
        sim.hr = sim.hr_baseline
        sim.temp = sim.temp_baseline
        sim.spo2_proxy = sim.spo2_baseline

    # Broadcast updated bed state over WebSocket
    beds_dict = {b_id: _bed_to_dict(b) for b_id, b in state.beds.items()}
    await ws_manager.broadcast("init", {"beds": beds_dict})

    logger.info(f"✓ Patient '{bed.patient_name}' admitted to {bed_id} ({prof.value} template)")
    return {"status": "admitted", "bed": _bed_to_dict(bed)}


@app.post("/api/beds/{bed_id}/discharge")
async def discharge_patient(bed_id: str):
    """Discharge/de-assign patient from a bed, returning bed to vacant template."""
    bed = state.beds.get(bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")

    old_patient = bed.patient_name
    bed.patient_name = None
    bed.patient_id = None
    bed.patient_mrn = None
    bed.patient_age = None
    bed.patient_gender = None
    bed.primary_diagnosis = None
    bed.clinical_conditions = []
    bed.attending_doctor = None
    bed.assigned_nurse = None
    bed.is_occupied = False
    bed.admitted_at = None
    bed.active_alarms = []
    bed.active_incidents = []

    # Reset simulator node to idle/normal
    if simulator_manager and bed.node_id in simulator_manager.simulators:
        sim = simulator_manager.simulators[bed.node_id]
        sim._init_baselines()
        sim.hr = 70
        sim.temp = 36.8
        sim.spo2_proxy = 650

    # Broadcast updated beds over WebSocket
    beds_dict = {b_id: _bed_to_dict(b) for b_id, b in state.beds.items()}
    await ws_manager.broadcast("init", {"beds": beds_dict})

    logger.info(f"✓ Patient '{old_patient}' discharged from {bed_id}. Bed is now vacant.")
    return {"status": "discharged", "bed_id": bed_id, "discharged_patient": old_patient}


@app.get("/api/beds/{bed_id}/vitals")
async def get_bed_vitals(bed_id: str):
    """Get current vitals for a bed."""
    bed = state.beds.get(bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")

    history = []
    if bed_id in vitals_buffer:
        for v in list(vitals_buffer[bed_id])[-100:]:
            history.append({
                "hr": v.heart_rate,
                "ecg": v.ecg_value,
                "temp": v.temperature,
                "spo2_proxy": v.spo2_proxy,
                "timestamp": v.timestamp.isoformat(),
            })

    return {
        "bed_id": bed_id,
        "current": _vitals_to_dict(bed.vitals),
        "history": history,
    }


@app.get("/api/beds/{bed_id}/alarms")
async def get_bed_alarms(bed_id: str):
    """Get active alarms for a bed."""
    bed = state.beds.get(bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")

    return {
        "bed_id": bed_id,
        "active_alarms": [
            {
                "id": a.id,
                "type": a.alarm_type.value,
                "priority": int(a.priority),
                "is_tier1": a.is_tier1,
                "is_artifact": a.is_artifact,
                "context_label": a.context_label,
                "timestamp": a.timestamp.isoformat(),
            }
            for a in bed.active_alarms[-20:]  # Last 20
        ],
        "total_alarms": bed.total_alarms,
    }


@app.get("/api/incidents")
async def get_incidents(
    bed_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    """Get all incidents, optionally filtered."""
    incidents = correlation_engine.get_active_incidents(bed_id)

    if status:
        incidents = [i for i in incidents if i.status.value == status]

    return {
        "incidents": [_incident_to_dict(i) for i in incidents],
        "count": len(incidents),
    }


@app.post("/api/incidents/{incident_id}/ack")
async def acknowledge_incident(incident_id: str, by: str = "Nurse"):
    """Acknowledge an incident."""
    incident = correlation_engine.acknowledge_incident(incident_id, by)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    routing_engine.on_acknowledge(incident_id, by, Role.NURSE)
    inc_dict = _incident_to_dict(incident)

    await ws_manager.broadcast("incident_ack", {
        "incident_id": incident_id,
        "by": by,
        "incident": inc_dict,
        "timestamp": datetime.now().isoformat(),
    })
    await ws_manager.broadcast("incident_update", {
        "incident": inc_dict,
    })

    return {"status": "acknowledged", "incident_id": incident_id, "incident": inc_dict}


@app.post("/api/incidents/{incident_id}/resolve")
async def resolve_incident(incident_id: str):
    """Resolve an incident."""
    incident = correlation_engine.resolve_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    inc_dict = _incident_to_dict(incident)
    await ws_manager.broadcast("incident_resolved", {
        "incident_id": incident_id,
        "incident": inc_dict,
        "timestamp": datetime.now().isoformat(),
    })
    await ws_manager.broadcast("incident_update", {
        "incident": inc_dict,
    })

    return {"status": "resolved", "incident_id": incident_id, "incident": inc_dict}


@app.post("/api/incidents/{incident_id}/escalate")
async def escalate_incident(incident_id: str, reason: str = "Manual Nurse Bedside Escalation"):
    """Escalate an incident to Doctor / Physician Console."""
    incident = None
    for bed_incidents in correlation_engine.active_incidents.values():
        for inc in bed_incidents:
            if inc.id == incident_id:
                incident = inc
                break
        if incident:
            break

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident.status = IncidentStatus.ESCALATED
    incident.escalation_level = max(1, incident.escalation_level + 1)
    if Role.DOCTOR not in incident.routed_to:
        incident.routed_to.append(Role.DOCTOR)
    incident.correlation_reason = f"[ESCALATED TO PHYSICIAN] {incident.correlation_reason or reason}"

    inc_dict = _incident_to_dict(incident)
    await ws_manager.broadcast("incident_escalated", {
        "incident_id": incident_id,
        "incident": inc_dict,
        "timestamp": datetime.now().isoformat(),
    })
    await ws_manager.broadcast("incident_update", {
        "incident": inc_dict,
    })

    return {"status": "escalated", "incident_id": incident_id, "incident": inc_dict}


@app.post("/api/beds/{bed_id}/planned-activity")
async def toggle_planned_activity(
    bed_id: str,
    active: bool = True,
    activity_type: str = "general",
):
    """Mark start/end of planned activity (suctioning, bathing, etc.)."""
    bed = state.beds.get(bed_id)
    if not bed:
        raise HTTPException(status_code=404, detail="Bed not found")

    bed.planned_activity = active
    bed.planned_activity_start = datetime.now() if active else None
    bed.planned_activity_type = activity_type if active else ""

    if simulator_manager:
        node_id = bed.node_id
        simulator_manager.set_planned_activity(node_id, active, activity_type)

    await ws_manager.broadcast("planned_activity", {
        "bed_id": bed_id,
        "active": active,
        "activity_type": activity_type,
    })

    return {"status": "ok", "planned_activity": active}


@app.get("/api/dashboard/{role}")
async def get_role_dashboard(role: str):
    """Get dashboard data filtered for a specific role."""
    try:
        role_enum = Role(role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown role: {role}")

    incidents = routing_engine.get_role_view(role_enum)
    tech_tasks = (
        routing_engine.get_pending_tech_tasks()
        if role_enum == Role.TECHNICIAN
        else []
    )

    beds_data = []
    for bed_id, bed in state.beds.items():
        beds_data.append(_bed_to_dict(bed))

    return {
        "role": role,
        "beds": beds_data,
        "incidents": [_incident_to_dict(i) for i in incidents],
        "tech_tasks": [_tech_task_to_dict(t) for t in tech_tasks],
    }


@app.get("/api/tech-tasks")
async def get_tech_tasks():
    """Get all technician tasks."""
    tasks = routing_engine.get_pending_tech_tasks()
    return {
        "tasks": [_tech_task_to_dict(t) for t in tasks],
        "count": len(tasks),
    }


@app.post("/api/tech-tasks/{task_id}/complete")
async def complete_tech_task(task_id: str):
    """Mark a technician task as completed."""
    task = routing_engine.complete_tech_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await ws_manager.broadcast("tech_task_completed", {
        "task_id": task_id,
        "timestamp": datetime.now().isoformat(),
    })

    return {"status": "completed", "task_id": task_id}


# ─── Clinical Duty Roster & Coverage API ─────────────────────────────

def _duty_roster_to_dict(roster: DutyRosterState) -> dict:
    return {
        "current_doctor": roster.current_doctor,
        "current_doctor_title": roster.current_doctor_title,
        "duty_status": roster.duty_status.value,
        "covering_doctor": roster.covering_doctor,
        "covering_doctor_title": roster.covering_doctor_title,
        "charge_nurse": roster.charge_nurse,
        "shift_name": roster.shift_name,
        "status_note": roster.status_note,
        "last_handover_at": roster.last_handover_at.isoformat() if roster.last_handover_at else None,
        "handover_history": roster.handover_history[-10:],
        "roster_options": [
            {"name": "Dr. Sharma, MD", "title": "Lead Intensivist / Attending", "contact": "Ext. 4410 / Voicera #1"},
            {"name": "Dr. Priya Patel, MD", "title": "Critical Care Fellow / On-Call", "contact": "Ext. 4412 / Voicera #2"},
            {"name": "Dr. Marcus Vance, MD", "title": "Emergency & Trauma Attending", "contact": "Ext. 4415 / Voicera #3"},
            {"name": "Dr. Alistair Chen, MD", "title": "Critical Care Specialist", "contact": "Ext. 4418 / Voicera #4"},
        ],
    }


@app.get("/api/duty-roster")
async def get_duty_roster():
    """Get active clinical duty roster and physician coverage state."""
    return _duty_roster_to_dict(state.duty_roster)


@app.post("/api/duty-roster/status")
async def update_duty_status(
    status: str = Query(...),
    note: str = Query(""),
    covering_doctor: Optional[str] = Query(None),
):
    """Update current attending physician's duty status (active, in_procedure, off_duty)."""
    try:
        status_enum = DutyStatus(status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid duty status: {status}")

    state.duty_roster.duty_status = status_enum
    if note:
        state.duty_roster.status_note = note
    else:
        state.duty_roster.status_note = (
            "Active on ward" if status_enum == DutyStatus.ACTIVE
            else "In surgical procedure — auto-forwarding active" if status_enum == DutyStatus.IN_PROCEDURE
            else "Off-duty shift handover in progress"
        )
    if covering_doctor:
        state.duty_roster.covering_doctor = covering_doctor

    roster_data = _duty_roster_to_dict(state.duty_roster)
    await ws_manager.broadcast("duty_roster_update", roster_data)
    logger.info(f"Duty status updated to {status_enum.value} for {state.duty_roster.current_doctor}")
    return {"status": "ok", "duty_roster": roster_data}


@app.post("/api/duty-roster/handover")
async def execute_duty_handover(payload: dict):
    """Execute shift handover to incoming attending physician."""
    new_doc = payload.get("new_doctor")
    new_title = payload.get("new_title", "Attending Intensivist")
    new_covering = payload.get("new_covering")
    note = payload.get("note", "Standard shift sign-out")
    shift_name = payload.get("shift_name", state.duty_roster.shift_name)

    if not new_doc:
        raise HTTPException(status_code=400, detail="new_doctor is required")

    prev_doc = state.duty_roster.current_doctor
    now = datetime.now()

    handover_record = {
        "timestamp": now.isoformat(),
        "from_doctor": prev_doc,
        "to_doctor": new_doc,
        "covering_doctor": new_covering or state.duty_roster.covering_doctor,
        "note": note,
    }
    state.duty_roster.handover_history.append(handover_record)
    state.duty_roster.current_doctor = new_doc
    state.duty_roster.current_doctor_title = new_title
    if new_covering:
        state.duty_roster.covering_doctor = new_covering
    state.duty_roster.duty_status = DutyStatus.ACTIVE
    state.duty_roster.status_note = f"Shift handover from {prev_doc}: {note}"
    state.duty_roster.shift_name = shift_name
    state.duty_roster.last_handover_at = now

    roster_data = _duty_roster_to_dict(state.duty_roster)
    await ws_manager.broadcast("duty_roster_update", roster_data)
    logger.info(f"Duty handover completed: {prev_doc} ➔ {new_doc}")
    return {"status": "ok", "handover": handover_record, "duty_roster": roster_data}


@app.get("/api/profiles")
async def get_profiles():
    """Get available bed profile information."""
    return {"profiles": profile_manager.get_all_profiles_info()}


@app.get("/api/stats")
async def get_statistics():
    """Get alarm statistics for the charge nurse overview."""
    stats = {
        "beds": {},
        "total_alarms": 0,
        "total_incidents": 0,
    }

    for bed_id, bed in state.beds.items():
        stats["beds"][bed_id] = {
            "total_alarms": bed.total_alarms,
            "active_incidents": len(bed.active_incidents),
            "profile": bed.profile.value,
            "signal_quality": bed.signal_quality.value if isinstance(bed.signal_quality, SignalQualityLevel) else bed.signal_quality,
        }
        stats["total_alarms"] += bed.total_alarms
        stats["total_incidents"] += len(bed.active_incidents)

    return stats


# ─── Simulator Endpoints ────────────────────────────────────────────

@app.get("/api/simulator/scenarios")
async def get_scenarios():
    """Get available demo scenarios."""
    if not simulator_manager:
        return {"scenarios": [], "simulator_active": False}
    return {
        "scenarios": simulator_manager.get_available_scenarios(),
        "simulator_active": True,
    }


@app.post("/api/simulator/trigger")
async def trigger_scenario(
    node_id: int,
    scenario: str,
    duration: float = 30.0,
):
    """Trigger a demo scenario on a specific bed."""
    if not simulator_manager:
        raise HTTPException(status_code=400, detail="Simulator not active")

    success = simulator_manager.trigger_scenario(node_id, scenario, duration)
    if not success:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    await ws_manager.broadcast("scenario_triggered", {
        "node_id": node_id,
        "scenario": scenario,
        "duration": duration,
    })

    return {"status": "triggered", "node_id": node_id, "scenario": scenario}


@app.post("/api/simulator/trigger-all")
async def trigger_scenario_all(scenario: str, duration: float = 30.0):
    """Trigger a scenario on ALL beds simultaneously."""
    if not simulator_manager:
        raise HTTPException(status_code=400, detail="Simulator not active")

    for node_id in simulator_manager.simulators:
        simulator_manager.trigger_scenario(node_id, scenario, duration)

    return {"status": "triggered_all", "scenario": scenario}


@app.post("/api/simulator/set-vitals")
async def set_simulated_vitals(node_id: int, hr: Optional[int] = None,
                                temp: Optional[float] = None,
                                spo2: Optional[int] = None,
                                vent_pressure: Optional[float] = None,
                                vent_tidal_volume: Optional[float] = None,
                                dial_blood_flow: Optional[float] = None,
                                dial_venous_pressure: Optional[float] = None):
    """Manually set vital values via simulator panel sliders."""
    if not simulator_manager:
        raise HTTPException(status_code=400, detail="Simulator not active")

    kwargs = {}
    if hr is not None:
        kwargs["hr"] = hr
    if temp is not None:
        kwargs["temp"] = temp
    if spo2 is not None:
        kwargs["spo2"] = spo2
    if vent_pressure is not None:
        kwargs["vent_pressure"] = vent_pressure
    if vent_tidal_volume is not None:
        kwargs["vent_tidal_volume"] = vent_tidal_volume
    if dial_blood_flow is not None:
        kwargs["dial_blood_flow"] = dial_blood_flow
    if dial_venous_pressure is not None:
        kwargs["dial_venous_pressure"] = dial_venous_pressure

    success = simulator_manager.set_vitals(node_id, **kwargs)
    if not success:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    return {"status": "ok", "node_id": node_id, "updated": kwargs}


# ─── WebSocket Endpoint ─────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_endpoint(
    websocket: WebSocket,
    role: Optional[str] = Query(None),
    bed: Optional[str] = Query(None),
):
    """
    WebSocket endpoint for real-time dashboard updates.
    Query params:
        role: Filter by role (doctor, nurse, technician, charge_nurse)
        bed:  Filter by bed ID (bed-1, bed-2, bed-3)
    """
    await ws_manager.connect(websocket, role=role, bed_id=bed)

    # Send initial state
    await ws_manager.send_personal(websocket, "init", {
        "beds": {
            bed_id: _bed_to_dict(bed)
            for bed_id, bed in state.beds.items()
        },
        "duty_roster": _duty_roster_to_dict(state.duty_roster),
        "simulator_mode": state.simulator_mode,
        "care_online": state.care_online,
    })

    try:
        while True:
            # Keep connection alive, handle incoming messages
            data = await websocket.receive_text()
            msg = json.loads(data)

            # Handle client messages
            msg_type = msg.get("type")
            if msg_type == "ping":
                await ws_manager.send_personal(websocket, "pong", {})
            elif msg_type == "subscribe_role":
                # Update role filter
                for conn in ws_manager.active_connections:
                    if conn["ws"] == websocket:
                        conn["role"] = msg.get("role")
            elif msg_type == "subscribe_bed":
                for conn in ws_manager.active_connections:
                    if conn["ws"] == websocket:
                        conn["bed_id"] = msg.get("bed_id")

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        ws_manager.disconnect(websocket)


# ─── Helper Functions ────────────────────────────────────────────────

def _bed_to_dict(bed: BedState) -> dict:
    return {
        "bed_id": bed.bed_id,
        "node_id": bed.node_id,
        "profile": bed.profile.value,
        "patient_name": bed.patient_name,
        "patient_mrn": bed.patient_mrn or bed.patient_id,
        "patient_age": bed.patient_age,
        "patient_gender": bed.patient_gender,
        "primary_diagnosis": bed.primary_diagnosis,
        "clinical_conditions": bed.clinical_conditions or [],
        "attending_doctor": bed.attending_doctor,
        "assigned_nurse": bed.assigned_nurse,
        "is_occupied": bool(bed.patient_name),
        "admitted_at": bed.admitted_at.isoformat() if bed.admitted_at else None,
        "node_status": bed.node_status.value,
        "signal_quality": bed.signal_quality.value if isinstance(bed.signal_quality, SignalQualityLevel) else bed.signal_quality,
        "vitals": _vitals_to_dict(bed.vitals),
        "active_alarm_count": len(bed.active_alarms),
        "active_incident_count": len(bed.active_incidents),
        "total_alarms": bed.total_alarms,
        "planned_activity": bed.planned_activity,
        "planned_activity_type": bed.planned_activity_type,
        "last_data_received": bed.last_data_received.isoformat() if bed.last_data_received else None,
    }


def _vitals_to_dict(v: VitalSigns) -> dict:
    return {
        "hr": v.heart_rate,
        "hr_raw": v.heart_rate_raw,
        "ecg": v.ecg_value,
        "ecg_quality": v.ecg_quality,
        "temp": v.temperature,
        "spo2_proxy": v.spo2_proxy,
        "lead_off": v.lead_off,
        "vent_pressure": v.vent_pressure,
        "vent_tidal_volume": v.vent_tidal_volume,
        "vent_rate": v.vent_rate,
        "vent_fio2": v.vent_fio2,
        "vent_connected": v.vent_connected,
        "vent_battery": v.vent_battery,
        "dial_blood_flow": v.dial_blood_flow,
        "dial_venous_pressure": v.dial_venous_pressure,
        "dial_blood_leak": v.dial_blood_leak,
        "pump_rate": v.pump_rate,
        "pump_volume_remaining": v.pump_volume_remaining,
    }


def _incident_to_dict(incident: Incident) -> dict:
    return {
        "id": incident.id,
        "bed_id": incident.bed_id,
        "profile": incident.profile.value,
        "priority": int(incident.priority),
        "status": incident.status.value,
        "alarm_count": incident.alarm_count,
        "correlation_reason": incident.correlation_reason,
        "context_label": incident.context_label,
        "created_at": incident.created_at.isoformat(),
        "acknowledged_at": incident.acknowledged_at.isoformat() if incident.acknowledged_at else None,
        "acknowledged_by": incident.acknowledged_by,
        "routed_to": [r.value for r in incident.routed_to],
        "escalation_level": incident.escalation_level,
        "is_planned_activity": incident.is_planned_activity,
        "alarms": [
            {
                "id": a.id,
                "type": a.alarm_type.value,
                "priority": int(a.priority),
                "is_tier1": a.is_tier1,
                "is_artifact": a.is_artifact,
                "artifact_confidence": a.artifact_confidence,
                "context_label": a.context_label,
                "signal_quality": a.signal_quality.value if isinstance(a.signal_quality, SignalQualityLevel) else a.signal_quality,
                "timestamp": a.timestamp.isoformat(),
            }
            for a in incident.alarms
        ],
    }


def _tech_task_to_dict(task: TechTask) -> dict:
    return {
        "id": task.id,
        "bed_id": task.bed_id,
        "task_type": task.task_type,
        "description": task.description,
        "alarm_type": task.alarm_type.value,
        "alarm_count": task.alarm_count,
        "status": task.status,
        "created_at": task.created_at.isoformat(),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


# ─── Entry Point ─────────────────────────────────────────────────────

if __name__ == "__main__":
    args = parse_args()
    uvicorn.run(
        "main:app",
        host=args.host,
        port=args.port,
        reload=False,
        log_level="info",
    )
