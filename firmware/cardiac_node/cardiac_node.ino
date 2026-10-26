/*
 * CARE — Clinical Action and Response Engine
 * Firmware: Cardiac Bed Node (Bed 1)
 * 
 * Tier 1 Device: ECG + Cardiac monitoring
 * Profile: Cardiac — arrhythmia detection, tachycardia, bradycardia
 *
 * Hardware:
 *   A0  — KY-039 heartbeat sensor (analog signal)
 *   A1  — ECG electrode (raw analog, no AD8232)
 *   D2  — DS18B20 temperature probe (OneWire, 4.7kΩ pull-up)
 *   D8  — Buzzer (active, HIGH = ON)
 *   D9  — Red LED (critical alarm)
 *   D10 — Yellow LED (medium alarm)
 *   D11 — Green LED (normal/OK)
 *   D12 — ECG lead-off detection (INPUT_PULLUP, LOW = connected)
 *
 * Serial: 115200 baud, JSON packets every 100ms
 * 
 * SAFETY: The buzzer and LEDs fire LOCALLY on the Arduino for critical
 * alarms. CARE (the server) NEVER suppresses these. This is the
 * independent safety notification path.
 */

#include <OneWire.h>
#include <DallasTemperature.h>

// ─── Pin Definitions ───────────────────────────────────────────────
#define PIN_HEARTBEAT   A0    // KY-039 analog signal
#define PIN_ECG_ANALOG  A1    // ECG raw analog input
#define PIN_TEMP_DATA   2     // DS18B20 OneWire data
#define PIN_BUZZER      8     // Active buzzer
#define PIN_LED_RED     9     // Critical alarm LED
#define PIN_LED_YELLOW  10    // Medium alarm LED
#define PIN_LED_GREEN   11    // Normal indicator LED
#define PIN_LEAD_OFF    12    // ECG lead-off detection

// ─── Node Identity ─────────────────────────────────────────────────
#define NODE_ID         1
#define PROFILE         "cardiac"

// ─── Alarm Thresholds (Cardiac Profile) ────────────────────────────
// Heart Rate
#define HR_CRITICAL_HIGH  150   // BPM — V-Tach territory
#define HR_HIGH           120   // BPM — Tachycardia
#define HR_LOW            50    // BPM — Bradycardia
#define HR_CRITICAL_LOW   40    // BPM — Severe bradycardia
#define HR_FLATLINE_MS    5000  // ms without a beat → flatline

// Temperature
#define TEMP_HIGH         38.5  // °C — Fever
#define TEMP_CRITICAL     40.0  // °C — Hyperthermia
#define TEMP_LOW          35.0  // °C — Hypothermia
#define TEMP_CRITICAL_LOW 34.0  // °C — Severe hypothermia

// ECG Signal Quality
#define ECG_NOISE_THRESHOLD   800   // Raw ADC value indicating noise/saturation
#define ECG_LOW_THRESHOLD     50    // Below this = possible lead issue

// ─── Timing ────────────────────────────────────────────────────────
#define SERIAL_INTERVAL_MS    100   // Send data every 100ms
#define TEMP_READ_INTERVAL_MS 1000  // DS18B20 conversion takes ~750ms
#define BUZZER_BEEP_MS        150   // Duration of a single beep
#define BUZZER_PAUSE_MS       100   // Pause between beeps
#define LED_BLINK_INTERVAL_MS 500   // Blink rate for LEDs

// ─── Heart Rate Detection ──────────────────────────────────────────
#define HR_SAMPLE_WINDOW      10    // Number of beats to average
#define HR_PEAK_THRESHOLD     550   // ADC value threshold for peak detection
#define HR_MIN_PEAK_INTERVAL  300   // Minimum ms between peaks (200 BPM max)
#define HR_MAX_PEAK_INTERVAL  2000  // Maximum ms between peaks (30 BPM min)

// ─── Temperature Sensor ────────────────────────────────────────────
OneWire oneWire(PIN_TEMP_DATA);
DallasTemperature tempSensor(&oneWire);

// ─── State Variables ───────────────────────────────────────────────
// Heart rate
unsigned long beatTimestamps[HR_SAMPLE_WINDOW];
int beatIndex = 0;
int beatCount = 0;
unsigned long lastPeakTime = 0;
bool wasBelowThreshold = true;
int currentHR = 0;            // Calculated BPM
int rawHeartbeat = 0;         // Raw ADC value from KY-039

// ECG
int rawECG = 0;               // Raw ADC value from ECG electrodes
bool leadOff = false;          // Lead disconnected?
int ecgQuality = 100;          // 0-100 signal quality score

// Temperature
float currentTemp = 0.0;
unsigned long lastTempRead = 0;
bool tempReady = false;

// Alarms — bitfield for active alarms
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

uint16_t activeAlarms = ALARM_NONE;
uint16_t prevAlarms = ALARM_NONE;

// Timing
unsigned long lastSerialSend = 0;
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false;
int buzzerBeepCount = 0;

// Alarm priority for local safety path
// 0 = none, 1 = low, 2 = medium, 3 = critical
int alarmPriority = 0;


// ════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════
void setup() {
  // Serial
  Serial.begin(115200);
  while (!Serial) { ; }  // Wait for serial port

  // Pin modes
  pinMode(PIN_HEARTBEAT, INPUT);
  pinMode(PIN_ECG_ANALOG, INPUT);
  pinMode(PIN_LEAD_OFF, INPUT_PULLUP);  // LOW = connected, HIGH = lead off
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);

  // Initialize outputs
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
  digitalWrite(PIN_LED_GREEN, HIGH);  // Green ON = system OK

  // Temperature sensor
  tempSensor.begin();
  tempSensor.setResolution(12);       // 12-bit resolution
  tempSensor.setWaitForConversion(false); // Non-blocking reads

  // Initialize beat timestamps
  for (int i = 0; i < HR_SAMPLE_WINDOW; i++) {
    beatTimestamps[i] = 0;
  }

  // Start first temperature conversion
  tempSensor.requestTemperatures();
  lastTempRead = millis();

  // Boot message
  Serial.println("{\"event\":\"boot\",\"node\":" + String(NODE_ID) +
                 ",\"profile\":\"" + String(PROFILE) + "\"}");
}


// ════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  // ── Read Sensors ──────────────────────────────────────────────
  readHeartbeat(now);
  readECG();
  readTemperature(now);

  // ── Evaluate Alarms ───────────────────────────────────────────
  evaluateAlarms(now);

  // ── Drive Local Safety Path (buzzer + LEDs) ───────────────────
  driveSafetyOutputs(now);

  // ── Send Serial Data ──────────────────────────────────────────
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

  // Peak detection for BPM calculation
  if (rawHeartbeat > HR_PEAK_THRESHOLD && wasBelowThreshold) {
    unsigned long interval = now - lastPeakTime;

    if (interval > HR_MIN_PEAK_INTERVAL) {
      // Valid beat detected
      wasBelowThreshold = false;
      lastPeakTime = now;

      // Store timestamp in circular buffer
      beatTimestamps[beatIndex] = now;
      beatIndex = (beatIndex + 1) % HR_SAMPLE_WINDOW;
      if (beatCount < HR_SAMPLE_WINDOW) beatCount++;

      // Calculate HR from average interval
      if (beatCount >= 2) {
        // Find oldest and newest timestamps in our window
        int oldest = (beatIndex - beatCount + HR_SAMPLE_WINDOW) % HR_SAMPLE_WINDOW;
        int newest = (beatIndex - 1 + HR_SAMPLE_WINDOW) % HR_SAMPLE_WINDOW;
        unsigned long totalInterval = beatTimestamps[newest] - beatTimestamps[oldest];
        if (totalInterval > 0 && beatCount > 1) {
          float avgInterval = (float)totalInterval / (float)(beatCount - 1);
          currentHR = (int)(60000.0 / avgInterval);
          // Clamp to reasonable range
          if (currentHR < 0) currentHR = 0;
          if (currentHR > 300) currentHR = 300;
        }
      }
    }
  }

  if (rawHeartbeat < HR_PEAK_THRESHOLD - 50) {  // Hysteresis
    wasBelowThreshold = true;
  }
}

void readECG() {
  rawECG = analogRead(PIN_ECG_ANALOG);

  // Lead-off detection
  leadOff = (digitalRead(PIN_LEAD_OFF) == HIGH);

  // Simple signal quality estimation
  if (leadOff) {
    ecgQuality = 0;
  } else if (rawECG > ECG_NOISE_THRESHOLD || rawECG < ECG_LOW_THRESHOLD) {
    ecgQuality = max(0, ecgQuality - 5);  // Degrade quality
  } else {
    ecgQuality = min(100, ecgQuality + 2);  // Recover quality
  }
}

void readTemperature(unsigned long now) {
  if (now - lastTempRead >= TEMP_READ_INTERVAL_MS) {
    if (tempSensor.isConversionComplete()) {
      float reading = tempSensor.getTempCByIndex(0);
      // Validate reading (-127 = error, 85 = power-on reset)
      if (reading != -127.0 && reading != 85.0) {
        currentTemp = reading;
        tempReady = true;
      }
      // Start next conversion
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

  // ── Heart Rate Alarms ─────────────────────────────────────────
  // Flatline: no beat detected for HR_FLATLINE_MS
  if (beatCount > 0 && (now - lastPeakTime > HR_FLATLINE_MS)) {
    activeAlarms |= ALARM_FLATLINE;
    alarmPriority = 3;  // CRITICAL
  }

  if (currentHR > 0) {
    if (currentHR >= HR_CRITICAL_HIGH) {
      activeAlarms |= ALARM_HR_CRIT_HIGH;
      alarmPriority = max(alarmPriority, 3);  // CRITICAL — possible V-Tach
    } else if (currentHR >= HR_HIGH) {
      activeAlarms |= ALARM_HR_HIGH;
      alarmPriority = max(alarmPriority, 2);  // MEDIUM
    }

    if (currentHR <= HR_CRITICAL_LOW) {
      activeAlarms |= ALARM_HR_CRIT_LOW;
      alarmPriority = max(alarmPriority, 3);  // CRITICAL
    } else if (currentHR <= HR_LOW) {
      activeAlarms |= ALARM_HR_LOW;
      alarmPriority = max(alarmPriority, 2);  // MEDIUM
    }
  }

  // ── Temperature Alarms ────────────────────────────────────────
  if (tempReady) {
    if (currentTemp >= TEMP_CRITICAL) {
      activeAlarms |= ALARM_TEMP_CRITICAL;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentTemp >= TEMP_HIGH) {
      activeAlarms |= ALARM_TEMP_HIGH;
      alarmPriority = max(alarmPriority, 1);  // LOW
    }

    if (currentTemp <= TEMP_CRITICAL_LOW) {
      activeAlarms |= ALARM_TEMP_CRIT_LOW;
      alarmPriority = max(alarmPriority, 3);
    } else if (currentTemp <= TEMP_LOW) {
      activeAlarms |= ALARM_TEMP_LOW;
      alarmPriority = max(alarmPriority, 1);
    }
  }

  // ── ECG Lead-Off ──────────────────────────────────────────────
  if (leadOff) {
    activeAlarms |= ALARM_LEAD_OFF;
    alarmPriority = max(alarmPriority, 2);  // MEDIUM — but could mask real events
  }

  // ── ECG Noise ─────────────────────────────────────────────────
  if (ecgQuality < 30 && !leadOff) {
    activeAlarms |= ALARM_ECG_NOISE;
    alarmPriority = max(alarmPriority, 1);  // LOW
  }
}


// ════════════════════════════════════════════════════════════════════
// LOCAL SAFETY PATH (Buzzer + LEDs)
// ════════════════════════════════════════════════════════════════════

void driveSafetyOutputs(unsigned long now) {
  // ── LEDs ──────────────────────────────────────────────────────
  if (alarmPriority == 3) {
    // Critical: Red ON, others OFF
    digitalWrite(PIN_LED_RED, HIGH);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_GREEN, LOW);
  } else if (alarmPriority == 2) {
    // Medium: Yellow ON, Green OFF
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_LED_YELLOW, HIGH);
    digitalWrite(PIN_LED_GREEN, LOW);
  } else if (alarmPriority == 1) {
    // Low: Yellow blink
    digitalWrite(PIN_LED_RED, LOW);
    if ((now / LED_BLINK_INTERVAL_MS) % 2 == 0) {
      digitalWrite(PIN_LED_YELLOW, HIGH);
      digitalWrite(PIN_LED_GREEN, LOW);
    } else {
      digitalWrite(PIN_LED_YELLOW, LOW);
      digitalWrite(PIN_LED_GREEN, HIGH);
    }
  } else {
    // Normal: Green ON
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_GREEN, HIGH);
  }

  // ── Buzzer ────────────────────────────────────────────────────
  if (alarmPriority == 3) {
    // Critical: continuous tone
    digitalWrite(PIN_BUZZER, HIGH);
  } else if (alarmPriority == 2) {
    // Medium: 3 beeps then pause
    if (now - lastBuzzerToggle >= (buzzerState ? BUZZER_BEEP_MS : BUZZER_PAUSE_MS)) {
      buzzerState = !buzzerState;
      lastBuzzerToggle = now;

      if (buzzerState) {
        buzzerBeepCount++;
        if (buzzerBeepCount > 3) {
          buzzerBeepCount = 0;
          buzzerState = false;
          // Longer pause after 3 beeps
          lastBuzzerToggle = now + 500;
        }
      }
      digitalWrite(PIN_BUZZER, buzzerState ? HIGH : LOW);
    }
  } else if (alarmPriority == 1) {
    // Low: single short beep every 2 seconds
    if (now - lastBuzzerToggle >= 2000) {
      digitalWrite(PIN_BUZZER, HIGH);
      delay(50);  // Very short beep
      digitalWrite(PIN_BUZZER, LOW);
      lastBuzzerToggle = now;
    }
  } else {
    // No alarm: buzzer off
    digitalWrite(PIN_BUZZER, LOW);
    buzzerBeepCount = 0;
  }
}


// ════════════════════════════════════════════════════════════════════
// SERIAL OUTPUT (JSON to BIU)
// ════════════════════════════════════════════════════════════════════

void sendSerialData(unsigned long now) {
  // Build JSON manually to avoid ArduinoJson dependency
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
  Serial.print(",\"lead_off\":");
  Serial.print(leadOff ? "true" : "false");
  Serial.print(",\"alarm_flags\":");
  Serial.print(activeAlarms);
  Serial.print(",\"priority\":");
  Serial.print(alarmPriority);

  // Alarm names array
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
