/*
 * CARE — Clinical Action and Response Engine
 * Firmware: Unified Bedside Interface Unit (BIU)
 * 
 * SINGLE ARDUINO — ALL 4 SENSORS
 * ══════════════════════════════════════════════════
 * This firmware reads ALL sensors from a single Arduino Uno,
 * multiplexing their data into a unified JSON telemetry packet
 * every 100ms over USB Serial at 115200 baud.
 *
 * Hardware Pin Map:
 *   A0 — KY-039 Heartbeat/Pulse Sensor (analog)
 *   A1 — ECG Electrode (raw analog, no AD8232)
 *   A2 — Optical Pulse Oximetry (red LED + LDR phototransistor)
 *   D2 — DS18B20 Temperature Probe (OneWire, 4.7kΩ pull-up)
 *   D8 — Active Buzzer (HIGH = ON)
 *   D9 — Red LED (critical alarm indicator)
 *   D10 — Yellow LED (medium alarm indicator)
 *   D11 — Green LED (normal / system OK)
 *   D12 — ECG Lead-off Detection (INPUT_PULLUP, LOW = connected)
 *
 * Wiring Notes:
 *   • KY-039 (A0): Signal pin → A0, VCC → 5V, GND → GND
 *   • ECG (A1): Electrode pair with voltage divider to A1
 *   • SpO2/Optical (A2): Red LED anode → D7 via 220Ω, 
 *     LDR/phototransistor collector → A2, emitter → GND
 *   • DS18B20 (D2): Data → D2 with 4.7kΩ pull-up to VCC
 *   • Lead-off (D12): Wire to ECG ground reference, 
 *     INPUT_PULLUP: LOW = electrode on, HIGH = electrode off
 *
 * JSON Output Format:
 *   {"node":1,"ts":12345,"profile":"unified",
 *    "hr":78,"hr_raw":612,"ecg":384,"ecg_quality":96,
 *    "spo2":97,"spo2_raw":520,"temp":37.1,
 *    "lead_off":false,"alarm_flags":0,"priority":0,
 *    "alarms":[]}
 *
 * SAFETY INVARIANT:
 *   The buzzer and LEDs fire LOCALLY on this Arduino for any
 *   critical alarm. The CARE server software can NEVER suppress
 *   or delay these hardware safety outputs. If the server
 *   crashes, Wi-Fi drops, or the host OS freezes, the bedside
 *   buzzer still sounds immediately.
 */

#include <OneWire.h>
#include <DallasTemperature.h>

// ─── Pin Definitions ───────────────────────────────────────────────
// Analog Inputs (Sensor Channels)
#define PIN_HEARTBEAT    A0    // KY-039 heartbeat analog
#define PIN_ECG_ANALOG   A1    // ECG raw analog electrode
#define PIN_SPO2_ANALOG  A2    // Optical pulse oximetry analog

// Digital Pins
#define PIN_TEMP_DATA    2     // DS18B20 OneWire data
#define PIN_SPO2_LED     7     // Red LED emitter for SpO2 (drive HIGH to illuminate)
#define PIN_BUZZER       8     // Active piezo buzzer
#define PIN_LED_RED      9     // Critical alarm LED
#define PIN_LED_YELLOW   10    // Medium alarm LED
#define PIN_LED_GREEN    11    // Normal indicator LED
#define PIN_LEAD_OFF     12    // ECG lead-off detect (INPUT_PULLUP)

// ─── Node Identity ─────────────────────────────────────────────────
#define NODE_ID          1
#define PROFILE          "unified"

// ─── Alarm Thresholds ──────────────────────────────────────────────
// Heart Rate
#define HR_CRITICAL_HIGH   150   // BPM — V-Tach territory
#define HR_HIGH            120   // BPM — Tachycardia
#define HR_LOW             50    // BPM — Bradycardia
#define HR_CRITICAL_LOW    40    // BPM — Severe bradycardia
#define HR_FLATLINE_MS     5000  // ms without a beat → flatline alert

// Temperature
#define TEMP_HIGH          38.5  // °C — Fever
#define TEMP_CRITICAL      40.0  // °C — Hyperthermia
#define TEMP_LOW           35.0  // °C — Hypothermia
#define TEMP_CRITICAL_LOW  34.0  // °C — Severe hypothermia

// SpO2
#define SPO2_LOW           90    // % — Mild hypoxemia
#define SPO2_CRITICAL      85    // % — Critical desaturation

// ECG Signal Quality
#define ECG_NOISE_CEIL     800   // ADC value indicating saturation/noise
#define ECG_NOISE_FLOOR    50    // Below this = possible lead issue

// ─── Timing ────────────────────────────────────────────────────────
#define SERIAL_INTERVAL_MS     100    // Telemetry every 100ms (10 Hz)
#define TEMP_READ_INTERVAL_MS  1000   // DS18B20 conversion ~750ms
#define BUZZER_BEEP_MS         150
#define BUZZER_PAUSE_MS        100
#define LED_BLINK_INTERVAL_MS  500

// ─── Heart Rate Detection ──────────────────────────────────────────
#define HR_SAMPLE_WINDOW       10     // Beats to average
#define HR_PEAK_THRESHOLD      550    // ADC peak detect threshold
#define HR_MIN_PEAK_INTERVAL   300    // Min ms between peaks (200 BPM cap)
#define HR_MAX_PEAK_INTERVAL   2000   // Max ms between peaks (30 BPM floor)

// ─── SpO2 Estimation ──────────────────────────────────────────────
#define SPO2_SAMPLE_COUNT      20     // Samples per SpO2 measurement cycle
#define SPO2_BASELINE_ALPHA    0.02   // EMA smoothing for baseline

// ─── Temperature Sensor ────────────────────────────────────────────
OneWire oneWire(PIN_TEMP_DATA);
DallasTemperature tempSensor(&oneWire);

// ─── State Variables ───────────────────────────────────────────────

// -- Heart Rate --
unsigned long beatTimestamps[HR_SAMPLE_WINDOW];
int beatIndex = 0;
int beatCount = 0;
unsigned long lastPeakTime = 0;
bool wasBelowThreshold = true;
int currentHR = 0;
int rawHeartbeat = 0;

// -- ECG --
int rawECG = 0;
bool leadOff = false;
int ecgQuality = 100;

// -- SpO2 / Optical --
int rawSpO2 = 0;
int estimatedSpO2 = 98;          // Estimated SpO2 percentage
float spo2Baseline = 512.0;      // EMA baseline for AC/DC ratio
int spo2SampleBuf[SPO2_SAMPLE_COUNT];
int spo2SampleIdx = 0;

// -- Temperature --
float currentTemp = 0.0;
unsigned long lastTempRead = 0;
bool tempReady = false;

// ─── Alarm Bitfield ────────────────────────────────────────────────
#define ALARM_NONE           0x0000
#define ALARM_HR_CRIT_HIGH   0x0001
#define ALARM_HR_HIGH        0x0002
#define ALARM_HR_LOW         0x0004
#define ALARM_HR_CRIT_LOW    0x0008
#define ALARM_FLATLINE       0x0010
#define ALARM_TEMP_HIGH      0x0020
#define ALARM_TEMP_CRITICAL  0x0040
#define ALARM_TEMP_LOW       0x0080
#define ALARM_TEMP_CRIT_LOW  0x0100
#define ALARM_LEAD_OFF       0x0200
#define ALARM_ECG_NOISE      0x0400
#define ALARM_SPO2_LOW       0x0800
#define ALARM_SPO2_CRITICAL  0x1000

uint16_t activeAlarms = ALARM_NONE;
uint16_t prevAlarms = ALARM_NONE;

// ─── Timing State ──────────────────────────────────────────────────
unsigned long lastSerialSend = 0;
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false;
int buzzerBeepCount = 0;
int alarmPriority = 0;   // 0=none, 1=low, 2=medium, 3=critical


// ════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }

  // Analog inputs
  pinMode(PIN_HEARTBEAT, INPUT);
  pinMode(PIN_ECG_ANALOG, INPUT);
  pinMode(PIN_SPO2_ANALOG, INPUT);

  // Digital inputs
  pinMode(PIN_LEAD_OFF, INPUT_PULLUP);

  // Digital outputs
  pinMode(PIN_SPO2_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);

  // Initialize outputs
  digitalWrite(PIN_SPO2_LED, HIGH);   // Keep SpO2 red LED always on
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
  digitalWrite(PIN_LED_GREEN, HIGH);  // Green = system OK

  // DS18B20 temperature sensor
  tempSensor.begin();
  tempSensor.setResolution(12);
  tempSensor.setWaitForConversion(false);

  // Init arrays
  for (int i = 0; i < HR_SAMPLE_WINDOW; i++) {
    beatTimestamps[i] = 0;
  }
  for (int i = 0; i < SPO2_SAMPLE_COUNT; i++) {
    spo2SampleBuf[i] = 0;
  }

  // Kick off first temp conversion
  tempSensor.requestTemperatures();
  lastTempRead = millis();

  // Boot announcement
  Serial.println("{\"event\":\"boot\",\"node\":" + String(NODE_ID) +
                 ",\"profile\":\"" + String(PROFILE) +
                 "\",\"sensors\":[\"ky039\",\"ecg\",\"spo2\",\"ds18b20\"]"
                 ",\"pins\":{\"hr\":\"A0\",\"ecg\":\"A1\",\"spo2\":\"A2\",\"temp\":\"D2\"}}");
}


// ════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  // ── Read ALL 4 Sensors ─────────────────────────────────────────
  readHeartbeat(now);
  readECG();
  readSpO2();
  readTemperature(now);

  // ── Evaluate Alarms ────────────────────────────────────────────
  evaluateAlarms(now);

  // ── Drive Local Safety Path ────────────────────────────────────
  driveSafetyOutputs(now);

  // ── Send Unified Telemetry Packet ──────────────────────────────
  if (now - lastSerialSend >= SERIAL_INTERVAL_MS) {
    sendSerialData(now);
    lastSerialSend = now;
  }
}


// ════════════════════════════════════════════════════════════════════
// SENSOR READING — KY-039 Heartbeat
// ════════════════════════════════════════════════════════════════════
void readHeartbeat(unsigned long now) {
  rawHeartbeat = analogRead(PIN_HEARTBEAT);

  // Peak detection
  if (rawHeartbeat > HR_PEAK_THRESHOLD && wasBelowThreshold) {
    unsigned long interval = now - lastPeakTime;

    if (interval > HR_MIN_PEAK_INTERVAL) {
      wasBelowThreshold = false;
      lastPeakTime = now;

      beatTimestamps[beatIndex] = now;
      beatIndex = (beatIndex + 1) % HR_SAMPLE_WINDOW;
      if (beatCount < HR_SAMPLE_WINDOW) beatCount++;

      if (beatCount >= 2) {
        int oldest = (beatIndex - beatCount + HR_SAMPLE_WINDOW) % HR_SAMPLE_WINDOW;
        int newest = (beatIndex - 1 + HR_SAMPLE_WINDOW) % HR_SAMPLE_WINDOW;
        unsigned long totalInterval = beatTimestamps[newest] - beatTimestamps[oldest];
        if (totalInterval > 0 && beatCount > 1) {
          float avgInterval = (float)totalInterval / (float)(beatCount - 1);
          currentHR = (int)(60000.0 / avgInterval);
          if (currentHR < 0) currentHR = 0;
          if (currentHR > 300) currentHR = 300;
        }
      }
    }
  }

  if (rawHeartbeat < HR_PEAK_THRESHOLD - 50) {
    wasBelowThreshold = true;
  }
}


// ════════════════════════════════════════════════════════════════════
// SENSOR READING — ECG Electrode
// ════════════════════════════════════════════════════════════════════
void readECG() {
  rawECG = analogRead(PIN_ECG_ANALOG);

  // Lead-off detection
  leadOff = (digitalRead(PIN_LEAD_OFF) == HIGH);

  // Signal quality index (SQI)
  if (leadOff) {
    ecgQuality = 0;
  } else if (rawECG > ECG_NOISE_CEIL || rawECG < ECG_NOISE_FLOOR) {
    ecgQuality = max(0, ecgQuality - 5);
  } else {
    ecgQuality = min(100, ecgQuality + 2);
  }
}


// ════════════════════════════════════════════════════════════════════
// SENSOR READING — Optical SpO2 (Red LED + Phototransistor)
// ════════════════════════════════════════════════════════════════════
void readSpO2() {
  rawSpO2 = analogRead(PIN_SPO2_ANALOG);

  // Store in circular buffer for AC component extraction
  spo2SampleBuf[spo2SampleIdx] = rawSpO2;
  spo2SampleIdx = (spo2SampleIdx + 1) % SPO2_SAMPLE_COUNT;

  // Update baseline (DC component) via exponential moving average
  spo2Baseline = spo2Baseline * (1.0 - SPO2_BASELINE_ALPHA) + rawSpO2 * SPO2_BASELINE_ALPHA;

  // Estimate AC component (peak-to-peak in buffer)
  int minVal = 1023, maxVal = 0;
  for (int i = 0; i < SPO2_SAMPLE_COUNT; i++) {
    if (spo2SampleBuf[i] < minVal) minVal = spo2SampleBuf[i];
    if (spo2SampleBuf[i] > maxVal) maxVal = spo2SampleBuf[i];
  }

  int acComponent = maxVal - minVal;
  float dcComponent = spo2Baseline;

  // Simplified R ratio → SpO2 mapping
  // In a real device you'd use dual wavelength (red + IR)
  // This approximation works for demonstration with single LED
  if (dcComponent > 50 && acComponent > 5) {
    float ratio = (float)acComponent / dcComponent;
    // Empirical linear mapping: SpO2 ≈ 110 - 25 * R
    // Clamped to [60, 100] range
    int spo2Raw = (int)(110.0 - 25.0 * ratio);
    if (spo2Raw > 100) spo2Raw = 100;
    if (spo2Raw < 60) spo2Raw = 60;

    // Smooth with previous reading
    estimatedSpO2 = (estimatedSpO2 * 3 + spo2Raw) / 4;
  }
}


// ════════════════════════════════════════════════════════════════════
// SENSOR READING — DS18B20 Temperature
// ════════════════════════════════════════════════════════════════════
void readTemperature(unsigned long now) {
  if (now - lastTempRead >= TEMP_READ_INTERVAL_MS) {
    if (tempSensor.isConversionComplete()) {
      float reading = tempSensor.getTempCByIndex(0);
      if (reading != -127.0 && reading != 85.0) {
        currentTemp = reading;
        tempReady = true;
      }
      tempSensor.requestTemperatures();
      lastTempRead = now;
    }
  }
}


// ════════════════════════════════════════════════════════════════════
// ALARM EVALUATION — All Sensors Combined
// ════════════════════════════════════════════════════════════════════
void evaluateAlarms(unsigned long now) {
  prevAlarms = activeAlarms;
  activeAlarms = ALARM_NONE;
  alarmPriority = 0;

  // ── Heart Rate ─────────────────────────────────────────────────
  if (beatCount > 0 && (now - lastPeakTime > HR_FLATLINE_MS)) {
    activeAlarms |= ALARM_FLATLINE;
    alarmPriority = 3;
  }

  if (currentHR > 0) {
    if (currentHR >= HR_CRITICAL_HIGH) {
      activeAlarms |= ALARM_HR_CRIT_HIGH;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentHR >= HR_HIGH) {
      activeAlarms |= ALARM_HR_HIGH;
      alarmPriority = max(alarmPriority, 2);
    }

    if (currentHR <= HR_CRITICAL_LOW) {
      activeAlarms |= ALARM_HR_CRIT_LOW;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentHR <= HR_LOW) {
      activeAlarms |= ALARM_HR_LOW;
      alarmPriority = max(alarmPriority, 2);
    }
  }

  // ── Temperature ────────────────────────────────────────────────
  if (tempReady) {
    if (currentTemp >= TEMP_CRITICAL) {
      activeAlarms |= ALARM_TEMP_CRITICAL;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentTemp >= TEMP_HIGH) {
      activeAlarms |= ALARM_TEMP_HIGH;
      alarmPriority = max(alarmPriority, 1);
    }

    if (currentTemp <= TEMP_CRITICAL_LOW) {
      activeAlarms |= ALARM_TEMP_CRIT_LOW;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentTemp <= TEMP_LOW) {
      activeAlarms |= ALARM_TEMP_LOW;
      alarmPriority = max(alarmPriority, 1);
    }
  }

  // ── SpO2 ───────────────────────────────────────────────────────
  if (estimatedSpO2 <= SPO2_CRITICAL) {
    activeAlarms |= ALARM_SPO2_CRITICAL;
    alarmPriority = max(alarmPriority, 3);
  } else if (estimatedSpO2 <= SPO2_LOW) {
    activeAlarms |= ALARM_SPO2_LOW;
    alarmPriority = max(alarmPriority, 2);
  }

  // ── ECG Lead-Off ───────────────────────────────────────────────
  if (leadOff) {
    activeAlarms |= ALARM_LEAD_OFF;
    alarmPriority = max(alarmPriority, 2);
  }

  // ── ECG Noise ──────────────────────────────────────────────────
  if (ecgQuality < 30 && !leadOff) {
    activeAlarms |= ALARM_ECG_NOISE;
    alarmPriority = max(alarmPriority, 1);
  }
}


// ════════════════════════════════════════════════════════════════════
// LOCAL SAFETY PATH — Buzzer + LEDs (NEVER suppressed by software!)
// ════════════════════════════════════════════════════════════════════
void driveSafetyOutputs(unsigned long now) {
  // ── LEDs ────────────────────────────────────────────────────────
  if (alarmPriority == 3) {
    digitalWrite(PIN_LED_RED, HIGH);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_GREEN, LOW);
  } else if (alarmPriority == 2) {
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_LED_YELLOW, HIGH);
    digitalWrite(PIN_LED_GREEN, LOW);
  } else if (alarmPriority == 1) {
    digitalWrite(PIN_LED_RED, LOW);
    if ((now / LED_BLINK_INTERVAL_MS) % 2 == 0) {
      digitalWrite(PIN_LED_YELLOW, HIGH);
      digitalWrite(PIN_LED_GREEN, LOW);
    } else {
      digitalWrite(PIN_LED_YELLOW, LOW);
      digitalWrite(PIN_LED_GREEN, HIGH);
    }
  } else {
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_GREEN, HIGH);
  }

  // ── Buzzer ─────────────────────────────────────────────────────
  if (alarmPriority == 3) {
    digitalWrite(PIN_BUZZER, HIGH);  // Continuous tone
  } else if (alarmPriority == 2) {
    // 3-beep pattern
    if (now - lastBuzzerToggle >= (buzzerState ? BUZZER_BEEP_MS : BUZZER_PAUSE_MS)) {
      buzzerState = !buzzerState;
      lastBuzzerToggle = now;
      if (buzzerState) {
        buzzerBeepCount++;
        if (buzzerBeepCount > 3) {
          buzzerBeepCount = 0;
          buzzerState = false;
          lastBuzzerToggle = now + 500;
        }
      }
      digitalWrite(PIN_BUZZER, buzzerState ? HIGH : LOW);
    }
  } else if (alarmPriority == 1) {
    // Single short beep every 2s
    if (now - lastBuzzerToggle >= 2000) {
      digitalWrite(PIN_BUZZER, HIGH);
      delay(50);
      digitalWrite(PIN_BUZZER, LOW);
      lastBuzzerToggle = now;
    }
  } else {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerBeepCount = 0;
  }
}


// ════════════════════════════════════════════════════════════════════
// SERIAL OUTPUT — Unified JSON Telemetry to BIU Server
// ════════════════════════════════════════════════════════════════════
void sendSerialData(unsigned long now) {
  // Build compact JSON manually (no ArduinoJson dependency)
  Serial.print("{\"node\":");
  Serial.print(NODE_ID);
  Serial.print(",\"ts\":");
  Serial.print(now);
  Serial.print(",\"profile\":\"");
  Serial.print(PROFILE);

  // Heart rate
  Serial.print("\",\"hr\":");
  Serial.print(currentHR);
  Serial.print(",\"hr_raw\":");
  Serial.print(rawHeartbeat);

  // ECG
  Serial.print(",\"ecg\":");
  Serial.print(rawECG);
  Serial.print(",\"ecg_quality\":");
  Serial.print(ecgQuality);

  // SpO2
  Serial.print(",\"spo2\":");
  Serial.print(estimatedSpO2);
  Serial.print(",\"spo2_raw\":");
  Serial.print(rawSpO2);

  // Temperature
  Serial.print(",\"temp\":");
  Serial.print(currentTemp, 1);

  // Lead-off
  Serial.print(",\"lead_off\":");
  Serial.print(leadOff ? "true" : "false");

  // Alarm state
  Serial.print(",\"alarm_flags\":");
  Serial.print(activeAlarms);
  Serial.print(",\"priority\":");
  Serial.print(alarmPriority);

  // Alarm names array
  Serial.print(",\"alarms\":[");
  bool first = true;
  if (activeAlarms & ALARM_HR_CRIT_HIGH)  { emitAlarmName("HR_CRITICAL_HIGH", first); }
  if (activeAlarms & ALARM_HR_HIGH)       { emitAlarmName("HR_HIGH", first); }
  if (activeAlarms & ALARM_HR_LOW)        { emitAlarmName("HR_LOW", first); }
  if (activeAlarms & ALARM_HR_CRIT_LOW)   { emitAlarmName("HR_CRITICAL_LOW", first); }
  if (activeAlarms & ALARM_FLATLINE)      { emitAlarmName("FLATLINE", first); }
  if (activeAlarms & ALARM_TEMP_HIGH)     { emitAlarmName("TEMP_HIGH", first); }
  if (activeAlarms & ALARM_TEMP_CRITICAL) { emitAlarmName("TEMP_CRITICAL", first); }
  if (activeAlarms & ALARM_TEMP_LOW)      { emitAlarmName("TEMP_LOW", first); }
  if (activeAlarms & ALARM_TEMP_CRIT_LOW) { emitAlarmName("TEMP_CRITICAL_LOW", first); }
  if (activeAlarms & ALARM_LEAD_OFF)      { emitAlarmName("LEAD_OFF", first); }
  if (activeAlarms & ALARM_ECG_NOISE)     { emitAlarmName("ECG_NOISE", first); }
  if (activeAlarms & ALARM_SPO2_LOW)      { emitAlarmName("SPO2_LOW", first); }
  if (activeAlarms & ALARM_SPO2_CRITICAL) { emitAlarmName("SPO2_CRITICAL", first); }
  Serial.print("]");

  Serial.println("}");
}

void emitAlarmName(const char* name, bool &first) {
  if (!first) Serial.print(",");
  Serial.print("\"");
  Serial.print(name);
  Serial.print("\"");
  first = false;
}
