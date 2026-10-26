import React, { useState, useEffect, useRef } from 'react';

export default function DoctorDashboard({
  beds,
  incidents,
  selectedBed,
  onSelectBed,
  onAckIncident,
  onResolveIncident,
  onEscalateIncident,
  onOrderIntervention,
  dutyRoster = {},
  onUpdateDutyStatus,
  onDutyHandover,
}) {
  const canvasRef = useRef(null);

  // ── Diagnostic Channel & Order States ────────────────────────────
  const [channel, setChannel] = useState('lead2'); // 'lead2' | 'leadV1' | 'pleth' | 'capno'
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderBed, setOrderBed] = useState('bed-1');
  const [orderPreset, setOrderPreset] = useState('💊 Amiodarone 150mg IV Bolus over 10 min');
  const [orderCustom, setOrderCustom] = useState('');
  const [orderNotice, setOrderNotice] = useState(null);

  // ── Duty Roster & Coverage Failover States ────────────────────────
  const [inProcedureModalOpen, setInProcedureModalOpen] = useState(false);
  const [procedurePreset, setProcedurePreset] = useState('Emergency Cardioversion in Cath Lab');
  const [customProcedure, setCustomProcedure] = useState('');
  const [procedureCovering, setProcedureCovering] = useState(dutyRoster.covering_doctor || 'Dr. Priya Patel, MD');

  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [handoverTarget, setHandoverTarget] = useState(
    dutyRoster.roster_options?.find(d => d.name !== dutyRoster.current_doctor)?.name || 'Dr. Priya Patel, MD'
  );
  const [handoverCovering, setHandoverCovering] = useState(dutyRoster.covering_doctor || 'Dr. Marcus Vance, MD');
  const [handoverShift, setHandoverShift] = useState(dutyRoster.shift_name || 'Day ICU Shift (07:00 – 19:00)');
  const [handoverNote, setHandoverNote] = useState('Bed 1 STEMI stabilized post-amiodarone; Bed 2 post-dialysis line check pending.');

  // Pre-configured Stat ICU Orders
  const STAT_ORDERS = [
    '💊 Amiodarone 150mg IV Bolus over 10 min (Cardiac VT / Afib)',
    '⚡ Titrate Noradrenaline IV (Target MAP ≥ 65 mmHg)',
    '🫁 Increase PEEP to 10 cmH₂O & Order Stat ABG Panel',
    '🧪 Urgent Stat 12-Lead ECG & High-Sensitivity Troponin I',
    '💧 Reduce Hemodialysis Ultrafiltration Rate by 50%',
    '🩸 Draw Blood Cultures ×2 & Administer IV Ceftriaxone 2g',
  ];

  // ── Multi-Channel Waveform Drawing ───────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const g = (p, c, w) => Math.exp(-((p - c) ** 2) / (2 * w * w));

    // Standard Lead II Normal Sinus
    const ecgLead2 = (p, isCardiacBed, isKidneyBed) => {
      let pWave = 0.12 * g(p, .18, .025);
      let qWave = -0.12 * g(p, .31, .008);
      let rWave = 1.05 * g(p, .34, .009);
      let sWave = -0.22 * g(p, .37, .008);
      let tWave = 0.25 * g(p, .62, .045);

      // Bed 1 STEMI: Significant ST Segment Elevation above isoelectric line
      let stElevation = 0;
      if (isCardiacBed) {
        stElevation = 0.32 * g(p, .48, .09); // Elevated ST segment
      }

      // Bed 2 Dialysis / ESRD: Peaked, tall tented T-wave (Hyperkalemia)
      if (isKidneyBed) {
        tWave = 0.65 * g(p, .60, .025); // Tall sharp tented T
      }

      return pWave + qWave + rWave + sWave + stElevation + tWave;
    };

    // Precordial Lead V1 Morphology (Small r, deep S)
    const ecgLeadV1 = (p) => {
      let pWave = 0.08 * g(p, .18, .025);
      let rWave = 0.28 * g(p, .33, .01);
      let sWave = -0.95 * g(p, .38, .015);
      let tWave = -0.18 * g(p, .60, .04); // Inverted T in V1
      return pWave + rWave + sWave + tWave;
    };

    // Optical PPG Waveform
    const ppg = (p) => g(p, .25, .09) + 0.35 * g(p, .55, .07);

    // Alveolar Capnogram (EtCO₂)
    const capno = (p) => {
      if (p < 0.18) return 0;
      if (p < 0.30) return ((p - 0.18) / 0.12) * 0.9;
      if (p < 0.70) return 0.9 + 0.1 * ((p - 0.30) / 0.40);
      if (p < 0.82) return 1.0 - ((p - 0.70) / 0.12);
      return 0;
    };

    let animId;
    function render() {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const now = performance.now() / 1000;

      const bed = beds[selectedBed] || {};
      const isOccupied = bed.is_occupied !== false && bed.patient_name;
      const v = bed.vitals || {};
      const hr = v.hr || 75;
      const isLeadOff = v.lead_off;
      const isCardiacBed = selectedBed === 'bed-1';
      const isKidneyBed = selectedBed === 'bed-2';

      const period = channel === 'capno' ? 60 / 14 : 60 / Math.max(35, hr);
      const speed = 120;

      ctx.clearRect(0, 0, W, H);

      // Fine clinical diagnostic millimeter grid
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.65)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 25) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 25) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Standby if unoccupied
      if (!isOccupied) {
        ctx.fillStyle = '#64748B';
        ctx.font = '600 13px Lexend, sans-serif';
        ctx.fillText('BED INFRASTRUCTURE STANDBY · NO PATIENT ALLOCATED TO SLOT', 30, H / 2);
        animId = requestAnimationFrame(render);
        return;
      }

      // Draw Waveform Trace
      ctx.beginPath();
      let color = '#2F6FED';
      let channelLabel = 'ECG Lead II (Continuous Rhythm Strip)';
      let calibration = '10 mm/mV · 25 mm/s';

      if (channel === 'leadV1') {
        color = '#3B82F6';
        channelLabel = 'ECG Lead V1 (Precordial / Anterior Wall)';
      } else if (channel === 'pleth') {
        color = '#13A89E';
        channelLabel = 'Optical PPG Plethysmograph (SpO₂ Perfusion Pulse)';
      } else if (channel === 'capno') {
        color = '#F59E0B';
        channelLabel = 'Alveolar Capnography (EtCO₂ Airway Respiration)';
        calibration = 'Range: 0–50 mmHg · 14 BrPM';
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;

      for (let x = 0; x < W; x += 2) {
        const t = now - (W - x) / speed;
        let p = (t % period) / period;
        if (p < 0) p += 1;

        let yVal = 0;
        if (channel === 'lead2') {
          yVal = ecgLead2(p, isCardiacBed, isKidneyBed);
        } else if (channel === 'leadV1') {
          yVal = ecgLeadV1(p);
        } else if (channel === 'pleth') {
          yVal = ppg(p);
        } else if (channel === 'capno') {
          yVal = capno(p);
        }

        if (isLeadOff && (channel === 'lead2' || channel === 'leadV1')) {
          yVal = (Math.random() - 0.5) * 0.12;
        }

        const y = channel === 'capno'
          ? H * 0.75 - yVal * (H * 0.5)
          : H * 0.50 - yVal * 65;

        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Channel annotations
      ctx.fillStyle = color;
      ctx.font = '700 12px Lexend, sans-serif';
      ctx.fillText(`${channelLabel} · HR ${hr} BPM`, 14, 22);

      ctx.fillStyle = '#64748B';
      ctx.font = '600 10.5px monospace';
      ctx.fillText(calibration, 14, 38);

      // Calibration scale marker on left
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(8, H * 0.50 - 30);
      ctx.lineTo(8, H * 0.50 + 30);
      ctx.stroke();

      animId = requestAnimationFrame(render);
    }
    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [beds, selectedBed, channel]);

  // Open Stat Order Dialog
  const handleOpenOrder = (bedId, prefilledOrder = '') => {
    setOrderBed(bedId || selectedBed);
    if (prefilledOrder) {
      setOrderPreset(prefilledOrder);
    }
    setOrderModalOpen(true);
  };

  const handleSendOrder = () => {
    const finalOrder = orderCustom.trim() || orderPreset;
    if (onOrderIntervention) {
      onOrderIntervention(orderBed, finalOrder);
    }
    setOrderModalOpen(false);
    setOrderCustom('');
    setOrderNotice(`✓ Order transmitted to Nurse Station for ${orderBed.toUpperCase()}: "${finalOrder}"`);
    setTimeout(() => setOrderNotice(null), 5000);
  };

  const bedEntries = Object.entries(beds);
  const selBed = beds[selectedBed] || {};
  const isSelOccupied = selBed.is_occupied !== false && selBed.patient_name;
  const selVitals = selBed.vitals || {};
  const shockIndex = selVitals.hr ? (selVitals.hr / 120).toFixed(2) : '0.64';
  const spo2Pct = Math.min(100, Math.max(0, Math.round(((selVitals.spo2_proxy || 512) / 700) * 100)));

  const doctorIncidents = Object.values(incidents)
    .flat()
    .filter(i => i.status !== 'resolved')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  return (
    <div className="doctor-view">
      {/* ── Doctor Header ── */}
      <div className="view-header doc-view-header">
        <div>
          <h2>👨‍⚕️ Intensivist Diagnostic Console</h2>
          <p className="view-sub">
            Continuous Multi-Channel Telemetry · ST-Deviation & STEMI Monitoring · Clinical Duty Coverage & Handover
          </p>
        </div>
        <div className="doctor-header-actions">
          {/* Duty Status Badge & Switcher */}
          <div className="duty-roster-control-card">
            <div className="duty-doc-avatar">👨‍⚕️</div>
            <div className="duty-doc-info">
              <div className="duty-doc-name-row">
                <span className="duty-doc-name">{dutyRoster.current_doctor || 'Dr. Sharma, MD'}</span>
                <span className="duty-doc-title-pill">{dutyRoster.current_doctor_title?.split('/')[0] || 'Attending'}</span>
              </div>
              <div className="duty-doc-sub-row">
                <span className="duty-doc-shift">{dutyRoster.shift_name || 'Day ICU Shift'}</span>
                <span className="duty-bullet">•</span>
                <span className={`duty-live-badge ${dutyRoster.duty_status || 'active'}`}>
                  <span className="duty-live-dot" />
                  {dutyRoster.duty_status === 'active' ? 'Active on Ward'
                    : dutyRoster.duty_status === 'in_procedure' ? 'In Procedure / OR'
                    : 'Off-Duty'}
                </span>
              </div>
            </div>

            <div className="duty-btn-row">
              {dutyRoster.duty_status === 'active' ? (
                <button
                  type="button"
                  className="duty-action-btn proc-btn"
                  onClick={() => setInProcedureModalOpen(true)}
                  title="Mark attending in surgery/procedure — auto-forwards all alerts"
                >
                  <span className="btn-icon">🟡</span> In Procedure
                </button>
              ) : (
                <button
                  type="button"
                  className="duty-action-btn active-btn"
                  onClick={() => onUpdateDutyStatus('active', 'Attending resumed active duty on ward')}
                  title="Return to active ward service"
                >
                  <span className="btn-icon">🟢</span> Resume Duty
                </button>
              )}

              <button
                type="button"
                className="duty-action-btn handover-btn"
                onClick={() => setHandoverModalOpen(true)}
                title="Execute official clinical shift sign-out & handover"
              >
                <span className="btn-icon">🔄</span> Shift Handover
              </button>
            </div>
          </div>

          <button
            className="pri doc-header-stat-btn"
            onClick={() => handleOpenOrder(selectedBed)}
          >
            ✍️ Issue Stat Order
          </button>
        </div>
      </div>

      {/* ── Active Failover / Auto-Forwarding Banner (when in_procedure or off_duty) ── */}
      {dutyRoster.duty_status === 'in_procedure' && (
        <div className="duty-procedure-alert-banner">
          <div className="pulsing-radar-dot" style={{ background: '#F59E0B' }} />
          <div className="duty-banner-content">
            <div className="duty-banner-title">
              ⚠️ ATTENDING PHYSICIAN IN SURGERY / PROCEDURE: {dutyRoster.status_note || 'Surgical Procedure'}
            </div>
            <div className="duty-banner-sub">
              🛡️ <b>SAFETY AUTO-FORWARDING ACTIVE:</b> All doctor alerts and Tier 1 escalations are routed immediately with zero delay to <b>{dutyRoster.covering_doctor}</b> ({dutyRoster.covering_doctor_title || 'Critical Care Fellow'}) and Charge Nurse <b>{dutyRoster.charge_nurse || 'Charge Nurse'}</b>.
            </div>
          </div>
          <button
            className="duty-resume-btn"
            onClick={() => onUpdateDutyStatus('active', 'Attending resumed active duty on ward')}
          >
            🟢 End Procedure & Resume Active Duty
          </button>
        </div>
      )}

      {dutyRoster.duty_status === 'off_duty' && (
        <div className="duty-procedure-alert-banner off-duty-banner">
          <div className="pulsing-radar-dot" style={{ background: '#EF4444' }} />
          <div className="duty-banner-content">
            <div className="duty-banner-title">
              🔴 ATTENDING PHYSICIAN OFF-DUTY: {dutyRoster.status_note || 'Shift sign-out pending'}
            </div>
            <div className="duty-banner-sub">
              Coverage active under <b>{dutyRoster.covering_doctor}</b>. Please complete shift handover to log the incoming attending physician.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="duty-resume-btn"
              onClick={() => onUpdateDutyStatus('active', 'Attending resumed ward shift')}
            >
              🟢 Resume Shift
            </button>
            <button
              className="duty-resume-btn handover"
              onClick={() => setHandoverModalOpen(true)}
            >
              🔄 Complete Handover
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Toast */}
      {orderNotice && (
        <div className="order-success-banner">
          <span className="dot" style={{ background: '#10B981' }} />
          <span>{orderNotice}</span>
        </div>
      )}

      {/* ── Acuity Priority Bed Ribbon (3-Column Grid) ── */}
      <div className="doctor-acuity-grid">
        {bedEntries.map(([bedId, bed]) => {
          const v = bed.vitals || {};
          const isOccupied = bed.is_occupied !== false && bed.patient_name;
          const isSel = selectedBed === bedId;
          const bedInc = incidents[bedId] || [];
          const critCount = bedInc.filter(i => (i.priority || 0) >= 3 && i.status !== 'resolved').length;
          const hasWatch = bedInc.some(i => i.status !== 'resolved');
          const si = v.hr ? (v.hr / 120).toFixed(2) : '0.64';
          const bedSpo2 = Math.min(100, Math.max(0, Math.round(((v.spo2_proxy || 512) / 700) * 100)));

          if (!isOccupied) {
            return (
              <div
                key={bedId}
                className={`doctor-bed-card vacant-doc-card ${isSel ? 'selected-bed' : ''}`}
                onClick={() => onSelectBed(bedId)}
              >
                <div className="doc-card-head">
                  <div className="doc-card-id-group">
                    <span className="doc-bed-badge">{bedId.toUpperCase()}</span>
                    <span className="doc-profile-tag">🫁 Ventilator</span>
                  </div>
                  <span className="doc-acuity-pill vacant">UNOCCUPIED</span>
                </div>

                <div className="vacant-doc-body">
                  <div className="vacant-icon-small">🛏️</div>
                  <h4>Bed Infrastructure Standby</h4>
                  <p>Node #{bed.node_id} Online • Awaiting nurse patient assignment</p>
                </div>

                <div className="doc-card-foot">
                  <span>Template Ready</span>
                  <span className="doc-focus-indicator">{isSel ? '● Standby Waveform' : 'Click to Focus'}</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={bedId}
              className={`doctor-bed-card ${critCount > 0 ? 'high-acuity' : hasWatch ? 'watch-acuity' : 'stable-acuity'} ${isSel ? 'selected-bed' : ''}`}
              onClick={() => onSelectBed(bedId)}
            >
              <div className="doc-card-head">
                <div className="doc-card-id-group">
                  <span className="doc-bed-badge">{bedId.toUpperCase()}</span>
                  <span className="doc-profile-tag">
                    {bedId === 'bed-1' ? '❤️ Cardiac' : bedId === 'bed-2' ? '🩸 Dialysis' : '🫁 Ventilator'}
                  </span>
                </div>
                <span className={`doc-acuity-pill ${critCount > 0 ? 'crit' : hasWatch ? 'watch' : 'stable'}`}>
                  {critCount > 0 ? `🚨 TIER 1 ALERT (${critCount})` : hasWatch ? '⚠️ ACTION REQ' : '✓ STABLE'}
                </span>
              </div>

              <div className="doc-patient-identity">
                <div className="doc-patient-name">{bed.patient_name}</div>
                <div className="doc-patient-sub">
                  {bed.patient_mrn || 'MRN-88412'} • {bed.patient_age ? `${bed.patient_age}y` : ''} {bed.patient_gender || ''}
                </div>
              </div>

              <div className="doc-diagnosis-strip" title={bed.primary_diagnosis || 'Intensive Care Monitoring'}>
                <span className="doc-diag-label">DX:</span>
                <span className="doc-diag-text">{bed.primary_diagnosis || 'Intensive Care Monitoring'}</span>
              </div>

              <div className="doc-vitals-matrix">
                <div className={`doc-vital-cell ${v.hr > 120 || v.hr < 50 ? 'vital-alert' : ''}`}>
                  <span className="doc-vital-k">HR</span>
                  <span className="doc-vital-v">{v.hr || '—'} <small>BPM</small></span>
                </div>
                <div className={`doc-vital-cell ${bedSpo2 < 90 ? 'vital-alert' : ''}`}>
                  <span className="doc-vital-k">SpO₂</span>
                  <span className="doc-vital-v">{bedSpo2}%</span>
                </div>
                <div className={`doc-vital-cell ${v.temp >= 38.0 ? 'vital-alert' : ''}`}>
                  <span className="doc-vital-k">Temp</span>
                  <span className="doc-vital-v">{v.temp ? `${v.temp}°C` : '—'}</span>
                </div>
                <div className={`doc-vital-cell ${parseFloat(si) > 0.9 ? 'vital-alert' : ''}`}>
                  <span className="doc-vital-k">Shock Idx</span>
                  <span className="doc-vital-v">{si}</span>
                </div>
              </div>

              <div className="doc-card-foot">
                <span>{critCount > 0 ? `${critCount} active emergencies` : 'Vitals within range'}</span>
                <span className="doc-focus-indicator">
                  {isSel ? '● Active Telemetry' : 'Click to Focus'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Diagnostic Center: Waveform + Clinical Metrics ── */}
      <div className="doctor-main-grid">
        <div className="card" style={{ padding: '16px' }}>
          <div className="card-header-row" style={{ marginBottom: '8px' }}>
            <div>
              <h2 style={{ margin: 0 }}>
                📈 Rhythm & Diagnostic Center — {selectedBed.toUpperCase()}: {isSelOccupied ? `${selBed.patient_name} (${selBed.profile || 'General'} Template)` : '[Unoccupied Bed Template]'}
              </h2>
              <div style={{ fontSize: '11.5px', color: 'var(--mut)', marginTop: '2px' }}>
                Continuous electrophysiology monitoring • Automated ST segment & pleth analysis
              </div>
            </div>
            <div className="channel-selector-bar">
              <button
                className={`ch-btn ${channel === 'lead2' ? 'active' : ''}`}
                onClick={() => setChannel('lead2')}
              >
                Lead II
              </button>
              <button
                className={`ch-btn ${channel === 'leadV1' ? 'active' : ''}`}
                onClick={() => setChannel('leadV1')}
              >
                Lead V1
              </button>
              <button
                className={`ch-btn ${channel === 'pleth' ? 'active' : ''}`}
                onClick={() => setChannel('pleth')}
              >
                PPG Pleth
              </button>
              <button
                className={`ch-btn ${channel === 'capno' ? 'active' : ''}`}
                onClick={() => setChannel('capno')}
              >
                EtCO₂ Capno
              </button>
            </div>
          </div>

          {/* Diagnostic Electrophysiology Ribbon */}
          <div className="doc-diagnostic-ribbon">
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
              <span><b>Sweep:</b> 25 mm/s · 10 mm/mV</span>
              <span><b>QTc:</b> 412 ms</span>
              <span><b>PR:</b> 160 ms</span>
              <span><b>QRS:</b> 88 ms</span>
            </div>
            <div>
              {selectedBed === 'bed-1' && (
                <span style={{ color: '#F87171', fontWeight: 600 }}>
                  ⚠️ ST Elevation +2.8mm in V1–V3 (Anterior STEMI Alert)
                </span>
              )}
              {selectedBed === 'bed-2' && (
                <span style={{ color: '#FBBF24', fontWeight: 600 }}>
                  ⚠️ Peaked T-Waves (Electrolyte/K⁺ Alert: Hyperkalemia Risk)
                </span>
              )}
              {selectedBed === 'bed-3' && (
                <span style={{ color: '#34D399', fontWeight: 600 }}>
                  ✓ Airway Respiration Synchronized: Ppeak 20 cmH₂O
                </span>
              )}
            </div>
          </div>

          <canvas ref={canvasRef} className="doc-wave-canvas" />

          {isSelOccupied && (
            <div className="clinical-kpi-grid">
              <div className="doc-kpi-box">
                <span className="doc-kpi-label">Shock Index (HR/SBP)</span>
                <span className={`doc-kpi-val ${parseFloat(shockIndex) > 0.9 ? 'alert' : ''}`}>
                  {shockIndex}
                </span>
                <small className="doc-kpi-hint">Normal &lt;0.70 · Compensated</small>
              </div>
              <div className="doc-kpi-box">
                <span className="doc-kpi-label">Signal Quality Index</span>
                <span className="doc-kpi-val">
                  {selVitals.ecg_quality !== undefined ? `${selVitals.ecg_quality}%` : '98%'}
                </span>
                <small className="doc-kpi-hint">Contact impedance verified</small>
              </div>
              <div className="doc-kpi-box">
                <span className="doc-kpi-label">Oxygenation Proxy</span>
                <span className={`doc-kpi-val ${spo2Pct < 90 ? 'alert' : ''}`}>
                  {spo2Pct}%
                </span>
                <small className="doc-kpi-hint">Pleth amplitude tracking</small>
              </div>
              <div className="doc-kpi-box">
                <span className="doc-kpi-label">Core Temp Stability</span>
                <span className="doc-kpi-val">
                  {selVitals.temp ? `${selVitals.temp}°C` : '36.8°C'}
                </span>
                <small className="doc-kpi-hint">1-Wire Digital DS18B20</small>
              </div>
            </div>
          )}
        </div>

        {/* Doctor Escalation Queue & Fast Protocol Bar */}
        <div className="card" style={{ padding: '16px' }}>
          <div className="card-header-row">
            <h2>🚨 Physician Escalation Queue ({doctorIncidents.length})</h2>
            <span className="badge-quiet">Requires Clinical Order</span>
          </div>

          {doctorIncidents.length === 0 ? (
            <div className="empty" style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ fontSize: '26px', marginBottom: '8px' }}>🩺</div>
              <strong>Zero Unaddressed Tier 1 Crises</strong>
              <p style={{ color: 'var(--mut)', margin: '4px 0 0', fontSize: '12px' }}>
                All high-priority cardiac, respiratory, and dialysis alarms are currently controlled.
              </p>
            </div>
          ) : (
            <div className="nurse-incident-list">
              {doctorIncidents.map(inc => {
                const isAutoForwarded = inc.context_label?.includes('Auto-forwarded') || inc.correlation_reason?.includes('[COVERAGE:');
                const cleanTitle = inc.context_label?.includes('Auto-forwarded')
                  ? (inc.alarms?.[0]?.type ? `${inc.alarms[0].type.replace(/_/g, ' ')} — Emergency Response` : 'High Acuity Bedside Emergency')
                  : (inc.context_label || inc.correlation_reason || 'Tier 1 Critical Emergency');
                const cleanReason = (inc.correlation_reason || '').replace(/\[COVERAGE:[^\]]+\]\s*/, '');

                return (
                  <div key={inc.id} className="inc real doc-incident-card">
                    <div className="doc-inc-header">
                      <div className="doc-inc-badge-group">
                        <span className="vd crit-vd">TIER 1 CRITICAL ALERT</span>
                        {isAutoForwarded && (
                          <span className="duty-autoforward-tag">
                            🛡️ Failover: <b>{dutyRoster.covering_doctor || 'Fellow'}</b>
                          </span>
                        )}
                      </div>
                      <span className="doc-inc-bed-tag">
                        BED: <b>{inc.bed_id?.toUpperCase()}</b>
                      </span>
                    </div>

                    <h3 className="doc-inc-title">{cleanTitle}</h3>
                    <p className="doc-inc-reason">{cleanReason}</p>

                    <div className="al doc-inc-al">
                      ⚡ {inc.alarms?.length || 1} native monitor alarms correlated · Hardware buzzer armed
                    </div>

                    <div className="doc-quick-actions">
                      <button
                        className="pri doc-stat-order-btn"
                        onClick={() => handleOpenOrder(inc.bed_id)}
                      >
                        ✍️ Issue Stat Order
                      </button>
                      {inc.status === 'acknowledged' ? (
                        <span className="ack-pill-status">
                          ✓ Signed Off by {inc.acknowledged_by || 'Doctor'}
                        </span>
                      ) : (
                        <button
                          className="doc-signoff-btn"
                          onClick={() => onAckIncident(inc.id)}
                        >
                          ✓ Doctor Sign-Off
                        </button>
                      )}
                      <button
                        className="doc-resolve-btn"
                        onClick={() => onResolveIncident(inc.id)}
                      >
                        ✓ Resolve
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick Physician Order Shortcuts Pad */}
          <div className="fast-protocol-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12px', color: 'var(--ink)' }}>⚡ Fast ICU Stat Protocols ({selectedBed.toUpperCase()}):</strong>
              <span style={{ fontSize: '10.5px', color: 'var(--mut)' }}>1-Click Transmit</span>
            </div>
            <div className="fast-protocol-grid">
              <button
                type="button"
                className="fast-protocol-btn"
                onClick={() => handleOpenOrder(selectedBed, '💊 Amiodarone 150mg IV Bolus over 10 min')}
              >
                💊 Amiodarone 150mg IV
              </button>
              <button
                type="button"
                className="fast-protocol-btn"
                onClick={() => handleOpenOrder(selectedBed, '⚡ Titrate Noradrenaline IV (Target MAP ≥ 65 mmHg)')}
              >
                ⚡ Noradrenaline Infusion
              </button>
              <button
                type="button"
                className="fast-protocol-btn"
                onClick={() => handleOpenOrder(selectedBed, '🧪 Urgent Stat 12-Lead ECG & High-Sensitivity Troponin I')}
              >
                🧪 Stat 12-Lead ECG + Trop-I
              </button>
              <button
                type="button"
                className="fast-protocol-btn"
                onClick={() => handleOpenOrder(selectedBed, '🩸 Draw Blood Cultures ×2 & Administer IV Ceftriaxone 2g')}
              >
                🩸 Blood Cultures + Ceftriaxone
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Physician Clinical Order Modal ── */}
      {orderModalOpen && (
        <div className="modal-backdrop" onClick={() => setOrderModalOpen(false)}>
          <div className="modal-dialog order-modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-tag">ICU Physician Escalation Order</span>
                <h3>✍️ Issue Stat Clinical Order</h3>
                <span className="order-target-subtitle">
                  Target: <b>{orderBed.toUpperCase()}</b> · {beds[orderBed]?.patient_name || 'Patient Bed'} ({beds[orderBed]?.profile || 'General'} Template)
                </span>
              </div>
              <button className="modal-close-btn" onClick={() => setOrderModalOpen(false)}>✕</button>
            </div>

            <div className="modal-body-content">
              <label className="order-field-label">Select Standard ICU Stat Protocol:</label>
              <div className="preset-orders-list">
                {STAT_ORDERS.map(ord => (
                  <button
                    key={ord}
                    type="button"
                    className={`order-preset-btn ${orderPreset === ord ? 'active' : ''}`}
                    onClick={() => { setOrderPreset(ord); setOrderCustom(''); }}
                  >
                    <span className="order-radio-indicator" />
                    <span>{ord}</span>
                  </button>
                ))}
              </div>

              <div className="custom-order-section">
                <label className="order-field-label">Or Custom Clinical Order / Dosage Note:</label>
                <input
                  type="text"
                  className="order-text-input"
                  placeholder="e.g. Administer 100mg IV Metoprolol; Check Potassium level"
                  value={orderCustom}
                  onChange={e => setOrderCustom(e.target.value)}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={() => setOrderModalOpen(false)}>Cancel</button>
              <button type="button" className="pri" style={{ padding: '9px 18px' }} onClick={handleSendOrder}>
                🚀 Transmit Stat Order to Nurse Station
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── In-Procedure / Surgery Modal ── */}
      {inProcedureModalOpen && (
        <div className="modal-backdrop" onClick={() => setInProcedureModalOpen(false)}>
          <div className="modal-dialog duty-modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-pill-tag proc-tag">⚡ Physician Unavailability Failover</div>
                <h3 className="modal-title">🟡 Set In-Procedure / Surgery Status</h3>
                <p className="modal-subtitle">
                  Attending <b>{dutyRoster.current_doctor}</b> will be marked in surgery. Emergency alerts will failover immediately.
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setInProcedureModalOpen(false)}>✕</button>
            </div>

            <div className="modal-body-content">
              <label className="handover-section-label">
                <span>Select Surgical Procedure / Clinical Scenario</span>
                <small>Designates location and automated failover reason</small>
              </label>

              <div className="handover-procedure-grid">
                {[
                  { id: 'Emergency Cardioversion in Cath Lab', icon: '⚡', label: 'Emergency Cardioversion', location: 'Cath Lab Suite 2' },
                  { id: 'Bronchoscopy & Airway Intubation (Bed 3)', icon: '🫁', label: 'Bronchoscopy & Intubation', location: 'ICU Bed 3' },
                  { id: 'Trauma Laparotomy in OR Suite 4', icon: '🩸', label: 'Trauma Laparotomy', location: 'Emergency OR 4' },
                  { id: 'Ultrasound-guided Central Venous Line Insertion', icon: '💉', label: 'Central Venous Line', location: 'Bedside Ultrasound' },
                ].map(proc => {
                  const isSelected = procedurePreset === proc.id;
                  return (
                    <div
                      key={proc.id}
                      className={`handover-procedure-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => { setProcedurePreset(proc.id); setCustomProcedure(''); }}
                    >
                      <div className="proc-card-icon">{proc.icon}</div>
                      <div className="proc-card-text">
                        <strong>{proc.label}</strong>
                        <span>{proc.location}</span>
                      </div>
                      <span className={`proc-card-check ${isSelected ? 'active' : ''}`}>✓</span>
                    </div>
                  );
                })}
              </div>

              <div className="handover-field-group" style={{ marginTop: '12px' }}>
                <label className="handover-section-label">
                  <span>Or Custom Procedure / Location Note</span>
                  <small>Override with specific suite or phone extension</small>
                </label>
                <input
                  type="text"
                  className="handover-input"
                  placeholder="e.g. Endoscopy Suite for Upper GI bleed; reachable via Voicera #1"
                  value={customProcedure}
                  onChange={e => setCustomProcedure(e.target.value)}
                />
              </div>

              <div className="handover-field-group" style={{ marginTop: '14px' }}>
                <label className="handover-section-label">
                  <span>Designated Covering Physician (Alert Recipient)</span>
                  <small>Holds primary pager while attending is in procedure</small>
                </label>
                <div className="custom-select-wrapper">
                  <select
                    className="custom-select"
                    value={procedureCovering}
                    onChange={e => setProcedureCovering(e.target.value)}
                  >
                    {(dutyRoster.roster_options || []).map(doc => (
                      <option key={doc.name} value={doc.name}>
                        {doc.name} · {doc.title} ({doc.contact})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="duty-info-callout">
                <div className="callout-icon">🛡️</div>
                <div className="callout-text">
                  <strong>Zero-Delay Safety Failover Active:</strong>
                  <span>While marked in procedure, C.A.R.E. automatically copies the <b>Charge Nurse</b> and routes all Tier 1 alarms directly to <b>{procedureCovering}</b>.</span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={() => setInProcedureModalOpen(false)}>Cancel</button>
              <button
                type="button"
                className="pri proc-confirm-btn"
                onClick={() => {
                  const finalNote = customProcedure.trim() || procedurePreset;
                  onUpdateDutyStatus('in_procedure', finalNote, procedureCovering);
                  setInProcedureModalOpen(false);
                }}
              >
                🟡 Activate In-Procedure Failover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shift Handover Modal ── */}
      {handoverModalOpen && (
        <div className="modal-backdrop" onClick={() => setHandoverModalOpen(false)}>
          <div className="modal-dialog duty-modal-dialog handover-modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-pill-tag handover-tag">📋 ICU Clinical Governance & Shift Sign-Out</div>
                <h3 className="modal-title">🔄 Physician Shift Handover & Sign-Out</h3>
                <p className="modal-subtitle">
                  Formal sign-out transfers primary attending pager and emergency auto-forwarding responsibilities.
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setHandoverModalOpen(false)}>✕</button>
            </div>

            <div className="modal-body-content">
              {/* Outgoing Attending Card */}
              <div className="handover-outgoing-card">
                <div className="handover-outgoing-avatar">👨‍⚕️</div>
                <div className="handover-outgoing-info">
                  <span className="handover-outgoing-tag">Signing-Out Primary Attending</span>
                  <h4 className="handover-outgoing-name">{dutyRoster.current_doctor || 'Dr. Sharma, MD'}</h4>
                  <p className="handover-outgoing-sub">
                    {dutyRoster.current_doctor_title || 'Lead Intensivist / Attending'} · Shift: {dutyRoster.shift_name || 'Day Shift'}
                  </p>
                </div>
                <div className="handover-outgoing-badge">Relinquishing Pager</div>
              </div>

              {/* Incoming Doctor Selection - Rich Clickable Cards */}
              <div className="handover-section">
                <label className="handover-section-label">
                  <span>Incoming Primary Attending (Pager Holder)</span>
                  <small>Select credentialed intensivist to receive lead clinician pager</small>
                </label>
                <div className="handover-doc-grid">
                  {(dutyRoster.roster_options || [])
                    .filter(doc => doc.name !== dutyRoster.current_doctor)
                    .map(doc => {
                      const isSelected = handoverTarget === doc.name;
                      return (
                        <div
                          key={doc.name}
                          className={`handover-doc-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => setHandoverTarget(doc.name)}
                        >
                          <div className="handover-doc-radio">
                            {isSelected && <span className="handover-radio-dot" />}
                          </div>
                          <div className="handover-doc-card-body">
                            <strong className="handover-doc-card-name">{doc.name}</strong>
                            <span className="handover-doc-card-title">{doc.title}</span>
                            <span className="handover-doc-card-contact">📞 {doc.contact}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Backup Covering Fellow & Shift Schedule */}
              <div className="handover-two-cols">
                <div className="handover-field-group">
                  <label className="handover-section-label">
                    <span>Backup Covering Fellow / On-Call</span>
                    <small>Second-line responder for clinical alarms</small>
                  </label>
                  <div className="custom-select-wrapper">
                    <select
                      className="custom-select"
                      value={handoverCovering}
                      onChange={e => setHandoverCovering(e.target.value)}
                    >
                      {(dutyRoster.roster_options || []).map(doc => (
                        <option key={doc.name} value={doc.name}>
                          {doc.name} · {doc.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="handover-field-group">
                  <label className="handover-section-label">
                    <span>Target Shift Schedule</span>
                    <small>Designated clinical tour of duty</small>
                  </label>
                  <div className="custom-select-wrapper">
                    <select
                      className="custom-select"
                      value={handoverShift}
                      onChange={e => setHandoverShift(e.target.value)}
                    >
                      <option value="Day ICU Shift (07:00 – 19:00)">☀️ Day ICU Shift (07:00 – 19:00)</option>
                      <option value="Night ICU Shift (19:00 – 07:00)">🌙 Night ICU Shift (19:00 – 07:00)</option>
                      <option value="Weekend On-Call Shift (24h)">⚡ Weekend On-Call Shift (24h)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Clinical Handover Notes with Quick Chips */}
              <div className="handover-field-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label className="handover-section-label">
                    <span>Clinical Sign-Out Summary & High-Acuity Notes</span>
                    <small>Actionable handover notes for incoming attending</small>
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--mut)' }}>1-Click Quick Append</span>
                </div>

                <div className="quick-note-chips">
                  {[
                    'Bed 1 STEMI stabilized post-amiodarone',
                    'Bed 2 Dialysis line clean & patent',
                    'Bed 3 SpO₂ stable on ventilator',
                    'Stat Troponin panel pending',
                  ].map(chip => (
                    <button
                      key={chip}
                      type="button"
                      className="quick-note-chip"
                      onClick={() => {
                        setHandoverNote(prev => (prev ? `${prev}; ${chip}` : chip));
                      }}
                    >
                      + {chip}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={3}
                  className="handover-textarea"
                  value={handoverNote}
                  onChange={e => setHandoverNote(e.target.value)}
                  placeholder="Summarize high acuity bed status, active stat orders, pending lab results..."
                />
              </div>

              {/* Handover Audit Trail */}
              {dutyRoster.handover_history?.length > 0 && (
                <div className="handover-history-box">
                  <div className="handover-history-header">
                    <span>📜 Recent Shift Handover Audit Trail</span>
                    <small>Hospital Electronic Medical Sign-Out Record</small>
                  </div>
                  <div className="handover-history-list">
                    {dutyRoster.handover_history.slice(-3).reverse().map((h, i) => (
                      <div key={i} className="handover-history-item">
                        <div className="history-item-top">
                          <strong>{h.from_doctor} ➔ {h.to_doctor}</strong>
                          <span className="history-item-time">
                            {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="history-item-note">"{h.note}"</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-cancel" onClick={() => setHandoverModalOpen(false)}>Cancel</button>
              <button
                type="button"
                className="pri handover-confirm-btn"
                onClick={() => {
                  const targetOpt = (dutyRoster.roster_options || []).find(d => d.name === handoverTarget);
                  onDutyHandover({
                    new_doctor: handoverTarget,
                    new_title: targetOpt?.title || 'Attending Intensivist',
                    new_covering: handoverCovering,
                    shift_name: handoverShift,
                    note: handoverNote.trim() || 'Shift sign-out completed',
                  });
                  setHandoverModalOpen(false);
                }}
              >
                🔄 Complete Handover & Transfer Pager
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
