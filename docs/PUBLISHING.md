# Publishing

Every push to `main` is a ClawAI Coding Agent release.

## Versioning

The repository-managed pre-commit hook automatically advances one delivery minor
from `origin/main`:

```
1.90.0 -> 1.91.0 -> 1.92.0
```

It updates `package.json`, both root package-lock version fields, the README
version sentence and a missing CHANGELOG heading, then stages those files.
`scripts/verify-version-bump.mjs` independently enforces the same rule in CI.

Local installs enable `.githooks` through the package `prepare` script. Never
use `--no-verify`.

## Split CI and artifact ordering

CI intentionally separates the former five-minute "Quality and VSIX" lane:

- Version
- Quality
- Unit and coverage
- Extension host
- Webview end-to-end
- Runtime dependency audit
- Package VSIX

The first six can run in parallel. **Package VSIX depends on every one of them**
and therefore runs last. It generates:

- `clawai-coding-agent-<version>.vsix`
- VSIX SHA-256
- CycloneDX SBOM + SHA-256
- SPDX SBOM + SHA-256
- in-toto/SLSA provenance + SHA-256

These files are CI outputs, not committed release inputs.

## Automatic Release and Marketplace publication

A successful CI run caused by a push to `main` triggers `.github/workflows/release.yml`.
That workflow:

1. checks out the exact successful CI commit;
2. rejects an already-existing `v<version>`;
3. downloads the final `clawai-coding-agent-release` artifact from that CI run;
4. verifies every checksum and the provenance Git SHA;
5. creates the matching GitHub Release with the CHANGELOG section;
6. publishes the **same VSIX** to the Visual Studio Marketplace.

The Marketplace publisher is `clawai`. The repository secret `VSCE_PAT` must
contain an Azure DevOps PAT with Marketplace **Manage** permission. It is
required: if it is absent or invalid, Release fails instead of silently claiming
success. This repository has already successfully published prior versions
through that step.

Open VSX publication is optional and runs only when `OVSX_PAT` exists.

## Shipping

Use `npm run ship`, never a direct push to main. Done means CI green, Release
green, GitHub Release created, and VS Code Marketplace publication successful.
