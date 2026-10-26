import React, { useState, useEffect } from 'react';

const CLINICAL_TEMPLATES = [
  {
    id: 'cardiac',
    name: '🫀 Cardiac Care Template',
    desc: 'Targeted for Post-MI, Arrhythmias, Heart Failure. Sets tight tachycardia (>120) and bradycardia (<50) bounds, priority ECG rhythm tracking.',
    defaultConditions: ['Known Atrial Fibrillation', 'Post-PCI / CABG', 'High Fall Risk'],
  },
  {
    id: 'kidney',
    name: '🫘 Nephrology & Dialysis Template',
    desc: 'Targeted for Acute Kidney Injury & ESRD on Hemodialysis. Activates dialysate pressure drop & blood leak detection, heightened fever watch (>38.0°C).',
    defaultConditions: ['Hemodialysis Dependent', 'Fluid Overload Risk', 'AV Fistula Right Arm'],
  },
  {
    id: 'respiratory',
    name: '🫁 Respiratory Critical Care Template',
    desc: 'Targeted for ARDS, Pneumonia, Mechanical Ventilation. Monitors rapid SpO₂ desaturation, high airway pressure spikes, and ventilator disconnects.',
    defaultConditions: ['Mechanical Ventilation', 'COPD (SpO₂ Target 88–92%)', 'High Extubation Risk'],
  },
  {
    id: 'general',
    name: '🏥 General ICU / Post-Op Template',
    desc: 'Standard multi-parameter telemetry with baseline drift detection for post-operative recovery.',
    defaultConditions: ['Post-Operative Monitoring', 'DVT Risk Protocol'],
  },
];

const PRESET_CONDITIONS = [
  'Known Atrial Fibrillation',
  'Post-PCI / CABG',
  'COPD (SpO₂ Target 88–92%)',
  'Hemodialysis Dependent',
  'Fluid Overload Risk',
  'Severe Sepsis Alert Protocol',
  'Mechanical Ventilation',
  'High Extubation Risk',
  'High Fall Risk',
  'AV Fistula Right Arm',
  'Occult Shock / Hypotension Watch',
];

export default function AdmissionModal({
  isOpen,
  onClose,
  initialBedId = 'bed-1',
  currentBedData = null,
  onAdmit,
}) {
  const [bedId, setBedId] = useState(initialBedId);
  const [patientName, setPatientName] = useState('');
  const [mrn, setMrn] = useState('');
  const [age, setAge] = useState('65');
  const [gender, setGender] = useState('Female');
  const [profile, setProfile] = useState('cardiac');
  const [diagnosis, setDiagnosis] = useState('');
  const [selectedConditions, setSelectedConditions] = useState([]);
  const [doctor, setDoctor] = useState('Dr. Sharma');
  const [nurse, setNurse] = useState('Nurse Priya');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialBedId) setBedId(initialBedId);
    if (currentBedData && currentBedData.is_occupied) {
      setPatientName(currentBedData.patient_name || '');
      setMrn(currentBedData.patient_mrn || `MRN-${Math.floor(10000 + Math.random() * 90000)}`);
      setAge(currentBedData.patient_age || '65');
      setGender(currentBedData.patient_gender || 'Female');
      setProfile(currentBedData.profile || 'cardiac');
      setDiagnosis(currentBedData.primary_diagnosis || '');
      setSelectedConditions(currentBedData.clinical_conditions || []);
      setDoctor(currentBedData.attending_doctor || 'Dr. Sharma');
      setNurse(currentBedData.assigned_nurse || 'Nurse Priya');
    } else {
      // Clean slate for new admission
      setPatientName('');
      setMrn(`MRN-${Math.floor(10000 + Math.random() * 90000)}`);
      setAge('62');
      setGender('Male');
      setProfile('cardiac');
      setDiagnosis('');
      setSelectedConditions(['Known Atrial Fibrillation']);
    }
  }, [initialBedId, currentBedData, isOpen]);

  if (!isOpen) return null;

  const handleTemplateChange = (tplId) => {
    setProfile(tplId);
    const tpl = CLINICAL_TEMPLATES.find(t => t.id === tplId);
    if (tpl) {
      // Auto-attach recommended conditions for this clinical template!
      setSelectedConditions(prev => Array.from(new Set([...prev, ...tpl.defaultConditions])));
    }
  };

  const toggleCondition = (cond) => {
    setSelectedConditions(prev =>
      prev.includes(cond) ? prev.filter(c => c !== cond) : [...prev, cond]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!patientName.trim()) {
      alert('Please enter patient name.');
      return;
    }

    try {
      setSubmitting(true);
      await onAdmit(bedId, {
        patient_name: patientName.trim(),
        patient_mrn: mrn.trim(),
        patient_age: parseInt(age) || 60,
        patient_gender: gender,
        profile: profile,
        primary_diagnosis: diagnosis.trim() || 'Acute Critical Monitoring',
        clinical_conditions: selectedConditions,
        attending_doctor: doctor,
        assigned_nurse: nurse,
      });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to admit patient: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-tag">ICU Bed Admission OS</span>
            <h3>🏥 Admit Patient & Allocate Bed Template</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {/* Bed Slot Selection */}
          <div className="form-group">
            <label className="form-label">Target Bed Slot (Physical Infrastructure):</label>
            <div className="bed-select-tabs">
              {['bed-1', 'bed-2', 'bed-3'].map(bId => (
                <button
                  type="button"
                  key={bId}
                  className={`bed-slot-btn ${bedId === bId ? 'active' : ''}`}
                  onClick={() => setBedId(bId)}
                >
                  <span className="bed-slot-id">{bId.toUpperCase()}</span>
                  <small>Node #{bId.replace('bed-', '')}</small>
                </button>
              ))}
            </div>
          </div>

          {/* Patient Demographics */}
          <div className="form-row two-cols">
            <div className="form-group">
              <label className="form-label">Patient Full Name *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Eleanor Vance"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Medical Record Number (MRN)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. MRN-88412"
                value={mrn}
                onChange={(e) => setMrn(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row three-cols">
            <div className="form-group">
              <label className="form-label">Age</label>
              <input
                type="number"
                className="form-input"
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Gender</label>
              <select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Attending Doctor</label>
              <input
                type="text"
                className="form-input"
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Primary Admission Diagnosis</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Acute Anterior STEMI, Severe ARDS, AKI with Volume Overload"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
            />
          </div>

          {/* Clinical Template Selection */}
          <div className="form-group">
            <label className="form-label">Clinical Condition Template (Configures Alarm Logic):</label>
            <div className="template-picker-grid">
              {CLINICAL_TEMPLATES.map(tpl => (
                <div
                  key={tpl.id}
                  className={`tpl-card ${profile === tpl.id ? 'active' : ''}`}
                  onClick={() => handleTemplateChange(tpl.id)}
                >
                  <div className="tpl-name">{tpl.name}</div>
                  <div className="tpl-desc">{tpl.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Clinical Conditions & Comorbidities (Auto-attached) */}
          <div className="form-group">
            <label className="form-label">
              Clinical Conditions & Comorbidities (Auto-Configured for Correlation):
            </label>
            <p className="form-hint">Click tags below to attach or detach clinical conditions to this bed:</p>
            <div className="condition-chips-cloud">
              {PRESET_CONDITIONS.map(cond => {
                const isSelected = selectedConditions.includes(cond);
                return (
                  <button
                    type="button"
                    key={cond}
                    className={`cond-chip ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleCondition(cond)}
                  >
                    {isSelected ? '✓ ' : '+ '} {cond}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Modal Actions */}
          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="pri btn-admit" disabled={submitting}>
              {submitting ? 'Allocating Bed...' : `🏥 Admit Patient to ${bedId.toUpperCase()} & Apply Template`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
