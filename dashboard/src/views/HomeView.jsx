import React, { useState, useEffect, useRef } from 'react';

export default function HomeView({ onNavigate, beds = {}, kpis = {} }) {
  const previewCanvasRef = useRef(null);
  const [waveformMode, setWaveformMode] = useState('normal');
  const [compareView, setCompareView] = useState('care');
  const [crashSimActive, setCrashSimActive] = useState(false);
  const [activePipeStage, setActivePipeStage] = useState(2);
  const [hwTab, setHwTab] = useState('diagram'); // 'diagram' | 'pinout' | 'stream' | 'flash'

  // ── Animated uptime counter ──
  const [uptimeSec, setUptimeSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setUptimeSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const fmtUp = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Live ECG Canvas ──
  useEffect(() => {
    const canvas = previewCanvasRef.current;
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
    const ecg = (p) => 0.12 * g(p, .18, .025) - 0.12 * g(p, .31, .008) + g(p, .34, .009) - 0.2 * g(p, .37, .008) + 0.25 * g(p, .6, .045);
    const ppg = (p) => g(p, .25, .09) + 0.35 * g(p, .55, .07);

    let animId;
    function render() {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const now = performance.now() / 1000;
      let bpm = 75;
      if (waveformMode === 'tachycardia') bpm = 142;
      if (waveformMode === 'motion') bpm = 82;
      const period = 60 / bpm;
      const speed = 120;

      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(207, 218, 236, 0.35)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 24) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 24) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      ctx.beginPath();
      ctx.strokeStyle = waveformMode === 'tachycardia' ? '#E5484D' : waveformMode === 'motion' ? '#F76B15' : '#2F6FED';
      ctx.lineWidth = 2;
      for (let x = 0; x < W; x += 2) {
        const t = now - (W - x) / speed;
        let p = (t % period) / period;
        if (p < 0) p += 1;
        let noise = 0;
        if (waveformMode === 'motion') noise = (Math.sin(x * 0.15 + now * 12) * 8) + (Math.cos(x * 0.08) * 6);
        const y = 46 - ecg(p) * (waveformMode === 'tachycardia' ? 42 : 36) + noise;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = '#13A89E';
      ctx.lineWidth = 1.8;
      for (let x = 0; x < W; x += 2) {
        const t = now - (W - x) / speed - 0.16;
        let p = (t % period) / period;
        if (p < 0) p += 1;
        let noise = 0;
        if (waveformMode === 'motion') noise = Math.sin(x * 0.1 + now * 8) * 5;
        const y = 104 - ppg(p) * 26 + noise;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.font = '600 11px Lexend, sans-serif';
      ctx.fillStyle = waveformMode === 'tachycardia' ? '#E5484D' : waveformMode === 'motion' ? '#F76B15' : '#2F6FED';
      const labelText = waveformMode === 'tachycardia'
        ? '⚠ V-Tach (142 BPM) · High Acuity'
        : waveformMode === 'motion'
        ? '〰 Lead II Motion · SQI 38%'
        : 'Lead II ECG · Normal Sinus (75 BPM)';
      ctx.fillText(labelText, 12, 18);
      ctx.fillStyle = '#13A89E';
      ctx.fillText('PPG Plethysmograph', 12, 78);

      animId = requestAnimationFrame(render);
    }
    render();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, [waveformMode]);

  const triggerCrashSim = () => { setCrashSimActive(true); setTimeout(() => setCrashSimActive(false), 4500); };

  const PIPELINE_STAGES = [
    { num: 1, title: 'Collect', tag: 'SERIAL INGEST', desc: 'Ingests multi-sensor streams from the unified Arduino BIU at 10 Hz sampling rate via USB Serial (115200 baud).', metric: '10 Hz · 115200 baud' },
    { num: 2, title: 'Sync', tag: 'CLOCK ALIGN', desc: 'Compensates hardware drift between Arduino millis() and server wall-clock using median offset estimation.', metric: '<50ms Drift Window' },
    { num: 3, title: 'Check SQI', tag: 'ARTIFACT FILTER', desc: 'Computes Signal Quality Index on ECG/PPG waveforms. Filters motion artifacts and electrode noise.', metric: '94% SQI Confidence' },
    { num: 4, title: 'Group', tag: 'CORRELATION', desc: 'Clusters cascading alarms from HR, SpO₂, ECG, and temperature into correlated clinical incidents.', metric: '15→1 Alarm Grouping' },
    { num: 5, title: 'Order', tag: 'CAUSALITY', desc: 'Determines temporal ordering and root cause across simultaneous sensor triggers.', metric: 'T₀ Root Identification' },
    { num: 6, title: 'Explain', tag: 'SYNTHESIS', desc: 'Generates plain-language clinical explanations with context-aware recommendations for clinicians.', metric: 'Natural Language' },
    { num: 7, title: 'Dispatch', tag: 'ROLE-ROUTE', desc: 'Routes incidents to the correct role: Doctors get life-critical, Nurses get care events, Techs get hardware faults.', metric: 'Role-Segregated' },
  ];

  return (
    <div className="home-pitch-page">

      {/* ── HERO: System Overview ── */}
      <section className="pitch-hero">
        <div className="pitch-hero-content">
          <div className="hero-badge-animated">
            <span className="pulsing-radar-dot" />
            Clinical Action & Response Engine (C.A.R.E.)
          </div>

          <h1 className="hero-pitch-title">
            Intelligent Edge Layer That <br />
            <span className="shimmer-text">Slashes ICU Alarm Fatigue by 71%</span>
          </h1>

          <p className="hero-pitch-desc">
            Transforms chaotic bedside monitor floods into clear, role-dispatched clinical actions —
            backed by an independent hardware safety watchdog that never lets a true alarm go unheard.
          </p>

          <div className="hero-punchy-actions">
            <button className="pri hero-primary-btn" onClick={() => onNavigate('simulator')}>
              <span>⚡ Open Live Simulator</span>
              <small>Inject vitals & emergency events</small>
            </button>
            <button className="sec hero-secondary-btn" onClick={() => onNavigate('nurse')}>
              <span>👩‍⚕️ Nurse Station</span>
              <small>Bed allocation & admissions</small>
            </button>
          </div>
        </div>

        {/* Live Waveform Card */}
        <div className="pitch-hero-card">
          <div className="pitch-card-head">
            <div className="pitch-dot-live" />
            <span>BIU Edge Core · Live Lead II</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
              <span className="live-chip-sm">&lt;50ms</span>
            </div>
          </div>

          <canvas ref={previewCanvasRef} className="pitch-mini-canvas" />

          <div className="waveform-interactive-bar">
            <button className={`wv-btn ${waveformMode === 'normal' ? 'active' : ''}`} onClick={() => setWaveformMode('normal')}>Normal Sinus</button>
            <button className={`wv-btn danger ${waveformMode === 'tachycardia' ? 'active' : ''}`} onClick={() => setWaveformMode('tachycardia')}>⚠ V-Tach</button>
            <button className={`wv-btn warn ${waveformMode === 'motion' ? 'active' : ''}`} onClick={() => setWaveformMode('motion')}>〰 Artifact</button>
          </div>

          <div className="pitch-card-metrics">
            <div><small>Noise Filtered</small><b>71%</b></div>
            <div><small>True Alarms Lost</small><b style={{ color: 'var(--green)' }}>0</b></div>
            <div><small>Safety Invariant</small><b style={{ color: 'var(--blue)' }}>Armed</b></div>
          </div>
        </div>
      </section>

      {/* ── HARDWARE ARCHITECTURE: Single Arduino BIU ── */}
      <section className="pitch-section">
        <div className="section-head-center">
          <span className="subhead-pill">HARDWARE ARCHITECTURE</span>
          <h2>Unified Bedside Interface Unit (Single Arduino)</h2>
          <p>
            Connects all 4 clinical sensors to a single Arduino Uno board, multiplexing high-frequency 
            telemetry at 10 Hz over USB Serial with bare-metal hardware fail-safe interlocks.
          </p>
        </div>

        <div className="hw-topology-card">
          <div className="hw-topo-header">
            <div className="hw-tab-bar">
              <button
                type="button"
                className={`hw-tab-btn ${hwTab === 'diagram' ? 'active' : ''}`}
                onClick={() => setHwTab('diagram')}
              >
                ⬡ Visual Block Diagram
              </button>
              <button
                type="button"
                className={`hw-tab-btn ${hwTab === 'pinout' ? 'active' : ''}`}
                onClick={() => setHwTab('pinout')}
              >
                📋 Physical Pinout & Wiring Table
              </button>
              <button
                type="button"
                className={`hw-tab-btn ${hwTab === 'stream' ? 'active' : ''}`}
                onClick={() => setHwTab('stream')}
              >
                ⚡ Live Serial Telemetry (JSON)
              </button>
              <button
                type="button"
                className={`hw-tab-btn ${hwTab === 'flash' ? 'active' : ''}`}
                onClick={() => setHwTab('flash')}
              >
                🔧 Compile & Upload Guide
              </button>
            </div>

            <div className="hw-topo-uptime">
              <span className="hw-uptime-dot" />
              Arduino Node 1 · Uptime: {fmtUp(uptimeSec)}
            </div>
          </div>

          {/* TAB 1: Visual Block Diagram */}
          {hwTab === 'diagram' && (
            <>
              <div className="hw-topo-grid">
                <div className="hw-node-center">
                  <div className="hw-arduino-icon">⬡</div>
                  <h4>Arduino Uno R3</h4>
                  <span className="hw-subtitle">ATmega328P · 16 MHz · USB Serial</span>
                  <div className="hw-baud-tag">115200 baud · JSON stream</div>
                  <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--mut)' }}>
                    Firmware: <b style={{ color: 'var(--ink)' }}>unified_biu_node.ino</b>
                  </div>
                </div>

                <div className="hw-sensor-ring">
                  <div className="hw-sensor-card">
                    <div className="hw-sensor-pin">PIN A0</div>
                    <div className="hw-sensor-name">KY-039 Optical</div>
                    <div className="hw-sensor-type">Pulse / Heart Rate (Analog)</div>
                    <div className="hw-sensor-stat active">Active · Real-Time Peak Detect</div>
                  </div>
                  <div className="hw-sensor-card">
                    <div className="hw-sensor-pin">PIN A1</div>
                    <div className="hw-sensor-name">Analog ECG</div>
                    <div className="hw-sensor-type">Lead II Electrode Pair (Analog)</div>
                    <div className="hw-sensor-stat active">Active · 10 Hz Continuous Waveform</div>
                  </div>
                  <div className="hw-sensor-card">
                    <div className="hw-sensor-pin">PIN A2</div>
                    <div className="hw-sensor-name">Optical SpO₂</div>
                    <div className="hw-sensor-type">Phototransistor + Red Emitter (D7)</div>
                    <div className="hw-sensor-stat active">Active · Oxygen Saturation Proxy</div>
                  </div>
                  <div className="hw-sensor-card">
                    <div className="hw-sensor-pin">PIN D2</div>
                    <div className="hw-sensor-name">DS18B20 Temp</div>
                    <div className="hw-sensor-type">Digital OneWire Probe (4.7kΩ pull-up)</div>
                    <div className="hw-sensor-stat active">Active · ±0.1°C Core Body Temp</div>
                  </div>
                </div>
              </div>

              {/* Safety Outputs */}
              <div className="hw-safety-outputs">
                <div className="hw-safety-item">
                  <span className="hw-safety-icon buzzer">🔊</span>
                  <div>
                    <b>D8 · Active Buzzer</b>
                    <small>Bare-metal hardware fail-safe (Cannot be silenced by server)</small>
                  </div>
                </div>
                <div className="hw-safety-item">
                  <span className="hw-safety-icon red">🚨</span>
                  <div>
                    <b>D9 · Red LED</b>
                    <small>Critical Tier 1 strobe (Asystole, V-Tach, Desaturation)</small>
                  </div>
                </div>
                <div className="hw-safety-item">
                  <span className="hw-safety-icon amber">⚠️</span>
                  <div>
                    <b>D10 · Yellow LED</b>
                    <small>Medium acuity warning (Bradycardia, Mild Fever)</small>
                  </div>
                </div>
                <div className="hw-safety-item">
                  <span className="hw-safety-icon green">🟢</span>
                  <div>
                    <b>D11 · Green LED</b>
                    <small>Heartbeat pulse indicator (100ms blink per detected beat)</small>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: Pinout Table */}
          {hwTab === 'pinout' && (
            <div className="hw-pinout-container">
              <table className="hw-pinout-table">
                <thead>
                  <tr>
                    <th>Arduino Pin</th>
                    <th>Sensor / Component</th>
                    <th>Hardware Type</th>
                    <th>Wiring Connection</th>
                    <th>Circuit / Resistor Notes</th>
                    <th>Fail-Safe Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="hw-pin-badge">A0</span></td>
                    <td><strong>KY-039 Pulse Sensor</strong></td>
                    <td>Analog Input (0-1023)</td>
                    <td>Signal → A0 · VCC → 5V · GND → GND</td>
                    <td>Infrared phototransistor for arterial pulse detection</td>
                    <td><span className="hw-fail-safe-tag">Local peak detection</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">A1</span></td>
                    <td><strong>ECG Lead II Electrode</strong></td>
                    <td>Raw Analog Input</td>
                    <td>RA/LA electrodes via voltage divider to A1</td>
                    <td>Capacitive decoupling; 10-sample moving average filter</td>
                    <td><span className="hw-fail-safe-tag">Local Flatline Buzzer (&gt;5s)</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">A2</span></td>
                    <td><strong>Optical SpO₂ Receiver</strong></td>
                    <td>Analog Phototransistor</td>
                    <td>Collector → A2 · Emitter → GND</td>
                    <td>Paired with Red LED emitter on Pin D7 (220Ω resistor)</td>
                    <td><span className="hw-fail-safe-tag">Desat alert if &lt;85%</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">D2 / A3</span></td>
                    <td><strong>Temperature Sensor (1 Temp)</strong></td>
                    <td>Digital OneWire (D2) OR Analog (A3)</td>
                    <td><b>DS18B20:</b> Data → D2 (4.7kΩ pull-up)<br /><b>LM35/TMP36:</b> Out → A3, VCC → 5V, GND → GND</td>
                    <td>Supports both digital probes (D2) and zero-library analog sensors (A3) with automatic fallback</td>
                    <td><span className="hw-fail-safe-tag">Fever alert &gt;38.5°C · Crit &gt;40°C</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">D8</span></td>
                    <td><strong>Active Piezo Buzzer</strong></td>
                    <td>Digital Output (HIGH=ON)</td>
                    <td>Positive (+) → D8 · Negative (-) → GND</td>
                    <td>Fires immediately on hardware comparator limit; independent of host OS</td>
                    <td><span className="hw-fail-safe-tag">Continuous Piercing Alarm</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">D9</span></td>
                    <td><strong>Red Warning LED</strong></td>
                    <td>Digital Output</td>
                    <td>Anode → D9 via 220Ω · Cathode → GND</td>
                    <td>Strobe flashes at 2 Hz during any Tier 1 critical alarm</td>
                    <td><span className="hw-fail-safe-tag">Visual Emergency Beacon</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">D10</span></td>
                    <td><strong>Yellow Warning LED</strong></td>
                    <td>Digital Output</td>
                    <td>Anode → D10 via 220Ω · Cathode → GND</td>
                    <td>Steady illumination during medium clinical deviation</td>
                    <td><span className="hw-fail-safe-tag">Warning Strobe</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">D11</span></td>
                    <td><strong>Green Normal LED</strong></td>
                    <td>Digital Output</td>
                    <td>Anode → D11 via 220Ω · Cathode → GND</td>
                    <td>Blinks synchronously with every detected R-wave heartbeat</td>
                    <td><span className="hw-fail-safe-tag">Rhythm Pulse Indicator</span></td>
                  </tr>
                  <tr>
                    <td><span className="hw-pin-badge">D12</span></td>
                    <td><strong>ECG Lead-Off Wire</strong></td>
                    <td>Digital Input (INPUT_PULLUP)</td>
                    <td>Connected to patient reference ground clip</td>
                    <td>LOW = Electrodes Attached · HIGH = Lead Disconnected</td>
                    <td><span className="hw-fail-safe-tag">Hardware Disconnect Alarm</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: Live Serial Telemetry Stream */}
          {hwTab === 'stream' && (
            <div className="hw-telemetry-console">
              <div className="telemetry-meta-bar">
                <div className="telemetry-status-pill">
                  <span className="telemetry-live-dot" />
                  <span>SERIAL STREAM ACTIVE · /dev/ttyUSB0 (115200 BAUD, 8N1)</span>
                </div>
                <span>PACKET RATE: 10.0 Hz · PACKET SIZE: 184 BYTES · CHECKSUM: VALID</span>
              </div>
              <pre className="telemetry-json-block">
{`{
  `}<span className="json-key">"node"</span>{`: `}<span className="json-num">1</span>{`,
  `}<span className="json-key">"ts"</span>{`: `}<span className="json-num">{104520 + (uptimeSec * 1000)}</span>{`,
  `}<span className="json-key">"profile"</span>{`: `}<span className="json-str">"unified"</span>{`,
  `}<span className="json-key">"hr"</span>{`: `}<span className="json-num">{beds['bed-1']?.vitals?.hr || 78}</span>{`,
  `}<span className="json-key">"hr_raw"</span>{`: `}<span className="json-num">612</span>{`,
  `}<span className="json-key">"ecg"</span>{`: `}<span className="json-num">{beds['bed-1']?.vitals?.ecg || 512}</span>{`,
  `}<span className="json-key">"ecg_quality"</span>{`: `}<span className="json-num">{beds['bed-1']?.vitals?.ecg_quality || 96}</span>{`,
  `}<span className="json-key">"spo2"</span>{`: `}<span className="json-num">{beds['bed-1']?.vitals?.spo2 || 98}</span>{`,
  `}<span className="json-key">"spo2_raw"</span>{`: `}<span className="json-num">584</span>{`,
  `}<span className="json-key">"temp"</span>{`: `}<span className="json-num">{beds['bed-1']?.vitals?.temp || 36.9}</span>{`,
  `}<span className="json-key">"lead_off"</span>{`: `}<span className="json-bool">false</span>{`,
  `}<span className="json-key">"alarm_flags"</span>{`: `}<span className="json-num">0</span>{`,
  `}<span className="json-key">"priority"</span>{`: `}<span className="json-num">0</span>{`,
  `}<span className="json-key">"alarms"</span>{`: []
}`}
              </pre>
            </div>
          )}

          {/* TAB 4: Firmware Compilation & Upload */}
          {hwTab === 'flash' && (
            <div className="hw-flash-guide">
              <div className="hw-flash-step">
                <div className="flash-step-num">1</div>
                <div className="flash-step-content">
                  <strong>Locate the Unified BIU Arduino Sketch</strong>
                  <p>The complete single-Arduino 4-sensor firmware is located in your project repository at:</p>
                  <div className="flash-cmd-box">
                    <span>CARE/firmware/unified_biu_node/unified_biu_node.ino</span>
                  </div>
                </div>
              </div>

              <div className="hw-flash-step">
                <div className="flash-step-num">2</div>
                <div className="flash-step-content">
                  <strong>Install Required Arduino Libraries</strong>
                  <p>In the Arduino Library Manager (or via CLI), install the OneWire and DallasTemperature libraries for the DS18B20 sensor:</p>
                  <div className="flash-cmd-box">
                    <code>arduino-cli lib install "OneWire" "DallasTemperature"</code>
                  </div>
                </div>
              </div>

              <div className="hw-flash-step">
                <div className="flash-step-num">3</div>
                <div className="flash-step-content">
                  <strong>Compile & Flash to your Arduino Uno</strong>
                  <p>Connect your Arduino Uno via USB and execute the upload command:</p>
                  <div className="flash-cmd-box">
                    <code>arduino-cli compile --fqbn arduino:avr:uno firmware/unified_biu_node && arduino-cli upload -p /dev/ttyUSB0 --fqbn arduino:avr:uno firmware/unified_biu_node</code>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── KPI Strip ── */}
      <div className="animated-kpi-strip">
        <div className="kpi-strip-item">
          <span className="kpi-big-num">350+</span>
          <span className="kpi-label">Alarms / Bed / Day</span>
          <small className="kpi-note">Continuous sensory overload</small>
        </div>
        <div className="kpi-strip-item alert-kpi">
          <span className="kpi-big-num">85%+</span>
          <span className="kpi-label">Clinically Non-Actionable</span>
          <small className="kpi-note">Motion artifacts & loose leads</small>
        </div>
        <div className="kpi-strip-item success-kpi">
          <span className="kpi-big-num">71%</span>
          <span className="kpi-label">Noise Reduction</span>
          <small className="kpi-note">Synthesized into clean incidents</small>
        </div>
        <div className="kpi-strip-item perfect-kpi">
          <span className="kpi-big-num">0</span>
          <span className="kpi-label">True Alarms Lost</span>
          <small className="kpi-note">Hardware buzzer never silenced</small>
        </div>
      </div>

      {/* ── HOSPITAL WARD TELEMETRY INFRASTRUCTURE ── */}
      <section className="pitch-section">
        <div className="section-head-center">
          <span className="subhead-pill">HOSPITAL INFRASTRUCTURE</span>
          <h2>Ward 4B Critical Care Telemetry Bays</h2>
          <p>Real-time status of bedside interface units connected across the ward edge network.</p>
        </div>

        <div className="ward-infra-grid">
          {/* BED 01 */}
          <div className="ward-bed-card" onClick={() => onNavigate('doctor')}>
            <div className="ward-bed-top">
              <div className="ward-bed-title">
                <span className="ward-status-dot-active" />
                <span className="ward-bed-id">BED-01 · CCU</span>
              </div>
              <span className="ward-profile-tag">Unified BIU (4 Sensors)</span>
            </div>
            <div className="ward-patient-info">
              <h4 className="ward-patient-name">{beds['bed-1']?.patient_name || 'Robert Vance'}</h4>
              <p className="ward-patient-sub">68y M · {beds['bed-1']?.diagnosis || 'Acute Anterior STEMI post-PCI'}</p>
            </div>
            <div className="ward-vitals-mini-grid">
              <div className="ward-mini-vital">
                <span className="ward-mini-label">HR</span>
                <span className="ward-mini-val" style={{ color: 'var(--red)' }}>{beds['bed-1']?.vitals?.hr || 78} <small style={{ fontSize: '10px' }}>BPM</small></span>
              </div>
              <div className="ward-mini-vital">
                <span className="ward-mini-label">SpO₂</span>
                <span className="ward-mini-val" style={{ color: 'var(--blue)' }}>{beds['bed-1']?.vitals?.spo2 || 98}%</span>
              </div>
              <div className="ward-mini-vital">
                <span className="ward-mini-label">Temp</span>
                <span className="ward-mini-val" style={{ color: 'var(--teal)' }}>{beds['bed-1']?.vitals?.temp || 36.9}°C</span>
              </div>
            </div>
            <div className="ward-hw-source">
              <span>🔌 Hardware: <b>Single Arduino Uno Node (/dev/ttyUSB0)</b></span>
            </div>
          </div>

          {/* BED 02 */}
          <div className="ward-bed-card" onClick={() => onNavigate('nurse')}>
            <div className="ward-bed-top">
              <div className="ward-bed-title">
                <span className="ward-status-dot-active" />
                <span className="ward-bed-id">BED-02 · DIALYSIS</span>
              </div>
              <span className="ward-profile-tag" style={{ background: '#FEF3C7', color: '#B45309' }}>Kidney / Dialysis Profile</span>
            </div>
            <div className="ward-patient-info">
              <h4 className="ward-patient-name">{beds['bed-2']?.patient_name || 'Maria Santos'}</h4>
              <p className="ward-patient-sub">54y F · {beds['bed-2']?.diagnosis || 'ESRD on HD · Fluid Overload'}</p>
            </div>
            <div className="ward-vitals-mini-grid">
              <div className="ward-mini-vital">
                <span className="ward-mini-label">HR</span>
                <span className="ward-mini-val">{beds['bed-2']?.vitals?.hr || 84} <small style={{ fontSize: '10px' }}>BPM</small></span>
              </div>
              <div className="ward-mini-vital">
                <span className="ward-mini-label">Venous P</span>
                <span className="ward-mini-val" style={{ color: 'var(--vio)' }}>{beds['bed-2']?.vitals?.dial_venous_pressure || 120} <small style={{ fontSize: '10px' }}>mmHg</small></span>
              </div>
              <div className="ward-mini-vital">
                <span className="ward-mini-label">Blood Flow</span>
                <span className="ward-mini-val" style={{ color: 'var(--teal)' }}>{beds['bed-2']?.vitals?.dial_blood_flow || 350} <small style={{ fontSize: '10px' }}>mL/m</small></span>
              </div>
            </div>
            <div className="ward-hw-source">
              <span>🩸 Interlock: <b>Blood Leak Optical Detector Armed</b></span>
            </div>
          </div>

          {/* BED 03 */}
          <div className="ward-bed-card" onClick={() => onNavigate('doctor')}>
            <div className="ward-bed-top">
              <div className="ward-bed-title">
                <span className="ward-status-dot-active" />
                <span className="ward-bed-id">BED-03 · STEP-DOWN</span>
              </div>
              <span className="ward-profile-tag" style={{ background: '#E0F2FE', color: '#0369A1' }}>Respiratory Profile</span>
            </div>
            <div className="ward-patient-info">
              <h4 className="ward-patient-name">{beds['bed-3']?.patient_name || 'Arthur Pendelton'}</h4>
              <p className="ward-patient-sub">72y M · {beds['bed-3']?.diagnosis || 'COPD Exacerbation / ARDS'}</p>
            </div>
            <div className="ward-vitals-mini-grid">
              <div className="ward-mini-vital">
                <span className="ward-mini-label">SpO₂</span>
                <span className="ward-mini-val" style={{ color: 'var(--blue)' }}>{beds['bed-3']?.vitals?.spo2 || 94}%</span>
              </div>
              <div className="ward-mini-vital">
                <span className="ward-mini-label">PEEP</span>
                <span className="ward-mini-val" style={{ color: 'var(--ink)' }}>{beds['bed-3']?.vitals?.vent_pressure || 8.0} <small style={{ fontSize: '10px' }}>cmH₂O</small></span>
              </div>
              <div className="ward-mini-vital">
                <span className="ward-mini-label">FiO₂</span>
                <span className="ward-mini-val" style={{ color: 'var(--green)' }}>{Math.round((beds['bed-3']?.vitals?.vent_fio2 || 0.40) * 100)}%</span>
              </div>
            </div>
            <div className="ward-hw-source">
              <span>🫁 Interlock: <b>Ventilator Disconnect Guard Armed</b></span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Before vs After ── */}
      <section className="pitch-section">
        <div className="section-head-center">
          <span className="subhead-pill">INTERACTIVE COMPARISON</span>
          <h2>Alarm Fatigue vs C.A.R.E. Synthesis</h2>
          <p>Toggle between conventional ICU monitor cacophony and C.A.R.E. edge correlation.</p>
        </div>

        <div className="compare-interactive-wrapper">
          <div className="compare-tabs">
            <button className={`comp-tab-btn ${compareView === 'care' ? 'active care-active' : ''}`} onClick={() => setCompareView('care')}>
              <span className="comp-dot green-dot" />
              🟢 With C.A.R.E. Engine
            </button>
            <button className={`comp-tab-btn ${compareView === 'conventional' ? 'active danger-active' : ''}`} onClick={() => setCompareView('conventional')}>
              <span className="comp-dot red-dot" />
              🔴 Conventional ICU
            </button>
          </div>

          {compareView === 'conventional' ? (
            <div className="compare-display-box conventional-box">
              <div className="comp-box-header">
                <div className="comp-status-badge danger">🚨 147 ALARMS IN 1 HOUR</div>
                <span className="comp-stat-pill">88 dB Continuous Beeping</span>
              </div>
              <div className="alarm-cacophony-stream">
                <span className="alarm-bubble flash">21:14:02 · SpO₂ Low 81%</span>
                <span className="alarm-bubble flash">21:14:03 · HR &gt; 135 BPM</span>
                <span className="alarm-bubble flash">21:14:04 · Lead II Off</span>
                <span className="alarm-bubble flash">21:14:04 · High Airway Pressure</span>
                <span className="alarm-bubble flash">21:14:05 · Art Line Drop</span>
                <span className="alarm-bubble flash">21:14:06 · Fever 38.9°C</span>
                <span className="alarm-bubble flash">21:14:07 · Tachy Cascade</span>
                <span className="alarm-bubble flash">21:14:08 · V3 Disconnected</span>
              </div>
              <div className="comp-results-grid danger-grid">
                <div>
                  <label>Alarm Fatigue</label>
                  <div className="comp-progress-bar danger"><div style={{ width: '92%' }} /></div>
                  <span>92% Severe Burnout</span>
                </div>
                <div>
                  <label>Response Delay</label>
                  <b className="comp-metric-danger">11.4 min</b>
                  <span>"Cry Wolf" effect</span>
                </div>
                <div>
                  <label>False Alarm Rate</label>
                  <b className="comp-metric-danger">86%</b>
                  <span>Motion & repositioning</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="compare-display-box care-box">
              <div className="comp-box-header">
                <div className="comp-status-badge success">🛡️ 1 CORRELATED INCIDENT</div>
                <span className="comp-stat-pill success">Room: Quiet & Restful</span>
              </div>
              <div className="care-correlated-card">
                <div className="care-incident-top">
                  <span className="care-badge-tag">GROUPED EVENT · BED-1</span>
                  <span className="care-time-tag">21:14:02 · 147 Alarms Correlated</span>
                </div>
                <h3 className="care-incident-title">Probable Motion During Bed Bath</h3>
                <p className="care-incident-desc">
                  SQI dropped to 38% with simultaneous optical PPG disturbance.
                  Cross-checked with Nurse Station motion suppression. No ischemia detected.
                </p>
                <div className="care-dispatch-row">
                  <span className="dispatch-chip nurse">👩‍⚕️ Auto-suppressed</span>
                  <span className="dispatch-chip tech">🔧 Lead verified</span>
                  <span className="dispatch-chip doctor">👨‍⚕️ Escalation prevented</span>
                </div>
              </div>
              <div className="comp-results-grid success-grid">
                <div>
                  <label>Noise Reduction</label>
                  <div className="comp-progress-bar success"><div style={{ width: '71%' }} /></div>
                  <span>-71% Interruption</span>
                </div>
                <div>
                  <label>True Alarms Lost</label>
                  <b className="comp-metric-success">0 Dropped</b>
                  <span>Safety invariant intact</span>
                </div>
                <div>
                  <label>Edge Latency</label>
                  <b className="comp-metric-success">&lt;50ms</b>
                  <span>Local processing</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Dual-Path Safety ── */}
      <section className="pitch-section">
        <div className="section-head-center">
          <span className="subhead-pill">NON-NEGOTIABLE SAFETY</span>
          <h2>Independent Hardware Fail-Safe</h2>
          <p>Software provides intelligence. Bare-metal hardware guarantees patient life-safety.</p>
        </div>

        <div className="schematic-interactive-card">
          <div className="schematic-header-bar">
            <span className="schem-title">Dual-Path Verification Architecture</span>
            <button className={`test-crash-btn ${crashSimActive ? 'active' : ''}`} onClick={triggerCrashSim} disabled={crashSimActive}>
              {crashSimActive ? '⚡ Simulating Crash...' : '💥 Simulate Software Crash'}
            </button>
          </div>

          <div className="dual-path-visual-grid">
            <div className="path-box hardware-path">
              <div className="path-box-badge hard">PATH 1: HARDWARE SAFETY</div>
              <h4>Local Microcontroller Interlock</h4>
              <p>Bare-metal threshold logic on Arduino Uno:</p>
              <div className="schematic-node-flow">
                <div className="schem-node">Physical Sensors (ECG / Temp / Pulse / SpO₂)</div>
                <div className="schem-arrow-animated down">↓ 100ms Analog Read</div>
                <div className="schem-node">Hardware Comparator & Safety Registers</div>
                <div className="schem-arrow-animated down">↓ Critical Limit Exceeded</div>
                <div className={`schem-node danger-node ${crashSimActive ? 'flashing-always' : ''}`}>
                  🚨 Buzzer + Red LED Fire Immediately
                </div>
              </div>
              <div className="path-invariant-callout hard">
                <strong>INVARIANT:</strong> Zero software dependencies. If the server crashes, Wi-Fi drops, or the host freezes, the bedside buzzer <em>still sounds instantly</em>.
              </div>
            </div>

            <div className={`path-box software-path ${crashSimActive ? 'crashed-state' : ''}`}>
              <div className="path-box-badge soft">PATH 2: C.A.R.E. CORRELATION</div>
              <h4>BIU Edge Intelligence Pipeline</h4>
              <p>Asynchronous multi-modal correlation:</p>
              <div className="schematic-node-flow">
                <div className="schem-node">USB Serial JSON (115200 Baud)</div>
                <div className="schem-arrow-animated down">↓ Real-Time Ingestion</div>
                <div className="schem-node">SQI & Artifact Filter Engine</div>
                <div className="schem-arrow-animated down">↓ Temporal Cross-Correlation</div>
                <div className="schem-node role-target-node">🎯 Synthesized Role Dispatch</div>
              </div>
              {crashSimActive ? (
                <div className="crashed-banner">❌ SOFTWARE OFFLINE — HARDWARE BUZZER REMAINS 100% OPERATIONAL</div>
              ) : (
                <div className="path-invariant-callout soft">
                  <strong>PURPOSE:</strong> Suppresses artifacts and clusters cascading alarms for quiet, prioritized clinical incidents.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 7-Stage Pipeline ── */}
      <section className="pitch-section">
        <div className="section-head-center">
          <span className="subhead-pill">PIPELINE ARCHITECTURE</span>
          <h2>7-Stage Real-Time Processing</h2>
          <p>Click any stage to inspect its deterministic edge transformation.</p>
        </div>

        <div className="pipeline-interactive-container">
          <div className="pipeline-stepper-bar">
            {PIPELINE_STAGES.map((stg, idx) => (
              <button
                key={stg.num}
                className={`pipe-step-btn ${activePipeStage === idx ? 'active' : ''}`}
                onClick={() => setActivePipeStage(idx)}
              >
                <span className="step-num">{stg.num}</span>
                <span className="step-label">{stg.title}</span>
              </button>
            ))}
          </div>

          <div className="active-stage-display-card">
            <div className="stage-card-meta">
              <span className="stage-pill-tag">STAGE {PIPELINE_STAGES[activePipeStage].num} OF 7</span>
              <span className="stage-pill-metric">{PIPELINE_STAGES[activePipeStage].metric}</span>
            </div>
            <h3 className="stage-card-title">
              {PIPELINE_STAGES[activePipeStage].title} · {PIPELINE_STAGES[activePipeStage].tag}
            </h3>
            <p className="stage-card-desc">{PIPELINE_STAGES[activePipeStage].desc}</p>
          </div>
        </div>
      </section>

      {/* ── Role Launchpad ── */}
      <section className="pitch-section" style={{ marginBottom: '48px' }}>
        <div className="section-head-center">
          <span className="subhead-pill">DEDICATED WORKSTATIONS</span>
          <h2>Role-Segregated Consoles</h2>
          <p>Access your assigned role workstation:</p>
        </div>

        <div className="launchpad-grid">
          <div className="launch-card nurse-launch" onClick={() => onNavigate('nurse')}>
            <span className="launch-icon">👩‍⚕️</span>
            <h3>Bedside Nurse Station</h3>
            <span className="role-card-badge">Admission & Bed Allocation</span>
            <p>Admit/discharge patients, activate bed bath motion suppression, manage care tasks.</p>
            <button className="pri">Open Nurse Station →</button>
          </div>

          <div className="launch-card doctor-launch" onClick={() => onNavigate('doctor')}>
            <span className="launch-icon">👨‍⚕️</span>
            <h3>Intensivist Console</h3>
            <span className="role-card-badge">Diagnostic & Escalation</span>
            <p>Continuous rhythm strip, shock index triage, Tier 1 physician escalation queue.</p>
            <button className="sec">Open Doctor Console →</button>
          </div>

          <div className="launch-card tech-launch" onClick={() => onNavigate('technician')}>
            <span className="launch-icon">🔧</span>
            <h3>Bio-Med Engineering</h3>
            <span className="role-card-badge">Hardware Diagnostics</span>
            <p>Electrode impedance monitoring, lead-off detection, preventive work orders.</p>
            <button>Open Tech Station →</button>
          </div>

          <div className="launch-card sim-launch" onClick={() => onNavigate('simulator')}>
            <span className="launch-icon">🕹️</span>
            <h3>Simulator Controller</h3>
            <span className="role-card-badge sim">Live Telemetry Injection</span>
            <p>Simulate arrhythmias, inject vital emergencies, verify correlation algorithms.</p>
            <button style={{ borderColor: 'var(--vio)', color: 'var(--vio)' }}>Open Simulator →</button>
          </div>
        </div>
      </section>
    </div>
  );
}
