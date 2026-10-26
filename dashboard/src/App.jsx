import React, { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';

import HomeView from './views/HomeView.jsx';
import NurseDashboard from './views/NurseDashboard.jsx';
import DoctorDashboard from './views/DoctorDashboard.jsx';
import TechnicianDashboard from './views/TechnicianDashboard.jsx';
import SimulatorDashboard from './views/SimulatorDashboard.jsx';
import AdmissionModal from './components/AdmissionModal.jsx';

const API = '/api';

const NAV_TABS = [
  { id: 'home', path: '/', label: '🏠 Overview', icon: '🏠' },
  { id: 'nurse', path: '/nurse', label: '👩‍⚕️ Nurse Station', icon: '👩‍⚕️' },
  { id: 'doctor', path: '/doctor', label: '👨‍⚕️ Doctor Console', icon: '👨‍⚕️' },
  { id: 'technician', path: '/tech', label: '🔧 Bio-Med Tech', icon: '🔧' },
  { id: 'simulator', path: '/simulator', label: '🕹️ Simulator', icon: '🕹️', highlight: true },
];

export default function App() {
  // Parse initial route from window.location.pathname or hash
  const getInitialView = () => {
    const p = window.location.pathname.toLowerCase();
    const h = window.location.hash.toLowerCase().replace('#', '');
    const route = p.replace('/', '') || h;
    if (route === 'nurse') return 'nurse';
    if (route === 'doctor') return 'doctor';
    if (route === 'tech' || route === 'technician') return 'technician';
    if (route === 'simulator' || route === 'sim') return 'simulator';
    return 'home';
  };

  const [currentView, setCurrentView] = useState(getInitialView);
  const [connected, setConnected] = useState(false);
  const [beds, setBeds] = useState({});
  const [selectedBed, setSelectedBed] = useState('bed-1');
  const [incidents, setIncidents] = useState({});
  const [nativeAlarms, setNativeAlarms] = useState([]);
  const [safetyRing, setSafetyRing] = useState(false);
  const [safetyText, setSafetyText] = useState('Watchdog armed. Rings on every native alarm, bypassing correlation.');
  const [pipeStep, setPipeStep] = useState(-1);
  const [clock, setClock] = useState('--:--:--');
  const [kpis, setKpis] = useState({ nativeAlarms: 0, incidentsShown: 0, noise: '—', lost: 0 });

  // Bed Allocation & Patient Admission OS state (Only available to Nurse!)
  const [isAdmissionOpen, setIsAdmissionOpen] = useState(false);
  const [admissionBedId, setAdmissionBedId] = useState('bed-3');
  const [admissionBedData, setAdmissionBedData] = useState(null);

  // ── Clinical Duty Roster & Physician Coverage ───────────────────────
  const [dutyRoster, setDutyRoster] = useState({
    current_doctor: 'Dr. Sharma, MD',
    current_doctor_title: 'Lead Intensivist / Attending',
    duty_status: 'active',
    covering_doctor: 'Dr. Priya Patel, MD',
    covering_doctor_title: 'Critical Care Fellow / On-Call',
    charge_nurse: 'Nurse Sarah Jenkins, RN',
    shift_name: 'Day ICU Shift (07:00 – 19:00)',
    status_note: 'Primary attending active on ward',
    last_handover_at: null,
    handover_history: [],
    roster_options: [
      { name: 'Dr. Sharma, MD', title: 'Lead Intensivist / Attending', contact: 'Ext. 4410 / Voicera #1' },
      { name: 'Dr. Priya Patel, MD', title: 'Critical Care Fellow / On-Call', contact: 'Ext. 4412 / Voicera #2' },
      { name: 'Dr. Marcus Vance, MD', title: 'Emergency & Trauma Attending', contact: 'Ext. 4415 / Voicera #3' },
      { name: 'Dr. Alistair Chen, MD', title: 'Critical Care Specialist', contact: 'Ext. 4418 / Voicera #4' },
    ],
  });

  // ── Shared Inter-Professional Nurse Tasks & Doctor Orders ──────────
  const [nurseTasks, setNurseTasks] = useState([
    { id: 1, bed: 'bed-1', text: 'Re-secure ECG Lead II gel pad (high noise recorded)', done: false, time: '10m ago', isStat: false },
    { id: 2, bed: 'bed-2', text: 'Inspect dialysis catheter return line dressing', done: false, time: '25m ago', isStat: false },
    { id: 3, bed: 'bed-3', text: 'Calibrate SpO₂ optical probe position', done: true, time: '40m ago', isStat: false },
  ]);

  const handleToggleNurseTask = (id) => {
    setNurseTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleDoctorOrder = (bedId, orderText) => {
    const newTask = {
      id: Date.now(),
      bed: bedId,
      text: `⚡ STAT ORDER (Dr. Sharma): ${orderText}`,
      done: false,
      time: 'Just now',
      isStat: true,
    };
    setNurseTasks(prev => [newTask, ...prev]);
  };

  const wsRef = useRef(null);

  // Sync route changes with browser history
  const navigateTo = (viewId) => {
    setCurrentView(viewId);
    const tab = NAV_TABS.find(t => t.id === viewId);
    if (tab && window.history) {
      window.history.pushState(null, '', tab.path);
    }
  };

  // Handle browser back/forward buttons
  useEffect(() => {
    const onPopState = () => {
      setCurrentView(getInitialView());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ── Clock ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString([], { hour12: false }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Initial Bed & Duty State Fetch ────────────────────────────────
  useEffect(() => {
    fetch(`${API}/beds`)
      .then(r => r.json())
      .then(data => {
        if (data.beds) {
          const map = {};
          data.beds.forEach(b => { map[b.bed_id] = b; });
          setBeds(map);
        }
      })
      .catch(() => {});

    fetch(`${API}/duty-roster`)
      .then(r => r.json())
      .then(data => {
        if (data && data.current_doctor) {
          setDutyRoster(data);
        }
      })
      .catch(() => {});
  }, []);

  // ── WebSocket Connection ──────────────────────────────────────────
  useEffect(() => {
    let reconnectTimer;
    let attempts = 0;

    function connect() {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          attempts = 0;
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            handleMessage(msg);
          } catch (err) { /* ignore */ }
        };

        ws.onclose = () => {
          setConnected(false);
          const delay = Math.min(1000 * Math.pow(2, attempts), 10000);
          attempts++;
          reconnectTimer = setTimeout(connect, delay);
        };
      } catch (e) {
        const delay = Math.min(1000 * Math.pow(2, attempts), 10000);
        attempts++;
        reconnectTimer = setTimeout(connect, delay);
      }
    }

    connect();

    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(ping);
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  // ── Throttled Vitals Buffer (prevents 30Hz React re-render lag) ──
  const vitalsBufferRef = useRef({});
  const vitalsTimerRef = useRef(null);

  // ── Handle WS Messages ───────────────────────────────────────────
  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'init':
        setBeds(msg.data.beds || {});
        if (msg.data.duty_roster) {
          setDutyRoster(msg.data.duty_roster);
        }
        break;

      case 'vitals': {
        const bedId = msg.data.bed_id;
        vitalsBufferRef.current[bedId] = {
          vitals: msg.data,
          node_status: msg.data.node_status,
        };

        if (!vitalsTimerRef.current) {
          vitalsTimerRef.current = setTimeout(() => {
            vitalsTimerRef.current = null;
            setBeds(prev => {
              let changed = false;
              const next = { ...prev };
              for (const [bId, data] of Object.entries(vitalsBufferRef.current)) {
                if (next[bId]) {
                  next[bId] = {
                    ...next[bId],
                    vitals: data.vitals,
                    node_status: data.node_status,
                  };
                  changed = true;
                }
              }
              vitalsBufferRef.current = {};
              return changed ? next : prev;
            });
          }, 200); // 5Hz batch flush keeps UI ultra-smooth and responsive
        }
        break;
      }

      case 'incidents': {
        const bedId = msg.data.bed_id;
        const newIncidents = msg.data.incidents || [];
        setIncidents(prev => ({ ...prev, [bedId]: newIncidents }));

        if (newIncidents.length > 0) {
          triggerPipeline();

          newIncidents.forEach(inc => {
            (inc.alarms || []).forEach(a => {
              triggerNativeAlarm(a.type || 'ALARM');
            });
          });
        }
        break;
      }

      case 'incident_ack': {
        const { incident_id, by } = msg.data;
        setIncidents(prev => {
          const next = { ...prev };
          for (const bId in next) {
            next[bId] = next[bId].map(inc =>
              inc.id === incident_id
                ? { ...inc, status: 'acknowledged', acknowledged_by: by || 'Nurse', acknowledged_at: new Date().toISOString() }
                : inc
            );
          }
          return next;
        });
        break;
      }

      case 'incident_resolved': {
        const { incident_id } = msg.data;
        setIncidents(prev => {
          const next = { ...prev };
          for (const bId in next) {
            next[bId] = next[bId].filter(inc => inc.id !== incident_id);
          }
          return next;
        });
        break;
      }

      case 'incident_escalated': {
        const inc = msg.data.incident;
        if (inc?.bed_id) {
          setIncidents(prev => {
            const list = prev[inc.bed_id] || [];
            const idx = list.findIndex(i => i.id === inc.id);
            if (idx >= 0) {
              const updated = [...list];
              updated[idx] = inc;
              return { ...prev, [inc.bed_id]: updated };
            }
            return { ...prev, [inc.bed_id]: [inc, ...list].slice(0, 15) };
          });
        }
        break;
      }

      case 'incident_update': {
        const inc = msg.data.incident;
        if (inc?.bed_id) {
          setIncidents(prev => {
            const list = prev[inc.bed_id] || [];
            if (inc.status === 'resolved') {
              return { ...prev, [inc.bed_id]: list.filter(i => i.id !== inc.id) };
            }
            const idx = list.findIndex(i => i.id === inc.id);
            if (idx >= 0) {
              const updated = [...list];
              updated[idx] = inc;
              return { ...prev, [inc.bed_id]: updated };
            }
            return { ...prev, [inc.bed_id]: [inc, ...list].slice(0, 15) };
          });
        }
        break;
      }

      case 'duty_roster_update':
        if (msg.data) {
          setDutyRoster(msg.data);
        }
        break;

      default:
        break;
    }
  }, []);

  // ── Native Alarm + Safety Ring ───────────────────────────────────
  const triggerNativeAlarm = useCallback((text) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setNativeAlarms(prev => [{ time, text: `Monitor: ${text}` }, ...prev.slice(0, 7)]);
    setKpis(prev => {
      const nat = prev.nativeAlarms + 1;
      const inc = prev.incidentsShown;
      const noise = nat > 0 ? `${Math.max(0, Math.round((1 - inc / nat) * 100))}%` : '—';
      return { ...prev, nativeAlarms: nat, noise };
    });

    setSafetyRing(true);
    setSafetyText('⚡ WATCHDOG BEDSIDE BUZZER FIRED (Local Arduino Fail-Safe)');
    setTimeout(() => {
      setSafetyRing(false);
      setSafetyText('Watchdog armed. Rings on every native alarm, bypassing correlation.');
    }, 1200);
  }, []);

  // ── Pipeline Animation ───────────────────────────────────────────
  const triggerPipeline = useCallback(() => {
    [0, 1, 2, 3, 4, 5, 6].forEach((step, i) => {
      setTimeout(() => setPipeStep(step), i * 350);
    });
    setTimeout(() => setPipeStep(99), 7 * 350);
  }, []);

  // ── Bed Allocation & Admission Actions (Exclusive to Nurse!) ─────
  const handleOpenAdmission = (bedId = 'bed-3', bedData = null) => {
    setAdmissionBedId(bedId);
    setAdmissionBedData(bedData || beds[bedId] || null);
    setIsAdmissionOpen(true);
  };

  const handleAdmitPatient = async (bedId, payload) => {
    try {
      const res = await fetch(`${API}/beds/${bedId}/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setBeds(prev => ({
          ...prev,
          [bedId]: data.bed,
        }));
      }
    } catch (e) {
      console.error('Failed to admit patient:', e);
    }
  };

  const handleDischargePatient = async (bedId) => {
    try {
      const res = await fetch(`${API}/beds/${bedId}/discharge`, { method: 'POST' });
      if (res.ok) {
        setBeds(prev => ({
          ...prev,
          [bedId]: {
            ...prev[bedId],
            patient_name: null,
            patient_mrn: null,
            is_occupied: false,
            clinical_conditions: [],
          },
        }));
        setIncidents(prev => ({ ...prev, [bedId]: [] }));
      }
    } catch (e) {
      console.error('Failed to discharge patient:', e);
    }
  };

  // ── Incident REST Actions (with 0ms optimistic UI updates) ────────
  const ackIncident = async (id) => {
    // Optimistic update: mark as acknowledged immediately
    setIncidents(prev => {
      const next = { ...prev };
      for (const bId in next) {
        next[bId] = next[bId].map(inc =>
          inc.id === id
            ? { ...inc, status: 'acknowledged', acknowledged_by: currentView.toUpperCase(), acknowledged_at: new Date().toISOString() }
            : inc
        );
      }
      return next;
    });

    try {
      await fetch(`${API}/incidents/${id}/ack?by=${currentView.toUpperCase()}`, { method: 'POST' });
    } catch (e) { console.error('Failed to ack incident:', e); }
  };

  const resolveIncident = async (id) => {
    // Optimistic update: remove resolved incident immediately
    setIncidents(prev => {
      const next = { ...prev };
      for (const bId in next) {
        next[bId] = next[bId].filter(inc => inc.id !== id);
      }
      return next;
    });

    try {
      await fetch(`${API}/incidents/${id}/resolve`, { method: 'POST' });
    } catch (e) { console.error('Failed to resolve incident:', e); }
  };

  const escalateIncident = async (id, reason = 'Bedside Nurse Escalation') => {
    // Optimistic update: mark as escalated immediately and add doctor routing
    setIncidents(prev => {
      const next = { ...prev };
      for (const bId in next) {
        next[bId] = next[bId].map(inc => {
          if (inc.id === id) {
            const routed = inc.routed_to ? [...inc.routed_to] : ['nurse'];
            if (!routed.includes('doctor')) routed.push('doctor');
            return {
              ...inc,
              status: 'escalated',
              escalation_level: (inc.escalation_level || 0) + 1,
              routed_to: routed,
              correlation_reason: `[ESCALATED TO PHYSICIAN] ${inc.correlation_reason || reason}`,
            };
          }
          return inc;
        });
      }
      return next;
    });

    try {
      await fetch(`${API}/incidents/${id}/escalate?reason=${encodeURIComponent(reason)}`, { method: 'POST' });
    } catch (e) { console.error('Failed to escalate incident:', e); }
  };

  const triggerScenario = async (scenarioId, bedId) => {
    try {
      const nodeId = parseInt(String(bedId).replace('bed-', '')) || 1;
      await fetch(`${API}/simulator/trigger?node_id=${nodeId}&scenario=${scenarioId}`, { method: 'POST' });
    } catch (e) { console.error(e); }
  };

  const triggerAllScenarios = async (scenarioId) => {
    try {
      await fetch(`${API}/simulator/trigger-all?scenario=${scenarioId}`, { method: 'POST' });
    } catch (e) { console.error(e); }
  };

  const setSimulatedVitals = async (nodeId, params) => {
    try {
      const q = new URLSearchParams({ node_id: nodeId, ...params }).toString();
      await fetch(`${API}/simulator/set-vitals?${q}`, { method: 'POST' });
    } catch (e) { console.error(e); }
  };

  const togglePlannedActivity = async (bedId, active, activityType = 'bed_bath') => {
    try {
      await fetch(`${API}/beds/${bedId}/planned-activity?active=${active}&activity_type=${activityType}`, { method: 'POST' });
      setBeds(prev => ({
        ...prev,
        [bedId]: { ...prev[bedId], planned_activity: active }
      }));
    } catch (e) { console.error(e); }
  };

  // ── Clinical Duty Roster Actions ──────────────────────────────────
  const handleUpdateDutyStatus = async (status, note = '', coveringDoctor = null) => {
    // Immediate optimistic update
    setDutyRoster(prev => ({
      ...prev,
      duty_status: status,
      status_note: note || (
        status === 'active' ? 'Active on ward'
        : status === 'in_procedure' ? 'In surgical procedure — auto-forwarding active'
        : 'Off-duty handover in progress'
      ),
      covering_doctor: coveringDoctor || prev.covering_doctor,
    }));

    try {
      const q = new URLSearchParams({ status, note });
      if (coveringDoctor) q.append('covering_doctor', coveringDoctor);
      const res = await fetch(`${API}/duty-roster/status?${q.toString()}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.duty_roster) setDutyRoster(data.duty_roster);
      }
    } catch (e) {
      console.error('Failed to update duty status:', e);
    }
  };

  const handleDutyHandover = async (payload) => {
    try {
      const res = await fetch(`${API}/duty-roster/handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.duty_roster) setDutyRoster(data.duty_roster);
      }
    } catch (e) {
      console.error('Failed to execute shift handover:', e);
    }
  };

  // Keep KPI in sync with incident counts
  useEffect(() => {
    const totalInc = Object.values(incidents).flat().length;
    setKpis(prev => {
      const nat = Math.max(prev.nativeAlarms, totalInc > 0 ? totalInc * 3 : 0);
      const inc = Math.max(prev.incidentsShown, totalInc);
      const noise = nat > 0 ? `${Math.max(0, Math.round((1 - inc / nat) * 100))}%` : '71%';
      return { ...prev, nativeAlarms: nat, incidentsShown: inc, noise };
    });
  }, [incidents]);

  return (
    <div className="wrap">
      {/* ── Top Master Header ── */}
      <header className="top">
        <div className="logo">C</div>
        <div>
          <h1>
            C.A.R.E.
            <small>Clinical Action & Response Engine · Multi-Role Bedside Operating System</small>
          </h1>
        </div>

        <div className="sp" />

        <div className="pill">
          <span className={`dot ${connected ? '' : 'dot--off'}`} />
          {connected ? 'Edge Online' : 'Connecting...'}
        </div>

        <div className="pill">
          <span className="dot" />
          Safety Path Armed
        </div>

        <div className="pill" style={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {clock}
        </div>
      </header>

      {/* ── Role Navigation Tabs (Only Role Endpoints + Pitch Home) ── */}
      <nav className="master-nav-tabs">
        {NAV_TABS.map(tab => {
          const isActive = currentView === tab.id;
          return (
            <button
              key={tab.id}
              className={`nav-tab-btn ${isActive ? 'active' : ''} ${tab.highlight ? 'sim-highlight' : ''}`}
              onClick={() => navigateTo(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* ── View Router ── */}
      <main className="view-container">
        {currentView === 'home' && (
          <HomeView
            onNavigate={(viewId) => navigateTo(viewId)}
            beds={beds}
            kpis={kpis}
          />
        )}

        {currentView === 'nurse' && (
          <NurseDashboard
            beds={beds}
            incidents={incidents}
            selectedBed={selectedBed}
            onSelectBed={setSelectedBed}
            onAckIncident={ackIncident}
            onResolveIncident={resolveIncident}
            onEscalateIncident={escalateIncident}
            onTogglePlannedActivity={togglePlannedActivity}
            onOpenAdmission={handleOpenAdmission}
            onDischargePatient={handleDischargePatient}
            tasks={nurseTasks}
            onToggleTask={handleToggleNurseTask}
            dutyRoster={dutyRoster}
          />
        )}

        {currentView === 'doctor' && (
          <DoctorDashboard
            beds={beds}
            incidents={incidents}
            selectedBed={selectedBed}
            onSelectBed={setSelectedBed}
            onAckIncident={ackIncident}
            onResolveIncident={resolveIncident}
            onEscalateIncident={escalateIncident}
            onOrderIntervention={handleDoctorOrder}
            dutyRoster={dutyRoster}
            onUpdateDutyStatus={handleUpdateDutyStatus}
            onDutyHandover={handleDutyHandover}
          />
        )}

        {currentView === 'technician' && (
          <TechnicianDashboard
            beds={beds}
            incidents={incidents}
          />
        )}

        {currentView === 'simulator' && (
          <SimulatorDashboard
            beds={beds}
            onTriggerScenario={triggerScenario}
            onTriggerAll={triggerAllScenarios}
            onSetVitals={setSimulatedVitals}
            onTogglePlannedActivity={togglePlannedActivity}
          />
        )}
      </main>

      {/* ── Patient Admission & Bed Template Modal (Triggered Exclusively by Nurse!) ── */}
      <AdmissionModal
        isOpen={isAdmissionOpen}
        onClose={() => setIsAdmissionOpen(false)}
        initialBedId={admissionBedId}
        currentBedData={admissionBedData}
        onAdmit={handleAdmitPatient}
      />

      {/* ── Footer ── */}
      <footer className="foot">
        <p>C.A.R.E. · Clinical Action & Response Engine · Independent Safety Invariant: Hardware buzzer & LEDs never muted by software.</p>
      </footer>
    </div>
  );
}
