# CARE: Clinical Action and Response Engine

**An AI-assisted, disease-aware alarm correlation and role-based escalation layer for ICUs. It never suppresses an alarm. It groups related alarms, explains them, and sends each one to the person who can act on it.**

Aligned to: Critical Care / ICU, Multidevice Alarm-Correlation System

---

## 1. The Problem (as it really looks in an ICU)

- The central bedside monitor usually gives one main beep for vitals. But the **other life-support machines beep on their own**: ventilator, dialysis/CRRT, infusion and feeding pumps.
- One real event (a cough, a moved arm, a loose probe) can trigger alarms on several machines at once.
- A nurse often looks after more than one critical patient, especially on night shifts, so every beep competes for the same pair of hands.
- Most alarms need no action. Staff learn to tune them out. This is **alarm fatigue**.
- Every alarm goes to whoever is nearby, even if that person cannot fix the cause (for example, a battery fault goes to a nurse instead of a technician).
- Hardware problems (bad probes, worn leads) are fixed late because nobody connects "this alarm keeps repeating" with "this sensor needs replacing".

## 2. The Idea in One Paragraph

CARE sits beside the existing devices and listens to their alarms and signals. It checks whether each signal is trustworthy, groups alarms that come from the same event, and explains the group with the original signals and timestamps. It knows the patient's **bed profile** (kidney, cardiac, respiratory, or a combination), so it knows which machine matters most for this patient. It routes each alert by **role** (Doctor, Nurse, Technician), escalates it if nobody responds, and sends repeated false alarms to a Technician as a hardware task. AI helps with classifying artifacts, learning correlations, spotting failing sensors and early warning. A fixed safety layer makes sure AI can never reduce safety.

## 3. The Safety Rules (Non-Negotiable)

> **AI proposes. A deterministic safety layer decides.**

1. **Overlay, not replacement.** Native device alarms always sound locally. CARE never delays, alters, or mutes them.
2. **No suppression, ever.** CARE and its AI can add recipients, raise urgency, add context labels, and create tasks. They can never mute, hide, delay, downgrade, or auto-dismiss any alarm. Only a human can dismiss an alarm, and every dismissal is logged.
3. **Grouping is presentation.** Every original alarm stays visible, expandable, and logged. A group takes the highest priority of its members.
4. **Tier 1 bypasses AI.** Critical events (cardiac arrest rhythms, ventilator disconnect, dialysis blood leak) go through fixed rules straight to the right people.
5. **Read-only.** CARE reads device data and alarm limits. It never changes device settings or controls any device.
6. **Fail-safe.** If CARE goes down, devices keep their native alarms and staff see a "CARE offline" notice.
7. **Decision support only.** The clinician decides.

**What AI may and may not do**

| AI may | AI may never |
|---|---|
| Group related alarms into one incident while keeping every member visible and expandable | Hide, mute, or delete an alarm |
| Add a label such as "possible motion artifact" next to the alarm | Mark an alarm as false and remove it from view |
| Add recipients or raise urgency | Remove default recipients or lower priority |
| Order alarms of the **same** priority by likelihood of needing action | Push an alarm below a lower-priority one or delay its delivery |
| Create a Technician task | Stop Nurse alerts because a Technician task exists |
| Suggest a cause with its evidence | Decide the cause or dismiss the alarm on its behalf |

If the AI is unsure, wrong, or offline, the staff simply see the original alarm, unchanged.

## 4. How It Works

```
Devices (monitor, ventilator, dialysis, pumps)
        │  adapters
        ▼
Bedside Integration Unit (BIU): collect, timestamp, sync clocks
        ▼
Signal Quality (AI): is this reading real?
        ▼
Correlation + Relationship (AI + rules): which alarms are one event?
        ▼
Bed Profile + Context: what matters most for THIS patient right now?
        ▼
Routing + Escalation: who acts, how urgently, what if no response?
        ▼
Role dashboards + tones + audit log

Parallel path:  Source alarm ──► native local alarm (always, untouched)
```

## 5. Fitting Into a Real ICU Day

Real hospitals are messy. CARE is designed around how they actually run.

| Real-life situation | What CARE does |
|---|---|
| **Admission** | Clinician picks a bed profile (or combination). The device on the bed is linked to the patient by scanning its barcode or QR code, so alarms are never attached to the wrong patient. |
| **Patient has more than one condition** (for example septic, ventilated, and in kidney failure) | Profiles combine. Tier 1 devices are the **union** of all active profiles. Rules never drop to the weaker profile. |
| **Planned procedures** (suctioning, repositioning, bathing, dialysis connection) | The nurse taps "planned activity". CARE adds context ("expected disturbance") and widens correlation. **Every alarm is still delivered.** Nothing is muted. |
| **Shift change** | Staff roster updates recipients automatically. A one-page handover shows incidents per bed, open Technician tasks, and alarms still unresolved. |
| **Nurse is busy or away** | Unacknowledged alerts escalate on a timer to the charge nurse, then the doctor. If a phone is offline, the next person is used. |
| **Patient moves bed or goes for a scan** | The device-to-patient link moves with the patient. During transport, alerts continue to the assigned team. |
| **Alarm limits** | CARE reads the limits clinicians set on each device and never changes them. An audit view highlights limits left at factory default or widened for a long time, as a suggestion to review. |
| **Power cut or network drop** | BIU and server run on the ICU's backup power (UPS). The BIU buffers data. Native alarms keep working throughout. |
| **Device is old or closed** | Falls back to a gateway or read-only export. If no data is available, the device simply stays on its native alarm only. |
| **Alarm committee review** | A monthly report shows noisiest beds, devices, and times of day, plus which sensors keep failing. This is evidence for quality and accreditation audits. |

## 6. Bed Profiles and Workflows

The profile sets which device is Tier 1, the correlation rules, and the routing. Profiles are **templates that clinicians configure**, not fixed rules.

### 6.1 Kidney Failure (CRRT / Dialysis Bed): Tier 1 = dialysis machine

| Trigger | Tone | Goes to | Rule |
|---|---|---|---|
| Dialysis blood leak or pressure drop | Critical, continuous high-pitch | Doctor + Nurse | Immediate, fixed rule |
| SpO2 below threshold | Medium priority | Nurse | Escalates to Doctor if unresolved after set time |
| SpO2 alarm repeats but vitals are stable | Low | Nurse | After N dismissals in T minutes, **add** a Technician task (probe check). Nurse alerts continue. |
| IV fluid pump empty | Low chime | Nurse | Routine task |

### 6.2 Cardiac (ECG / Infusion Bed): Tier 1 = ECG and cardiac infusions

| Trigger | Tone | Goes to | Rule |
|---|---|---|---|
| V-Fib / asystole | Critical | Bedside team + Doctor; code process per hospital protocol | Fixed rule. Code call follows the hospital's own protocol with confirmation, because these rhythms are also common artifacts. |
| Tachycardia | Medium | Nurse + Doctor | Escalates by severity |
| ECG lead-off / artifact | Low | Nurse | If repeated, **add** a Technician/assistant task (fresh leads) |
| BP cuff fails twice | Low | Nurse, then Technician | Hardware check |

### 6.3 Respiratory (Ventilator Bed): Tier 1 = ventilator

| Trigger | Tone | Goes to | Rule |
|---|---|---|---|
| Tube disconnect | Critical | Doctor + Respiratory Therapist + Nurse | Immediate, fixed rule |
| High airway pressure (cough) | Medium, short | Nurse | Always delivered. If it resolves in seconds it is tagged "resolved in X s" but stays visible. If it persists, escalate. |
| Ventilator battery or power warning | Medium | Technician (copy to Nurse) | Hardware path |
| SpO2 drops while ventilator values are normal | Low | Nurse, then Technician | Likely sensor issue, so suggest an alternate probe site |

All times, counts, and thresholds are **hospital-configurable parameters**. Numbers shown are examples, to be set with the clinical team.

## 7. Where AI Is Used

| Module | What AI does | Model (small, runs on-site) |
|---|---|---|
| **Signal quality** | Classifies artifact vs. real event from motion, pleth amplitude, ECG noise, lead-off | Gradient boosting or small 1D-CNN |
| **Correlation** | Learns which alarms usually come from one event, per bed profile, on top of time windows | Sequence clustering plus rules |
| **Relationship analysis** | Finds sequences ("airway pressure rose, then SpO2 fell") and scores link strength. Wording is "possible connection", never causal | Temporal pattern model |
| **Actionability score** | Predicts how likely an alarm is to need action, from history and staff feedback. Used only to order alarms **within the same priority level** and to show a context hint. Never hides, delays, or lowers any alarm | Logistic regression or small tree model |
| **Sensor health (Technician loop)** | Detects a degrading probe, lead, or battery before repeated alarms start. The fixed "N in T minutes" rule stays as a fallback | Anomaly detection on sensor-health trends |
| **Smart routing** | Learns response times and workload to suggest the best nurse to also notify. Adds recipients, never removes the default ones. Escalation time has a hard cap | Simple ranking model |
| **Early warning** | Profile-specific risk: fluid overload / AKI (kidney), arrhythmia (cardiac), ventilator asynchrony (respiratory). Shows "abstain" when data quality is poor | Calibrated models |
| **Explainability** | Shows which signals drove each decision. A language model may write a plain-English incident summary and shift handover from structured data only, and never makes decisions | Feature attribution plus constrained summary |
| **Feedback loop** | "Useful / noise" buttons retrain per unit, tested first in shadow mode | Periodic retraining with clinician review |

**Honesty rule:** Tier 1 safety logic is rules, not AI. We state clearly which parts are AI and which are rules.

## 8. Roles, Dashboards, and Delivery

| Role | Sees |
|---|---|
| **Doctor** | Critical and Tier 1 events, escalated alerts, deterioration risk with explanation |
| **Nurse** | Bed grid ranked by priority, grouped incidents, care tasks, acknowledge button |
| **Technician** | Failing sensors, battery warnings, repeated false-alarm tasks, work-order status |
| **Charge nurse / ICU head** | Unit overview, unacknowledged alerts, alarm statistics, shift handover |

Every incident card shows the original alarms, raw signal snippet, timestamps from each source, why they were grouped, signal-quality status, and an "N alarms → 1 incident" counter. Every acknowledgment is logged.

**Delivery channels (layered, because hospital reality varies):**

1. **Bedside:** native device alarms (always) plus a CARE status light or screen.
2. **Nurse station:** central screen with the bed grid.
3. **Phone or tablet web app:** push notifications, works in a browser with no install.
4. **Fallback for critical, unacknowledged alerts:** SMS or automated call, and integration with the hospital's existing nurse-call or paging system where present.

**Sounds:** tones map to the standard alarm priority categories (high, medium, low, per IEC 60601-1-8). Role and source cues are used sparingly, mainly on phones, so the bedside does not become noisier or more confusing.

## 9. Escalation Loop

1. Alert routed to the right role.
2. Acknowledgment required.
3. If unacknowledged within a configurable time (shorter for higher severity): Nurse → Charge Nurse → Doctor.
4. If a recipient's device is offline, fall back to the next person.
5. Assignment comes from the hospital roster or ADT feed.
6. Escalation time can be shortened by AI but never lengthened beyond the hospital's cap.

## 10. Infrastructure (Light by Design)

| Part | What | Where |
|---|---|---|
| **BIU** (Bedside Integration Unit) | Small wired box (Raspberry Pi or mini PC) that collects alarms and signals, timestamps them, and buffers if the network drops | One per bed or per few beds |
| **CARE Server** | One on-prem server running everything in Docker Compose: message broker, correlation, AI models, database, dashboards | One per ICU (second server optional for backup) |
| **Apps** | Web app for phones, tablets, and nurse-station screens | Any browser |

**Stack (all open source):** Docker Compose · MQTT broker · Python FastAPI services · PostgreSQL + TimescaleDB · ONNX Runtime for models · React web app · NTP/chrony for time sync.

**Real-world choices:**
- Wired BIU on a separate device network (VLAN), not on ICU Wi-Fi. Only the phone app uses Wi-Fi.
- All data stays inside the hospital. No cloud is required.
- BIU and server on UPS / backup power.

**Start small, scale later**

| Stage | Setup |
|---|---|
| Pilot | 1 ICU, 1 server, BIUs for a few beds |
| Hospital | Backup server, more units (ICU, HDU, ER) |
| Network | Optional multi-hospital reporting and model sharing, with no raw patient data leaving a site |

**Degraded-mode ladder (what happens when things fail)**

| Level | Condition | What staff get |
|---|---|---|
| 1. Full | Everything working | Grouping, AI labels, routing, dashboards |
| 2. Rules only | AI models unavailable | Fixed grouping, routing, and escalation rules |
| 3. Basic routing | Correlation unavailable | Alarms forwarded to the right role, ungrouped |
| 4. Pass-through | CARE down | Native device alarms only, plus a "CARE offline" notice |

At every level the original alarms remain intact. Each step down removes a convenience, never a safety function.

## 11. Plug-and-Play Integration

CARE connects to what hospitals already have through adapters. Each device or system has a small adapter that converts its data to one common format.

| Level | Connects via | Examples |
|---|---|---|
| **1. Standard** | HL7 v2, FHIR, IEEE 11073 / IHE PCD | Modern monitors, EMR, lab systems |
| **2. Gateway** | Vendor gateway or serial/network output | Ventilators, dialysis, pumps |
| **3. Fallback** | Read-only database or CSV export | Older systems |

Compatibility is stated honestly: standards-capable devices plus adapter-supported devices, not "every device". Some vendors require licensed gateways or agreements, and a mixed fleet of brands is normal in real hospitals.

**Quick setup flow (target, to be measured in the pilot):**

1. Plug in the BIU and connect it to the device network.
2. **Auto-discovery** lists devices and proposes field mappings (AI-assisted mapping helper).
3. Scan the device barcode to link it to the bed.
4. Pick a **bed profile** template and adjust thresholds with the clinical team.
5. Link the staff roster or ADT feed.
6. Run **shadow mode**: CARE records and analyzes but alerts no one.
7. Compare with real events, then go live.

## 12. Rolling It Out in a Real Hospital

Technology alone does not fix alarm fatigue. People and process matter.

| Step | What happens |
|---|---|
| **Involve stakeholders early** | ICU doctors, nurses, biomedical engineering, IT, and infection control agree on profiles, limits, and escalation timings |
| **Alarm committee** | A small group owns thresholds and reviews monthly reports |
| **Shadow mode first** | Weeks of silent running to check grouping accuracy and catch any missed critical alarm before anyone depends on CARE |
| **Training** | Short, role-based sessions; one-page quick guides; nurses test the "planned activity" and acknowledge flows |
| **Supervised go-live** | One unit, with clinicians watching and a quick path to switch to pass-through |
| **Downtime procedure** | Written steps for what staff do if CARE is offline (they continue with native alarms) |
| **Keep measuring** | Alarms per bed per hour, response time, Technician task closure |

## 13. Prototype and Demo

**Hardware (about 6 parts):** Raspberry Pi (BIU) · ESP32 ×2 as independent "devices" with their own clocks and thresholds · MAX30102 (SpO2/pulse) · AD8232 + electrodes (ECG, lead-off) · MPU6050 (motion) · buzzer + LEDs as the independent safety path. A software emulator of a dialysis machine or ventilator lets us demo all three bed profiles.

**Demo scenarios:**

1. **Motion artifact:** shake the finger sensor. Several alarms appear, CARE shows **one** "possible motion disturbance" incident with the motion trace. Tap to expand and see every original alarm. The native alarm path still fires.
2. **Lead-off:** pull an electrode. The asystole alarm is grouped as probable lead-off, but the independent safety path still fires.
3. **True event:** simulate a desaturation with a stable signal. CARE ranks it top priority and does not collapse it.
4. **Technician loop:** repeat false SpO2 alarms until a Technician task is created while Nurse alerts continue.
5. **Planned activity:** tap "planned activity", trigger a disturbance, and show that all alarms are still delivered with extra context.
6. **Role views:** show Doctor, Nurse, and Technician dashboards on three phones for the same incident.
7. **Failure test:** switch off the CARE server and show that the native alarm path continues.

The prototype sensors are hobby-grade, so it is labelled a research prototype. Power the ECG node from a battery, never from a mains-connected computer while electrodes are on a person.

## 14. Validation and Metrics

**Data:** PhysioNet 2015 false-alarm challenge, MIMIC-IV, eICU (retrospective replay). Then shadow mode in a real ICU.

| Metric | Goal |
|---|---|
| Notification burden (raw alarms vs. grouped incidents shown) | Fewer interruptions, measured on replay |
| Share of non-actionable alarms correctly labelled | Measured on replay (labelled only, never hidden) |
| **Alarms hidden, muted, delayed, or downgraded by CARE** | **0**, checked by automated test |
| Artifact detection precision and recall | Measured, rules-only vs. rules + AI |
| Grouping latency | Under 2 seconds for critical alerts |
| Time to acknowledge and respond | Faster than baseline |
| Technician task closure time | Measured in pilot |
| Staff feedback (useful vs. noise) | Improves over time |

Key chart: **rules-only vs. rules + AI** on the same data.

## 15. Patent Focus

A **disease-contextual temporal correlation and role-based escalation mechanism** in which:

1. Alarms from independent devices are grouped using offset-corrected timestamps and signal patterns.
2. Grouping preserves each source's thresholds and priority (the group inherits the highest priority).
3. An independent safety notification path fires on source alarms regardless of grouping.
4. The bed profile (single or combined) sets device tiers, routing, and escalation.
5. A signal-quality and sensor-health score creates Technician tasks without reducing Nurse alerts.
6. AI operates only inside a safety invariant: it may add or raise, never suppress.

Notes: alarm grouping and alarm middleware already exist in prior art, so the claim rests on the **combination**, especially items 2 to 6. Tie the claim to the bedside hardware unit and its technical effect, since software alone faces Section 3(k) in India. A patent attorney must run a prior-art search before filing.

## 16. Standards, Regulation, and Privacy

- Likely software as a medical device: CDSCO in India.
- IEC 60601-1-8 (alarm systems), IEC 62304 (software lifecycle), ISO 14971 (risk management). Keep a hazard log from day one.
- Until cleared, CARE runs in research or shadow mode.
- Security: encrypted connections, role-based access, tamper-evident audit log, separate device network, regular backups.
- Privacy: data stays on site, minimum data collected, consent and purpose limits under India's DPDP Act 2023. ABDM/ABHA identifiers supported where the hospital uses them.

## 17. Cost and Value

- **Low capex:** a small BIU per bed (or per few beds) and one server per ICU. No replacement of existing monitors, ventilators, or pumps.
- **Value to hospitals:** fewer interruptions for nurses, faster response, faster hardware fixes, and audit-ready alarm reports.
- **Model:** subscription plus integration and training services. Real costs (integration work, validation, support, compliance) are priced in.

## 18. Limitations

- Closed devices may need vendor gateways or agreements.
- Prototype sensors are not clinical grade, so clinical claims need validation on real data.
- AI performance varies by hospital, so local recalibration and shadow mode come before go-live.
- Grouping labels such as "possible motion" are hints, and the raw alarms always remain visible.
- Correlation depends on synchronized clocks, so time sync is required.
- Benefits depend on staff adoption, training, and sensible thresholds set by the hospital.

## 19. Roadmap

1. **Prototype:** BIU, two devices plus emulator, signal quality, correlation, three bed profiles, role dashboards, replay metrics.
2. **Pilot:** real device adapters, shadow mode in one ICU, threshold tuning with clinicians, training.
3. **Scale:** more bed profiles and units, backup server, regulatory track, optional multi-hospital learning.

---

*CARE: fewer interruptions, no lost real alarms, the right person alerted, and safe even if CARE itself fails.*
