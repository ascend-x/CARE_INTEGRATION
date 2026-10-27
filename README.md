# CARE — Clinical Action and Response Engine

<div align="center">

![CARE Banner](https://img.shields.io/badge/CARE-Clinical_Action_%26_Response_Engine-00f0ff?style=for-the-badge&logo=medtronic&logoColor=black)
<br>
![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.104%2B-009688?style=flat-square&logo=fastapi&logoColor=white)
![React 19](https://img.shields.io/badge/React-19.3-61DAFB?style=flat-square&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=flat-square&logo=vite&logoColor=white)
![Arduino Uno](https://img.shields.io/badge/Hardware-Arduino_Uno_R3-00979D?style=flat-square&logo=arduino&logoColor=white)
![IEC 60601-1-8](https://img.shields.io/badge/Safety_Standard-IEC_60601--1--8-critical?style=flat-square)
![License](https://img.shields.io/badge/License-Research_Prototype-purple?style=flat-square)

**An AI-assisted, disease-aware alarm correlation and role-based escalation layer for ICUs.**  
*It never suppresses an alarm. It groups related alarms, explains them with raw signal evidence, and sends each one to the person who can act on it.*

</div>

---

## 📌 Executive Summary

Modern Intensive Care Units (ICUs) face an overwhelming crisis of **alarm fatigue**:
- Bedside monitors, ventilators, dialysis (CRRT) machines, and infusion pumps beep in isolation.
- Over **85% of bedside alarms require no clinical intervention** (motion artifacts, loose leads, temporary coughing).
- When a single real event occurs (e.g., patient movement or suctioning), **multiple machines alarm simultaneously**, competing for the same nurse's attention.
- Critical hardware faults (such as a deteriorating pulse oximeter probe or worn lead) are treated as repeated patient crises instead of being dispatched to bio-medical engineering.

### The CARE Solution:
> **"AI proposes. A deterministic safety layer decides."**

CARE sits as a non-invasive layer beside bedside medical devices. It timestamps telemetry at sub-millisecond precision, evaluates signal trustworthiness, correlates cascading alarms into unified clinical incidents, and routes them strictly by **role** (Doctor, Nurse, Biomedical Technician) with automated escalation.

---

## 🔒 The Non-Negotiable Safety Invariants

CARE is designed around clinical safety standards (aligned with **IEC 60601-1-8**):

1. **Zero Suppression, Ever**: CARE never mutes, hides, delays, downgrades, or auto-dismisses any native alarm.
2. **Overlay, Not Replacement**: Native device alarms (and physical bedside piezo buzzers) always fire locally on hardware.
3. **Grouping is Presentation Only**: An incident card is a visual grouping. Every original raw alarm remains individually visible, timestamped, expandable, and logged in the audit trail.
4. **Tier 1 Hard Bypass**: Life-critical events (Ventilator Disconnect, Dialysis Blood Leak, Asystole / V-Fib) bypass all AI models and route directly through hard-coded deterministic rules.
5. **Read-Only Integration**: CARE passively ingests telemetry. It never controls life-support machines or alters alarm limits.
6. **Fail-Safe / Pass-Through**: If the server crashes, Wi-Fi drops, or host OS freezes, native hardware alarms fire continuously without interruption.
7. **Decision Support Only**: AI provides context labels and probable relationships; the clinician always decides.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       BEDSIDE HARDWARE LAYER (BIU NODES)                   │
│                                                                             │
│   ┌────────────────────────┐  ┌────────────────────────┐  ┌─────────────┐   │
│   │    Bed 1: Cardiac      │  │    Bed 2: Dialysis     │  │   Bed 3     │   │
│   │ ⚡ REAL ARDUINO UNO R3 │  │  🕹️ SIMULATED RUNTIME  │  │ 🕹️ SIMULATED │   │
│   │  • AD8232 ECG Lead II  │  │  • Blood Flow Monitor  │  │ • Vent Press│   │
│   │  • KY-039 / Optic SpO₂ │  │  • Venous / Art Press  │  │ • Tidal Vol │   │
│   │  • Temperature Sensor  │  │  • Heparin Infusion    │  │ • FiO₂ 21%  │   │
│   │  • D8 Piezo Safety Buz │  │  • Blood Leak Detector │  │ • Disconn   │   │
│   └───────────┬────────────┘  └───────────┬────────────┘  └──────┬──────┘   │
└───────────────┼───────────────────────────┼──────────────────────┼──────────┘
                │ USB Serial @ 115200       │ IPC Memory Stream    │
                ▼                           ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CARE INTEGRATION & CORRELATION SERVER                    │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. SERIAL MANAGER & AUTO-DISCOVERY                                   │   │
│   │    Hot-plug scanner • Stale port pruning • Non-blocking flash pause │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 2. SIGNAL QUALITY INDEX (SQI) ENGINE                                │   │
│   │    Biological range boundaries • 750ms persistence debounce         │   │
│   │    Noise floor • Saturation detection • Artifact classification     │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 3. ALARM CORRELATION & PATTERN MATCHER                              │   │
│   │    Multi-sensor cascade clustering • Temporal sequence windows      │   │
│   │    N alarms → 1 Unified Incident • "N in T minutes" tracking        │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 4. DISEASE-AWARE BED PROFILES                                       │   │
│   │    • Cardiac: Tier 1 = ECG / Arrhythmias                            │   │
│   │    • Kidney: Tier 1 = Dialysis Blood Leak & Venous Press Drop       │   │
│   │    • Respiratory: Tier 1 = Ventilator Disconnect & Airway Pressure  │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 5. ROLE ROUTING & ESCALATION LADDER                                 │   │
│   │    Nurse Station • Doctor Console • Bio-Med Technician Station      │   │
│   │    Auto-escalation timer: Nurse ──(60s)──► Charge Nurse ──(120s)──► │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │ WebSocket @ 10Hz + REST API
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLINICAL ROLE-BASED DASHBOARDS                        │
│                                                                             │
│   👩‍⚕️ Nurse Station      👨‍⚕️ Doctor Console     🔧 Bio-Med Tech     🕹️ Simulator │
│   • Bed Grid Status    • Live ECG Rhythm Strip • Sensor Health     • Crisis Inj │
│   • Incident Counters  • Shock Index (SI)      • Repeat Alarms     • Hybrid Mon │
│   • Quick Acknowledge  • Hemodynamic Trends    • Work Orders       • Scenarios  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔌 Hardware Architecture & Direct No-Breadboard Wiring

CARE includes an **All-in-One Unified BIU Node** (`firmware/unified_biu_node/unified_biu_node.ino`) that connects an Arduino Uno R3 directly to 3 physical sensors **without requiring a breadboard**.

### Direct Socket Layout (Zero Pin Overlap)

| Component | Sensor Pin | Arduino Pin | Wire Connection Description |
| :--- | :--- | :--- | :--- |
| **AD8232 Heart Monitor** | `3.3V` | `3.3V` | Direct to Power Strip 3.3V socket |
| **AD8232 Heart Monitor** | `GND` | `GND` | Direct to Power Strip GND socket (next to 5V) |
| **AD8232 Heart Monitor** | `OUTPUT` | `A1` | Direct to Analog In Pin A1 (ECG Lead II) |
| **AD8232 Heart Monitor** | `LO-` | `D12` | *(Optional)* Direct to Digital Pin 12 (or auto-detected) |
| **Temperature Sensor** | `VCC` | `5V` | Direct to Power Strip 5V socket |
| **Temperature Sensor** | `GND` | `GND` | Direct to Power Strip GND socket (next to Vin) |
| **Temperature Sensor** | `SIG` | `A3` | Direct to Analog Pin A3 (LM35 / TMP36) or D2 (DS18B20) |
| **Active Piezo Buzzer** | `+` (Long Pin)| `D8` | Direct to Digital Pin 8 (PWM Safety Loop) |
| **Active Piezo Buzzer** | `-` (Short Pin)| `GND` | Direct to Digital Strip GND socket (next to Pin 13) |

```
                     ┌─────────────────────────────────────────┐
                     │             Arduino Uno R3              │
                     │                                         │
   AD8232 3.3V ──────┤ 3.3V                                    │
    AD8232 GND ──────┤ GND (Power)                             │
      Temp 5V  ──────┤ 5V                                      │
      Temp GND ──────┤ GND (Power)                             │
                     │                                         │
                     │ A0  (Pulse / KY-039 opt)                │
 AD8232 OUTPUT ──────┤ A1  (Live ECG Lead II)                  │
                     │ A2  (SpO₂ Optical ADC)                  │
      Temp SIG ──────┤ A3  (Analog Temp LM35/TMP36)            │
                     │                                         │
    Buzzer (+) ──────┤ D8  (Hardware Safety Buzzer Output)     │
                     │ D9  (Red Alarm LED)                     │
                     │ D10 (Yellow Alert LED)                  │
                     │ D11 (Green System OK LED)               │
    AD8232 LO- ──────┤ D12 (Hardware Lead-Off Detect)          │
    Buzzer (-) ──────┤ GND (Digital Strip next to D13)         │
                     │                                         │
                     │ USB ────────────────► PC / BIU Server   │
                     └─────────────────────────────────────────┘
```

---

## 🎛️ Firmware Digital Signal Processing (DSP)

The unified firmware implements real-time embedded DSP directly on the ATmega328P:

### 1. 100 Hz QRS Detection Engine
- **Throttled Sampling**: The ADC runs at a fixed 100 Hz (every 10ms) interval to prevent high-frequency loop jitter.
- **Adaptive Running Baseline**: An Exponential Moving Average ($\tau \approx 330\text{ms}$, $\alpha = 0.03$) tracks 0.5–1.0 Hz respiratory baseline drift while preserving **90%+ of the rapid 80ms QRS spike**.
- **Bidirectional Deflection**: Measures absolute spike $|V(t) - V_{\text{baseline}}| > 12\text{ ADC}$ to accurately capture both upright and inverted Lead II morphologies.
- **Beat-to-Beat Responsiveness**: Instantaneous calculation (`60000 / interval`) smoothed with a 60% instant / 40% weighted filter for sub-second display updates.

### 2. 750ms Medical Persistence Filter (Lead-Off)
- Motion artifacts, finger pressure changes, and muscle EMG can cause momentary ADC railing for 5–20 milliseconds.
- A **750ms persistence debounce window** prevents false disconnections: only continuous railing ($< 35$ or $> 985$ ADC units) for $> 750\text{ms}$ declares `LEAD_OFF`.
- Reconnection latency is **0 milliseconds**: the moment electrodes touch skin, `lead_off: false` triggers instantly.

### 3. Fail-Safe Bedside Safety Loop
- The piezo buzzer on Pin `D8` evaluates priority independently inside `driveSafetyOutputs()`.
- If heart rate exceeds 150 BPM, drops below 40 BPM, flatlines for $> 6.0\text{s}$, or temperature exceeds 40°C, the buzzer sounds **locally on hardware** even if the USB cable is unplugged or the server is dead.

---

## 🧠 Server Architecture & Modules

The CARE server is built on **FastAPI**, **WebSockets**, and **Pydantic**:

### 1. `signal_quality.py` — Artifact vs. Reality
Analyzes incoming telemetry against four signal quality dimensions:
- **Lead Contact Quality**: Evaluates analog biological baseline consistency.
- **Motion Artifact Detection**: Analyzes high-frequency variance across multiple sensors simultaneously.
- **Signal-to-Noise Ratio (SNR)**: Computes signal degradation to distinguish between clinical deterioration and sensor detachment.

### 2. `correlation.py` — Alarm Cascade Reducer
Groups cascading alarms that stem from a single underlying clinical event:
- **Motion Disturbance Cascade**: When ECG noise, pulse variability, and SpO₂ pleth artifacts coincide within a 5-second window, they are grouped into **1 "Possible Motion Disturbance" Incident**.
- **Lead-Off Cascade**: Correlates Lead Disconnect with false asystole, suppressing false Code Blue pages while notifying the nurse to re-attach the pad.
- **Desaturation Cascade**: Correlates gradual SpO₂ decline with compensatory sinus tachycardia into an acute oxygenation incident.

### 3. `bed_profiles.py` — Disease-Aware Prioritization

| Bed Profile | Clinical Diagnosis | Tier 1 Critical Focus | Example Correlation Rule |
| :--- | :--- | :--- | :--- |
| **Cardiac** (Bed 1) | Acute Anterior STEMI, Post-PCI | ECG Arrhythmias & Infusion Rates | Flatline without lead-off = Instant Tier 1 Code Blue |
| **Kidney** (Bed 2) | Acute Kidney Injury on CRRT | Dialysis Machine & Blood Circuit | Blood leak or venous pressure drop = Instant Tier 1 alarm |
| **Respiratory** (Bed 3)| ARDS on Mechanical Ventilation | Ventilator Pressure & Tidal Volume | Low tidal volume + airway pressure spike = Suctioning/tube check |

### 4. `routing.py` — Role-Based Escalation Ladder
- **Deterministic Delivery**: Critical events route to Doctor + Nurse; sensor failures route to Biomedical Technician; routine vitals route to Bedside Nurse.
- **Automated Escalation Timer**:
  - `0s`: Notification delivered to assigned Bedside Nurse.
  - `60s` (Unacknowledged): Escalates to Charge Nurse / Ward Head.
  - `120s` (Unacknowledged): Escalates to Attending Doctor.
- **Technician Loop**: If an SpO₂ or ECG sensor alarms $\ge 3$ times in 10 minutes without hemodynamic collapse, CARE generates a **Hardware Work Order** for the Biomedical Technician to replace the probe, preventing nurse alert fatigue.

---

## 💻 Clinical Role Dashboards

CARE delivers role-specific user interfaces built with **React 19** and a custom **ICU Dark Theme** (`dashboard/src/index.css`):

### 👩‍⚕️ Nurse Dashboard (`/nurse`)
- **Ward Grid**: Live status cards for all active beds, colored by IEC 60601-1-8 priority levels.
- **Incident Grouping Counter**: Displays `"4 Alarms → 1 Grouped Incident"`, showing staff how many individual alarms were grouped.
- **One-Tap Acknowledge**: Acknowledge incidents with timestamped audit logging.
- **Planned Activity Toggle**: Mark temporary bedside procedures (bathing, suctioning) to prevent false alerts.

### 👨‍⚕️ Doctor Dashboard (`/doctor`)
- **Live 60 FPS ECG Rhythm Strip**: Canvas-rendered Lead II electrocardiogram rendering real-time hardware ADC telemetry.
- **Shock Index (SI)**: Automatically computes $\text{Heart Rate} / \text{Systolic BP}$ to identify early occult shock before blood pressure drops.
- **Clinical Context Flags**: Displays admitting diagnosis, comorbidities (e.g., Atrial Fibrillation, Fall Risk), and attending team.

### 🔧 Biomedical Technician Station (`/tech`)
- **Sensor Health Degradation Tracking**: Monitors probe wear and battery cycles across all ward devices.
- **Automated Work-Order Board**: Converts repeated false alarms into actionable hardware replacement tasks.

### 🕹️ Multi-Bed Simulator Master Console (`/simulator`)
- **Hybrid Ward Telemetry**: Run physical Arduino on Bed 1 while Beds 2 & 3 run simulated multi-device patients.
- **On-Demand Crisis Injection**: Test emergency responses with one click:
  - `Tachycardia (145 BPM)`
  - `Electrode Disconnect (Lead-Off)`
  - `Dialysis Blood Leak`
  - `Ventilator Tube Disconnect`
  - `Multi-Bed Ward Crisis`

---

## 🎮 Interactive Clinical Scenarios

| Scenario | Trigger | What CARE Does | Safety Verification |
| :--- | :--- | :--- | :--- |
| **1. Motion Disturbance** | Shake/wiggle sensor leads | Grouped as 1 "Possible Motion Disturbance" incident. | Raw alarms remain visible in audit log. |
| **2. Electrode Disconnect** | Pull ECG pad | Groups asystole alarm with Lead-Off; cancels false cardiac arrest code. | Bedside hardware buzzer still alerts nurse. |
| **3. True Desaturation** | SpO₂ drops below 85% | Ranked as Critical Tier 1; routes immediately to Doctor + Nurse. | Never collapsed or delayed. |
| **4. Dialysis Blood Leak** | Blood in dialysate circuit | Instant Tier 1 alarm; alerts Doctor + Nurse; highlights CRRT profile. | Bypasses all AI models. |
| **5. Ventilator Disconnect** | Tracheal tube disconnect | Alerts Respiratory Therapist + Doctor; correlates subsequent SpO₂ drop. | Fixed deterministic safety rule. |
| **6. Technician Loop** | Repeat false SpO₂ alarms | Automatically creates a Technician task to replace probe; Nurse alerts continue. | Nurse alerts are NEVER suppressed. |
| **7. Server Failure** | Terminate Python server | Dashboard displays "CARE Offline"; Arduino hardware buzzer sounds on threshold. | Fail-safe pass-through verified. |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** with `npm`
- **Arduino IDE** (or `arduino-cli`)
- 1× Arduino Uno R3 with USB cable (optional — full simulator mode works out of the box)

---

### Step 1: Upload Arduino Firmware

1. Open `firmware/unified_biu_node/unified_biu_node.ino` in the Arduino IDE.
2. Select your board (**Arduino Uno**) and serial port (e.g., `/dev/ttyACM0` or `COM3`).
3. Click **Upload (➡️)**.
4. *(No external libraries required — compiles out of the box with zero dependencies!)*

---

### Step 2: Start the CARE Backend Server

```bash
cd server

# Create and activate a Python virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server with hybrid simulation enabled
python main.py --simulate
```
* The server will automatically scan, identify, and link to your Arduino on `/dev/ttyACM*` or `/dev/ttyUSB*`.
* Server API runs at: **`http://localhost:8000`**
* Interactive Swagger Docs: **`http://localhost:8000/docs`**

---

### Step 3: Start the Web Dashboard

```bash
cd dashboard

# Install frontend dependencies
npm install

# Start Vite dev server
npm run dev
```
* Open your browser to: **`http://localhost:5173`**

---

## 📡 REST & WebSocket API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | System health, connected hardware nodes, and active serial ports |
| `GET` | `/api/beds` | All ICU beds, current vitals, patient profiles, and telemetry sources |
| `GET` | `/api/beds/{bed_id}` | Detailed telemetry and active alarms for a specific bed |
| `GET` | `/api/beds/{bed_id}/vitals` | Rolling 100-sample physiological vitals history |
| `GET` | `/api/incidents` | All active grouped incidents, severity, and assigned roles |
| `POST`| `/api/incidents/{id}/ack` | Acknowledge incident (logs staff ID and timestamp) |
| `POST`| `/api/incidents/resolve-all` | Resolve all active incidents (clean test slate) |
| `POST`| `/api/serial/pause?seconds=60` | Temporarily release serial port for Arduino IDE firmware flashing |
| `POST`| `/api/serial/resume` | Manually resume serial telemetry streaming |
| `POST`| `/api/simulator/trigger` | Inject a clinical test scenario (`scenario`, `node_id`, `duration`) |
| `WS`  | `/ws/live` | 10 Hz bi-directional WebSocket stream for real-time vitals & ECG |

---

## 📂 Project Directory Structure

```
CARE/
├── .gitignore                          # Comprehensive ignore rules for Python, Node, & Arduino
├── README.md                           # Master documentation
├── DOCS/
│   └── CARE_Idea.md                    # Original clinical specification
├── firmware/
│   ├── unified_biu_node/
│   │   └── unified_biu_node.ino        # ⭐ All-in-One Single Arduino Node (100Hz DSP, No-Breadboard)
│   ├── cardiac_node/
│   │   └── cardiac_node.ino            # Bed 1 Dedicated Cardiac Node
│   ├── kidney_node/
│   │   └── kidney_node.ino             # Bed 2 Dedicated Dialysis Node
│   └── respiratory_node/
│       └── respiratory_node.ino        # Bed 3 Dedicated Ventilator Node
├── server/
│   ├── main.py                         # FastAPI application entry point
│   ├── models.py                       # Pydantic data schemas & clinical enums
│   ├── serial_listener.py              # USB serial auto-discovery & port manager
│   ├── signal_quality.py               # Signal Quality Index (SQI) & artifact detector
│   ├── correlation.py                  # Multi-sensor alarm grouping engine
│   ├── bed_profiles.py                 # Disease-aware bed profiles (Cardiac, Kidney, Respiratory)
│   ├── routing.py                      # Role-based escalation & technician task router
│   ├── simulator.py                    # Multi-patient physiological simulation engine
│   ├── websocket_manager.py            # High-throughput real-time WebSocket broadcaster
│   └── requirements.txt                # Python backend dependencies
└── dashboard/
    ├── package.json                    # Frontend dependencies & scripts
    ├── vite.config.js                  # Vite bundler configuration
    ├── index.html                      # HTML5 entry with clinical meta tags
    └── src/
        ├── main.jsx                    # React 19 root
        ├── App.jsx                     # Top-level view router with role navigation
        ├── index.css                   # ICU Dark Theme Design System (HSL tokens, IEC palette)
        ├── hooks/
        │   └── useWebSocket.js         # Real-time WebSocket telemetry hook
        ├── utils/
        │   ├── api.js                  # REST API client
        │   └── constants.js            # Clinical thresholds & display maps
        ├── components/
        │   ├── BedCard.jsx             # Bed telemetry card with canvas ECG waveform
        │   ├── IncidentCard.jsx        # Grouped incident card with expandable raw alarms
        │   └── SimulatorPanel.jsx      # Scenario injection control panel
        └── views/
            ├── HomeView.jsx            # Interactive architecture pitch & live telemetry demo
            ├── NurseDashboard.jsx      # Rapid multi-bed triage station
            ├── DoctorDashboard.jsx     # High-acuity workstation with 60FPS rhythm strip
            ├── TechnicianDashboard.jsx  # Biomedical engineering hardware task board
            ├── SimulatorDashboard.jsx  # Multi-bed scenario master controller
            └── OverviewDashboard.jsx   # Unit charge nurse overview
```

---

## ⚖️ Clinical & Regulatory Disclaimer

> **⚠️ RESEARCH PROTOTYPE ONLY**: CARE is an academic research and engineering prototype. It is **not** a certified medical device and has not been evaluated by the FDA, CE, or CDSCO. It is designed for demonstration, algorithm evaluation, and simulation purposes. Never connect mains-powered equipment directly to human subjects during testing. Power all bedside hardware exclusively from USB or battery isolation.

---

## 👨‍💻 Author & Contributions

* **CARE Integration Architecture & Engineering**: Nandakishore V ([@ascend-x](https://github.com/ascend-x))
* **Repository**: [https://github.com/ascend-x/CARE_INTEGRATION](https://github.com/ascend-x/CARE_INTEGRATION)

*CARE: Fewer interruptions, no lost alarms, the right clinician alerted, and safe even if CARE itself fails.*
