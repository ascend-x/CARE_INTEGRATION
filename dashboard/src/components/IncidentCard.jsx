import React, { useState } from 'react';
import { ALARM_DISPLAY, ROLE_INFO, PRIORITY_LABELS, timeAgo } from '../utils/constants.js';
import { acknowledgeIncident, resolveIncident } from '../utils/api.js';

/**
 * IncidentCard — displays a grouped incident with all its alarms.
 * Every original alarm is visible and expandable.
 */
export default function IncidentCard({ incident, role = 'nurse', showActions = true }) {
  const [expanded, setExpanded] = useState(false);
  const [acking, setAcking] = useState(false);

  if (!incident) return null;

  const handleAck = async (e) => {
    e.stopPropagation();
    setAcking(true);
    try {
      await acknowledgeIncident(incident.id, ROLE_INFO[role]?.name || 'Staff');
    } catch (err) {
      console.error('Ack failed:', err);
    }
    setAcking(false);
  };

  const handleResolve = async (e) => {
    e.stopPropagation();
    try {
      await resolveIncident(incident.id);
    } catch (err) {
      console.error('Resolve failed:', err);
    }
  };

  const priority = incident.priority ?? 0;
  const isAcked = incident.status === 'acknowledged';
  const isEscalated = incident.status === 'escalated';

  return (
    <div
      className={`card incident-card card--priority-${priority} animate-slide-in`}
      onClick={() => setExpanded(!expanded)}
      style={{ opacity: isAcked ? 0.7 : 1 }}
    >
      {/* Top row */}
      <div className="incident-card__top">
        <div className="incident-card__priority">
          <div className={`priority-indicator priority-indicator--${priority}`} />
          <span className={`priority-label priority-label--${priority}`}>
            {PRIORITY_LABELS[priority] || 'Unknown'}
          </span>
          {incident.is_planned_activity && (
            <span style={{ fontSize: '0.7rem', color: 'var(--medium)' }}>
              📋 During Planned Activity
            </span>
          )}
          {isEscalated && (
            <span className="escalation-timer escalation-timer--critical">
              ⬆ Escalated L{incident.escalation_level}
            </span>
          )}
          {isAcked && (
            <span style={{ fontSize: '0.7rem', color: 'var(--normal)' }}>
              ✓ Acknowledged
            </span>
          )}
        </div>
        <div className="incident-card__meta">
          <span>{incident.alarm_count} alarm{incident.alarm_count !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{timeAgo(incident.created_at)}</span>
          <span>·</span>
          <span>{incident.bed_id}</span>
        </div>
      </div>

      {/* Context label (AI-generated) */}
      {incident.context_label && (
        <div className="incident-card__context">
          💡 {incident.context_label}
        </div>
      )}

      {/* Correlation reason */}
      {incident.correlation_reason && incident.alarm_count > 1 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          📎 {incident.correlation_reason}
        </div>
      )}

      {/* Alarm badges — always visible */}
      <div className="incident-card__alarms">
        {(incident.alarms || []).map((alarm, i) => {
          const display = ALARM_DISPLAY[alarm.type] || { label: alarm.type, desc: alarm.type };
          const badgeClass = alarm.is_tier1 ? 'alarm-badge--tier1'
            : alarm.is_artifact ? 'alarm-badge--artifact'
            : 'alarm-badge--normal';

          return (
            <span key={alarm.id || i} className={`alarm-badge ${badgeClass}`} title={display.desc}>
              {alarm.is_tier1 && <span className="alarm-badge__icon">🔴</span>}
              {alarm.is_artifact && <span className="alarm-badge__icon">⚠️</span>}
              {display.label}
            </span>
          );
        })}
      </div>

      {/* Expanded: show each alarm's details */}
      {expanded && (
        <div className="animate-fade-in" style={{ marginTop: '0.5rem' }}>
          {(incident.alarms || []).map((alarm, i) => {
            const display = ALARM_DISPLAY[alarm.type] || { label: alarm.type, desc: alarm.type };
            return (
              <div key={alarm.id || i} style={{
                padding: '0.4rem 0.6rem',
                marginBottom: '0.25rem',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <strong style={{ color: alarm.is_tier1 ? 'var(--critical)' : 'var(--text-primary)' }}>
                    {display.desc}
                  </strong>
                  {alarm.is_tier1 && <span style={{ color: 'var(--critical)', marginLeft: '0.3rem' }}>TIER 1</span>}
                  {alarm.is_artifact && (
                    <span style={{ color: 'var(--medium)', marginLeft: '0.3rem' }}>
                      (artifact {Math.round(alarm.artifact_confidence * 100)}%)
                    </span>
                  )}
                  {alarm.context_label && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>
                      — {alarm.context_label}
                    </span>
                  )}
                </div>
                <span style={{ color: 'var(--text-muted)' }}>
                  {timeAgo(alarm.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Routing */}
      <div className="incident-card__routing">
        <span>Routed to:</span>
        {(incident.routed_to || []).map((r) => (
          <span key={r} className={`role-badge role-badge--${r}`}>
            {ROLE_INFO[r]?.icon} {ROLE_INFO[r]?.name || r}
          </span>
        ))}
      </div>

      {/* Actions */}
      {showActions && !isAcked && (
        <div className="incident-card__actions">
          <button
            className="btn btn--sm btn--primary"
            onClick={handleAck}
            disabled={acking}
          >
            {acking ? '...' : '✓ Acknowledge'}
          </button>
          <button className="btn btn--sm btn--success" onClick={handleResolve}>
            ✓ Resolve
          </button>
          <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? '▲ Collapse' : `▼ Details (${incident.alarm_count})`}
          </button>
        </div>
      )}
    </div>
  );
}
