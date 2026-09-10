import { redactText } from './redaction';
import {
  MAX_INHERITED_BYTES,
  MAX_INHERITED_FINDINGS,
  MAX_INHERITED_PATHS,
} from './sub-agent-inheritance.constants';

import type { ParentRunContext, SubAgentInheritance } from './sub-agent-inheritance.types';

function boundedBytes(value: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= MAX_INHERITED_BYTES) return value;
  // Cut on a line boundary. A prompt truncated mid-sentence reads as though the
  // parent stopped mid-thought, and a model handed one tends to ask what came
  // next instead of doing the work.
  const lines = value.split('\n');
  let kept = '';
  for (const line of lines) {
    const next = kept.length === 0 ? line : `${kept}\n${line}`;
    if (encoder.encode(next).byteLength > MAX_INHERITED_BYTES) break;
    kept = next;
  }
  return kept;
}

function describeFindings(context: ParentRunContext): string[] {
  if (context.findings.length === 0) return [];
  const worst = context.findings.slice(0, MAX_INHERITED_FINDINGS);
  return [
    'Findings already raised on this work (do not re-report these):',
    ...worst.map(
      (finding) =>
        `- [${finding.severity}] ${finding.title} — ${finding.path}${
          finding.line === undefined ? '' : `:${String(finding.line)}`
        }`,
    ),
  ];
}

/**
 * What a child starts knowing about the run that spawned it.
 *
 * Sub-agents received a goal, a write set and a worktree, and nothing about why
 * they were asked. A reviewer would re-report a finding the parent had already
 * recorded; an implementer would rediscover a decision the parent made an hour
 * earlier and quietly make the opposite one.
 *
 * The two modes are separate because they answer different needs. `summary`
 * says what the parent is doing and what it has settled, which is what an
 * implementer needs. `findings` adds what has already been reported, which is
 * what a reviewer needs and what an implementer mostly does not.
 *
 * Everything is redacted before it is bounded, never after. Redaction shortens
 * text, so bounding first would cut at a position that shifts once secrets are
 * removed, and a secret could survive by sitting just past a boundary that
 * later moved.
 */
export function buildInheritedContext(
  mode: SubAgentInheritance,
  context: ParentRunContext,
): string {
  if (mode === 'none') return '';
  const parts = [
    `The run that delegated this work is doing: ${context.goal}`,
    context.decisions.length === 0
      ? ''
      : [
          'Decisions already made (do not relitigate):',
          ...context.decisions.map((d) => `- ${d}`),
        ].join('\n'),
    context.changedPaths.length === 0
      ? ''
      : [
          'Files the parent has already changed:',
          ...context.changedPaths.slice(0, MAX_INHERITED_PATHS).map((path) => `- ${path}`),
        ].join('\n'),
    mode === 'findings' ? describeFindings(context).join('\n') : '',
  ].filter((part) => part.length > 0);
  return boundedBytes(redactText(parts.join('\n\n')));
}
