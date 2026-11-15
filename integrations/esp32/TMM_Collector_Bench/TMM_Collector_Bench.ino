/*
 TMM independent collector: offline bench first, no Wi-Fi or TMM uploads.
 1. Use ESP32-DevKitC-32E (classic ESP32-WROOM-32E), USB power only.
 2. Arduino IDE: install esp32 by Espressif Systems. Select ESP32 Dev Module.
 3. Open this sketch folder; keep tmm_j1939.h beside this .ino. Verify/Upload.
 4. Serial Monitor: 115200 baud. Expect decoder_self_test=PASS and test_data=true.
 5. LEDs: GPIO25 -> 1k resistor -> green LED anode; cathode -> logic GND.
    Repeat GPIO26/yellow and GPIO27/red, each with its OWN 1k resistor.
    Green heartbeat, yellow fresh supported RPM, red missing/stale/error.
 6. Default BENCH_MODE=1 replays known bytes internally. NO CAN wiring needed.
    These are test vectors, never actual machine readings. Nothing is uploaded.
 7. Only after approving machine pinout/bitrate/source, set BENCH_MODE=0.
    Isolated 3.3V logic-compatible CAN transceiver required: TX GPIO5, RX GPIO4.
    Never wire GPIO to CAN-H/L, or 12/24V to board/breadboard. No extra vehicle
    termination. This sketch is receive-only and never requests or clears faults.
 8. Supported signal: J1939 EEC1 PGN61444/SPN190 RPM only. No hour meter,
    fault-code decoding, CAN FD, OEM proprietary protocols or permanent logging.
    A successful compile does not prove electrical or machine compatibility.
*/
#include <Arduino.h>
#include "driver/twai.h"
#include "tmm_j1939.h"

#ifndef BENCH_MODE
#define BENCH_MODE 1
#endif
#define CAN_BITRATE 250000
#define ENGINE_SOURCE_ADDRESS 0

constexpr uint8_t LED_RUN = 25, LED_DATA = 26, LED_ERROR = 27;
constexpr uint32_t FRESH_MS = 5000;
bool ready = false, hasRpm = false;
double lastRpm = 0;
uint32_t rpmAt = 0, lastReplay = 0, lastPrint = 0;
uint32_t supportedFrames = 0, otherFrames = 0;

bool decoderSelfTest() {
  uint8_t bytes[8] = {0xFF,0xFF,0xFF,0xE0,0x2E,0xFF,0xFF,0xFF};
  double value = -1;
  if (!tmmDecodeEngineRpm(0x0CF00400,bytes,8,true,false,0,value) || value != 1500) return false;
  if (tmmDecodeEngineRpm(0x0CF00401,bytes,8,true,false,0,value)) return false;
  if (tmmDecodeEngineRpm(0x0CF00400,bytes,4,true,false,0,value)) return false;
  bytes[3]=0xFF; bytes[4]=0xFF;
  return !tmmDecodeEngineRpm(0x0CF00400,bytes,8,true,false,0,value);
}

bool startCan() {
  twai_general_config_t general = TWAI_GENERAL_CONFIG_DEFAULT(GPIO_NUM_5,GPIO_NUM_4,TWAI_MODE_LISTEN_ONLY);
  general.tx_queue_len=0; general.rx_queue_len=64;
#if CAN_BITRATE == 250000
  twai_timing_config_t timing=TWAI_TIMING_CONFIG_250KBITS();
#elif CAN_BITRATE == 500000
  twai_timing_config_t timing=TWAI_TIMING_CONFIG_500KBITS();
#else
#error Use only the verified machine bus bitrate: 250000 or 500000
#endif
  twai_filter_config_t filter=TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&general,&timing,&filter)!=ESP_OK) return false;
  if (twai_start()!=ESP_OK) { twai_driver_uninstall(); return false; }
  return true;
}

void acceptFrame(uint32_t id,const uint8_t* bytes,size_t length,bool extended,bool remote) {
  double rpm;
  if (tmmDecodeEngineRpm(id,bytes,length,extended,remote,ENGINE_SOURCE_ADDRESS,rpm)) {
    lastRpm=rpm; rpmAt=millis(); hasRpm=true; ++supportedFrames;
  } else ++otherFrames;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_RUN,OUTPUT); pinMode(LED_DATA,OUTPUT); pinMode(LED_ERROR,OUTPUT);
  digitalWrite(LED_RUN,LOW); digitalWrite(LED_DATA,LOW); digitalWrite(LED_ERROR,LOW);
  delay(800);
  if (!decoderSelfTest()) { Serial.println("decoder_self_test=FAIL"); digitalWrite(LED_ERROR,HIGH); return; }
  Serial.println("decoder_self_test=PASS");
  ready=BENCH_MODE || startCan();
  if (!ready) { Serial.println("CAN startup failed; acquisition stopped"); digitalWrite(LED_ERROR,HIGH); return; }
  Serial.println(BENCH_MODE ? "INTERNAL REPLAY: test data; no external CAN or network" : "LISTEN ONLY: verified engine source and PGN required; no network");
}

void loop() {
  if (!ready) { delay(20); return; }
  const uint32_t now=millis();
  if (BENCH_MODE) {
    if (uint32_t(now-lastReplay)>=1000) {
      lastReplay=now;
      const uint8_t bytes[8]={0xFF,0xFF,0xFF,0xE0,0x2E,0xFF,0xFF,0xFF};
      acceptFrame(0x0CF00400,bytes,8,true,false);
    }
  } else {
    twai_message_t frame;
    // Bound each pass so LEDs/status remain responsive during heavy traffic.
    for (unsigned i=0;i<64 && twai_receive(&frame,0)==ESP_OK;++i)
      acceptFrame(frame.identifier,frame.data,frame.data_length_code,frame.extd,frame.rtr);
  }
  const bool fresh=hasRpm && uint32_t(millis()-rpmAt)<=FRESH_MS;
  digitalWrite(LED_RUN,(now/500)%2);
  digitalWrite(LED_DATA,fresh ? HIGH : LOW);
  digitalWrite(LED_ERROR,fresh ? LOW : HIGH);
  if (uint32_t(now-lastPrint)>=1000) {
    lastPrint=now;
    Serial.printf("{\"test_data\":%s,\"uptime_ms\":%lu,\"rpm\":",BENCH_MODE?"true":"false",(unsigned long)now);
    if (fresh) Serial.print(lastRpm,3); else Serial.print("null");
    Serial.printf(",\"fresh\":%s,\"supported_frames\":%lu,\"other_frames\":%lu}\n",fresh?"true":"false",(unsigned long)supportedFrames,(unsigned long)otherFrames);
  }
  delay(1);
}
