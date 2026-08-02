# Runtime Protocol V2 threat model

## Assets and boundaries

Protected assets include workspace files, Git state, process trees, containers, database credentials/data, browser sessions, OS authority, journals, evidence, provider credentials, and publication rights. The backend is authoritative for identity, entitlement, routing, inference, and provider secrets. The extension is authoritative for local capability truth, approvals, execution, cancellation, stale-state checks, and evidence.

## Primary threats and controls

| Threat                                     | Required control                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Prompt injection requests a dangerous tool | Structured tool catalog, policy classification, exact approval, immutable safety rails                   |
| Confused deputy changes target or scope    | Account/workspace/target/policy epochs and target identity hash in every invocation                      |
| Path traversal, symlink escape, or TOCTOU  | Canonical URI containment, before-hash preconditions, transactional revalidation                         |
| Shell injection                            | Direct executable/argument contracts; shell text is not a tool input                                     |
| Secret disclosure                          | Secret Storage handles, environment-key denylist, result redaction and bounded JSON                      |
| Replay or duplicate events                 | Idempotency keys, ordered sequences, one-shot capabilities, non-repeatable effect blocking               |
| Target drift/reconnect                     | Capability and identity revalidation, epoch increment, cancellation and owned cleanup                    |
| Browser exfiltration                       | Isolated contexts, origin policy, explicit external navigation, download byte limits, sanitized evidence |
| Container/DB destructive action            | Ownership labels, statement classification, production denial, separate R4 approval                      |
| Elevation abuse                            | Signed single-operation envelope/receipt, executable and argument hashes, nonce/expiry, native consent   |
| Multi-agent races                          | DAG dependencies, write sets, leases, isolated worktrees, integrator-only publication                    |
| Journal theft/corruption                   | AES-256-GCM with Secret Storage key, strict schema, safe export, corrupt-store denial                    |
| Supply-chain substitution                  | Locked dependencies, SBOM, artifact hashes, reproducible package comparison, signed release evidence     |

## Immutable rails

Enterprise policy may narrow access but cannot permit unrestricted shell elevation, hidden reasoning export, provider-secret exposure, silent telemetry, implicit cross-target file transfer, automatic publication, or destructive unowned-process cleanup.

## Release blockers

Critical/high vulnerabilities, RCE, path escape, authorization bypass, stale-state races, secret leakage, data loss, replayed effects, or orphaned elevated helpers block release. Unsupported or untested platform paths must be labeled honestly rather than inferred from compilation.
