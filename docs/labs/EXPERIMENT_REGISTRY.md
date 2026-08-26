# Experiment Registry

| ID      | Status | Result | Evidence                                                                       |
| ------- | ------ | ------ | ------------------------------------------------------------------------------ |
| B-001   | passed | pass   | Git/package/VS Code identities captured without changing user work             |
| B-003   | passed | pass   | README/package/API truth is enforced for candidate `0.64.4`                    |
| B-005   | passed | pass   | 170 files, 1,158 tests; coverage and every source/package gate pass            |
| B-008   | passed | pass   | VS Code 1.135.0 extension-host activation exited 0                             |
| B-009   | passed | pass   | 45 visual tests pass twice; six intentional Windows baselines inspected        |
| B-010   | passed | pass   | Two clean profiles install 0.64.4 and activate the exact unpacked VSIX bits    |
| B-014   | passed | pass   | VSIX hash, manifest, source-bound provenance, SBOMs, and negative control pass |
| SD-005  | passed | pass   | Active runs resume from encrypted capsule/cursor with restored budget          |
| SD-006  | passed | pass   | Epoch, binding, fingerprint, handle, and uncertain-effect drift fails closed   |
| SEC-001 | passed | pass   | Runtime security and isolation suite passes with zero production advisories    |
| ST-001  | passed | pass   | 20/20 restart, drift, idempotency, cursor, and security stress cycles pass     |
| UI-001  | passed | pass   | Both installed VSIX profiles activate and open the real workbench command      |

Raw attempts belong under ignored `.clawai-lab/runs/<experiment>/<attempt>/`.
No skipped or unavailable lane is counted as passed.
