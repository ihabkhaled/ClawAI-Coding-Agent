# Production Readiness Scorecard

## Wave 0 verdict

**Not eligible for an 85+ claim.** The evidence-weighted raw score is 85.8, but
the enforced score is 74.

Failed category minima:

- session durability: 0.50 earned versus 0.90 required;
- recovery/idempotency: 0.80 earned versus 0.90 required.

Active hard caps:

- installed artifact activation is proven, but installed extension-host visual
  workbench replay is absent: maximum 74;
- crash/reconnect/resume/soak evidence is absent: maximum 79.

The most restrictive cap is 74. Active-run restart recovery is an open P0, so
the candidate remains ineligible regardless of its raw weighted score. No
future-wave, skipped, blocked, or unavailable experiment earns points.
