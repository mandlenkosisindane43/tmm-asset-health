# Independent TMM machine device — ESP32 prototype

The device is a **separate collection route**:

machine bus → isolated CAN interface → ESP32 → Wi-Fi/HTTPS → TMM authenticated
intake → central storage → automatic analysis/reports.

No OEM API, OEM account or company's central pot is required for this route.
The TMM endpoint is the device's destination. A TMM connection token authorises
upload; it does not grant access to an engine controller. Identify/map each
machine once in TMM. Do not assume its serial number is automatically broadcast.

## Firmware and setup

Open `TMM_Device/TMM_Device.ino` in Arduino IDE, using the Espressif ESP32 core
and ArduinoJson 7. Select the exact ESP32 board you own. Copy
`config.example.h` to private `config.h`; configure Wi-Fi, a trusted PEM root CA,
the staging endpoint and a dedicated TMM device source/token. TLS validation
is mandatory; the code never uses `setInsecure`. The example contains no secrets.

Default `TMM_BENCH_MODE=1` sends synthetic, explicitly test-labelled readings.
Map `ESP32-BENCH-001` to a simulation fleet machine for this test. First queued
sample follows UTC clock synchronisation, then samples are scheduled every
15 minutes. The pending JSON/event identity is persisted in ESP32 Preferences
before upload. Accepted/duplicate/discovered receipts confirm durable server
storage; discovery still needs mapping/site setup. Transport success alone does
not confirm analysis/reporting. Rejected/unacknowledged samples stay pending.

One pending sample is retained across restarts. While it is pending, further
collection pauses; this is deliberately bounded backpressure, not unlimited
historical logging. High-rate field collection needs an SD/flash ring buffer,
retention limits and a tested recovery protocol. Credentials are not printed.
Stored queue ownership is bound to endpoint/source/machine ID, so changing the
connection cannot silently transfer queued data into another company's account.

## Real machine acquisition path

`TMM_BENCH_MODE=0` enables native ESP32 TWAI **listen-only** classic CAN.
The code contains no transmit/request/clear-fault call. A dedicated receiver task
keeps listening while HTTP runs. Configure the verified bus bitrate (250 or
500 kbit/s), GPIOs and engine-controller source address. It initially decodes
only **EEC1 / PGN 61444 / SPN 190 engine RPM**. Data older than five seconds is
not submitted as current. Missing signals remain absent. It does not infer
ignition state from RPM or manufacture an hour meter, fault list or temperature.

This initial receive-only path is not a complete 21-parameter decoder. Engine
hours, temperatures, pressures and diagnostics need verified per-machine signal
maps. J1939 DM1 can require transport-protocol reassembly; that is not implemented
here. Some signals are request-only or proprietary and will not appear to a
passive listener. CAN FD, J1708/J1587, OBD-II requests and proprietary OEM protocols
are outside this firmware. Never claim these are supported merely because the
connector fits. The host decoder tests verify sample bytes, not a physical ECU.

Before connecting to a machine, obtain the exact model/year, permitted diagnostic
connector pinout, supply voltage, protocol, bitrate, available signals and site/OEM
permission. Connect through an appropriately isolated automotive CAN interface;
ESP32 GPIOs must not connect directly to CAN-H/CAN-L. Do not add bus termination
without checking the existing bus design. Use USB power on the bench; machine
power needs a fused, protected automotive DC/DC design with transient/reverse
polarity protection. Do not connect the board directly to a 12/24 V supply.

## Hardware stages

1. Bench transfer: ESP32 DevKit, USB power/data cable and Wi-Fi hotspot.
2. Bench CAN acquisition: isolated 3.3 V-compatible CAN transceiver/interface,
   second CAN node or simulator, suitable test harness and verified termination.
3. Machine pilot: reviewed power supply, fuse, transient protection, connector,
   isolation, enclosure, strain relief and qualified installation.

This is a prototype, not an intrinsically safe or mine-certified product. Machine
installation, especially in hazardous areas, requires the site's approved design
and equipment. Do not connect control outputs or send ECU commands.

## Verification status

The portable RPM decoder compiles with g++ and passes host assertions for
1500 RPM, zero RPM, invalid/short frames, wrong source, wrong PGN, remote/standard
frames and not-available values. The full ESP32 firmware and both mode branches
still require Arduino toolchain compilation and physical Wi-Fi/CAN testing.
The CLI downloaded successfully in this session, but board/package index downloads
were blocked by the environment's network path. No successful firmware compile,
board upload or physical-machine acquisition is claimed.

Bench acceptance: successful trusted-TLS upload; duplicate replay; Wi-Fi outage;
power loss with pending record; bad token; wrong mapping; changed company binding;
clock unavailable; reconnect and acknowledgement. CAN acceptance: compare RPM to
a calibrated/reference display; disconnect CAN and verify stale data is omitted;
verify no bus transmission using an independent analyser; then add documented
parameters one at a time.

References:
- https://docs.espressif.com/projects/esp-idf/en/release-v5.4/esp32/api-reference/peripherals/twai.html
- https://docs.espressif.com/projects/arduino-esp32/en/latest/api/preferences.html
- https://github.com/espressif/arduino-esp32/tree/master/libraries/NetworkClientSecure
- https://arduinojson.org/v7/how-to/use-arduinojson-with-httpclient/
- https://www.csselectronics.com/pages/j1939-explained-simple-intro-tutorial
