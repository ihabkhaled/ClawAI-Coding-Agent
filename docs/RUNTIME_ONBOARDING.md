# Runtime Studio onboarding

## Connection and models

Choose Local or Custom separately for the Backend and Frontend. Cloud remains unavailable until a hosted endpoint is finalized. Backend traffic owns authentication, entitlement, routing, provider credentials, inference, compare, judge, and research. The extension never asks for provider secrets.

Cloud and local models use the same Runtime Protocol V2. Capability truth comes from the selected execution target, not from model-specific UI branches. If Runtime V2 negotiation is unavailable, the extension visibly retains the supported V1 path.

## Workspace and permissions

Open the intended folder, review VS Code Workspace Trust, and choose Ask, Plan, Auto Edit, Autonomous Scoped, or an enterprise-locked policy. Approval scopes bind the account, backend, workspace, target, policy epoch, exact effect, and expiry. Changing any binding invalidates pending authority.

External output folders require a separate explicit grant. A planning request never grants execution. Commit, push, deployment, publication, production writes, and elevation are separate effects.

## Runtime dependencies

- Command and process tools use direct executable plus argument arrays; they do not accept arbitrary shell text.
- PTY support uses the packaged native dependency for the current extension host.
- Browser operations require a compatible Playwright Chromium installation. Navigation is origin-scoped; downloads are disabled unless policy explicitly enables them.
- Containers require a discovered Docker or Podman engine. The agent acts only on resources carrying its ownership labels.
- Database profiles store credentials in VS Code Secret Storage. Read and write statements are classified separately; production mutation is disabled unless policy explicitly enables it.
- Native elevation requires an installed, signed helper and interactive OS consent. Missing or headless helpers fail closed.

## Effort modes

Every run is bounded by a `RunBudget` — model turns, tool calls, tool rounds,
repair attempts, wall clock, output bytes and tool-result bytes. Until 0.54.0
that budget was one hardcoded constant, so a one-line edit and a cross-service
feature were allowed to spend exactly the same amount.

`clawAI.effortMode` now selects it. Six modes, weakest to strongest:

| Mode     | Model turns | Tool calls | Tool rounds | Repairs | Wall clock | Output | Tool result |
| -------- | ----------- | ---------- | ----------- | ------- | ---------- | ------ | ----------- |
| `LOW`    | 6           | 10         | 8           | 0       | 5 min      | 1 MiB  | 128 KiB     |
| `MEDIUM` | 12          | 25         | 20          | 1       | 15 min     | 2 MiB  | 256 KiB     |
| `HIGH`   | 20          | 45         | 40          | 1       | 30 min     | 4 MiB  | 512 KiB     |
| `MAX`    | 28          | 65         | 60          | 1       | 60 min     | 8 MiB  | 1 MiB       |
| `XHIGH`  | 34          | 85         | 80          | 1       | 90 min     | 12 MiB | 1 MiB       |
| `ULTRA`  | 40          | 100        | 100         | 1       | 120 min    | 16 MiB | 1 MiB       |

`ULTRA` is the default and is byte-identical to the budget every run used
before effort modes existed, so upgrading changes nothing until a lower mode is
chosen. Selecting less is opt-in.

The modes are not decorative labels. `effort-mode.test.ts` fails if any two
resolve to the same budget, if a stronger mode buys less of any dimension, or
if `ULTRA` stops matching the historical constant.
`runtime-studio-effort-budget.test.ts` fails if the runtime stops sending the
selected mode's budget to the transport.

Two limits are the schema's, not the ladder's. `maxRepairAttempts` is bounded
`0..1`, so it cannot form a six-step ladder — `LOW` spends it and every other
mode keeps its single repair. Wall clock, output bytes and tool-result bytes
were already pinned at the schema ceiling before effort modes existed, so the
ladder reaches that ceiling at `ULTRA` rather than exceeding today's behaviour.

Each run's trace and journal record the mode in force, so cost can be
attributed to the setting that chose it, and two runs at different efforts
produce different policy snapshot hashes.

## Privacy and evidence

Runtime journals are encrypted with a random key held in VS Code Secret Storage. Evidence exports are sanitized, exclude hidden reasoning and credentials, and include an integrity hash chain. Remote telemetry is off by default and requires explicit policy plus user authorization.

## Recovery

Durable runs can resume only after account, workspace, target, policy, files, Git HEAD, and owned process/service state are revalidated. An uncertain non-repeatable effect blocks replay and requires a new decision. Users can inspect, safely export, or delete journals from the Runtime Studio.
