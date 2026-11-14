# Five-machine central-pot trial

The producer `integrations/python/five_machine_simulator.py` supplies ADT,
GRADER, FEL, TLB and EXCAVATOR identities and explicitly simulated readings.
It uses no OEM credentials and does not contact an OEM. Initial hour meters
are illustrative: 4250, 3180, 5670, 1890 and 6320 hours respectively.

## Local verification

From the repository root:

```sh
python3 integrations/python/five_machine_simulator.py | python3 integrations/python/tmm_telemetry_bridge.py --dry-run
python3 -m unittest discover -s tests -p 'test_five_machine_simulator.py'
```

Expect five validated observations. Tests advance the clock without waiting;
they do not prove a deployed 15-minute collection cycle.

For continuous output, add `--watch` to the producer. It emits immediately,
then every 900 seconds. All engines run for this initial scenario, so each
meter advances 0.25 h per cycle. The first cycle has no faults; the second
introduces SPN/FMI examples automatically, the third repeats them, the fourth
has an empty active-fault list, and the sixth reintroduces them. No manual
fault entry is required. A restarted producer begins a new scenario and resets
its illustrative meters; do not treat this as a persistent lifetime meter.

## Hosted staging registration

The staging-only page `/telemetry/connections/five-machine-trial` lets a company
administrator enter a site and register all five simulation identities once.
It validates role, same origin and session CSRF. Existing non-simulation identity
conflicts stop registration. Repeating setup preserves the scenario start time.
A pause button stops future trial collection without deleting historical data.

The route and collector require both `TMM_FIVE_MACHINE_TRIAL=true` and the exact
isolated staging app origin. They are disabled in production. The first batch
is sent during registration through scoped authenticated intake; the existing
server cron supplies following batches every 15 minutes without Python or an
open browser. This exercises internal intake; it does not prove network transfer
from an external OEM. All machines have `status=simulation`, no live operating
meter or service schedule, and clearly labelled SIM IDs. Incoming readings retain
`test_data=true`. Live readings to simulation-only machines are rejected. These
machines are excluded from the automatic dashboard's live fleet and catalog.
Simulation analysis and reports never queue external delivery.

The Python producer remains a separate optional tool. It requires a running
process and is not used by the hosted five-machine collector.

## Acceptance evidence still required

1. Five identities discovered through an authenticated source.
2. Five simulation-only records registered/mapped, with live records isolated.
3. Initial readings displayed with source timestamps and simulation labels.
4. Two actual scheduled updates observed with the dashboard closed.
5. Automatic fault arrival and provider-defined clearing semantics verified.
6. Duplicate delivery adds no extra fault occurrences or machines.
7. Stored simulation reports remain separate from live reports and emails.

Local integration tests advance the clock to verify registration, repeat delivery,
scheduled hour-meter progression, automatic faults, stored reports and tenant
isolation. Actual deployed cycles still require observation after setup.
Production remains untouched.
