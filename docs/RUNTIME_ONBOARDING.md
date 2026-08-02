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

## Privacy and evidence

Runtime journals are encrypted with a random key held in VS Code Secret Storage. Evidence exports are sanitized, exclude hidden reasoning and credentials, and include an integrity hash chain. Remote telemetry is off by default and requires explicit policy plus user authorization.

## Recovery

Durable runs can resume only after account, workspace, target, policy, files, Git HEAD, and owned process/service state are revalidated. An uncertain non-repeatable effect blocks replay and requires a new decision. Users can inspect, safely export, or delete journals from the Runtime Studio.
