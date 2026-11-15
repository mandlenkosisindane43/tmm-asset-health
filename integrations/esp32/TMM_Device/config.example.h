#pragma once
// Copy this file to config.h in this sketch directory. Keep config.h private.
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define TMM_ENDPOINT "https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev/api/telemetry/v2"
// Create a dedicated 'J1939 device' connection; use its source key and token.
#define TMM_SOURCE_KEY "YOUR_DEVICE_CONNECTION_SOURCE_KEY"
#define TMM_TOKEN "YOUR_DEVICE_CONNECTION_TOKEN"
#define TMM_EXTERNAL_ID "ESP32-BENCH-001"
// Obtain the current issuing root CA from the trusted certificate authority.
// Certificate verification is required. Never replace it with setInsecure().
static const char TMM_ROOT_CA[] = R"PEM(
REPLACE_WITH_TRUSTED_PEM_ROOT_CA
)PEM";
// Keep bench mode until hardware and the machine interface are authorised.
// Set to 0 only for receive-only J1939 RPM acquisition; all other readings omitted.
#define TMM_BENCH_MODE 1
#define TMM_CAN_RX 4
#define TMM_CAN_TX 5
#define TMM_CAN_BITRATE 250000
#define TMM_ENGINE_SOURCE_ADDRESS 0
