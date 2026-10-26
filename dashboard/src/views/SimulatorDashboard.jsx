import React, { useState } from 'react';

const ALL_SCENARIOS = [
  // ── CARDIAC BED SPECIFIC (Bed-1) ───────────────────────────────────
  {
    id: 'flatline',
    name: '💔 Cardiac Arrest / Asystole',
    desc: 'Zero cardiac rhythm detected with valid electrode contact. Highest priority Tier 1 code blue event triggering immediate defibrillator prep and physician stat notification.',
    tag: 'Life Threat',
    color: 'var(--red)',
    profiles: ['cardiac'],
    profileLabel: '❤️ Cardiac ICU',
  },
  {
    id: 'tachycardia',
    name: '⚡ Ventricular Tachycardia (178 BPM)',
    desc: 'Rapid ventricular tachycardia with widening QRS complex. Escalated to on-call cardiologist with antiarrhythmic drip advisory.',
    tag: 'Tier 1 Arrhythmia',
    color: 'var(--red)',
    profiles: ['cardiac'],
    profileLabel: '❤️ Cardiac ICU',
  },
  {
    id: 'bradycardia',
    name: '🐢 Severe Sinus Bradycardia (33 BPM)',
    desc: 'Heart rate drops below 40 BPM critical threshold. Prompts nurse to check carotid pulse and ready transcutaneous pacing.',
    tag: 'Tier 2 Conduction',
    color: 'var(--amb)',
    profiles: ['cardiac'],
    profileLabel: '❤️ Cardiac ICU',
  },
  {
    id: 'lead_off',
    name: '⚡ ECG Lead Disconnect vs Asystole',
    desc: 'Disconnects Lead II electrode pin. Demonstrates safety invariant: Hardware buzzer alerts, while CARE flags it as a lead-off rather than false cardiac arrest.',
    tag: 'Safety Invariant',
    color: 'var(--vio)',
    profiles: ['cardiac'],
    profileLabel: '❤️ Cardiac ICU',
  },

  // ── KIDNEY / DIALYSIS SPECIFIC (Bed-2) ──────────────────────────────
  {
    id: 'dialysis_blood_leak',
    name: '🩸 Dialysis Blood Leak & Line Rupture',
    desc: 'Simulates hemodialysis line rupture: blood leak optical detector trips and venous return pressure plunges. Auto-halts blood pump to prevent exsanguination.',
    tag: 'Tier 1 Kidney',
    color: 'var(--red)',
    profiles: ['kidney'],
    profileLabel: '🩸 Nephrology / Dialysis',
  },
  {
    id: 'dialysis_pressure',
    name: '🛑 Venous Return Pressure Spike (270 mmHg)',
    desc: 'Venous chamber pressure rises sharply due to vascular access needle thrombosis or line kinking. Alerts nephrology nurse to inspect access.',
    tag: 'Tier 2 Dialysis',
    color: 'var(--amb)',
    profiles: ['kidney'],
    profileLabel: '🩸 Nephrology / Dialysis',
  },

  // ── RESPIRATORY / VENTILATOR SPECIFIC (Bed-3) ────────────────────────
  {
    id: 'vent_disconnect',
    name: '💨 Ventilator Circuit Disconnect',
    desc: 'Airway pressure drops to zero with delayed SpO₂ fall. Triggers urgent ventilator reconnect alert and RT bedside dispatch.',
    tag: 'Tier 1 Respiratory',
    color: 'var(--blue)',
    profiles: ['respiratory'],
    profileLabel: '🫁 Pulmonary / Ventilator',
  },
  {
    id: 'vent_high_pressure',
    name: '⚠️ Peak Airway Pressure Spike (>45 cmH₂O)',
    desc: 'Sudden high peak inspiratory pressure caused by bronchospasm or secretion plugging. Prompts immediate in-line suctioning protocol.',
    tag: 'Tier 2 Airway',
    color: 'var(--amb)',
    profiles: ['respiratory'],
    profileLabel: '🫁 Pulmonary / Ventilator',
  },
  {
    id: 'desaturation',
    name: '🫁 Acute Hypoxic Desaturation',
    desc: 'Gradual SpO₂ drop to 76% with clean optical pulse signal. Classified as genuine respiratory emergency and escalated immediately to Nurse & Respiratory Therapist.',
    tag: 'Tier 1 Hypoxia',
    color: 'var(--red)',
    profiles: ['respiratory'],
    profileLabel: '🫁 Pulmonary / Ventilator',
  },

  // ── SYSTEMIC & UNIVERSAL (All Beds) ─────────────────────────────────
  {
    id: 'fever',
    name: '🌡️ Sepsis Fever Spike + Tachycardia',
    desc: 'Core temperature rises to 39.8°C with compensatory tachycardia (142 BPM). Cross-correlated as impending septic shock rather than isolated rhythm problem.',
    tag: 'Correlation Rule',
    color: 'var(--teal)',
    profiles: ['cardiac', 'kidney', 'respiratory'],
    profileLabel: '🌐 Systemic Sepsis',
  },
  {
    id: 'motion_artifact',
    name: '🏃 Motion Artifact during Bed Bath',
    desc: 'Simulates sensor displacement during patient turning. KY-039 noise & ECG spikes fire. CARE classifies as motion artifact, suppressing nuisance nurse alerts.',
    tag: 'Artifact Filter',
    color: 'var(--amb)',
    profiles: ['cardiac', 'kidney', 'respiratory'],
    profileLabel: '🌐 Universal ICU',
  },
  {
    id: 'repeated_spo2',
    name: '🔄 Repeated SpO₂ Flapping (Tech Loop)',
    desc: 'SpO₂ sensor intermittently trips due to poor optical alignment. CARE auto-generates a Biomedical Work Order for Tech Ravi.',
    tag: 'Tech Routing',
    color: 'var(--vio)',
    profiles: ['cardiac', 'kidney', 'respiratory'],
    profileLabel: '🌐 Universal ICU',
  },
];

export default function SimulatorDashboard({
  beds,
  onTriggerScenario,
  onTriggerAll,
  onSetVitals,
  onTogglePlannedActivity,
}) {
  const [selectedSimBed, setSelectedSimBed] = useState('bed-1');
  const [filterMode, setFilterMode] = useState('bed'); // 'bed' = profile tailored, 'all' = full ward library
  const [activeScenarioName, setActiveScenarioName] = useState(null);
  const [log, setLog] = useState([
    { time: new Date().toLocaleTimeString(), text: 'Simulator console initialized. Connected to BIU backend.' },
  ]);

  const addLog = (text) => {
    setLog(prev => [{ time: new Date().toLocaleTimeString(), text }, ...prev.slice(0, 19)]);
  };

  const selNodeId = parseInt(selectedSimBed.replace('bed-', '')) || 1;
  const currentBed = beds[selectedSimBed] || {};
  const currentBedData = currentBed.vitals || {};
  const currentBedProfile = currentBed.profile || (selectedSimBed === 'bed-1' ? 'cardiac' : selectedSimBed === 'bed-2' ? 'kidney' : 'respiratory');

  // Filter scenarios based on bed profile
  const scenariosToShow = filterMode === 'bed'
    ? ALL_SCENARIOS.filter(sc => sc.profiles.includes(currentBedProfile))
    : ALL_SCENARIOS;

  const handleSlider = async (field, val) => {
    addLog(`Overriding ${selectedSimBed.toUpperCase()} ${field} → ${val}`);
    await onSetVitals(selNodeId, { [field]: val });
  };

  const runScenario = async (sc) => {
    setActiveScenarioName(sc.name);
    addLog(`Triggered Scenario: "${sc.name}" on ${selectedSimBed.toUpperCase()}`);
    await onTriggerScenario(sc.id, selectedSimBed);
    setTimeout(() => setActiveScenarioName(null), 4000);
  };

  const resetAllBeds = async () => {
    addLog('Resetting all beds to clean physiological baselines...');
    await onSetVitals(1, { hr: 75, temp: 36.8, spo2: 600 });
    await onSetVitals(2, { hr: 80, temp: 37.0, spo2: 590, dial_blood_flow: 250, dial_venous_pressure: 120 });
    await onSetVitals(3, { hr: 82, temp: 36.9, spo2: 580, vent_pressure: 20, vent_tidal_volume: 500 });
  };

  return (
    <div className="sim-view">
      {/* ── Simulator Header ── */}
      <div className="view-header">
        <div>
          <h2>🕹️ Simulator Master Control Console</h2>
          <p className="view-sub">
            Real-time injection console • Override physiological parameters • Launch clinical validation scenarios
          </p>
        </div>
        <div className="sim-top-buttons">
          <button className="pri" onClick={resetAllBeds}>
            🔄 Reset All Beds to Nominal
          </button>
          <button className="danger" onClick={() => { addLog('Simulating multi-bed crisis across ward!'); onTriggerAll('multi_bed_crisis'); }}>
            🚨 Trigger Multi-Bed Ward Crisis
          </button>
        </div>
      </div>

      {activeScenarioName && (
        <div className="sim-scenario-banner">
          <span className="dot" style={{ background: 'var(--red)' }} />
          <strong>Injecting Scenario:</strong> {activeScenarioName} (Watch main dashboard update in real-time)
        </div>
      )}

      {/* ── Main Two Column: Controls Left, Scenarios Right ── */}
      <div className="sim-main-grid">
        {/* Left Column: Bed-by-Bed Vitals Override */}
        <div className="card">
          <div className="card-header-row">
            <h2>🎛️ Real-Time Vitals Override</h2>
            <div className="bed-picker-pills">
              {['bed-1', 'bed-2', 'bed-3'].map(bId => {
                const bProf = beds[bId]?.profile || (bId === 'bed-1' ? 'cardiac' : bId === 'bed-2' ? 'kidney' : 'respiratory');
                return (
                  <button
                    key={bId}
                    className={`picker-pill ${selectedSimBed === bId ? 'active' : ''}`}
                    onClick={() => setSelectedSimBed(bId)}
                  >
                    {bId.toUpperCase()} ({bProf})
                  </button>
                );
              })}
            </div>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--mut)', marginTop: 0 }}>
            Adjust physiological & equipment values below. Sliders push directly to the BIU edge server:
          </p>

          <div className="slider-control-group">
            {/* Heart Rate */}
            <div className="slider-item">
              <div className="slider-top">
                <label>Heart Rate (BPM)</label>
                <span className="slider-val-badge">{currentBedData.hr || 75} BPM</span>
              </div>
              <input
                type="range"
                min="30"
                max="220"
                value={currentBedData.hr || 75}
                onChange={(e) => handleSlider('hr', parseInt(e.target.value))}
              />
              <div className="slider-labels">
                <span>30 (Bradycardia)</span>
                <span>Normal (60–100)</span>
                <span>220 (V-Tach)</span>
              </div>
            </div>

            {/* Core Temperature */}
            <div className="slider-item">
              <div className="slider-top">
                <label>Core Temperature (°C)</label>
                <span className="slider-val-badge">{currentBedData.temp || 36.8}°C</span>
              </div>
              <input
                type="range"
                min="34.0"
                max="41.5"
                step="0.1"
                value={currentBedData.temp || 36.8}
                onChange={(e) => handleSlider('temp', parseFloat(e.target.value))}
              />
              <div className="slider-labels">
                <span>34.0 (Hypothermia)</span>
                <span>37.0 (Normal)</span>
                <span>41.5 (Hyperpyrexia)</span>
              </div>
            </div>

            {/* SpO2 */}
            <div className="slider-item">
              <div className="slider-top">
                <label>SpO₂ Optical Proxy</label>
                <span className="slider-val-badge">
                  {Math.min(100, Math.round(((currentBedData.spo2_proxy || 512)/700)*100))}% ({currentBedData.spo2_proxy || 512})
                </span>
              </div>
              <input
                type="range"
                min="200"
                max="750"
                value={currentBedData.spo2_proxy || 512}
                onChange={(e) => handleSlider('spo2', parseInt(e.target.value))}
              />
              <div className="slider-labels">
                <span>200 (&lt;60% Critical)</span>
                <span>500 (80% Caution)</span>
                <span>700 (99% Nominal)</span>
              </div>
            </div>

            {/* ── Profile-Specific Sliders: Kidney / Hemodialysis ── */}
            {currentBedProfile === 'kidney' && (
              <>
                <div className="slider-item" style={{ borderTop: '1px dashed var(--line)', paddingTop: '10px' }}>
                  <div className="slider-top">
                    <label>🩸 Dialysis Blood Flow Rate (ml/min)</label>
                    <span className="slider-val-badge" style={{ color: 'var(--red)' }}>
                      {currentBedData.dial_blood_flow || 250} ml/min
                    </span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="500"
                    step="10"
                    value={currentBedData.dial_blood_flow || 250}
                    onChange={(e) => handleSlider('dial_blood_flow', parseFloat(e.target.value))}
                  />
                  <div className="slider-labels">
                    <span>100 (Reduced)</span>
                    <span>250 (Standard)</span>
                    <span>500 (High Flow)</span>
                  </div>
                </div>

                <div className="slider-item">
                  <div className="slider-top">
                    <label>🛑 Venous Return Pressure (mmHg)</label>
                    <span className="slider-val-badge" style={{ color: (currentBedData.dial_venous_pressure || 120) > 240 ? 'var(--red)' : 'var(--blue)' }}>
                      {currentBedData.dial_venous_pressure || 120} mmHg
                    </span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="300"
                    step="5"
                    value={currentBedData.dial_venous_pressure || 120}
                    onChange={(e) => handleSlider('dial_venous_pressure', parseFloat(e.target.value))}
                  />
                  <div className="slider-labels">
                    <span>50 (Subnominal)</span>
                    <span>120 (Normal)</span>
                    <span>&gt;250 (Occlusion Hazard)</span>
                  </div>
                </div>
              </>
            )}

            {/* ── Profile-Specific Sliders: Respiratory / Mechanical Ventilator ── */}
            {currentBedProfile === 'respiratory' && (
              <>
                <div className="slider-item" style={{ borderTop: '1px dashed var(--line)', paddingTop: '10px' }}>
                  <div className="slider-top">
                    <label>💨 Peak Airway Pressure (cmH₂O)</label>
                    <span className="slider-val-badge" style={{ color: (currentBedData.vent_pressure || 20) > 40 ? 'var(--red)' : 'var(--blue)' }}>
                      {currentBedData.vent_pressure || 20} cmH₂O
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="1"
                    value={currentBedData.vent_pressure || 20}
                    onChange={(e) => handleSlider('vent_pressure', parseFloat(e.target.value))}
                  />
                  <div className="slider-labels">
                    <span>10 (Circuit Leak)</span>
                    <span>20 (Normal Ppeak)</span>
                    <span>&gt;40 (Bronchospasm / High PIP)</span>
                  </div>
                </div>

                <div className="slider-item">
                  <div className="slider-top">
                    <label>🫁 Delivered Tidal Volume (ml)</label>
                    <span className="slider-val-badge" style={{ color: 'var(--teal)' }}>
                      {currentBedData.vent_tidal_volume || 500} ml
                    </span>
                  </div>
                  <input
                    type="range"
                    min="200"
                    max="800"
                    step="25"
                    value={currentBedData.vent_tidal_volume || 500}
                    onChange={(e) => handleSlider('vent_tidal_volume', parseFloat(e.target.value))}
                  />
                  <div className="slider-labels">
                    <span>200 (Hypoventilation)</span>
                    <span>500 (Nominal)</span>
                    <span>800 (Hyperinflation)</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Quick Hardware Fault Injections */}
          <div className="sim-toggles-box">
            <h4>⚡ Quick Hardware Fault Injections ({selectedSimBed.toUpperCase()} • {currentBedProfile.toUpperCase()})</h4>
            <div className="sim-quick-toggles">
              {currentBedProfile === 'cardiac' && (
                <>
                  <button onClick={() => runScenario({ id: 'lead_off', name: 'Electrode Disconnect' })}>
                    🔌 Disconnect Lead II (D12)
                  </button>
                  <button onClick={() => runScenario({ id: 'flatline', name: 'Cardiac Arrest / Asystole' })}>
                    💔 Induce Asystole (Code Blue)
                  </button>
                  <button onClick={() => runScenario({ id: 'tachycardia', name: 'Ventricular Tachycardia' })}>
                    ⚡ Induce V-Tach (178 BPM)
                  </button>
                </>
              )}

              {currentBedProfile === 'kidney' && (
                <>
                  <button onClick={() => runScenario({ id: 'dialysis_blood_leak', name: 'Dialysis Blood Leak' })}>
                    🩸 Trip Blood Leak Detector
                  </button>
                  <button onClick={() => runScenario({ id: 'dialysis_pressure', name: 'Venous Return Pressure Spike' })}>
                    🛑 Spike Venous Line (&gt;250 mmHg)
                  </button>
                  <button onClick={() => runScenario({ id: 'fever', name: 'Catheter Sepsis Fever' })}>
                    🌡️ Catheter Sepsis Spike (39.8°C)
                  </button>
                </>
              )}

              {currentBedProfile === 'respiratory' && (
                <>
                  <button onClick={() => runScenario({ id: 'vent_disconnect', name: 'Ventilator Circuit Disconnect' })}>
                    💨 Disconnect Ventilator Y-Piece
                  </button>
                  <button onClick={() => runScenario({ id: 'vent_high_pressure', name: 'Peak Airway Pressure Spike' })}>
                    ⚠️ Cough / Airway Pressure Spike
                  </button>
                  <button onClick={() => runScenario({ id: 'desaturation', name: 'Acute Hypoxic Desaturation' })}>
                    🫁 Drop SpO₂ Hypoxia (76%)
                  </button>
                </>
              )}

              <button onClick={() => runScenario({ id: 'motion_artifact', name: 'Motion Artifact Noise' })}>
                🌊 Shake Sensor (Motion Noise)
              </button>
              <button onClick={() => onTogglePlannedActivity(selectedSimBed, true, 'bed_bath')}>
                🛁 Start Bed Bath (Planned Care)
              </button>
            </div>
          </div>

          {/* Console Log */}
          <div className="sim-console-box">
            <h4>📡 Live Injection Telemetry Log</h4>
            <div className="sim-log-scroll">
              {log.map((entry, idx) => (
                <div key={idx} className="sim-log-line">
                  <span className="sim-log-time">[{entry.time}]</span> {entry.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Clinical Scenarios Launcher */}
        <div className="card">
          <div className="card-header-row">
            <div>
              <h2 style={{ margin: 0 }}>🎯 Clinical Scenario Library</h2>
              <div style={{ fontSize: '11px', color: 'var(--mut)', marginTop: '2px' }}>
                Profile-aware simulation suite for CARE intelligent routing
              </div>
            </div>
            <span className="badge-quiet">Target: {selectedSimBed.toUpperCase()} ({currentBedProfile.toUpperCase()})</span>
          </div>

          {/* Scenario Filter Pills */}
          <div className="filter-pill-bar" style={{ marginTop: '10px' }}>
            <button
              className={`picker-pill ${filterMode === 'bed' ? 'active' : ''}`}
              onClick={() => setFilterMode('bed')}
            >
              🎯 {selectedSimBed.toUpperCase()} ({currentBedProfile.toUpperCase()}) Tailored ({ALL_SCENARIOS.filter(s => s.profiles.includes(currentBedProfile)).length})
            </button>
            <button
              className={`picker-pill ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              🌐 All Ward Scenarios ({ALL_SCENARIOS.length})
            </button>
          </div>

          {/* Educational Profile Info Banner */}
          <div className="sim-profile-info-banner">
            <span style={{ fontSize: '16px' }}>
              {currentBedProfile === 'cardiac' ? '❤️' : currentBedProfile === 'kidney' ? '🩸' : '🫁'}
            </span>
            <div>
              {filterMode === 'bed' ? (
                <span>
                  <strong>Clinical Isolation Active:</strong> Displaying {scenariosToShow.length} scenarios relevant to <strong>{selectedSimBed.toUpperCase()} ({currentBedProfile.toUpperCase()} ICU)</strong>. Dialysis line rupture is calibrated for Bed-2, and Ventilator disconnect is calibrated for Bed-3.
                </span>
              ) : (
                <span>
                  <strong>All Ward Scenarios View:</strong> Showing all {ALL_SCENARIOS.length} scenarios across Cardiac, Kidney, and Respiratory beds. Launching a profile-mismatched scenario demonstrates cross-ward routing.
                </span>
              )}
            </div>
          </div>

          <div className="scenarios-list">
            {scenariosToShow.map(sc => {
              const isTailored = sc.profiles.includes(currentBedProfile);
              return (
                <div key={sc.id} className="scenario-card" style={{ opacity: isTailored ? 1 : 0.82 }}>
                  <div className="scenario-card-top">
                    <h4>{sc.name}</h4>
                    <div className="scenario-card-meta">
                      <span className="scenario-profile-chip">{sc.profileLabel}</span>
                      <span className="scenario-tag" style={{ borderColor: sc.color, color: sc.color }}>
                        {sc.tag}
                      </span>
                    </div>
                  </div>
                  <p>{sc.desc}</p>
                  <div className="scenario-card-foot">
                    <span className="scenario-bed-target">
                      Target: {selectedSimBed.toUpperCase()} {isTailored ? '✓ Match' : '⚠️ Profile Differs'}
                    </span>
                    <button
                      className="pri"
                      style={{ padding: '5px 12px', fontSize: '12px' }}
                      onClick={() => runScenario(sc)}
                    >
                      ▶ Launch on {selectedSimBed.toUpperCase()}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
