import React, { useState, useEffect } from 'react';
import { fetchScenarios, triggerScenario, triggerScenarioAll, setSimulatedVitals } from '../utils/api.js';

/**
 * SimulatorPanel — control panel for triggering demo scenarios
 * and manually adjusting simulated vital signs.
 */
export default function SimulatorPanel() {
  const [scenarios, setScenarios] = useState([]);
  const [selectedBed, setSelectedBed] = useState(1);
  const [lastTriggered, setLastTriggered] = useState(null);
  const [sliders, setSliders] = useState({ hr: 75, temp: 36.8, spo2: 600 });

  useEffect(() => {
    fetchScenarios()
      .then((data) => setScenarios(data.scenarios || []))
      .catch(() => {});
  }, []);

  const handleTrigger = async (scenarioId, duration) => {
    try {
      await triggerScenario(selectedBed, scenarioId, duration);
      setLastTriggered({ bed: selectedBed, scenario: scenarioId, time: Date.now() });
    } catch (e) {
      console.error('Trigger failed:', e);
    }
  };

  const handleTriggerAll = async (scenarioId, duration) => {
    try {
      await triggerScenarioAll(scenarioId, duration);
      setLastTriggered({ bed: 'all', scenario: scenarioId, time: Date.now() });
    } catch (e) {
      console.error('Trigger all failed:', e);
    }
  };

  const handleSliderChange = async (key, value) => {
    const newSliders = { ...sliders, [key]: value };
    setSliders(newSliders);
    try {
      await setSimulatedVitals(selectedBed, { [key]: value });
    } catch (e) {
      console.error('Set vitals failed:', e);
    }
  };

  return (
    <div className="sim-panel">
      <div className="sim-panel__title">
        🎮 Simulator Control Panel
      </div>

      {/* Bed Selector */}
      <div className="sim-bed-select">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            className={`sim-bed-btn ${selectedBed === n ? 'sim-bed-btn--active' : ''}`}
            onClick={() => setSelectedBed(n)}
          >
            Bed {n} — {n === 1 ? '❤️ Cardiac' : n === 2 ? '🫘 Kidney' : '🫁 Respiratory'}
          </button>
        ))}
      </div>

      {/* Scenarios Grid */}
      <div className="sim-scenarios">
        {scenarios.map((s) => (
          <button
            key={s.id}
            className="sim-scenario-btn"
            onClick={() => handleTrigger(s.id, s.duration || 30)}
            title={s.description}
          >
            <span className="sim-scenario-btn__name">{s.name}</span>
            <span className="sim-scenario-btn__desc">{s.description}</span>
          </button>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="sim-controls">
        <button
          className="btn btn--sm btn--danger"
          onClick={() => handleTriggerAll('multi_bed_crisis', 30)}
        >
          🚨 Multi-Bed Crisis (All)
        </button>
        <button
          className="btn btn--sm"
          onClick={() => handleTriggerAll('motion_artifact', 15)}
        >
          📳 Motion Artifact (All)
        </button>
      </div>

      {/* Manual Vital Sliders */}
      <div className="slider-group">
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
          Manual Override — Bed {selectedBed}
        </div>
        <div className="slider-row">
          <span className="slider-row__label">Heart Rate</span>
          <input
            className="slider-row__input"
            type="range"
            min="0"
            max="250"
            value={sliders.hr}
            onChange={(e) => handleSliderChange('hr', parseInt(e.target.value))}
          />
          <span className="slider-row__value">{sliders.hr} bpm</span>
        </div>
        <div className="slider-row">
          <span className="slider-row__label">Temperature</span>
          <input
            className="slider-row__input"
            type="range"
            min="30"
            max="43"
            step="0.1"
            value={sliders.temp}
            onChange={(e) => handleSliderChange('temp', parseFloat(e.target.value))}
          />
          <span className="slider-row__value">{sliders.temp.toFixed(1)} °C</span>
        </div>
        <div className="slider-row">
          <span className="slider-row__label">SpO₂ proxy</span>
          <input
            className="slider-row__input"
            type="range"
            min="100"
            max="800"
            value={sliders.spo2}
            onChange={(e) => handleSliderChange('spo2', parseInt(e.target.value))}
          />
          <span className="slider-row__value">{Math.min(100, Math.round((sliders.spo2 / 700) * 100))}%</span>
        </div>
      </div>

      {/* Last triggered status */}
      {lastTriggered && (
        <div style={{
          marginTop: '0.75rem',
          fontSize: '0.75rem',
          color: 'var(--normal)',
          padding: '0.3rem 0.5rem',
          background: 'var(--normal-bg)',
          borderRadius: 'var(--radius-sm)',
        }}>
          ✓ Triggered "{lastTriggered.scenario}" on {lastTriggered.bed === 'all' ? 'all beds' : `Bed ${lastTriggered.bed}`}
        </div>
      )}
    </div>
  );
}
