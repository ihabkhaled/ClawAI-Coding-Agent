import { describe, expect, it } from 'vitest';

import {
  browserOrigin,
  BrowserTakeoverState,
  hashBrowserArtifact,
  isOriginAllowed,
} from '../../src/core/browser-operation';
import { classifyDatabaseStatement } from '../../src/core/database-statement-policy';
import {
  orderServiceDefinitions,
  type ServiceDefinition,
} from '../../src/core/development-service';
import { applyExactHunks, contentHash } from '../../src/core/file-transaction';
import {
  inspectQualityEvidence,
  parseQualityDiagnostics,
  QualityRepairBudget,
} from '../../src/core/quality-graph';
import {
  classifyDeliveryState,
  instructionAuthority,
} from '../../src/core/workspace-intelligence-graph';

describe('God Mode pure contracts', () => {
  it('enforces browser origin and takeover boundaries', () => {
    const scope = {
      allowedOrigins: ['https://claw.local'],
      allowExternalNavigationWithApproval: true,
      allowDownloads: false,
      maxDownloadBytes: 1024,
    };
    expect(browserOrigin('https://claw.local/path')).toBe('https://claw.local');
    expect(isOriginAllowed('https://claw.local/chat', scope)).toBe(true);
    expect(isOriginAllowed('https://example.com', scope)).toBe(false);
    expect(() => browserOrigin('file:///secret')).toThrow(/scheme/u);
    expect(hashBrowserArtifact(new TextEncoder().encode('evidence'))).toMatch(/^sha256:/u);

    const takeover = new BrowserTakeoverState();
    takeover.takeOver();
    expect(takeover.currentOwner()).toBe('user');
    expect(() => {
      takeover.assertAgentControl();
    }).toThrow(/paused/u);
    takeover.returnControl();
    expect(takeover.currentOwner()).toBe('agent');
  });

  it('classifies database statements conservatively', () => {
    expect(classifyDatabaseStatement('SELECT * FROM users').classification).toBe('read');
    expect(classifyDatabaseStatement('UPDATE users SET active = true').classification).toBe(
      'write',
    );
    expect(classifyDatabaseStatement('CREATE TABLE audit(id int)').classification).toBe('ddl');
    expect(
      classifyDatabaseStatement("COPY users TO PROGRAM 'curl example.com'").classification,
    ).toBe('shell-file');
    expect(classifyDatabaseStatement('SELECT 1; DELETE FROM users').classification).toBe(
      'ambiguous',
    );
  });

  it('orders development services by declared dependencies', () => {
    const service = (serviceId: string, dependencies: string[]): ServiceDefinition => ({
      serviceId,
      label: serviceId,
      kind: 'vscode-task',
      targetId: 'target:workspace',
      dependencies,
      expectedPorts: [],
      environmentOverlay: {},
      restartPolicy: 'on-change',
      maxRestarts: 3,
      restartWindowMs: 60_000,
    });
    const levels = orderServiceDefinitions([
      service('frontend', ['api']),
      service('database', []),
      service('api', ['database']),
    ]);
    expect(levels.map((level) => level.map(({ serviceId }) => serviceId))).toEqual([
      ['database'],
      ['api'],
      ['frontend'],
    ]);
    expect(() => orderServiceDefinitions([service('a-service', ['b-service'])])).toThrow(
      /cycle|unknown/u,
    );
  });

  it('applies exact file hunks and rejects stale content', () => {
    expect(applyExactHunks('alpha\nbeta\n', [{ before: 'beta', after: 'gamma' }])).toBe(
      'alpha\ngamma\n',
    );
    expect(() => applyExactHunks('alpha\n', [{ before: 'missing', after: 'gamma' }])).toThrow();
    expect(contentHash('same')).toBe(contentHash(new TextEncoder().encode('same')));
  });

  it('requires root-cause classification before bounded quality repair', () => {
    const budget = new QualityRepairBudget(1);
    expect(() => budget.consume()).toThrow(/classification/u);
    budget.classify('product-regression');
    expect(budget.consume()).toBe(1);
    expect(() => budget.consume()).toThrow(/exhausted/u);
    expect(inspectQualityEvidence('coverage threshold failed; test.only; flaky')).toEqual({
      flaky: true,
      skippedOrFocused: true,
      snapshotChanged: false,
      coverageThresholdFailed: true,
    });
    expect(parseQualityDiagnostics('src/a.ts:4:2 - error broken')[0]).toMatchObject({
      file: 'src/a.ts',
      line: 4,
      column: 2,
      severity: 'error',
    });
  });

  it('keeps delivery claims evidence-based and instruction authority deterministic', () => {
    expect(
      classifyDeliveryState({
        declaration: false,
        caller: false,
        route: false,
        test: false,
        documentation: false,
        packageArtifact: false,
        releaseEvidence: false,
      }),
    ).toBe('missing');
    expect(
      classifyDeliveryState({
        declaration: true,
        caller: true,
        route: true,
        test: true,
        documentation: true,
        packageArtifact: true,
        releaseEvidence: false,
      }),
    ).toBe('packaged');
    expect(instructionAuthority('CLAUDE.md')).toBeLessThan(instructionAuthority('AGENTS.md'));
    expect(instructionAuthority('random.md')).toBe(Number.MAX_SAFE_INTEGER);
  });
});
