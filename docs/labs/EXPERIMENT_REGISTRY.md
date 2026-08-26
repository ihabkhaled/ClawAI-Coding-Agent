# Experiment Registry

| ID     | Status       | Result       | Evidence                                                                   |
| ------ | ------------ | ------------ | -------------------------------------------------------------------------- |
| B-001  | passed       | pass         | Git/package/VS Code identities captured without changing user work         |
| B-003  | passed       | pass         | README/package/API truth is enforced for candidate `0.64.3`                |
| B-005  | passed       | pass         | 167 files, 1,147 tests; coverage and every source/package gate pass        |
| B-008  | passed       | pass         | VS Code 1.135.0 extension-host activation exited 0                         |
| B-009  | passed       | pass         | 45 visual tests pass twice; six intentional Windows baselines inspected    |
| B-010  | needs replay | inconclusive | Candidate source passes; isolated 0.64.3 installation is pending           |
| B-014  | partial      | inconclusive | Provenance source binding is implemented; clean-source artifact is pending |
| SD-005 | partial      | fail         | Durable metadata exists; active Runtime V2 run reconstruction is not wired |

Raw attempts belong under ignored `.clawai-lab/runs/<experiment>/<attempt>/`.
No skipped or unavailable lane is counted as passed.
