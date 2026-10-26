import React, { useRef, useEffect, useState } from 'react';
import { PROFILE_INFO, formatVital, vitalStatus, timeAgo } from '../utils/constants.js';
import { togglePlannedActivity } from '../utils/api.js';

/**
 * BedCard — displays a single bed's vitals, status, and waveform.
 */
export default function BedCard({ bed, vitals, compact = false }) {
  const profile = bed?.profile || 'cardiac';
  const profileInfo = PROFILE_INFO[profile] || PROFILE_INFO.cardiac;
  const v = vitals || bed?.vitals || {};
  const canvasRef = useRef(null);
  const ecgHistoryRef = useRef([]);
  const [isPlannedActivity, setIsPlannedActivity] = useState(bed?.planned_activity || false);

  // Update planned activity from props
  useEffect(() => {
    setIsPlannedActivity(bed?.planned_activity || false);
  }, [bed?.planned_activity]);

  // ECG waveform drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || compact) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Add new ECG value to history
    const ecgVal = v.ecg ?? 512;
    ecgHistoryRef.current.push(ecgVal);
    if (ecgHistoryRef.current.length > rect.width) {
      ecgHistoryRef.current.shift();
    }

    // Draw
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    for (let y = 0; y < rect.height; y += 15) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }

    // ECG line
    const history = ecgHistoryRef.current;
    if (history.length < 2) return;

    const signalColor = v.lead_off ? 'var(--critical)'
      : (v.signal_quality === 'artifact' || v.is_artifact) ? 'var(--medium)'
      : 'var(--normal)';

    ctx.strokeStyle = signalColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const xStep = rect.width / Math.max(history.length - 1, 1);
    for (let i = 0; i < history.length; i++) {
      const x = i * xStep;
      // Normalize ECG value (0-1023) to canvas height
      const normalized = 1 - (history[i] / 1023);
      const y = normalized * rect.height * 0.8 + rect.height * 0.1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Glow effect
    ctx.shadowColor = signalColor;
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [v.ecg, v.lead_off, v.signal_quality, v.is_artifact, compact]);

  const handlePlannedActivity = async () => {
    const newState = !isPlannedActivity;
    setIsPlannedActivity(newState);
    try {
      await togglePlannedActivity(bed.bed_id, newState, 'general');
    } catch (e) {
      setIsPlannedActivity(!newState);
    }
  };

  const hrStatus = vitalStatus(v.hr || 0, 'hr', profile);
  const tempStatus = vitalStatus(v.temp || 0, 'temp', profile);
  const spo2Pct = Math.min(100, Math.max(0, Math.round(((v.spo2_proxy || 512) / 700) * 100)));
  const spo2Status = vitalStatus(v.spo2_proxy || 512, 'spo2', profile);
  const ecgStatus = vitalStatus(v.ecg_quality ?? 100, 'ecg_quality', profile);

  const nodeOnline = (bed?.node_status === 'online') || v.node_status === 'online';

  return (
    <div className={`card bed-card ${(bed?.active_incident_count || 0) > 0 ? 'card--priority-2' : ''}`}>
      <div className={`bed-card__profile-stripe bed-card__profile-stripe--${profile}`} />

      <div className="bed-card__header">
        <div className="bed-card__name">
          <div className={`bed-card__status-dot bed-card__status-dot--${nodeOnline ? 'online' : 'offline'}`} />
          <span className="bed-card__id">{bed?.patient_name || bed?.bed_id || 'Unknown'}</span>
          <span className={`bed-card__profile-badge bed-card__profile-badge--${profile}`}>
            {profileInfo.icon} {profileInfo.name}
          </span>
        </div>
        <div className="signal-quality-container">
          <SignalQuality level={v.signal_quality || bed?.signal_quality || 'good'} />
        </div>
      </div>

      {isPlannedActivity && (
        <div className="planned-activity-banner">
          ⚠️ Planned activity in progress — alarms NOT suppressed
        </div>
      )}

      {/* Vitals Row */}
      <div className="vitals-row">
        <div className={`vital vital--${hrStatus}`}>
          <div className="vital__label">HR</div>
          <div className="vital__value">{v.hr || '--'}</div>
          <div className="vital__unit">BPM</div>
        </div>
        <div className={`vital vital--${tempStatus}`}>
          <div className="vital__label">Temp</div>
          <div className="vital__value">{v.temp ? v.temp.toFixed(1) : '--'}</div>
          <div className="vital__unit">°C</div>
        </div>
        <div className={`vital vital--${spo2Status}`}>
          <div className="vital__label">SpO₂</div>
          <div className="vital__value">{spo2Pct || '--'}</div>
          <div className="vital__unit">%</div>
        </div>
        <div className={`vital vital--${ecgStatus}`}>
          <div className="vital__label">ECG</div>
          <div className="vital__value">{v.ecg_quality ?? '--'}</div>
          <div className="vital__unit">%</div>
        </div>
      </div>

      {/* ECG Waveform */}
      {!compact && (
        <div className="waveform-container">
          <canvas ref={canvasRef} className="waveform-canvas" />
        </div>
      )}

      {/* Profile-specific extras */}
      {!compact && profile === 'respiratory' && (
        <div className="vitals-row" style={{ marginBottom: 0 }}>
          <div className="vital vital--normal">
            <div className="vital__label">Vent P</div>
            <div className="vital__value">{v.vent_pressure?.toFixed(0) || '--'}</div>
            <div className="vital__unit">cmH₂O</div>
          </div>
          <div className="vital vital--normal">
            <div className="vital__label">TV</div>
            <div className="vital__value">{v.vent_tidal_volume?.toFixed(0) || '--'}</div>
            <div className="vital__unit">mL</div>
          </div>
          <div className={`vital ${v.vent_connected === false ? 'vital--critical' : 'vital--normal'}`}>
            <div className="vital__label">Vent</div>
            <div className="vital__value">{v.vent_connected === false ? '⚠' : '✓'}</div>
            <div className="vital__unit">{v.vent_connected === false ? 'DISC' : 'OK'}</div>
          </div>
          <div className="vital vital--normal">
            <div className="vital__label">FiO₂</div>
            <div className="vital__value">{v.vent_fio2 ? (v.vent_fio2 * 100).toFixed(0) : '--'}</div>
            <div className="vital__unit">%</div>
          </div>
        </div>
      )}

      {!compact && profile === 'kidney' && (
        <div className="vitals-row" style={{ marginBottom: 0 }}>
          <div className="vital vital--normal">
            <div className="vital__label">Blood Flow</div>
            <div className="vital__value">{v.dial_blood_flow?.toFixed(0) || '--'}</div>
            <div className="vital__unit">mL/min</div>
          </div>
          <div className="vital vital--normal">
            <div className="vital__label">VP</div>
            <div className="vital__value">{v.dial_venous_pressure?.toFixed(0) || '--'}</div>
            <div className="vital__unit">mmHg</div>
          </div>
          <div className={`vital ${v.dial_blood_leak ? 'vital--critical' : 'vital--normal'}`}>
            <div className="vital__label">Leak</div>
            <div className="vital__value">{v.dial_blood_leak ? '⚠' : '✓'}</div>
            <div className="vital__unit">{v.dial_blood_leak ? 'LEAK!' : 'OK'}</div>
          </div>
          <div className="vital vital--normal">
            <div className="vital__label">Pump</div>
            <div className="vital__value">{v.pump_volume_remaining?.toFixed(0) || '--'}</div>
            <div className="vital__unit">mL</div>
          </div>
        </div>
      )}

      {/* Actions */}
      {!compact && (
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
          <button
            className={`btn btn--sm ${isPlannedActivity ? 'btn--danger' : 'btn--planned'}`}
            onClick={handlePlannedActivity}
          >
            {isPlannedActivity ? '✕ End Activity' : '📋 Planned Activity'}
          </button>
        </div>
      )}
    </div>
  );
}

function SignalQuality({ level }) {
  const cls = `signal-quality signal-quality--${level}`;
  return (
    <div className={cls} title={`Signal: ${level}`}>
      <div className="signal-bar" />
      <div className="signal-bar" />
      <div className="signal-bar" />
      <div className="signal-bar" />
    </div>
  );
}
