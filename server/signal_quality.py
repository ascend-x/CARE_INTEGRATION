"""
CARE — Clinical Action and Response Engine
BIU Server: Signal Quality Engine

Determines whether sensor readings are trustworthy.
Labels artifacts (motion, noise, lead-off) without hiding any alarm.

This is where AI would run in production (gradient boosting / 1D-CNN).
For the prototype we use rule-based heuristics.
"""

import logging
from collections import deque
from datetime import datetime
from typing import Optional

from models import (
    SignalQualityLevel,
    VitalSigns,
    BedProfile,
)

logger = logging.getLogger("care.signal_quality")


class SignalQualityEngine:
    """
    Evaluates signal quality for each bed's sensor data.
    Detects artifacts, noise, and degrading sensors.

    SAFETY: This engine LABELS, never SUPPRESSES. Every alarm is
    still delivered. Labels like "possible motion artifact" are hints.
    """

    def __init__(self):
        # Per-node history for trend analysis
        self.history: dict[int, deque] = {}
        self.sensor_health: dict[int, dict] = {}  # Per-node sensor health scores
        self.HISTORY_SIZE = 50  # ~5 seconds of data at 10Hz

    def _ensure_history(self, node_id: int):
        """Initialize history buffer for a node."""
        if node_id not in self.history:
            self.history[node_id] = deque(maxlen=self.HISTORY_SIZE)
            self.sensor_health[node_id] = {
                "ecg_score": 100,
                "heartbeat_score": 100,
                "temp_score": 100,
                "overall": 100,
                "degrading": False,
                "artifact_count_recent": 0,
            }

    def evaluate(self, node_id: int, vitals: VitalSigns, profile: BedProfile) -> dict:
        """
        Evaluate signal quality for current readings.

        Returns:
            dict with:
                - overall_quality: SignalQualityLevel
                - ecg_quality: SignalQualityLevel
                - heartbeat_quality: SignalQualityLevel
                - temp_quality: SignalQualityLevel
                - is_artifact: bool (any sensor showing artifact)
                - artifact_type: str (motion/noise/lead_off/none)
                - artifact_confidence: float (0-1)
                - context_label: str (human-readable label)
                - sensor_health: dict (degradation tracking)
        """
        self._ensure_history(node_id)
        self.history[node_id].append(vitals)

        result = {
            "overall_quality": SignalQualityLevel.GOOD,
            "ecg_quality": SignalQualityLevel.GOOD,
            "heartbeat_quality": SignalQualityLevel.GOOD,
            "temp_quality": SignalQualityLevel.GOOD,
            "is_artifact": False,
            "artifact_type": "none",
            "artifact_confidence": 0.0,
            "context_label": "",
            "sensor_health": self.sensor_health[node_id],
        }

        # ── ECG Quality ──────────────────────────────────────────
        result["ecg_quality"] = self._evaluate_ecg(node_id, vitals)

        # ── Heartbeat / SpO2 Quality ─────────────────────────────
        result["heartbeat_quality"] = self._evaluate_heartbeat(node_id, vitals)

        # ── Temperature Quality ──────────────────────────────────
        result["temp_quality"] = self._evaluate_temperature(node_id, vitals)

        # ── Motion Artifact Detection ────────────────────────────
        motion_result = self._detect_motion_artifact(node_id, vitals)
        if motion_result["is_artifact"]:
            result["is_artifact"] = True
            result["artifact_type"] = "motion"
            result["artifact_confidence"] = motion_result["confidence"]
            result["context_label"] = "possible motion disturbance"

        # ── Lead-Off Detection ───────────────────────────────────
        if vitals.lead_off:
            result["is_artifact"] = True
            result["artifact_type"] = "lead_off"
            result["artifact_confidence"] = 0.95
            result["context_label"] = "ECG lead disconnected"
            result["ecg_quality"] = SignalQualityLevel.LEAD_OFF

        # ── Overall Quality ──────────────────────────────────────
        qualities = [
            result["ecg_quality"],
            result["heartbeat_quality"],
            result["temp_quality"],
        ]
        if SignalQualityLevel.ARTIFACT in qualities:
            result["overall_quality"] = SignalQualityLevel.ARTIFACT
        elif SignalQualityLevel.LEAD_OFF in qualities:
            result["overall_quality"] = SignalQualityLevel.LEAD_OFF
        elif SignalQualityLevel.POOR in qualities:
            result["overall_quality"] = SignalQualityLevel.POOR
        elif SignalQualityLevel.DEGRADED in qualities:
            result["overall_quality"] = SignalQualityLevel.DEGRADED

        # ── Update Sensor Health Tracking ────────────────────────
        self._update_sensor_health(node_id, result)

        return result

    def _evaluate_ecg(self, node_id: int, vitals: VitalSigns) -> SignalQualityLevel:
        """Evaluate ECG signal quality."""
        if vitals.lead_off:
            return SignalQualityLevel.LEAD_OFF

        quality = vitals.ecg_quality

        if quality < 20:
            return SignalQualityLevel.POOR
        elif quality < 50:
            return SignalQualityLevel.DEGRADED
        else:
            # Check for saturation (rail-to-rail)
            if vitals.ecg_value >= 1000 or vitals.ecg_value <= 20:
                return SignalQualityLevel.POOR
            return SignalQualityLevel.GOOD

    def _evaluate_heartbeat(self, node_id: int, vitals: VitalSigns) -> SignalQualityLevel:
        """Evaluate heartbeat sensor quality using signal variability."""
        history = self.history[node_id]
        if len(history) < 5:
            return SignalQualityLevel.GOOD

        # Check for excessive variability (motion artifact)
        recent_raw = [h.heart_rate_raw for h in list(history)[-10:]]
        if len(recent_raw) >= 5:
            spread = max(recent_raw) - min(recent_raw)
            if spread > 400:
                return SignalQualityLevel.ARTIFACT
            elif spread > 200:
                return SignalQualityLevel.DEGRADED

        # Check for flatline on the raw signal
        if all(abs(v - recent_raw[0]) < 5 for v in recent_raw) and len(recent_raw) > 5:
            return SignalQualityLevel.POOR  # Sensor may not be on the finger

        return SignalQualityLevel.GOOD

    def _evaluate_temperature(self, node_id: int, vitals: VitalSigns) -> SignalQualityLevel:
        """Evaluate temperature sensor quality."""
        # DS18B20 is generally reliable — check for impossible values
        if vitals.temperature == 0.0:
            return SignalQualityLevel.POOR  # Sensor not connected or error
        if vitals.temperature < 25.0 or vitals.temperature > 45.0:
            return SignalQualityLevel.DEGRADED  # Out of physiological range

        # Check for sudden jumps
        history = self.history[node_id]
        if len(history) >= 2:
            prev_temp = list(history)[-2].temperature
            if prev_temp > 0 and abs(vitals.temperature - prev_temp) > 2.0:
                return SignalQualityLevel.ARTIFACT  # Probe moved/removed

        return SignalQualityLevel.GOOD

    def _detect_motion_artifact(self, node_id: int, vitals: VitalSigns) -> dict:
        """
        Detect motion artifacts from sensor data patterns.

        In production, this would use a trained ML model.
        For prototype: use heuristics based on signal variability.
        """
        history = self.history[node_id]
        if len(history) < 10:
            return {"is_artifact": False, "confidence": 0.0}

        recent = list(history)[-10:]

        # Check multiple signals simultaneously
        scores = []

        # 1. HR raw variability
        hr_raw_values = [h.heart_rate_raw for h in recent]
        hr_spread = max(hr_raw_values) - min(hr_raw_values)
        if hr_spread > 300:
            scores.append(0.8)
        elif hr_spread > 150:
            scores.append(0.4)

        # 2. ECG noise increase
        ecg_quality_trend = [h.ecg_quality for h in recent]
        if ecg_quality_trend[-1] < ecg_quality_trend[0] - 30:
            scores.append(0.6)

        # 3. SpO2 proxy instability
        spo2_values = [h.spo2_proxy for h in recent]
        spo2_spread = max(spo2_values) - min(spo2_values)
        if spo2_spread > 150:
            scores.append(0.7)

        # 4. Multiple signals degrading simultaneously
        # (Real motion affects everything at once)
        if hr_spread > 150 and spo2_spread > 100:
            scores.append(0.9)  # Strong indicator

        if not scores:
            return {"is_artifact": False, "confidence": 0.0}

        confidence = max(scores)
        is_artifact = confidence >= 0.6

        return {"is_artifact": is_artifact, "confidence": confidence}

    def _update_sensor_health(self, node_id: int, quality_result: dict):
        """
        Track sensor health over time for Technician task creation.
        A degrading sensor triggers a maintenance task.
        """
        health = self.sensor_health[node_id]

        # Update individual sensor scores
        quality_to_score = {
            SignalQualityLevel.GOOD: 100,
            SignalQualityLevel.DEGRADED: 60,
            SignalQualityLevel.POOR: 30,
            SignalQualityLevel.ARTIFACT: 10,
            SignalQualityLevel.LEAD_OFF: 0,
        }

        ecg_s = quality_to_score.get(quality_result["ecg_quality"], 50)
        hb_s = quality_to_score.get(quality_result["heartbeat_quality"], 50)
        temp_s = quality_to_score.get(quality_result["temp_quality"], 50)

        # Exponential moving average
        alpha = 0.05
        health["ecg_score"] = health["ecg_score"] * (1 - alpha) + ecg_s * alpha
        health["heartbeat_score"] = health["heartbeat_score"] * (1 - alpha) + hb_s * alpha
        health["temp_score"] = health["temp_score"] * (1 - alpha) + temp_s * alpha
        health["overall"] = min(health["ecg_score"], health["heartbeat_score"], health["temp_score"])

        # Track artifact count
        if quality_result["is_artifact"]:
            health["artifact_count_recent"] += 1
        else:
            health["artifact_count_recent"] = max(0, health["artifact_count_recent"] - 0.1)

        # Degrading flag
        health["degrading"] = health["overall"] < 50 or health["artifact_count_recent"] > 10
