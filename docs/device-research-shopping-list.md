# TMM independent machine collector: research and shopping list

Research date: 15 November 2026. Engineering prototype specification; no machine
or mine installation is claimed to be validated.

## The connection we are actually designing

The computer box is an ECU/ECM: electronic control unit/module. Its physical
length and width do not determine which cable works. A machine can contain
separate engine, transmission, hydraulic, brake and body controllers. For this
project we want an approved diagnostic or telematics connection, rather than
unplugging an ECU's main harness. Record the connector, its keyed mating part,
pin assignments, network/protocol, voltage, permitted signals and machine PIN.

There is no single ECU size or diagnostic plug defined by ADT, FEL, grader, TLB
or excavator. Exact ECU dimensions and part numbers cannot be identified from
these five class names. Obtain the make/model/year/PIN and controller part
number before ordering an ECU-specific harness. This report provides verified
connector families and a bench bill of materials, not universal fitment.

Device path: machine diagnostic port -> verified adapter harness -> isolated
CAN interface -> ESP32 -> later authenticated TMM upload. A cable is a wiring
adapter, not a decoder and not an access licence. A fitting connector does not
prove protocol compatibility. Engine and chassis data may be on different buses.

## Findings from primary manufacturer/vendor documentation

| Family | Documented connection | What this establishes | What it does not establish |
|---|---|---|---|
| SAE J1939 | Standard 9-pin Deutsch; Type 1/Type 2 variants | A widely used diagnostic connector family; network/pin checks still needed [1] | Not every off-highway connector is this standard |
| Caterpillar | Cat-specific 9-pin and 14-pin adapters are available [2] | Interchangeable harnesses are needed even within one manufacturer | A generic 9-pin lead is not automatically suitable |
| Komatsu | Noregon 121313, 12-pin, listed for construction equipment and J1939 [3] | A documented Komatsu cable family | No guarantee for every Komatsu serial range; tool end is Noregon DLA+ |
| Volvo CE | Noregon 121305 (8-pin), 121306 (14-pin) [4,5] | Those particular products explicitly list J1708/J1587 | They must not be assumed to work with our CAN-only firmware |
| John Deere OEM engines | Deere lists a JDLink harness for a 9-pin engine diagnostic connector [6] | A 9-pin engine connection exists in documented engine applications | Not a model-specific promise for every Deere grader/backhoe |
| JCB, Bell, Hitachi, Hyundai, Case, Doosan/Develon and others | Machine-specific harness/protocol investigation remains open | A brand and machine PIN are necessary next inputs | No pinout, ECU dimensions or universal cable verified here |

Important pinout example: CSS Electronics documents different supply and CAN
assignments for standard J1939 versus the grey Cat 9-pin connector [1]. Therefore
we will not wire a socket using shape, pin count or wire colour alone.

Noregon and other diagnostic-tool cable listings are compatibility evidence,
not a recommendation to plug their proprietary tool ends into an ESP32. For
our device, the harness supplier must provide a drawing and continuity-tested
breakout compatible with our chosen interface.

## Applying the research to the first five machines

These are inspection routes, not verified fleet specifications.

| Fleet class | Examples of manufacturer families to identify | Next inspection evidence |
|---|---|---|
| ADT: articulated dump truck | Bell, Volvo, Cat | Machine PIN, engine model, diagnostic socket and data-network drawing |
| FEL: front-end/wheel loader | Cat, Komatsu, Volvo, Deere | Exact model/PIN; engine versus transmission/hydraulic network access |
| GR: motor grader | Cat, Deere, Komatsu | Serial range, connector keying, engine/controller source address |
| TLB: tractor-loader-backhoe | JCB, Cat, Case, Deere | Model/year/PIN; electronic versus mechanical engine; actual diagnostic port |
| EXC: excavator | Cat, Komatsu, Hitachi, Volvo, Hyundai | Engine and machine controller identities; approved service/telematics connection |

For each row collect: make; model; year; machine PIN/serial; engine make/model;
ECU part number; voltage; diagnostic connector front and label photos; connector
part number; OEM wiring sheet; CAN/J1708/etc.; verified bitrate and engine source
address; required signals; permitted mounting location. Do not unplug controllers
or probe unknown pins to obtain these details. A mechanical engine may not offer
an electronic RPM/hour-meter feed; additional sensors would be a separate design.

## Shopping list A: buy for one offline bench prototype

| Qty | Item / purchasing specification | Purpose |
|---:|---|---|
| 1 | Espressif ESP32-DevKitC-32E, ESP32-WROOM-32E, fitted headers | Exact proposed controller; matches classic ESP32 code [7] |
| 1 | USB-A to Micro-B DATA cable (plus host adapter if needed) | Programming and bench power; not a charge-only cable [7] |
| 2 | Full-size solderless breadboards, or 1 board plus ESP32 breakout | Keep header rows accessible |
| 1 pack | Male-male and male-female jumper wires, ~20 of each | Low-voltage bench interconnects |
| 1 each | Green, yellow and red low-current through-hole LEDs | Run, supported data, missing/error indicators |
| 10 | 1k ohm, 0.25W resistors | One per LED, plus spares |
| 1 | Digital multimeter with continuity and DC measurement | Verify bench wiring and supplies |
| 1 | Computer with Arduino IDE or Cloud Agent and USB access | Compile, upload and Serial Monitor |

This set runs the internal-replay sketch without a machine, CAN module, Wi-Fi,
API token or TMM connection. USB is the only ESP32 supply in this stage. The
DevKitC guide warns against simultaneous alternative power feeds [7].

LED calculation (nominal red/yellow Vf=2.0V): I=(3.3-2.0)/1000=1.3mA.
Actual LED current depends on the selected LED's forward voltage. Each LED
needs its own resistor. They indicate device operation, not machine health.

## Shopping list B: add for an isolated physical CAN bench

| Qty | Item / condition | Purpose |
|---:|---|---|
| 1 | M5Stack Unit CAN U085, with supplied Grove and terminal leads; inspect revision [8,9] | Candidate isolated CAN transceiver with isolated power; not the non-isolated Mini CAN |
| 1 | Grove/HY2.0 4-pin breakout to the ESP32's labelled header pins | 5V logic-side supply, ground, TX and RX routing; follow actual revision drawing |
| 1 | Known CAN traffic source / USB-CAN test system with documented modes | Physical receiver test against known frames |
| As designed | Bench twisted-pair harness and 120-ohm endpoint resistors | Terminate the independent bench network at its two ends only |
| 1 optional | Independent CAN analyser with verified silent-monitor mode | Verify received frames and absence of collector transmissions |

U085 is a candidate, not an automotive/mine certification claim. The manufacturer
lists a 5V Grove input, CA-IS3050G isolated transceiver and isolated DC/DC; the
linked schematic shows a 3.3V host-logic domain [8,9]. Verify the delivered board
revision. Do not substitute an unidentified 5V RX-output module into ESP32 GPIO.

A normal CAN transmitter needs an acknowledging node. Our listen-only receiver
does not ACK. Configure the separate bench generator appropriately or include
an ACK-capable bench node; repeated transmitter errors on a two-node bench do
not by themselves prove the receiver is defective [10]. No generator goes on
the machine network during the passive pilot.

## Shopping list C: defer until one actual machine is identified

- One approved, model/PIN-specific diagnostic/telematics mating harness, with
  keyed connector, drawing, verified power and network assignments, weather seal
  and strain relief. Count contact positions, not merely populated contacts.
- Reviewed fused 12/24V-to-regulated-5V vehicle power design with reverse-polarity,
  overcurrent and transient/load-dump protection appropriate to the actual
  electrical system. A cheap nominal-input buck board is not this validation.
- Sealed enclosure, glands, keyed bulkhead connector, secure mounts, locking
  terminals/PCB, labels and antenna arrangement selected after thermal, space,
  ingress and vibration review. No breadboard or loose Dupont leads in service.
- If the machine uses J1708/J1587, a separate electrical interface and decoder;
  if CAN FD, different controller/interface support; if proprietary/secured,
  authorised signal definitions/access. Do not buy these before identification.
- SD/flash ring buffer and recovery design if historical offline retention is
  required; RTC if readings need trustworthy wall-clock time without networking;
  LTE modem, antenna, SIM and separate power design only if Wi-Fi is inadequate.
- Site-appropriate approved equipment/design for hazardous areas. The prototype
  is not intrinsically safe, a safety controller or mine-certified equipment.

Do not order five complete cable sets now. Build one bench unit, select one
documented machine, prove acquisition, then replicate per validated harness.
No supplier quotations or South African delivered prices are asserted here.

## Physical size: what can be stated today

OEM ECU dimensions: unknown without each ECU part number; there is no honest
ADT/FEL/GR/TLB/EXC size table from class names alone.

Our selected DevKitC V4 PCB drawing gives approximately 48.26 x 27.94mm [11].
U085's published body is 56 x 24 x 10.2mm [8]. These do not include connector
clearance, cable bends, USB access, isolation clearance, glands or a power stage.
A 150 x 100 x 60mm enclosure is only a provisional space-planning allowance,
not a selected product, verified fit or ECU dimension. Finalise after layout.

## The code we can run first

Project: integrations/esp32/TMM_Collector_Bench. No third-party Arduino libraries
required beyond the ESP32 board package. Default BENCH_MODE=1: boot self-test,
known internal J1939 RPM replay, 115200-baud JSON and three LEDs. The example
bytes decode to 1500rpm using PGN61444/SPN190 [12]. Every replay output is
labelled test_data:true. There is no external CAN traffic or network upload.

With BENCH_MODE=0, classic CAN is receive-only at a configured bitrate and ECU
source. GPIO5 -> transceiver TXD; transceiver RXD -> GPIO4. Do not attach those
GPIOs to the CAN wires. A supported reading older than five seconds becomes
rpm:null. No signal means unknown, not engine-off. Uptime is not an OEM hour
meter or a UTC timestamp. Only RPM is implemented; 21-parameter coverage is not
claimed. No DM1, fault clearing, ECU requests, CAN FD or legacy J1708 support.

This new offline sketch is separate from the earlier TMM_Device HTTPS sketch.
It follows the requested sequence: code -> bench LEDs/CAN -> verified machine
readings -> TMM transport. Compilation is not a physical execution test.

## Acceptance before TMM integration

1. Verify the sketch; upload to the exact board. Serial shows self-test PASS and
   test-labelled 1500rpm replay. Check green blink/yellow on/red off after data.
2. On an isolated bench CAN network, use known extended EEC1 frames and source;
   compare RPM. Exercise wrong source/PGN, unavailable data, stale/disconnected
   CAN, power restart and startup errors. Independently check no transmissions.
3. Review the machine harness, supply and site authorisation. Compare supported
   readings with the machine/reference instrument during an approved pilot.
4. Add verified hour-meter, temperature, pressure and DM1 mappings individually.
   Do not infer an OEM fault from a generic online code list or supply missing
   values as zero. Multi-packet DM1 requires transport handling and validation.
5. Add durable recording and authenticated upload to TMM; then test outage,
   replay, machine mapping, timestamps and automatic analysis/reporting.

## Sources

1. CSS Electronics, J1939 introduction and connector differences:
   https://www.csselectronics.com/pages/j1939-explained-simple-intro-tutorial/
2. CSS Electronics, Caterpillar 14-pin adapter and linked 9-pin variant:
   https://www.csselectronics.com/products/caterpillar-14-pin-db9-adapter-cable
3. Noregon, Komatsu 12-pin cable 121313:
   https://shop.noregon.com/komatsu-12pin-cable
4. Noregon, Volvo CE 8-pin cable 121305:
   https://shop.noregon.com/volvo-ce-8-pin-cable
5. Noregon, Volvo CE 14-pin cable 121306:
   https://shop.noregon.com/volvo-ce-14-pin-cable
6. Deere, OEM engine 9-pin diagnostic harness listing (historical, not price quote):
   https://www.deere.com/assets/pdfs/region-4/industries/government-and-military-sales/contracts/price-pages/agricultural/Ag%20Mgmt%20Systems_01Nov2023.pdf
7. Espressif, DevKitC V4 board/power/header guide:
   https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html
8. M5Stack, Unit CAN U085 specification and pin map:
   https://docs.m5stack.com/en/unit/Unit_CAN
9. M5Stack, linked U085 revision 1.1 schematic:
   https://m5stack-doc.oss-cn-shenzhen.aliyuncs.com/586/SCH_UNIT_ISOCAN_v1.1.pdf
10. Espressif, TWAI classic CAN/listen-only/ACK requirements:
    https://docs.espressif.com/projects/esp-idf/en/release-v5.4/esp32/api-reference/peripherals/twai.html
11. Espressif, DevKitC V4 dimensions:
    https://dl.espressif.com/dl/schematics/esp32_devkitc_v4_dimensions.pdf
12. Senquip, APN0012, EEC1/SPN190 decoding explanation:
    https://cdn.senquip.com/wp-content/uploads/2024/04/18103039/APN0012-Rev-1.0-Parsing-a-CAN-bus-message-with-a-Script.pdf
