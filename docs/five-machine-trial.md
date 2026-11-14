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

## Staging integration boundary

Current discovery accepts identity-bearing observations, but the site assignment
route refuses simulation registration into `machines`. Therefore this producer
alone does NOT complete automatic fleet registration or analysis/reporting for
five unknown simulated machines. Do not strip `test_data` to bypass that rule.

Before the full trial, provide a simulation-only registration/mapping path and
an authenticated staging connection. Reuse the existing durable Python bridge
for network transfer, with its documented environment credentials and an
independent persistent spool. No credentials belong in source control.

Continuous producer output requires a running host/service. This script does
not install a scheduler, deploy a Worker, or start an unattended cloud service.
The existing Worker schedule processes received data; it does not automatically
start this external producer. A hosted source/simulator needs deployment before
claiming end-to-end unattended collection.

## Acceptance evidence still required

1. Five identities discovered through an authenticated source.
2. Five simulation-only records registered/mapped, with live records isolated.
3. Initial readings displayed with source timestamps and simulation labels.
4. Two actual scheduled updates observed with the dashboard closed.
5. Automatic fault arrival and provider-defined clearing semantics verified.
6. Duplicate delivery adds no extra fault occurrences or machines.
7. Stored simulation reports remain separate from live reports and emails.

No live staging transfer, real OEM connection or deployment is claimed by the
local checks. Production remains untouched.
