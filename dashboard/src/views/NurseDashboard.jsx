import React, { useState } from 'react';

export default function NurseDashboard({
  beds,
  incidents,
  selectedBed,
  onSelectBed,
  onAckIncident,
  onResolveIncident,
  onEscalateIncident,
  onTogglePlannedActivity,
  onOpenAdmission,
  onDischargePatient,
  tasks = [],
  onToggleTask,
  dutyRoster = {},
}) {
  const bedEntries = Object.entries(beds);
  const selBed = beds[selectedBed] || {};
  const isPlanned = selBed.planned_activity || false;

  const nurseIncidents = Object.values(incidents)
    .flat()
    .filter(i => i.status !== 'resolved')
    .filter(i => (i.routed_to || []).includes('nurse') || (i.routed_to || []).length === 0)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  return (
    <div className="nurse-view">
      {/* ── Nurse Top Header ── */}
      <div className="view-header">
        <div>
          <h2>👩‍⚕️ Bedside Nurse Triage Station</h2>
          <p className="view-sub">
            Bed Management & Patient Assignment • Real-time condition-driven triage • 1-click care window suppression
          </p>
        </div>
        <div className="nurse-actions-top">
          {/* On-Duty Physician Coverage Status Indicator */}
          <div className={`nurse-duty-roster-pill ${dutyRoster.duty_status || 'active'}`}>
            <span className="dot" style={{
              background: dutyRoster.duty_status === 'active' ? '#10B981' : dutyRoster.duty_status === 'in_procedure' ? '#F59E0B' : '#EF4444'
            }} />
            <div className="nurse-duty-text">
              {dutyRoster.duty_status === 'active' ? (
                <span>👨‍⚕️ Attending: <b>{dutyRoster.current_doctor || 'Dr. Sharma, MD'}</b> (Active on Ward)</span>
              ) : dutyRoster.duty_status === 'in_procedure' ? (
                <span>🟡 Attending in OR ➔ Covering: <b>{dutyRoster.covering_doctor || 'Fellow'}</b></span>
              ) : (
                <span>🔴 Attending Off-Duty ➔ Covering: <b>{dutyRoster.covering_doctor || 'Fellow'}</b></span>
              )}
            </div>
          </div>

          <button className="pri" onClick={() => onOpenAdmission()}>
            ➕ Admit Patient to Bed
          </button>
          <button
            className={`planned-activity-btn ${isPlanned ? 'active-planned' : ''}`}
            onClick={() => onTogglePlannedActivity(selectedBed, !isPlanned, 'bed_bath')}
          >
            {isPlanned ? '🛑 End Bed Bath / Care Window' : '🩺 Start Bed Bath (Suppress Motion)'}
          </button>
        </div>
      </div>

      {/* ── Active Bed Bath / Motion Suppression Banner ── */}
      {isPlanned && (
        <div className="bed-bath-active-banner">
          <span className="pulsing-radar-dot" style={{ background: '#F59E0B' }} />
          <div>
            <strong>🛁 Motion Suppression Active on {selectedBed.toUpperCase()} (Bed Bath Care Window)</strong>
            <span>Routine motion transients are filtered from nurse notifications · Hardware watchdog buzzer remains 100% armed</span>
          </div>
          <button
            className="sec"
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '11px', background: '#fff' }}
            onClick={() => onTogglePlannedActivity(selectedBed, false, 'bed_bath')}
          >
            End Care Window
          </button>
        </div>
      )}

      {/* ── Bed Cards Grid ── */}
      <div className="nurse-bed-grid">
        {bedEntries.map(([bedId, bed]) => {
          const v = bed.vitals || {};
          const isSel = selectedBed === bedId;
          const isOccupied = bed.is_occupied !== false && bed.patient_name;
          const bedInc = incidents[bedId] || [];
          const hasCrit = bedInc.some(i => (i.priority || 0) >= 3);
          const hasWatch = bedInc.some(i => i.status !== 'resolved');
          const spo2Pct = Math.min(100, Math.max(0, Math.round(((v.spo2_proxy || 512) / 700) * 100)));

          // Vacant Bed Card
          if (!isOccupied) {
            return (
              <div
                key={bedId}
                className={`nurse-card vacant-bed-card ${isSel ? 'sel' : ''}`}
                onClick={() => onSelectBed(bedId)}
              >
                <div className="nurse-card-head">
                  <div>
                    <span className="bed-number-pill">{bedId.toUpperCase()}</span>
                    <span className="nurse-bed-title" style={{ color: 'var(--mut)', marginTop: '4px' }}>
                      Vacant / Unoccupied
                    </span>
                  </div>
                  <span className="status-pill ok" style={{ background: '#F1F5F9', color: '#475569' }}>
                    READY FOR ADMISSION
                  </span>
                </div>

                <div className="vacant-bed-body">
                  <div className="vacant-icon">🛏️</div>
                  <p>Bed infrastructure is clean, calibrated, and awaiting patient allocation.</p>
                  <button
                    className="pri admit-btn-inline"
                    onClick={(e) => { e.stopPropagation(); onOpenAdmission(bedId); }}
                  >
                    ➕ Admit Patient to {bedId.toUpperCase()}
                  </button>
                </div>

                <div className="nurse-card-foot">
                  <span>Node #{bed.node_id} Online</span>
                  <span className="select-hint">{isSel ? '● Selected' : 'Click to Focus'}</span>
                </div>
              </div>
            );
          }

          // Occupied Bed Card
          return (
            <div
              key={bedId}
              className={`nurse-card ${isSel ? 'sel' : ''} ${hasCrit ? 'crit' : hasWatch ? 'watch' : 'ok'}`}
              onClick={() => onSelectBed(bedId)}
            >
              <div className="nurse-card-head">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span className="bed-number-pill">{bedId.toUpperCase()}</span>
                    <span className="nurse-bed-title">{bed.patient_name}</span>
                    {bed.data_source === 'arduino' ? (
                      <span className="live-hw-badge" title="Physical Arduino Telemetry Active (3 Heart Sensors + 1 Temp + Alarm)">
                        ⚡ REAL ARDUINO
                      </span>
                    ) : (
                      <span className="sim-hw-badge" title="Simulated Bed Telemetry">
                        🕹️ SIMULATED
                      </span>
                    )}
                  </div>
                  <span className="nurse-bed-prof">
                    {bed.patient_mrn || 'MRN-88412'} • {bed.patient_age ? `${bed.patient_age}y` : ''} {bed.patient_gender || ''} • {bed.profile || 'General'} Template
                  </span>
                </div>
                <span className={`status-pill ${hasCrit ? 'crit' : hasWatch ? 'watch' : 'ok'}`}>
                  {hasCrit ? 'CRITICAL' : hasWatch ? 'ACTION REQ' : 'STABLE'}
                </span>
              </div>

              {/* Diagnosis & Attached Conditions */}
              <div className="bed-diagnosis-box">
                <div className="diag-text">
                  <b>Diagnosis:</b> {bed.primary_diagnosis || 'Critical Care Monitoring'}
                </div>
                {(bed.clinical_conditions || []).length > 0 && (
                  <div className="conditions-badges-row">
                    {bed.clinical_conditions.map((cond, i) => (
                      <span key={i} className="cond-tag-pill">{cond}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Vitals */}
              <div className="nurse-vitals-row">
                <div className="nurse-vital-col">
                  <span className="nurse-vital-label">Heart Rate</span>
                  <span className={`nurse-vital-val ${v.hr > 120 || v.hr < 50 ? 'vital-alert' : ''}`}>
                    {v.hr || '—'} <small>BPM</small>
                  </span>
                </div>
                <div className="nurse-vital-col">
                  <span className="nurse-vital-label">SpO₂</span>
                  <span className={`nurse-vital-val ${spo2Pct < 90 ? 'vital-alert' : ''}`}>
                    {spo2Pct}%
                  </span>
                </div>
                <div className="nurse-vital-col">
                  <span className="nurse-vital-label">Temp</span>
                  <span className={`nurse-vital-val ${v.temp >= 38.0 ? 'vital-alert' : ''}`}>
                    {v.temp ? `${v.temp}°C` : '—'}
                  </span>
                </div>
                <div className="nurse-vital-col">
                  <span className="nurse-vital-label">Signal SQI</span>
                  <span className="nurse-vital-val">
                    {v.ecg_quality !== undefined ? `${v.ecg_quality}%` : '98%'}
                  </span>
                </div>
              </div>

              {bed.planned_activity && (
                <div className="planned-badge-nurse">
                  🩺 Planned Care in Progress (Motion Filter Active)
                </div>
              )}

              {/* Actions Footer: Discharge & Edit */}
              <div className="nurse-card-actions-bar">
                <button
                  className="card-action-btn edit"
                  onClick={(e) => { e.stopPropagation(); onOpenAdmission(bedId, bed); }}
                  title="Modify clinical conditions template"
                >
                  ✏️ Edit Template
                </button>
                <button
                  className="card-action-btn discharge"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Discharge patient ${bed.patient_name} from ${bedId.toUpperCase()}?`)) {
                      onDischargePatient(bedId);
                    }
                  }}
                  title="Discharge / De-assign patient from bed"
                >
                  🚪 Discharge
                </button>
              </div>

              <div className="nurse-card-foot">
                <span>{bedInc.filter(i => i.status !== 'resolved').length} active incidents</span>
                <span className="select-hint">{isSel ? '● Monitoring' : 'Click to Focus'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Two Column Bottom: Active Incidents + Bedside Checklist ── */}
      <div className="nurse-bottom-grid">
        <div className="card">
          <div className="card-header-row">
            <h2>🔔 Bedside Incident Queue ({nurseIncidents.length})</h2>
            <span className="badge-quiet">Only verified clinical events</span>
          </div>

          {nurseIncidents.length === 0 ? (
            <div className="empty" style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>✅</div>
              <strong>All patient beds nominal</strong>
              <p style={{ color: 'var(--mut)', margin: '4px 0 0', fontSize: '12px' }}>
                No active bedside incidents require nursing intervention right now.
              </p>
            </div>
          ) : (
            <div className="nurse-incident-list">
              {nurseIncidents.map(inc => (
                <div key={inc.id} className={`inc ${inc.priority >= 3 ? 'real' : 'adv'}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span className="vd">
                        {inc.priority >= 3 ? '🚨 URGENT ACTION' : '⚠️ BEDSIDE CHECK'}
                      </span>
                      {inc.status === 'acknowledged' && (
                        <span className="incident-status-tag ack">Silenced 2m</span>
                      )}
                      {inc.status === 'escalated' && (
                        <span className="incident-status-tag esc">Escalated</span>
                      )}
                      {(inc.context_label?.includes('Auto-forwarded') || inc.correlation_reason?.includes('[COVERAGE:')) && (
                        <span className="incident-status-tag auto-fwd">
                          🛡️ Coverage Auto-Forwarded ({dutyRoster.covering_doctor || 'Fellow'})
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--mut)' }}>
                      Bed: {inc.bed_id?.toUpperCase()}
                    </span>
                  </div>

                  <h3>{inc.context_label || inc.correlation_reason || 'Grouped Bedside Incident'}</h3>
                  <p>{inc.correlation_reason}</p>

                  <div className="nurse-quick-actions">
                    {inc.status === 'acknowledged' ? (
                      <span className="ack-pill-status">
                        ✓ Silenced (2m) by {inc.acknowledged_by || 'Nurse'}
                      </span>
                    ) : (
                      <button
                        className="pri"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => onAckIncident(inc.id)}
                      >
                        ✓ Acknowledge (Silence 2m)
                      </button>
                    )}

                    {inc.status === 'escalated' ? (
                      <span className="esc-pill-status">
                        🚨 Escalated to Doctor Console
                      </span>
                    ) : (
                      <button
                        style={{ padding: '6px 12px', fontSize: '12px', borderColor: 'var(--blue)', color: 'var(--blue)', background: '#F0F6FF' }}
                        onClick={() => onEscalateIncident && onEscalateIncident(inc.id, 'Bedside nurse triage escalation')}
                      >
                        👨‍⚕️ Escalate to Doctor
                      </button>
                    )}

                    <button
                      style={{ padding: '6px 12px', fontSize: '12px', borderColor: 'var(--green)', color: 'var(--green)', background: '#F0FDF4' }}
                      onClick={() => onResolveIncident(inc.id)}
                    >
                      ✓ Mark Resolved
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header-row">
            <h2>📋 Bedside Care Checklist</h2>
            <span className="badge-routine">Auto-generated</span>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--mut)', marginTop: 0 }}>
            Automated sensor hygiene reminders created from bedside telemetry:
          </p>

          <div className="task-list">
            {tasks.map(t => (
              <div
                key={t.id}
                className={`task-item ${t.done ? 'task-done' : ''} ${t.isStat ? 'stat-task-item' : ''}`}
                onClick={() => onToggleTask && onToggleTask(t.id)}
              >
                <input type="checkbox" checked={t.done} onChange={() => {}} />
                <div className="task-body">
                  <div className="task-text">
                    {t.isStat && <span className="stat-order-pill">⚡ STAT PHYSICIAN ORDER</span>}
                    {t.text}
                  </div>
                  <div className="task-meta">
                    <span className="task-bed">{t.bed.toUpperCase()}</span>
                    <span>{t.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="safety-watchdog-banner">
            <div className="watchdog-icon">🛡️</div>
            <div>
              <strong>Hardware Safety Invariant Active</strong>
              <div style={{ fontSize: '11px', color: 'var(--mut)' }}>
                Bedside piezo buzzer and LEDs fire locally on the Arduino on critical thresholds regardless of tablet connection.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
