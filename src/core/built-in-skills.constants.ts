import type { SkillDefinition } from './skill-definition.types';

/**
 * `/security-review`: a static security review of the pending change.
 *
 * A prompt rather than a new engine. The model reads the diff with the git
 * tool, the dependency scanner the project already has runs behind the normal
 * process approval, and everything lands in the findings view through the same
 * `workspace.quality report` a reviewer uses — so a scanner advisory and a
 * reviewer's finding about the same line collapse into one entry.
 *
 * The checklist is the one that catches real bugs in a diff, not a compliance
 * list: every item names something a reader can find in changed lines.
 */
const SECURITY_REVIEW: SkillDefinition = {
  name: 'security-review',
  description: 'Review the pending change for security issues and scan dependencies',
  argumentHint: '[focus or path]',
  body: [
    'Perform a security review of the pending change in this workspace. Focus: $ARGUMENTS',
    '',
    '1. Read the change with workspace.git diff (staged and unstaged). Review only changed lines and the code they call.',
    '2. Check each change for: injection (SQL, shell, template, path traversal), missing authentication or authorization and object-level access checks (IDOR), secrets or tokens in code, logs or errors, unsafe deserialization, SSRF and unvalidated URLs, weak or hand-rolled cryptography, missing input validation at trust boundaries, and XSS in rendered output.',
    '3. Run workspace.dependency-audit run with scanner auto. If it reports no-scanner, say which scanner would cover this project; do not install one.',
    '4. If the workspace has a SARIF report from a scanner, import it with workspace.scan import.',
    '5. Record every issue with workspace.quality report, source "security-review", with a concrete remediation and an honest confidence. Report nothing you cannot point to in the code.',
    '6. Finish with a short summary: counts by severity and whether anything blocks a release.',
    '',
    'Use only workspace tools. Do not send code or findings to any external service.',
  ].join('\n'),
};

/** The commands the extension ships, before any workspace or global skill. */
export const BUILT_IN_SKILLS: readonly SkillDefinition[] = [SECURITY_REVIEW];
