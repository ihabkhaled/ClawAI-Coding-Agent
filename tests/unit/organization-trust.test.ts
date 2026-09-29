import { describe, expect, it } from 'vitest';

import { evaluatePolicyV2 } from '../../src/core/policy-v2';

const request = (
  overrides: Record<string, unknown> = {},
  subject: Record<string, unknown> = {},
) => ({
  runId: 'run:1',
  invocationHash: `sha256:${'a'.repeat(64)}`,
  mode: 'AUTONOMOUS_SCOPED',
  risk: 'R2',
  effect: 'local-mutation',
  scope: {
    accountId: 'account:1',
    backendOrigin: 'https://claw.local',
    workspaceId: 'workspace:1',
    targetId: 'target:workspace',
    root: 'file:///w',
  },
  workspaceTrusted: true,
  userPresent: true,
  reversible: true,
  subject: { tool: 'workspace.command', operation: 'run', paths: [], domains: [], ...subject },
  ...overrides,
});

const organization = (extra: Record<string, unknown>) => ({
  allowedTools: [],
  maximumRisk: 'R4',
  deniedEffects: [],
  requireApproval: [],
  ...extra,
});

const trust = (extra: Record<string, unknown>) =>
  organization({ trust: { repositories: [], domains: [], commands: [], ...extra } });

describe('organization hard deny rules', () => {
  it('denies a matching organization rule, and deny beats ask', () => {
    const org = organization({
      rules: [
        { commandGlob: 'git push*', outcome: 'ask', reason: 'review pushes' },
        { commandGlob: 'git push --force*', outcome: 'deny', reason: 'no force push' },
      ],
    });
    expect(
      evaluatePolicyV2(request({}, { command: 'git push --force origin' }), {}, org).code,
    ).toBe('ORGANIZATION_RULE_DENIED');
    expect(evaluatePolicyV2(request({}, { command: 'git push origin' }), {}, org)).toMatchObject({
      outcome: 'ask',
      code: 'ORGANIZATION_RULE_APPROVAL_REQUIRED',
    });
    expect(evaluatePolicyV2(request({}, { command: 'npm test' }), {}, org).outcome).toBe('allow');
  });

  it('an organization ask never masks a project hard deny', () => {
    const org = organization({ requireApproval: ['local-mutation'] });
    const project = { rules: [{ commandGlob: 'rm *', outcome: 'deny', reason: 'no rm' }] };
    expect(evaluatePolicyV2(request({}, { command: 'rm -rf x' }), project, org).code).toBe(
      'PROJECT_RULE_DENIED',
    );
    expect(evaluatePolicyV2(request({}, { command: 'ls' }), project, org).code).toBe(
      'ORGANIZATION_APPROVAL_REQUIRED',
    );
  });
});

describe('organization trust lists', () => {
  it('denies writes outside trusted repositories, and in a workspace with no remote', () => {
    const org = trust({ repositories: [['github.com/acme/*']] });
    expect(
      evaluatePolicyV2(request({}, { repository: 'github.com/acme/app' }), {}, org).outcome,
    ).toBe('allow');
    expect(evaluatePolicyV2(request({}, { repository: 'github.com/evil/app' }), {}, org).code).toBe(
      'ORGANIZATION_REPOSITORY_UNTRUSTED',
    );
    expect(evaluatePolicyV2(request(), {}, org).code).toBe('ORGANIZATION_REPOSITORY_UNTRUSTED');
    expect(evaluatePolicyV2(request({ effect: 'read', risk: 'R0' }), {}, org).outcome).toBe(
      'allow',
    );
  });

  it('holds a member of two organizations to both lists', () => {
    const org = trust({ repositories: [['github.com/acme/*'], ['github.com/*/app']] });
    expect(
      evaluatePolicyV2(request({}, { repository: 'github.com/acme/app' }), {}, org).outcome,
    ).toBe('allow');
    expect(evaluatePolicyV2(request({}, { repository: 'github.com/acme/lib' }), {}, org).code).toBe(
      'ORGANIZATION_REPOSITORY_UNTRUSTED',
    );
  });

  it('denies any named host outside the trusted domains', () => {
    const org = trust({ domains: [['*.acme.com']] });
    expect(evaluatePolicyV2(request({}, { domains: ['api.acme.com'] }), {}, org).outcome).toBe(
      'allow',
    );
    expect(
      evaluatePolicyV2(request({}, { domains: ['api.acme.com', 'evil.io'] }), {}, org).code,
    ).toBe('ORGANIZATION_DOMAIN_UNTRUSTED');
  });

  it('asks before a command outside the trusted commands', () => {
    const org = trust({ commands: [['npm *', 'git status']] });
    expect(evaluatePolicyV2(request({}, { command: 'npm test' }), {}, org).outcome).toBe('allow');
    expect(evaluatePolicyV2(request({}, { command: 'curl x' }), {}, org)).toMatchObject({
      outcome: 'ask',
      code: 'ORGANIZATION_COMMAND_UNTRUSTED',
    });
    expect(evaluatePolicyV2(request(), {}, org).outcome).toBe('allow');
  });

  it('an empty group in the list constrains nothing', () => {
    expect(evaluatePolicyV2(request(), {}, trust({ repositories: [[]] })).outcome).toBe('allow');
  });

  it('fails closed on a malformed trust block', () => {
    expect(() =>
      evaluatePolicyV2(request(), {}, organization({ trust: { repositories: 'x' } })),
    ).toThrow();
  });
});
