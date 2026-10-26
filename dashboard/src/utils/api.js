// API base URL — proxied through Vite in dev
const API_BASE = '/api';

export async function fetchBeds() {
  const res = await fetch(`${API_BASE}/beds`);
  return res.json();
}

export async function fetchBedVitals(bedId) {
  const res = await fetch(`${API_BASE}/beds/${bedId}/vitals`);
  return res.json();
}

export async function fetchIncidents(bedId = null) {
  const url = bedId
    ? `${API_BASE}/incidents?bed_id=${bedId}`
    : `${API_BASE}/incidents`;
  const res = await fetch(url);
  return res.json();
}

export async function acknowledgeIncident(incidentId, by = 'Nurse') {
  const res = await fetch(
    `${API_BASE}/incidents/${incidentId}/ack?by=${encodeURIComponent(by)}`,
    { method: 'POST' }
  );
  return res.json();
}

export async function resolveIncident(incidentId) {
  const res = await fetch(
    `${API_BASE}/incidents/${incidentId}/resolve`,
    { method: 'POST' }
  );
  return res.json();
}

export async function togglePlannedActivity(bedId, active, activityType = 'general') {
  const res = await fetch(
    `${API_BASE}/beds/${bedId}/planned-activity?active=${active}&activity_type=${activityType}`,
    { method: 'POST' }
  );
  return res.json();
}

export async function fetchDashboard(role) {
  const res = await fetch(`${API_BASE}/dashboard/${role}`);
  return res.json();
}

export async function fetchTechTasks() {
  const res = await fetch(`${API_BASE}/tech-tasks`);
  return res.json();
}

export async function completeTechTask(taskId) {
  const res = await fetch(`${API_BASE}/tech-tasks/${taskId}/complete`, {
    method: 'POST',
  });
  return res.json();
}

export async function fetchScenarios() {
  const res = await fetch(`${API_BASE}/simulator/scenarios`);
  return res.json();
}

export async function triggerScenario(nodeId, scenario, duration = 30) {
  const res = await fetch(
    `${API_BASE}/simulator/trigger?node_id=${nodeId}&scenario=${scenario}&duration=${duration}`,
    { method: 'POST' }
  );
  return res.json();
}

export async function triggerScenarioAll(scenario, duration = 30) {
  const res = await fetch(
    `${API_BASE}/simulator/trigger-all?scenario=${scenario}&duration=${duration}`,
    { method: 'POST' }
  );
  return res.json();
}

export async function setSimulatedVitals(nodeId, vitals) {
  const params = new URLSearchParams({ node_id: nodeId });
  if (vitals.hr !== undefined) params.append('hr', vitals.hr);
  if (vitals.temp !== undefined) params.append('temp', vitals.temp);
  if (vitals.spo2 !== undefined) params.append('spo2', vitals.spo2);

  const res = await fetch(`${API_BASE}/simulator/set-vitals?${params}`, {
    method: 'POST',
  });
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/stats`);
  return res.json();
}

export async function fetchStatus() {
  const res = await fetch(`${API_BASE}/status`);
  return res.json();
}
