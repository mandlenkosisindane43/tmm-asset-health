/*
 TMM independent ESP32 device — phase 1 BENCH firmware, not machine acquisition.
 1. Arduino IDE: install 'esp32 by Espressif Systems' and ArduinoJson 7.
 2. Open this directory's TMM_Device.ino; select your actual ESP32 board.
 3. Copy config.example.h to config.h; fill Wi-Fi, trusted root CA and dedicated
    TMM source/token. Never paste secrets in chat or commit config.h.
 4. In staging OEM Connections, map external ID ESP32-BENCH-001 to a SIM fleet
    machine. This sketch sends test_data=true; it never supplies live readings.
 5. Upload over USB; open Serial Monitor at 115200. Bench mode is default; receive-only CAN mode initially decodes RPM only.
    First sample is immediate
    after a valid UTC clock; later samples are every 15 minutes.
 6. Optional TMM_BENCH_MODE=0 reads verified J1939 RPM in listen-only mode.
    Use a reviewed isolated CAN interface; no other signals are acquired yet.
    Disconnect/reconnect Wi-Fi: a single pending message persists across reboot.
    Collection applies backpressure while it awaits acknowledgement. This is
    NOT unlimited offline logging. No ECU request or transmit functions are present.
 7. A successful firmware compile is not a hardware/network field test.
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include "config.h"
#include "driver/twai.h"
#include "tmm_j1939.h"

Preferences state;
const uint32_t SAMPLE_MS = 15UL * 60UL * 1000UL;
const uint32_t RETRY_MS = 30UL * 1000UL;
uint32_t lastSample = 0, lastAttempt = 0, lastAcquireAttempt = 0;
bool acquisitionTried = false;
bool sampled = false, configured = false;
portMUX_TYPE signalLock = portMUX_INITIALIZER_UNLOCKED;
double receivedRpm = 0;
uint32_t rpmAt = 0;
bool rpmReceived = false;
void canReceiver(void*) {
  for (;;) {
    twai_message_t frame;
    if (twai_receive(&frame, pdMS_TO_TICKS(100)) == ESP_OK) {
      double rpm;
      if (tmmDecodeEngineRpm(frame.identifier, frame.data, frame.data_length_code,
                            frame.extd, frame.rtr, TMM_ENGINE_SOURCE_ADDRESS, rpm)) {
        portENTER_CRITICAL(&signalLock);
        receivedRpm = rpm; rpmAt = millis(); rpmReceived = true;
        portEXIT_CRITICAL(&signalLock);
      }
    }
  }
}
bool startReceiveOnlyCan() {
  twai_general_config_t general = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)TMM_CAN_TX, (gpio_num_t)TMM_CAN_RX, TWAI_MODE_LISTEN_ONLY);
  general.tx_queue_len = 0; general.rx_queue_len = 64;
#if TMM_CAN_BITRATE == 250000
  twai_timing_config_t timing = TWAI_TIMING_CONFIG_250KBITS();
#elif TMM_CAN_BITRATE == 500000
  twai_timing_config_t timing = TWAI_TIMING_CONFIG_500KBITS();
#else
#error Configure a verified 250000 or 500000 bit/s classic CAN interface
#endif
  twai_filter_config_t filter = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&general, &timing, &filter) != ESP_OK || twai_start() != ESP_OK) return false;
  return xTaskCreate(canReceiver, "tmm-can-rx", 4096, nullptr, 5, nullptr) == pdPASS;
}

bool configurationValid() {
  return String(TMM_ENDPOINT) == "https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev/api/telemetry/v2"
    && String(TMM_SOURCE_KEY).indexOf("YOUR_") < 0
    && String(TMM_TOKEN).indexOf("YOUR_") < 0
    && String(TMM_ROOT_CA).indexOf("-----BEGIN CERTIFICATE-----") >= 0;
}

String utcStamp(time_t epoch) {
  struct tm utc;
  gmtime_r(&epoch, &utc);
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(buffer);
}

bool saveBenchSample() {
  time_t now = time(nullptr);
  if (now < 1700000000) { Serial.println("Awaiting a valid UTC clock; no fabricated timestamp."); return false; }
  double rpm = 0;
  if (!TMM_BENCH_MODE) {
    portENTER_CRITICAL(&signalLock);
    const bool fresh = rpmReceived && uint32_t(millis() - rpmAt) <= 5000;
    rpm = receivedRpm;
    portEXIT_CRITICAL(&signalLock);
    if (!fresh) { Serial.println("No fresh supported J1939 signal; no machine reading fabricated."); return false; }
  }
  uint64_t start = state.getULong64("start", 0);
  if (!start) { start = now; if (!state.putULong64("start", start)) return false; }
  if (uint64_t(now) < start) { Serial.println("Clock moved backwards; sample paused."); return false; }
  JsonDocument record;
  const String stamp = utcStamp(now);
  record["external_machine_id"] = TMM_EXTERNAL_ID;
  record["event_id"] = String(TMM_EXTERNAL_ID) + ":" + stamp + ":" + String(esp_random(), HEX);
  record["timestamp"] = stamp;
  record["test_data"] = TMM_BENCH_MODE != 0;
  if (TMM_BENCH_MODE) {
  record["engine_hours"] = 1250.0 + (double(now) - double(start)) / 3600.0;
  record["ignition_status"] = "ON";
  record["rpm"] = 1400;
  record["coolant_temperature"] = 82;
  record["engine_oil_pressure"] = 350;
  record["fuel_level"] = 75;
  record["units"]["engine_hours"] = "h";
  record["units"]["rpm"] = "rpm";
  record["units"]["coolant_temperature"] = "degC";
  record["units"]["engine_oil_pressure"] = "kPa";
  record["units"]["fuel_level"] = "percent";
  record["asset"]["serial_number"] = TMM_EXTERNAL_ID;
  record["asset"]["manufacturer"] = "TMM ESP32 BENCH SIMULATOR";
  record["asset"]["model"] = "Independent Wi-Fi transfer prototype";
  JsonArray faults = record["fault_codes"].to<JsonArray>();
  if (((uint64_t(now) - start) / 900) % 4 == 1) {
    JsonObject fault = faults.add<JsonObject>(); fault["spn"] = 110; fault["fmi"] = 3;
  }
  } else {
    // Standalone machine acquisition: only the supported fresh bus signal.
    record["rpm"] = rpm;
    record["units"]["rpm"] = "rpm";
    // No invented hour meter, identity, temperatures, ignition or fault status.
  }
  String payload;
  serializeJson(record, payload);
  if (payload.length() > 3500) return false;
  if (state.putString("pending", payload) != payload.length()) {
    Serial.println("Persistent save failed; sample was not queued."); return false;
  }
  Serial.println("BENCH sample persisted; awaiting TMM receipt.");
  return true;
}

void sendPending() {
  const String pending = state.getString("pending", "");
  if (pending.isEmpty() || WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure secure;
  secure.setCACert(TMM_ROOT_CA);
  secure.setTimeout(15);
  HTTPClient http;
  http.setConnectTimeout(10000); http.setTimeout(15000);
  if (!http.begin(secure, TMM_ENDPOINT)) return;
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-telemetry-source", TMM_SOURCE_KEY);
  http.addHeader("Authorization", String("Bearer ") + TMM_TOKEN);
  const int code = http.POST(pending);
  bool durable = false;
  if (code >= 200 && code < 300 && http.getSize() <= 8192) {
    const String body = http.getString();
    if (body.length() <= 8192) {
      JsonDocument reply;
      if (!deserializeJson(reply, body)) {
        const String status = reply["results"][0]["status"] | "";
        durable = status == "accepted" || status == "duplicate" || status == "discovered";
        if (status == "discovered") Serial.println("TMM stored identity; site/mapping still requires setup.");
      }
    }
  }
  http.end();
  if (durable) {
    if (state.remove("pending")) Serial.println("TMM acknowledged durable receipt; local pending sample cleared.");
  } else {
    Serial.printf("Transfer not acknowledged (HTTP %d); same event retained for retry.\n", code);
  }
}

void setup() {
  Serial.begin(115200);
  configured = configurationValid() && state.begin("tmm-device", false);
  if (!configured) { Serial.println("Complete private config.h and trusted root CA. Device paused."); return; }
  const String binding = String(TMM_ENDPOINT) + "|" + TMM_SOURCE_KEY + "|" + TMM_EXTERNAL_ID;
  const String priorBinding = state.getString("binding", "");
  if (!priorBinding.isEmpty() && priorBinding != binding) { configured = false; Serial.println("Connection identity changed. Restore prior config or explicitly recover/reset device storage before switching accounts."); return; }
  if (priorBinding.isEmpty() && !state.putString("binding", binding)) { configured = false; return; }
  if (!TMM_BENCH_MODE && !startReceiveOnlyCan()) { configured = false; Serial.println("CAN receive-only startup failed; device paused."); return; }
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println(TMM_BENCH_MODE ? "BENCH mode: synthetic data, no machine acquisition." : "Receive-only J1939 mode: supported RPM only; verify with a reference instrument.");
}

void loop() {
  if (!configured) { delay(100); return; }
  const uint32_t tick = millis();
  if (state.getString("pending", "").isEmpty() && (!sampled || uint32_t(tick - lastSample) >= SAMPLE_MS) && (!acquisitionTried || uint32_t(tick-lastAcquireAttempt)>=RETRY_MS)) {
    acquisitionTried=true;lastAcquireAttempt=tick;
    if (saveBenchSample()) { sampled = true; lastSample = tick; }
  }
  if (uint32_t(tick - lastAttempt) >= RETRY_MS) { lastAttempt = tick; sendPending(); }
  delay(25);
}
