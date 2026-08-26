# Production Readiness Scorecard

## Wave 1 verdict

**Eligible.** The evidence-weighted raw and enforced score is **92.35**.

All eleven category minima pass. No hard cap applies. The machine-readable input
is `docs/labs/READINESS_INPUT.json` and is evaluated by the tested
`calculateReadinessScore` function.

The two formerly failing categories now meet their conservative minima:

- session durability: 0.90 earned versus 0.90 required;
- recovery/idempotency: 0.90 earned versus 0.90 required.

Evidence includes fail-closed active-run recovery, restored cursor and budget,
20 repeated stress cycles, 1,158 source tests, 45 browser tests, source host
activation, and two installed-artifact workbench-command replays. Publication,
tagging, and remote release remain authorization gates and earn no points.
