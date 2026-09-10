import { describe, expect, it } from 'vitest';

import { evaluatePolicyV2, policyRuleSchema, projectPolicySchema } from '../../src/core/policy-v2';

const scope = {
  accountId: 'account-1',
  backendOrigin: 'https://claw.local',
  workspaceId: 'workspace-1',
  targetId: 'target:workspace',
  root: 'D:/workspace',
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    invocationHash: `sha256:${'a'.repeat(64)}`,
    mode: 'AUTONOMOUS_SCOPED',
    risk: 'R1',
    effect: 'workspace-write',
    scope,
    workspaceTrusted: true,
    userPresent: true,
    reversible: true,
    subject: {
      tool: 'workspace.files',
      operation: 'apply',
      paths: ['src/app.ts'],
    },
    ...overrides,
  };
}

describe('policyRuleSchema', () => {
  // A rule that matches nothing in particular matches everything, which is
  // never what the author meant.
  it('requires at least one thing to match on', () => {
    expect(policyRuleSchema.safeParse({ outcome: 'deny', reason: 'no' }).success).toBe(false);
    expect(
      policyRuleSchema.safeParse({ tool: 'workspace.git', outcome: 'deny', reason: 'no' }).success,
    ).toBe(true);
  });

  // The policy file lives in the workspace, and workspace content is untrusted.
  // A repository that could write `allow` would grant itself permissions by
  // being cloned.
  it('has no allow outcome, so a rule can only tighten', () => {
    expect(
      policyRuleSchema.safeParse({ tool: 'workspace.git', outcome: 'allow', reason: 'yes' })
        .success,
    ).toBe(false);
  });
});

describe('evaluatePolicyV2 with project rules', () => {
  it('denies a matching tool and operation', () => {
    const decision = evaluatePolicyV2(
      request(),
      projectPolicySchema.parse({
        rules: [
          { tool: 'workspace.files', operation: 'apply', outcome: 'deny', reason: 'frozen tree' },
        ],
      }),
    );

    expect(decision).toMatchObject({ outcome: 'deny', code: 'PROJECT_RULE_DENIED' });
  });

  it('leaves an unmatched call to the ordinary mode rules', () => {
    const decision = evaluatePolicyV2(
      request(),
      projectPolicySchema.parse({
        rules: [{ tool: 'workspace.git', outcome: 'deny', reason: 'not this call' }],
      }),
    );

    expect(decision.outcome).toBe('allow');
  });

  it('matches a path glob against what the call actually touches', () => {
    const policy = projectPolicySchema.parse({
      rules: [{ pathGlob: 'infra/*', outcome: 'ask', reason: 'infra is reviewed' }],
    });

    expect(evaluatePolicyV2(request(), policy).outcome).toBe('allow');
    expect(
      evaluatePolicyV2(
        request({
          subject: { tool: 'workspace.files', operation: 'apply', paths: ['infra/nginx.conf'] },
        }),
        policy,
      ),
    ).toMatchObject({ outcome: 'ask', code: 'PROJECT_RULE_APPROVAL_REQUIRED' });
  });

  it('matches a command glob against the executable and its arguments', () => {
    const decision = evaluatePolicyV2(
      request({
        risk: 'R2',
        effect: 'local-mutation',
        reversible: false,
        subject: {
          tool: 'workspace.command',
          operation: 'run',
          paths: [],
          command: 'git push origin main',
        },
      }),
      projectPolicySchema.parse({
        rules: [{ commandGlob: 'git push*', outcome: 'deny', reason: 'pushes are manual here' }],
      }),
    );

    expect(decision).toMatchObject({ outcome: 'deny' });
  });

  // When two rules disagree the stricter answer is the safe one, and the file
  // is hand-written, so the reader should not have to simulate list order.
  it('lets a deny win over an ask regardless of order', () => {
    const rules = [
      { tool: 'workspace.files', outcome: 'ask' as const, reason: 'review' },
      { pathGlob: 'src/*', outcome: 'deny' as const, reason: 'frozen' },
    ];

    expect(evaluatePolicyV2(request(), projectPolicySchema.parse({ rules })).outcome).toBe('deny');
    expect(
      evaluatePolicyV2(request(), projectPolicySchema.parse({ rules: [...rules].reverse() }))
        .outcome,
    ).toBe('deny');
  });

  // A rule may tighten and may never loosen. An immutable rail is decided
  // before rules are consulted, so no rule can reach past it.
  it('cannot loosen an immutable denial', () => {
    const decision = evaluatePolicyV2(
      request({ effect: 'elevation', risk: 'R4', userPresent: false, reversible: false }),
      projectPolicySchema.parse({
        rules: [{ tool: 'workspace.files', outcome: 'ask', reason: 'just ask' }],
      }),
    );

    expect(decision).toMatchObject({ outcome: 'deny', immutable: true });
  });

  it('cannot loosen an untrusted workspace', () => {
    const decision = evaluatePolicyV2(
      request({ workspaceTrusted: false }),
      projectPolicySchema.parse({
        rules: [{ tool: 'workspace.files', outcome: 'ask', reason: 'just ask' }],
      }),
    );

    expect(decision).toMatchObject({ outcome: 'deny', code: 'WORKSPACE_UNTRUSTED' });
  });

  it('treats a glob as a literal apart from its asterisks', () => {
    const policy = projectPolicySchema.parse({
      rules: [{ pathGlob: 'src/a.ts', outcome: 'deny', reason: 'exact' }],
    });

    expect(
      evaluatePolicyV2(
        request({ subject: { tool: 'workspace.files', operation: 'apply', paths: ['src/aXts'] } }),
        policy,
      ).outcome,
    ).toBe('allow');
  });

  // A request from an older client carries no subject, and a policy with rules
  // must not start denying everything because of it.
  it('ignores rules when the request carries no subject', () => {
    const decision = evaluatePolicyV2(
      request({ subject: undefined }),
      projectPolicySchema.parse({
        rules: [{ tool: 'workspace.files', outcome: 'deny', reason: 'frozen' }],
      }),
    );

    expect(decision.outcome).toBe('allow');
  });
});

describe('evaluatePolicyV2 with an organization policy', () => {
  const organization = {
    allowedTools: [],
    maximumRisk: 'R4' as const,
    deniedEffects: [] as string[],
    requireApproval: [] as string[],
  };

  it('changes nothing when no organization constrains the user', () => {
    expect(evaluatePolicyV2(request(), undefined, undefined).outcome).toBe('allow');
  });

  it('denies a tool outside a non-empty allowlist', () => {
    expect(
      evaluatePolicyV2(request(), undefined, {
        ...organization,
        allowedTools: ['workspace.git'],
      }),
    ).toMatchObject({ outcome: 'deny', code: 'ORGANIZATION_TOOL_DENIED' });
  });

  // An empty allowlist means everything, the same convention the backend
  // intersection uses. Reading it as "nothing allowed" would deny every call
  // for every organization that has not set the field.
  it('treats an empty allowlist as every tool permitted', () => {
    expect(evaluatePolicyV2(request(), undefined, organization).outcome).toBe('allow');
  });

  it('denies an effect the organization refuses, and one above its risk ceiling', () => {
    expect(
      evaluatePolicyV2(request(), undefined, {
        ...organization,
        deniedEffects: ['workspace-write'],
      }),
    ).toMatchObject({ outcome: 'deny', code: 'ORGANIZATION_POLICY_NARROWED' });

    expect(
      evaluatePolicyV2(request({ risk: 'R3' }), undefined, { ...organization, maximumRisk: 'R1' }),
    ).toMatchObject({ outcome: 'deny' });
  });

  it('asks when the organization requires approval for an effect', () => {
    expect(
      evaluatePolicyV2(request(), undefined, {
        ...organization,
        requireApproval: ['workspace-write'],
      }),
    ).toMatchObject({ outcome: 'ask', code: 'ORGANIZATION_APPROVAL_REQUIRED' });
  });

  // An organization may tighten what a project allows and must never loosen a
  // safety rail, so it is consulted after the immutable rail.
  it('cannot loosen an immutable denial or an untrusted workspace', () => {
    const permissive = { ...organization, allowedTools: [], maximumRisk: 'R4' as const };

    expect(
      evaluatePolicyV2(
        request({ effect: 'elevation', risk: 'R4', userPresent: false }),
        undefined,
        permissive,
      ),
    ).toMatchObject({ outcome: 'deny', immutable: true });

    expect(
      evaluatePolicyV2(request({ workspaceTrusted: false }), undefined, permissive),
    ).toMatchObject({ code: 'WORKSPACE_UNTRUSTED' });
  });

  it('still applies the project policy when the organization permits', () => {
    expect(
      evaluatePolicyV2(
        request(),
        projectPolicySchema.parse({ deniedEffects: ['workspace-write'] }),
        organization,
      ),
    ).toMatchObject({ outcome: 'deny', code: 'PROJECT_POLICY_NARROWED' });
  });
});

describe('domain rules', () => {
  function webRequest(domains: string[] = ['docs.example.dev']) {
    return request({
      effect: 'read',
      subject: { tool: 'workspace.web', operation: 'fetch', paths: [], domains },
    });
  }

  it('denies a host the project refuses', () => {
    const decision = evaluatePolicyV2(
      webRequest(),
      projectPolicySchema.parse({
        rules: [{ domainGlob: 'docs.example.dev', outcome: 'deny', reason: 'no docs' }],
      }),
    );

    expect(decision).toMatchObject({ outcome: 'deny', code: 'PROJECT_RULE_DENIED' });
  });

  it('matches a host glob', () => {
    const decision = evaluatePolicyV2(
      webRequest(),
      projectPolicySchema.parse({
        rules: [{ domainGlob: '*.example.dev', outcome: 'deny', reason: 'no example' }],
      }),
    );

    expect(decision).toMatchObject({ outcome: 'deny' });
  });

  it('leaves a host no rule names alone', () => {
    const decision = evaluatePolicyV2(
      webRequest(),
      projectPolicySchema.parse({
        rules: [{ domainGlob: 'evil.test', outcome: 'deny', reason: 'no' }],
      }),
    );

    expect(decision).not.toMatchObject({ code: 'PROJECT_RULE_DENIED' });
  });

  it('never matches a call that names no host at all', () => {
    const decision = evaluatePolicyV2(
      request(),
      projectPolicySchema.parse({
        rules: [{ domainGlob: '*', outcome: 'deny', reason: 'no network' }],
      }),
    );

    expect(decision).not.toMatchObject({ code: 'PROJECT_RULE_DENIED' });
  });

  it('accepts a rule that names only a domain', () => {
    expect(
      policyRuleSchema.safeParse({ domainGlob: 'example.dev', outcome: 'deny', reason: 'no' })
        .success,
    ).toBe(true);
  });
});
