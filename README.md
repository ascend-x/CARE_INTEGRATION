# CARE — Clinical Action and Response Engine

**An AI-assisted, disease-aware alarm correlation and role-based escalation layer for ICUs.**

It never suppresses an alarm. It groups related alarms, explains them, and sends each one to the person who can act on it.

---

## 🏗 Architecture

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Arduino Uno #1  │  │  Arduino Uno #2  │  │  Arduino Uno #3  │
│  ❤️ Cardiac Bed  │  │  🫘 Kidney Bed   │  │  🫁 Respiratory  │
│  ECG+Pulse+Temp  │  │  ECG+Pulse+Temp  │  │  ECG+Pulse+Temp  │
│  Buzzer+LEDs     │  │  Buzzer+LEDs     │  │  Buzzer+LEDs     │
└───────┬──────────┘  └───────┬──────────┘  └───────┬──────────┘
        │ USB Serial          │ USB Serial          │ USB Serial
        └─────────────┬───────┴─────────────────────┘
                      │
              ┌───────▼──────────────────┐
              │   BIU Server (Python)    │
              │   FastAPI + WebSocket    │
              │                          │
              │  ┌─ Signal Quality ──┐   │
              │  ├─ Correlation ─────┤   │
              │  ├─ Bed Profiles ────┤   │
              │  ├─ Routing ─────────┤   │
              │  └─ Simulator ───────┘   │
              └───────┬──────────────────┘
                      │ WebSocket + REST
              ┌───────▼──────────────────────────┐
              │      Web Dashboard (React)       │
              │                                  │
              │  🏠 /          Animated Pitch    │
              │  👩‍⚕️ /nurse     Nurse Station     │
              │                (Admit/Discharge) │
              │  👨‍⚕️ /doctor    Doctor Console    │
              │  🔧 /tech      Bio-Med Station   │
              │  🕹️ /simulator Simulator Master  │
              └──────────────────────────────────┘
```

---

## 🔌 Wiring Diagram (Per Arduino)

```
Arduino Uno R3
┌──────────────────────────────────────────┐
│                                          │
│  A0 ─── KY-039 Heartbeat Sensor (SIG)   │
│  A1 ─── ECG Electrode Lead (Analog)     │
│                                          │
│  D2 ─── DS18B20 Data ─── 4.7kΩ ─── 5V  │
│                                          │
│  D8 ─── Buzzer (+)                       │
│  D9 ─── Red LED (220Ω → GND)            │
│  D10 ── Yellow LED (220Ω → GND)         │
│  D11 ── Green LED (220Ω → GND)          │
│  D12 ── ECG Lead-Off (INPUT_PULLUP)     │
│                                          │
│  5V ─── KY-039 VCC, DS18B20 VCC         │
│  GND ── KY-039 GND, DS18B20 GND,        │
│          Buzzer(-), LED GNDs             │
│                                          │
│  USB ── To PC (serial + power)           │
└──────────────────────────────────────────┘
```

### Component Connections

| Component | Pin | Wire Color Suggestion |
|-----------|-----|----------------------|
| KY-039 Signal | A0 | Yellow |
| KY-039 VCC | 5V | Red |
| KY-039 GND | GND | Black |
| ECG Electrode | A1 | White |
| ECG Lead-Off | D12 | Gray |
| DS18B20 Data | D2 | Blue |
| DS18B20 VCC | 5V | Red |
| DS18B20 GND | GND | Black |
| DS18B20 Pull-up | 4.7kΩ between D2 and 5V | — |
| Buzzer (+) | D8 | Orange |
| Buzzer (-) | GND | Black |
| Red LED (+) | D9 → 220Ω | Red |
| Yellow LED (+) | D10 → 220Ω | Yellow |
| Green LED (+) | D11 → 220Ω | Green |
| All LED (-) | GND | Black |

> ⚠️ **Safety**: Power the Arduino from USB. Never connect mains power while ECG electrodes are on a person. This is a research prototype with hobby-grade sensors, not a medical device.

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm
- **3× Arduino Uno R3** (optional — simulator mode works without hardware)
- Arduino IDE with `OneWire` and `DallasTemperature` libraries

### 1. Upload Arduino Firmware

Open each `.ino` file in the Arduino IDE:

```bash
firmware/cardiac_node/cardiac_node.ino      # → Arduino #1
firmware/kidney_node/kidney_node.ino        # → Arduino #2
firmware/respiratory_node/respiratory_node.ino  # → Arduino #3
```

Install required Arduino libraries:
- `OneWire` (by Jim Studt)
- `DallasTemperature` (by Miles Burton)

Upload each sketch to its respective Arduino.

### 2. Start the BIU Server

```bash
cd server
python3 -m pip install -r requirements.txt

# Simulator mode (no hardware needed):
python3 main.py --simulate

# Hardware mode:
python3 main.py --serial /dev/ttyUSB0,/dev/ttyUSB1,/dev/ttyUSB2

# Both:
python3 main.py --serial /dev/ttyUSB0,/dev/ttyUSB1,/dev/ttyUSB2 --simulate
```

Server runs at `http://localhost:8000`. API docs at `/docs`.

### 3. Start the Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard runs at `http://localhost:5173`.

---

## 🎮 Demo Scenarios

Use the Simulator Control Panel in the dashboard to trigger these:

| Scenario | What Happens |
|----------|-------------|
| **Motion Artifact** | Multiple sensors spike → grouped as one "possible motion disturbance" incident |
| **Lead Disconnect** | ECG lead off → asystole alarm grouped with lead-off, safety buzzer still fires |
| **True Desaturation** | Gradual SpO2 drop with stable signal → ranked top priority, NOT collapsed |
| **Tachycardia** | HR rises to critical levels |
| **Flatline** | No heartbeat → critical alarm with safety path |
| **Vent Disconnect** | Ventilator tube disconnected → SpO2 drops after delay |
| **Dialysis Blood Leak** | Blood leak detected → Tier 1 critical alarm |
| **Repeated SpO2** | SpO2 alarm repeats → Technician task created, Nurse alerts continue |
| **Multi-Bed Crisis** | All 3 beds deteriorate simultaneously |

---

## 🔒 Safety Rules

1. **CARE never mutes, hides, delays, or suppresses any alarm**
2. Buzzer + LEDs on Arduino = independent safety path (fires regardless of CARE)
3. Tier 1 alarms bypass AI — fixed rules only
4. Grouping is presentation only — every original alarm is visible and expandable
5. AI may add context labels and recipients — never remove them
6. If CARE goes down, native device alarms continue unchanged
7. Decision support only — the clinician decides

---

## 📁 Project Structure

```
CARE/
├── README.md
├── DOCS/
│   └── CARE_Idea.md              # Full project specification
├── firmware/
│   ├── unified_biu_node/
│   │   └── unified_biu_node.ino  # All-in-One Node (Single-Arduino Hybrid Mode)
│   ├── cardiac_node/
│   │   └── cardiac_node.ino      # Arduino #1 — Cardiac bed
│   ├── kidney_node/
│   │   └── kidney_node.ino       # Arduino #2 — Kidney/Dialysis
│   └── respiratory_node/
│       └── respiratory_node.ino  # Arduino #3 — Respiratory
├── server/
│   ├── main.py                   # FastAPI entry point
│   ├── models.py                 # Data structures
│   ├── serial_listener.py       # USB serial reader
│   ├── simulator.py             # Synthetic data generator
│   ├── signal_quality.py        # Artifact detection
│   ├── correlation.py           # Alarm grouping
│   ├── bed_profiles.py          # Profile rules & routing tables
│   ├── routing.py               # Role-based routing & escalation
│   ├── websocket_manager.py     # WebSocket handler
│   └── requirements.txt         # Python dependencies
└── dashboard/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx               # Main app with role tabs
        ├── index.css             # ICU dark theme design system
        ├── hooks/
        │   └── useWebSocket.js   # Real-time data hook
        ├── utils/
        │   ├── api.js            # REST API calls
        │   └── constants.js      # Display mappings
        ├── components/
        │   ├── BedCard.jsx       # Bed vitals + ECG waveform
        │   ├── IncidentCard.jsx  # Grouped alarm incident
        │   └── SimulatorPanel.jsx# Demo scenario controls
        └── views/
            ├── NurseDashboard.jsx
            ├── DoctorDashboard.jsx
            ├── TechnicianDashboard.jsx
            └── OverviewDashboard.jsx
```

---

## ⚖️ License

Research prototype. Not a medical device. Not for clinical use without proper validation and regulatory clearance.

*CARE: fewer interruptions, no lost real alarms, the right person alerted, and safe even if CARE itself fails.*
