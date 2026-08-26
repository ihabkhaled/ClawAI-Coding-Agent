# Production Readiness Scorecard

## Baseline verdict

**Not eligible for an 85+ claim.** The score is intentionally not awarded before
the experiment records are normalized through the Wave 0 scorer.

Hard caps currently active:

- no installed-VSIX replay for the candidate: maximum 69;
- no complete extension-host UI evidence: maximum 74;
- no crash/reconnect/resume/soak evidence: maximum 79;
- release documentation/provenance drift: maximum 84.

The most restrictive cap is 69. Active-run restart recovery is an open P0, so a
release candidate is ineligible regardless of its raw weighted score.
