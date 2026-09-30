import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { lifecycleHookSchema } from '../../src/core/lifecycle-hook';
import { admitMcpServers } from '../../src/core/mcp/mcp-server-policy';
import { classifiedOperation } from '../../src/core/runtime/runtime-operation-classification';
import { LifecycleHookService } from '../../src/services/lifecycle-hook-service';
import { classify } from '../../src/services/runtime-policy-v2-adapter';
import {
  decide,
  MATRIX_CEILINGS,
  MATRIX_MODES,
  type MatrixScenario,
  type Verdict,
} from '../helpers/permission-matrix';
import { discoverToolOperations } from '../helpers/permission-matrix-discovery';
import { renderPermissionMatrix } from '../helpers/permission-matrix-doc';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const ROOT = process.cwd();
const DOC_PATH = join(ROOT, 'docs', 'PERMISSION_MATRIX.md');
const operations = discoverToolOperations(ROOT);
const SEVERITY: Readonly<Record<Verdict, number>> = { allow: 0, ask: 1, deny: 2 };
/** Weakest to strongest; the order ADR 0003 ranks the modes in. */
const MODE_ORDER = MATRIX_MODES;

interface Classified {
  readonly key: string;
  readonly tool: string;
  readonly operation: string;
  readonly effect: string;
}

const classified: readonly Classified[] = operations.map(({ tool, operation }) => ({
  key: `${tool}.${operation}`,
  tool,
  operation,
  effect: classify({ toolName: tool, operation } as ToolInvocation).effect,
}));
const nonRead = classified.filter((item) => item.effect !== 'read');

/** Every verdict for every operation under one scenario shape, computed once. */
async function verdicts(build: (item: Classified) => MatrixScenario): Promise<Verdict[]> {
  return Promise.all(
    classified.map(async (item) => (await decide(item.tool, item.operation, build(item))).verdict),
  );
}

describe('permission matrix: classification', () => {
  it('finds the registered tool operations', () => {
    // A floor, so a scan that quietly stops finding definitions fails loudly.
    expect(operations.length).toBeGreaterThan(180);
    expect(new Set(operations.map((item) => item.tool)).size).toBeGreaterThan(35);
  });

  it('classifies every registered operation explicitly (present is not wired)', () => {
    const missing = operations
      .filter(({ tool, operation }) => classifiedOperation(tool, operation) === undefined)
      .map(({ tool, operation }) => `${tool}.${operation}`);
    expect(missing).toEqual([]);
  });

  it('treats an operation nobody classified as an asked, irreversible mutation, never a read', async () => {
    const result = classify({
      toolName: 'workspace.new',
      operation: 'frobnicate',
    } as ToolInvocation);
    expect(result).toMatchObject({ effect: 'local-mutation', risk: 'R3', reversible: false });
    await expect(
      decide('workspace.new', 'frobnicate', { mode: 'AUTONOMOUS_SCOPED' }),
    ).resolves.toMatchObject({
      verdict: 'ask',
    });
    await expect(decide('workspace.new', 'frobnicate', { mode: 'PLAN' })).resolves.toMatchObject({
      verdict: 'deny',
    });
  });

  // An operation whose name says it changes something must not be classed a read.
  // The listed exceptions start or stop a trace or read a stored file, not the workspace.
  const MUTATING_WORD =
    /(?:^|-)(?:write|create|delete|remove|update|patch|rename|copy|mkdir|push|publish|tag|commit|merge|rebase|stage|unstage|stash|revert|pull|start|stop|restart|run|exec|click|fill|type|upload|download|drag|select|keyboard|insert|replace|apply|terminate|pause|resume|register|restore|save|post|send|trigger|enter|exit|apply|migration|integrate|execute)(?:-|$)/u;
  const READ_EXCEPTIONS = new Set([
    'workspace.browser.trace-start',
    'workspace.browser.trace-stop',
  ]);

  it('never classes an operation with a mutating name as a read', () => {
    const offenders = classified
      .filter((item) => item.effect === 'read' && MUTATING_WORD.test(item.operation))
      .filter((item) => !READ_EXCEPTIONS.has(item.key))
      .map((item) => item.key);
    expect(offenders).toEqual([]);
  });
});

describe('permission matrix: plan and organization ceilings', () => {
  it('denies every non-read operation in Plan mode, at every risk class', async () => {
    for (const item of nonRead) {
      const result = await decide(item.tool, item.operation, { mode: 'PLAN' });
      expect(result.verdict, item.key).toBe('deny');
    }
  });

  it('denies every non-read operation under a Plan ceiling, whatever mode is configured', async () => {
    for (const mode of MODE_ORDER) {
      const results = await verdicts(() => ({ mode, ceiling: 'PLAN' }));
      classified.forEach((item, index) => {
        if (item.effect !== 'read') expect(results[index], `${mode} ${item.key}`).toBe('deny');
      });
    }
  });

  it('never auto-allows a non-read operation under an Ask ceiling', async () => {
    for (const mode of MODE_ORDER) {
      const results = await verdicts(() => ({ mode, ceiling: 'ASK' }));
      classified.forEach((item, index) => {
        if (item.effect !== 'read') expect(results[index], `${mode} ${item.key}`).not.toBe('allow');
      });
    }
  });

  it('never loosens a non-read decision when the ceiling gets stricter', async () => {
    for (const mode of MODE_ORDER) {
      const byCeiling = await Promise.all(
        MATRIX_CEILINGS.map((ceiling) => verdicts(() => ({ mode, ceiling }))),
      );
      // MATRIX_CEILINGS runs loosest to strictest: none, Plan, Ask. Order it by strictness.
      const [none, plan, ask] = byCeiling;
      classified.forEach((item, index) => {
        if (item.effect === 'read') return;
        const sev = (list: Verdict[] | undefined): number => SEVERITY[list?.[index] ?? 'allow'];
        expect(sev(ask), `${mode} ${item.key} ask>=none`).toBeGreaterThanOrEqual(sev(none));
        expect(sev(plan), `${mode} ${item.key} plan>=ask`).toBeGreaterThanOrEqual(sev(ask));
      });
    }
  });

  it('never loosens a non-read decision when the mode gets stricter', async () => {
    const byMode = await Promise.all(MODE_ORDER.map((mode) => verdicts(() => ({ mode }))));
    for (let stricter = 0; stricter < MODE_ORDER.length - 1; stricter += 1) {
      classified.forEach((item, index) => {
        if (item.effect === 'read') return;
        const strict = SEVERITY[byMode[stricter]?.[index] ?? 'allow'];
        const looser = SEVERITY[byMode[stricter + 1]?.[index] ?? 'allow'];
        expect(
          strict,
          `${String(MODE_ORDER[stricter])} vs ${String(MODE_ORDER[stricter + 1])}: ${item.key}`,
        ).toBeGreaterThanOrEqual(looser);
      });
    }
  });

  it('holds a mode above the ceiling at the ceiling, however the setting was written', async () => {
    for (const mode of ['BYPASS_PERMISSIONS', 'EDIT_AUTOMATICALLY', 'MANUAL'] as const) {
      const result = await decide('workspace.files', 'update', { mode, ceiling: 'PLAN' });
      expect(result.verdict, mode).toBe('deny');
    }
  });
});

describe('permission matrix: deny beats allow', () => {
  const denyRule = (item: Classified) => ({
    rules: [
      { tool: item.tool, operation: item.operation, outcome: 'ask' as const, reason: 'review' },
      { tool: item.tool, operation: item.operation, outcome: 'deny' as const, reason: 'forbidden' },
    ],
  });

  it('lets a project deny rule beat every mode for every operation, even R4 and reads', async () => {
    for (const mode of MODE_ORDER) {
      const results = await verdicts((item) => ({ mode, project: denyRule(item) }));
      classified.forEach((item, index) => {
        expect(results[index], `${mode} ${item.key}`).toBe('deny');
      });
    }
  });

  it('lets a project denied effect beat every mode', async () => {
    for (const mode of MODE_ORDER) {
      const results = await verdicts((item) => ({
        mode,
        project: { deniedEffects: [item.effect as 'read'] },
      }));
      classified.forEach((item, index) => {
        expect(results[index], `${mode} ${item.key}`).toBe('deny');
      });
    }
  });

  it('lets an organization denied effect and a project ask rule coexist with deny winning', async () => {
    for (const item of classified) {
      const result = await decide(item.tool, item.operation, {
        mode: 'AUTONOMOUS_SCOPED',
        organization: { deniedEffects: [item.effect] },
        project: { rules: [{ tool: item.tool, outcome: 'ask', reason: 'review' }] },
      });
      expect(result.verdict, item.key).toBe('deny');
    }
  });

  it('lets an organization deny rule beat the destructive rail', async () => {
    const result = await decide('workspace.files', 'delete', {
      mode: 'AUTONOMOUS_SCOPED',
      organization: { rules: [{ tool: 'workspace.files', outcome: 'deny', reason: 'never' }] },
    });
    expect(result.verdict).toBe('deny');
  });

  it('never lets a deny rule on a path be turned into a question by the destructive rail', async () => {
    const result = await decide('workspace.files', 'delete', {
      mode: 'ASK',
      arguments: { path: 'infra/prod/state.tf' },
      project: {
        rules: [{ pathGlob: 'infra/**', outcome: 'deny', reason: 'infra is off limits' }],
      },
    });
    expect(result).toMatchObject({ verdict: 'deny', code: 'PROJECT_RULE_DENIED' });
  });
});

describe('permission matrix: untrusted workspace', () => {
  it('denies every operation in every mode under every ceiling', async () => {
    for (const mode of MODE_ORDER) {
      for (const ceiling of MATRIX_CEILINGS) {
        const results = await verdicts(() => ({ mode, ceiling, trusted: false }));
        classified.forEach((item, index) => {
          expect(results[index], `${mode}/${String(ceiling)} ${item.key}`).toBe('deny');
        });
      }
    }
  });

  it('starts no lifecycle hook', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, timedOut: false }));
    const service = new LifecycleHookService({
      runner: { run },
      hooks: () => [lifecycleHookSchema.parse({ event: 'before-tool', command: 'guard' })],
      trusted: () => false,
      log: vi.fn(),
    });
    for (const event of ['run-start', 'run-end', 'before-tool', 'after-tool'] as const) {
      await service.run(event, 'workspace.files');
    }
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'plugin', 'user'] as const)('refuses a %s stdio MCP server', (origin) => {
    const stdio = {
      name: 'local',
      origin,
      transport: 'stdio',
      command: 'node',
      args: [],
      env: {},
    } as const;
    const { admitted, refused } = admitMcpServers([stdio], {}, false);
    expect(admitted).toEqual([]);
    expect(refused).toEqual([expect.objectContaining({ code: 'MCP_WORKSPACE_UNTRUSTED' })]);
  });

  it('cannot create, list or delete a scheduled task, run a plugin command or start a process', async () => {
    const targets = classified.filter(
      (item) =>
        item.tool === 'runtime.schedule' ||
        item.tool === 'workspace.process' ||
        item.tool === 'workspace.command',
    );
    expect(targets.length).toBeGreaterThan(10);
    for (const item of targets) {
      const result = await decide(item.tool, item.operation, {
        mode: 'AUTONOMOUS_SCOPED',
        trusted: false,
      });
      expect(result, item.key).toMatchObject({ verdict: 'deny', code: 'WORKSPACE_UNTRUSTED' });
    }
  });
});

describe('permission matrix: the committed document', () => {
  let rendered = '';
  beforeAll(async () => {
    rendered = await renderPermissionMatrix(operations);
    // `npm run permissions:matrix` sets this; the test then rewrites the file it would compare.
    if (process.env.UPDATE_PERMISSION_MATRIX === '1') writeFileSync(DOC_PATH, rendered, 'utf8');
  });

  it('matches what the policy computes now (run `npm run permissions:matrix` to refresh)', () => {
    expect(readFileSync(DOC_PATH, 'utf8').replaceAll('\r\n', '\n')).toBe(rendered);
  });
});
