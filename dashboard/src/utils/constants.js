// Priority mappings
export const PRIORITY_LABELS = {
  0: 'Normal',
  1: 'Low',
  2: 'Medium',
  3: 'Critical',
};

export const PRIORITY_COLORS = {
  0: 'var(--normal)',
  1: 'var(--low)',
  2: 'var(--medium)',
  3: 'var(--critical)',
};

// Profile display info
export const PROFILE_INFO = {
  cardiac: { name: 'Cardiac', icon: '❤️', color: 'var(--cardiac)' },
  kidney: { name: 'Kidney', icon: '🫘', color: 'var(--kidney)' },
  respiratory: { name: 'Respiratory', icon: '🫁', color: 'var(--respiratory)' },
};

// Role display info
export const ROLE_INFO = {
  doctor: { name: 'Doctor', icon: '👨‍⚕️' },
  nurse: { name: 'Nurse', icon: '👩‍⚕️' },
  technician: { name: 'Technician', icon: '🔧' },
  charge_nurse: { name: 'Charge Nurse', icon: '📊' },
  respiratory_therapist: { name: 'RT', icon: '🫁' },
};

// Alarm type display
export const ALARM_DISPLAY = {
  HR_CRITICAL_HIGH: { label: 'HR ↑↑', desc: 'Critical Tachycardia' },
  HR_HIGH: { label: 'HR ↑', desc: 'Tachycardia' },
  HR_LOW: { label: 'HR ↓', desc: 'Bradycardia' },
  HR_CRITICAL_LOW: { label: 'HR ↓↓', desc: 'Critical Bradycardia' },
  FLATLINE: { label: 'FLATLINE', desc: 'No Heartbeat' },
  TEMP_HIGH: { label: 'T° ↑', desc: 'Fever' },
  TEMP_CRITICAL: { label: 'T° ↑↑', desc: 'Hyperthermia' },
  TEMP_LOW: { label: 'T° ↓', desc: 'Hypothermia' },
  TEMP_CRITICAL_LOW: { label: 'T° ↓↓', desc: 'Severe Hypothermia' },
  LEAD_OFF: { label: 'LEAD OFF', desc: 'ECG Lead Disconnected' },
  ECG_NOISE: { label: 'ECG NOISE', desc: 'Noisy ECG Signal' },
  SPO2_LOW: { label: 'SpO₂ ↓', desc: 'Low Oxygen' },
  SPO2_CRITICAL: { label: 'SpO₂ ↓↓', desc: 'Critical Desaturation' },
  SPO2_RAPID_DROP: { label: 'SpO₂ ⚡', desc: 'Rapid SpO₂ Drop' },
  VENT_DISCONNECT: { label: 'VENT DC', desc: 'Ventilator Disconnect' },
  VENT_HIGH_PRESSURE: { label: 'VENT P↑', desc: 'High Airway Pressure' },
  VENT_LOW_PRESSURE: { label: 'VENT P↓', desc: 'Low Airway Pressure' },
  VENT_BATTERY: { label: 'VENT BAT', desc: 'Ventilator Battery Low' },
  DIALYSIS_BLOOD_LEAK: { label: 'BLOOD LEAK', desc: 'Dialysis Blood Leak' },
  DIALYSIS_PRESSURE_DROP: { label: 'DIAL P↓', desc: 'Dialysis Pressure Drop' },
  DIALYSIS_AIR_DETECTED: { label: 'DIAL AIR', desc: 'Air in Dialysis Line' },
  PUMP_EMPTY: { label: 'PUMP ∅', desc: 'IV Pump Empty' },
  PUMP_OCCLUSION: { label: 'PUMP OCC', desc: 'IV Pump Occlusion' },
};

// Format time ago
export function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Format vital with unit
export function formatVital(value, type) {
  switch (type) {
    case 'hr': return `${Math.round(value)}`;
    case 'temp': return `${value.toFixed(1)}`;
    case 'spo2': return `${Math.min(100, Math.max(0, Math.round((value / 700) * 100)))}`;
    default: return `${value}`;
  }
}

// Determine vital status
export function vitalStatus(value, type, profile = 'cardiac') {
  switch (type) {
    case 'hr':
      if (value >= 150 || value <= 40) return 'critical';
      if (value >= 120 || value <= 50) return 'warning';
      return 'normal';
    case 'temp':
      if (value >= 40.0 || value <= 34.0) return 'critical';
      if (value >= 38.5 || value <= 35.0) return 'warning';
      return 'normal';
    case 'spo2':
      const pct = (value / 700) * 100;
      if (pct < 50) return 'critical';
      if (pct < 70) return 'warning';
      return 'normal';
    case 'ecg_quality':
      if (value < 30) return 'critical';
      if (value < 60) return 'warning';
      return 'normal';
    default:
      return 'normal';
  }
}
