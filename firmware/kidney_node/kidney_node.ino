/*
 * CARE — Clinical Action and Response Engine
 * Firmware: Kidney / Dialysis Bed Node (Bed 2)
 * 
 * Tier 1 Device: Dialysis machine (simulated via software)
 * Profile: Kidney — fluid balance, dialysis pressure, AKI early warning
 *
 * Hardware: Same as Cardiac node, different thresholds.
 * Since we don't have a real dialysis machine, the server's simulator
 * generates dialysis-specific data. This Arduino focuses on SpO2/pulse
 * (via KY-039), temperature, and ECG as secondary monitoring.
 *
 * Pins:
 *   A0  — KY-039 heartbeat sensor (proxy for SpO2 trends)
 *   A1  — ECG electrode (raw analog)
 *   D2  — DS18B20 temperature probe
 *   D8  — Buzzer
 *   D9  — Red LED (critical)
 *   D10 — Yellow LED (medium)
 *   D11 — Green LED (normal)
 *   D12 — ECG lead-off detection
 *
 * Serial: 115200 baud, JSON packets every 100ms
 */

#include <OneWire.h>
#include <DallasTemperature.h>

// ─── Pin Definitions ───────────────────────────────────────────────
#define PIN_HEARTBEAT   A0
#define PIN_ECG_ANALOG  A1
#define PIN_TEMP_DATA   2
#define PIN_BUZZER      8
#define PIN_LED_RED     9
#define PIN_LED_YELLOW  10
#define PIN_LED_GREEN   11
#define PIN_LEAD_OFF    12

// ─── Node Identity ─────────────────────────────────────────────────
#define NODE_ID         2
#define PROFILE         "kidney"

// ─── Alarm Thresholds (Kidney Profile) ─────────────────────────────
// In kidney profile, temperature is MORE critical (infection risk)
// and HR thresholds are slightly more sensitive (fluid overload)
#define HR_CRITICAL_HIGH  140   // Lower threshold — fluid overload risk
#define HR_HIGH           110   // Tachycardia during dialysis
#define HR_LOW            55    // Slightly more tolerant
#define HR_CRITICAL_LOW   40    // Same critical low
#define HR_FLATLINE_MS    5000

// Temperature — tighter bounds for infection/sepsis monitoring
#define TEMP_HIGH         38.0  // Lower fever threshold (infection concern)
#define TEMP_CRITICAL     39.5  // Critical in dialysis patient
#define TEMP_LOW          35.5  // Hypothermia — dialysate cooling?
#define TEMP_CRITICAL_LOW 34.5

// ECG Signal Quality
#define ECG_NOISE_THRESHOLD   800
#define ECG_LOW_THRESHOLD     50

// SpO2 proxy thresholds (from KY-039 amplitude)
// The KY-039 amplitude correlates loosely with perfusion
#define SPO2_PROXY_LOW        400   // ADC value — suggests poor perfusion
#define SPO2_PROXY_CRITICAL   300   // Very poor signal/perfusion

// ─── Timing ────────────────────────────────────────────────────────
#define SERIAL_INTERVAL_MS    100
#define TEMP_READ_INTERVAL_MS 1000
#define BUZZER_BEEP_MS        150
#define BUZZER_PAUSE_MS       100
#define LED_BLINK_INTERVAL_MS 500

// ─── Heart Rate Detection ──────────────────────────────────────────
#define HR_SAMPLE_WINDOW      10
#define HR_PEAK_THRESHOLD     550
#define HR_MIN_PEAK_INTERVAL  300
#define HR_MAX_PEAK_INTERVAL  2000

// ─── Temperature Sensor ────────────────────────────────────────────
OneWire oneWire(PIN_TEMP_DATA);
DallasTemperature tempSensor(&oneWire);

// ─── State Variables ───────────────────────────────────────────────
unsigned long beatTimestamps[HR_SAMPLE_WINDOW];
int beatIndex = 0;
int beatCount = 0;
unsigned long lastPeakTime = 0;
bool wasBelowThreshold = true;
int currentHR = 0;
int rawHeartbeat = 0;
int peakAmplitude = 0;  // Track peak amplitude for SpO2 proxy

int rawECG = 0;
bool leadOff = false;
int ecgQuality = 100;

float currentTemp = 0.0;
unsigned long lastTempRead = 0;
bool tempReady = false;

// SpO2 proxy tracking
int spo2ProxyAvg = 512;  // Running average of heartbeat signal peak
int spo2ProxySamples[8];
int spo2ProxyIdx = 0;

// Alarms
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
#define ALARM_SPO2_LOW       0x0800  // Kidney-specific: poor perfusion
#define ALARM_SPO2_CRITICAL  0x1000

uint16_t activeAlarms = ALARM_NONE;
uint16_t prevAlarms = ALARM_NONE;

// Repeated alarm tracking for Technician loop
uint16_t spo2AlarmCount = 0;        // Count of SpO2 alarms (for tech task trigger)
unsigned long spo2AlarmWindowStart = 0;
#define SPO2_ALARM_TECH_THRESHOLD  5  // N alarms in T minutes → tech task
#define SPO2_ALARM_WINDOW_MS  300000  // 5 minutes

unsigned long lastSerialSend = 0;
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false;
int buzzerBeepCount = 0;
int alarmPriority = 0;
bool techTaskTriggered = false;


// ════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }

  pinMode(PIN_HEARTBEAT, INPUT);
  pinMode(PIN_ECG_ANALOG, INPUT);
  pinMode(PIN_LEAD_OFF, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);

  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
  digitalWrite(PIN_LED_GREEN, HIGH);

  tempSensor.begin();
  tempSensor.setResolution(12);
  tempSensor.setWaitForConversion(false);

  for (int i = 0; i < HR_SAMPLE_WINDOW; i++) beatTimestamps[i] = 0;
  for (int i = 0; i < 8; i++) spo2ProxySamples[i] = 512;

  tempSensor.requestTemperatures();
  lastTempRead = millis();

  Serial.println("{\"event\":\"boot\",\"node\":" + String(NODE_ID) +
                 ",\"profile\":\"" + String(PROFILE) + "\"}");
}


// ════════════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  readHeartbeat(now);
  readECG();
  readTemperature(now);
  evaluateAlarms(now);
  driveSafetyOutputs(now);

  if (now - lastSerialSend >= SERIAL_INTERVAL_MS) {
    sendSerialData(now);
    lastSerialSend = now;
  }
}


// ════════════════════════════════════════════════════════════════════
// SENSOR READING
// ════════════════════════════════════════════════════════════════════

void readHeartbeat(unsigned long now) {
  rawHeartbeat = analogRead(PIN_HEARTBEAT);

  // Track peak amplitude for SpO2 proxy
  if (rawHeartbeat > peakAmplitude) {
    peakAmplitude = rawHeartbeat;
  }

  // Peak detection
  if (rawHeartbeat > HR_PEAK_THRESHOLD && wasBelowThreshold) {
    unsigned long interval = now - lastPeakTime;

    if (interval > HR_MIN_PEAK_INTERVAL) {
      wasBelowThreshold = false;
      lastPeakTime = now;

      // Store SpO2 proxy (peak amplitude of this beat)
      spo2ProxySamples[spo2ProxyIdx] = peakAmplitude;
      spo2ProxyIdx = (spo2ProxyIdx + 1) % 8;
      peakAmplitude = 0;

      // Calculate running average for SpO2 proxy
      long sum = 0;
      for (int i = 0; i < 8; i++) sum += spo2ProxySamples[i];
      spo2ProxyAvg = sum / 8;

      // HR calculation
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

void readECG() {
  rawECG = analogRead(PIN_ECG_ANALOG);
  leadOff = (digitalRead(PIN_LEAD_OFF) == HIGH);

  if (leadOff) {
    ecgQuality = 0;
  } else if (rawECG > ECG_NOISE_THRESHOLD || rawECG < ECG_LOW_THRESHOLD) {
    ecgQuality = max(0, ecgQuality - 5);
  } else {
    ecgQuality = min(100, ecgQuality + 2);
  }
}

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
// ALARM EVALUATION
// ════════════════════════════════════════════════════════════════════

void evaluateAlarms(unsigned long now) {
  prevAlarms = activeAlarms;
  activeAlarms = ALARM_NONE;
  alarmPriority = 0;

  // ── Heart Rate ────────────────────────────────────────────────
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

  // ── Temperature ───────────────────────────────────────────────
  if (tempReady) {
    if (currentTemp >= TEMP_CRITICAL) {
      activeAlarms |= ALARM_TEMP_CRITICAL;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentTemp >= TEMP_HIGH) {
      activeAlarms |= ALARM_TEMP_HIGH;
      alarmPriority = max(alarmPriority, 2);  // Higher priority for kidney (infection)
    }
    if (currentTemp <= TEMP_CRITICAL_LOW) {
      activeAlarms |= ALARM_TEMP_CRIT_LOW;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentTemp <= TEMP_LOW) {
      activeAlarms |= ALARM_TEMP_LOW;
      alarmPriority = max(alarmPriority, 1);
    }
  }

  // ── SpO2 Proxy ────────────────────────────────────────────────
  if (spo2ProxyAvg < SPO2_PROXY_CRITICAL) {
    activeAlarms |= ALARM_SPO2_CRITICAL;
    alarmPriority = max(alarmPriority, 3);
  } else if (spo2ProxyAvg < SPO2_PROXY_LOW) {
    activeAlarms |= ALARM_SPO2_LOW;
    alarmPriority = max(alarmPriority, 2);

    // Track repeated SpO2 alarms for Technician task
    if (!(prevAlarms & ALARM_SPO2_LOW)) {  // New alarm onset
      if (now - spo2AlarmWindowStart > SPO2_ALARM_WINDOW_MS) {
        spo2AlarmCount = 0;
        spo2AlarmWindowStart = now;
      }
      spo2AlarmCount++;
    }
  }

  // ── Lead-Off ──────────────────────────────────────────────────
  if (leadOff) {
    activeAlarms |= ALARM_LEAD_OFF;
    alarmPriority = max(alarmPriority, 1);  // Lower for kidney (ECG is secondary)
  }

  // ── ECG Noise ─────────────────────────────────────────────────
  if (ecgQuality < 30 && !leadOff) {
    activeAlarms |= ALARM_ECG_NOISE;
    alarmPriority = max(alarmPriority, 1);
  }

  // ── Technician Task Flag ──────────────────────────────────────
  if (spo2AlarmCount >= SPO2_ALARM_TECH_THRESHOLD && !techTaskTriggered) {
    techTaskTriggered = true;  // Will be sent in serial data
  }
}


// ════════════════════════════════════════════════════════════════════
// LOCAL SAFETY PATH
// ════════════════════════════════════════════════════════════════════

void driveSafetyOutputs(unsigned long now) {
  // LEDs
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

  // Buzzer
  if (alarmPriority == 3) {
    digitalWrite(PIN_BUZZER, HIGH);
  } else if (alarmPriority == 2) {
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
// SERIAL OUTPUT
// ════════════════════════════════════════════════════════════════════

void sendSerialData(unsigned long now) {
  Serial.print("{\"node\":");
  Serial.print(NODE_ID);
  Serial.print(",\"ts\":");
  Serial.print(now);
  Serial.print(",\"profile\":\"");
  Serial.print(PROFILE);
  Serial.print("\",\"hr\":");
  Serial.print(currentHR);
  Serial.print(",\"hr_raw\":");
  Serial.print(rawHeartbeat);
  Serial.print(",\"ecg\":");
  Serial.print(rawECG);
  Serial.print(",\"ecg_quality\":");
  Serial.print(ecgQuality);
  Serial.print(",\"temp\":");
  Serial.print(currentTemp, 1);
  Serial.print(",\"spo2_proxy\":");
  Serial.print(spo2ProxyAvg);
  Serial.print(",\"lead_off\":");
  Serial.print(leadOff ? "true" : "false");
  Serial.print(",\"alarm_flags\":");
  Serial.print(activeAlarms);
  Serial.print(",\"priority\":");
  Serial.print(alarmPriority);
  Serial.print(",\"spo2_alarm_count\":");
  Serial.print(spo2AlarmCount);
  Serial.print(",\"tech_task\":");
  Serial.print(techTaskTriggered ? "true" : "false");

  // Alarm names
  Serial.print(",\"alarms\":[");
  bool first = true;
  if (activeAlarms & ALARM_HR_CRIT_HIGH)  { printAlarmName("HR_CRITICAL_HIGH", first); }
  if (activeAlarms & ALARM_HR_HIGH)       { printAlarmName("HR_HIGH", first); }
  if (activeAlarms & ALARM_HR_LOW)        { printAlarmName("HR_LOW", first); }
  if (activeAlarms & ALARM_HR_CRIT_LOW)   { printAlarmName("HR_CRITICAL_LOW", first); }
  if (activeAlarms & ALARM_FLATLINE)      { printAlarmName("FLATLINE", first); }
  if (activeAlarms & ALARM_TEMP_HIGH)     { printAlarmName("TEMP_HIGH", first); }
  if (activeAlarms & ALARM_TEMP_CRITICAL) { printAlarmName("TEMP_CRITICAL", first); }
  if (activeAlarms & ALARM_TEMP_LOW)      { printAlarmName("TEMP_LOW", first); }
  if (activeAlarms & ALARM_TEMP_CRIT_LOW) { printAlarmName("TEMP_CRITICAL_LOW", first); }
  if (activeAlarms & ALARM_LEAD_OFF)      { printAlarmName("LEAD_OFF", first); }
  if (activeAlarms & ALARM_ECG_NOISE)     { printAlarmName("ECG_NOISE", first); }
  if (activeAlarms & ALARM_SPO2_LOW)      { printAlarmName("SPO2_LOW", first); }
  if (activeAlarms & ALARM_SPO2_CRITICAL) { printAlarmName("SPO2_CRITICAL", first); }
  Serial.print("]");

  Serial.println("}");
}

void printAlarmName(const char* name, bool &first) {
  if (!first) Serial.print(",");
  Serial.print("\"");
  Serial.print(name);
  Serial.print("\"");
  first = false;
}
