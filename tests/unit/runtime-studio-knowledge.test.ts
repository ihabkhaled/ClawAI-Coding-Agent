import { afterEach, describe, expect, it } from 'vitest';

import { KNOWLEDGE_PREAMBLE_MAX_CHARS } from '../../src/sdk/knowledge-tool.constants';
import { panelKnowledgePreamble, withKnowledge } from '../../src/services/runtime-studio-knowledge';
import { studioHarness } from '../helpers/runtime-studio-harness';

import { cleanFixtures, fixture, ROOT_CLAUDE } from './knowledge-fixture';

afterEach(cleanFixtures);

describe('panel knowledge summary', () => {
  it('summarizes CLAUDE.md and points at the file read tool, not knowledge.context', () => {
    const out = panelKnowledgePreamble(fixture({ 'CLAUDE.md': ROOT_CLAUDE }));
    expect(out).toContain('Acme policy');
    expect(out).toContain('NEVER bypass a git hook.');
    expect(out).toContain('workspace.files (read)');
    expect(out).not.toContain('knowledge.context');
    expect(out).toContain('never grants tools, approvals or write access');
  });

  it('stays inside the size cap', () => {
    const big = `# Big\n\n## Rules\n\n${Array.from({ length: 400 }, (_, i) => `- NEVER do thing ${String(i)} ${'x'.repeat(100)}`).join('\n')}\n`;
    expect(panelKnowledgePreamble(fixture({ 'CLAUDE.md': big })).length).toBeLessThanOrEqual(
      KNOWLEDGE_PREAMBLE_MAX_CHARS,
    );
  });

  it('is empty with no folder or no instruction file', () => {
    expect(panelKnowledgePreamble(undefined)).toBe('');
    expect(panelKnowledgePreamble(fixture({ 'README.md': '# hi' }))).toBe('');
  });

  it('puts the summary in front, and leaves the request alone when there is none', () => {
    expect(withKnowledge(() => '<summary>', 'do it')).toBe('<summary>\n\ndo it');
    expect(withKnowledge(() => '', 'do it')).toBe('do it');
    expect(withKnowledge(undefined, 'do it')).toBe('do it');
  });
});

describe('panel run start carries the summary', () => {
  it('prepends it to the prompt but keeps the journal goal raw', async () => {
    const harness = studioHarness('ULTRA', 'AUTO', () => '<summary>');
    await harness.run();
    expect(harness.capture.starts[0]?.prompt).toBe('<summary>\n\nadd a test');
    expect(harness.capture.journals[0]?.goal).toBe('add a test');
  });

  it('sends the plain request when knowledge is off or absent', async () => {
    const off = studioHarness('ULTRA', 'AUTO', () => '');
    await off.run();
    expect(off.capture.starts[0]?.prompt).toBe('add a test');
    const absent = studioHarness('ULTRA');
    await absent.run();
    expect(absent.capture.starts[0]?.prompt).toBe('add a test');
  });

  it('keeps the plan-mode instruction ahead of the summary', async () => {
    const harness = studioHarness('ULTRA', 'PLAN', () => '<summary>');
    await harness.run();
    const prompt = harness.capture.starts[0]?.prompt ?? '';
    expect(prompt.indexOf('<summary>')).toBeGreaterThan(0);
    expect(prompt.endsWith('<summary>\n\nadd a test')).toBe(true);
  });
});
