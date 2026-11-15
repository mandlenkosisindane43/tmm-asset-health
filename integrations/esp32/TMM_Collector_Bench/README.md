# Offline collector: code, USB and LEDs before TMM

Use an Espressif ESP32-DevKitC-32E / ESP32-WROOM-32E with the generic ESP32 Dev
Module target. This is a classic ESP32 project, not an Uno sketch. No libraries
beyond the ESP32 board core are required. Keep both sketch files together.

Default `BENCH_MODE=1` replays known bytes inside the program, runs decoder
self-tests and prints test-labelled JSON at 115200 baud. It does not exercise a
physical CAN transceiver, collect machine data or contact TMM. With no board, a
compile is the available check; actual LED/USB operation remains unverified.

LED wiring: GPIO25/26/27 each feeds its own 1k ohm resistor, then green/yellow/red
LED anode respectively. Each cathode goes to ESP32 logic GND. Green blinks,
yellow means a fresh supported RPM value, red means missing/stale data or a
self-test/startup failure. These are collector indicators, not mine safety lamps.
Use two breadboards or a breakout if the board obscures the breadboard rows.

For a reviewed CAN pilot only, set BENCH_MODE to 0; verify bitrate and source
address from the machine first. GPIO5 is TX into the transceiver, GPIO4 is RX
from it. Listen-only mode disables transmission, ACK and error frames. There is
no automatic protocol discovery or bit-rate guessing. A silent port, wrong ECU
address or unsupported messages produces rpm:null, not engine-off or healthy.

Only EEC1 PGN61444/SPN190 RPM is decoded. No engine-hour, DM1 fault, temperature,
pressure, J1708/J1587, CAN FD, proprietary-protocol, SD logging or Wi-Fi support
is included in this deliberately offline sketch. The separate TMM_Device sketch
is the later authenticated HTTPS transport prototype, not a prerequisite here.

Use an isolated CAN transceiver with 3.3V logic and isolated bus-side power.
M5Stack Unit CAN U085 is a researched candidate; inspect the supplied revision's
schematic and connector pin labels before wiring. Its Grove supply is 5V, not
12/24V; its isolated bus domain must remain separate from logic GND. Its included
120-ohm resistor is for a correctly terminated bench network, not an extra
termination across the existing vehicle bus. No machine-side pinout is supplied
without model/PIN-specific documentation.

References: Espressif TWAI listen-only documentation, Espressif DevKitC V4 user
guide, M5Stack U085 schematic and Senquip APN0012. Full links and shopping stages
are in docs/device-research-shopping-list.md.
