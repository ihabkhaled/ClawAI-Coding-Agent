// UserPromptSubmit hook: prints a short reminder that goes into the model's context on every prompt.
// Display-only: no network, no file access, never returns a permission decision, always exits 0.
// Rule: docs/RULES.md rule 17. Decision: docs/adr/0009-akinator-runs-on-every-change.md.
import process from 'node:process';

const lines = [
  'AKINATOR RUNS ON EVERY CHANGE, NO COMMAND NEEDED (docs/RULES.md rule 17): ask, resolve, audit, plan, implement, document, skillify, rule, contextify, memoize, index+sync, verify. Procedure: skills/akinator/SKILL.md.',
  'DECLARE THE KNOWLEDGE DELTA BY PATH, OR WRITE "knowledge delta: none, because <reason>". THE WIKI (docs/wiki/) MOVES WITH THE CODE.',
];
process.stdout.write(`${lines.join('\n')}\n`);
process.exit(0);
