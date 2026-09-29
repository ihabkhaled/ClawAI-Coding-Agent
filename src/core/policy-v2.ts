import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { mcpServerPolicySchema } from './mcp/mcp-server-policy';
import { organizationTrustDecision, organizationTrustSchema } from './organization-trust';
import { ruleMatches } from './policy-rule-match';

export const POLICY_MODES = [
  'PLAN',
  'ASK',
  'AUTO_EDIT',
  'AUTONOMOUS_SCOPED',
  'ENTERPRISE_LOCKED',
] as const;
export const RISK_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export const EFFECT_KINDS = [
  'read',
  'workspace-write',
  'local-mutation',
  'network-write',
  'publication',
  'elevation',
  'production',
  'destructive',
] as const;

export const policyScopeSchema = z
  .object({
    accountId: z.string().min(1).max(200),
    backendOrigin: z.url().max(2_048),
    workspaceId: z.string().min(1).max(500),
    targetId: z.string().min(1).max(200),
    root: z.string().min(1).max(4_096),
    cwd: z.string().min(1).max(4_096).optional(),
    ref: z.string().min(1).max(500).optional(),
  })
  .strict();

/**
 * What a rule may look at, beyond the effect and risk classes.
 *
 * The request carried only a classification, so a project could say "deny every
 * network write" but never "deny pushing to this remote" or "always ask before
 * touching infra/". Carrying the subject is what makes a rule expressible.
 */
export const policySubjectSchema = z
  .object({
    tool: z.string().min(1).max(80),
    operation: z.string().min(1).max(80),
    paths: z.array(z.string().max(4_096)).max(200).default([]),
    /** The executable and its arguments, joined, for command rules to match. */
    command: z.string().max(8_192).optional(),
    /**
     * Hosts the call names, for domain rules to match.
     *
     * Hosts, not URLs. A rule about where a request may go is about the
     * site, and matching a whole URL would let a path fragment satisfy a
     * rule that was meant to be about the origin.
     */
    domains: z.array(z.string().max(253)).max(50).default([]),
    /**
     * The workspace's repository as `host/owner/name`, from its origin remote,
     * for organization trust lists. Absent when there is no remote.
     */
    repository: z.string().max(512).optional(),
  })
  .strict();

export const policyRequestSchema = z
  .object({
    runId: z.string().min(1).max(200),
    invocationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    mode: z.enum(POLICY_MODES),
    risk: z.enum(RISK_CLASSES),
    effect: z.enum(EFFECT_KINDS),
    scope: policyScopeSchema,
    workspaceTrusted: z.boolean(),
    userPresent: z.boolean(),
    reversible: z.boolean(),
    subject: policySubjectSchema.optional(),
  })
  .strict();

/**
 * A rule may tighten and may never loosen, which is why `outcome` has no
 * `allow`.
 *
 * The project policy is read from a file inside the workspace, and workspace
 * content is untrusted: a repository that could write `allow` into it would be
 * a repository that grants itself permissions by being cloned. Tightening is
 * safe from an untrusted source because the worst a hostile rule achieves is
 * refusing to do something.
 *
 * Patterns are `*` globs rather than regular expressions for the same reason.
 * A regular expression from an untrusted file is a denial-of-service waiting
 * for the right input, and a glob compiled from an escaped literal has no
 * backtracking to exploit.
 */
export const policyRuleSchema = z
  .object({
    tool: z.string().min(1).max(80).optional(),
    operation: z.string().min(1).max(80).optional(),
    pathGlob: z.string().min(1).max(1_000).optional(),
    commandGlob: z.string().min(1).max(1_000).optional(),
    domainGlob: z.string().min(1).max(253).optional(),
    outcome: z.enum(['ask', 'deny']),
    reason: z.string().min(1).max(500),
  })
  .strict()
  .refine(
    (rule) =>
      rule.tool !== undefined ||
      rule.operation !== undefined ||
      rule.pathGlob !== undefined ||
      rule.commandGlob !== undefined ||
      rule.domainGlob !== undefined,
    'A policy rule must match on at least one of tool, operation, pathGlob, commandGlob or domainGlob',
  );

export const projectPolicySchema = z
  .object({
    deniedEffects: z.array(z.enum(EFFECT_KINDS)).max(EFFECT_KINDS.length).default([]),
    maximumRisk: z.enum(RISK_CLASSES).default('R4'),
    requireApproval: z.array(z.enum(EFFECT_KINDS)).max(EFFECT_KINDS.length).default([]),
    rules: z.array(policyRuleSchema).max(200).default([]),
    /** Which MCP servers may start. Deny wins; see `mcp/mcp-server-policy.ts`. */
    mcpServers: mcpServerPolicySchema.optional(),
    /**
     * The only plugin marketplaces this project may install from. Absent means
     * no restriction; present, even empty, refuses every marketplace it does
     * not name. It can only narrow, like everything else in this file.
     */
    allowedPluginMarketplaces: z.array(z.string().min(1).max(2_048)).max(100).optional(),
  })
  .strict();

/**
 * The organization policy, as the client applies it.
 *
 * Mirrors what `GET agent/organizations/policy/effective` returns. Unsigned on
 * purpose: every field narrows and none widens, so a forged policy could only
 * refuse work. `allowedModels` is absent here because an invocation does not
 * carry a model — that field is enforced where a model is chosen.
 */
export const organizationPolicySchema = z
  .object({
    allowedTools: z.array(z.string().max(200)).max(256).default([]),
    maximumRisk: z.enum(RISK_CLASSES).default('R4'),
    deniedEffects: z.array(z.enum(EFFECT_KINDS)).max(EFFECT_KINDS.length).default([]),
    requireApproval: z.array(z.enum(EFFECT_KINDS)).max(EFFECT_KINDS.length).default([]),
    /** Hard deny and ask rules, the same shape as project rules, from every organization. */
    rules: z.array(policyRuleSchema).max(400).default([]),
    /** Trusted repositories, domains and commands; see `organization-trust.ts`. */
    trust: organizationTrustSchema.default({ repositories: [], domains: [], commands: [] }),
  })
  .loose();

export type OrganizationPolicyConstraints = z.infer<typeof organizationPolicySchema>;

export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicySubject = z.infer<typeof policySubjectSchema>;

export type PolicyRequest = z.infer<typeof policyRequestSchema>;
export type ProjectPolicy = z.infer<typeof projectPolicySchema>;
export type PolicyOutcome = 'allow' | 'ask' | 'deny';

export interface PolicyV2Decision {
  readonly outcome: PolicyOutcome;
  readonly code: string;
  readonly risk: PolicyRequest['risk'];
  readonly immutable: boolean;
}

const riskIndex = (risk: PolicyRequest['risk']): number => RISK_CLASSES.indexOf(risk);

function immutableRailDecision(request: PolicyRequest): PolicyV2Decision | undefined {
  if (!['elevation', 'production', 'destructive'].includes(request.effect)) return undefined;
  if (!request.userPresent || request.mode === 'ENTERPRISE_LOCKED') {
    return { outcome: 'deny', code: 'FRESH_USER_PRESENCE_REQUIRED', risk: 'R4', immutable: true };
  }
  return { outcome: 'ask', code: 'R4_APPROVAL_REQUIRED', risk: 'R4', immutable: true };
}

function narrowedProjectDecision(
  request: PolicyRequest,
  project: ProjectPolicy,
): PolicyV2Decision | undefined {
  if (
    !project.deniedEffects.includes(request.effect) &&
    riskIndex(request.risk) <= riskIndex(project.maximumRisk)
  )
    return undefined;
  return {
    outcome: 'deny',
    code: 'PROJECT_POLICY_NARROWED',
    risk: request.risk,
    immutable: false,
  };
}

/**
 * The first matching rule wins, and a deny anywhere in the list beats an ask.
 *
 * Order-independence matters because the file is hand-written and a reader
 * should not have to simulate the list to know what it does. Denies are
 * collected first for the same reason a rule cannot allow: when two rules
 * disagree, the stricter answer is the safe one.
 */
function ruleDecision(
  request: PolicyRequest,
  project: ProjectPolicy,
): PolicyV2Decision | undefined {
  const subject = request.subject;
  if (subject === undefined || project.rules.length === 0) return undefined;
  const matched = project.rules.filter((rule) => ruleMatches(rule, subject));
  if (matched.length === 0) return undefined;
  const denied = matched.some((rule) => rule.outcome === 'deny');
  return {
    outcome: denied ? 'deny' : 'ask',
    code: denied ? 'PROJECT_RULE_DENIED' : 'PROJECT_RULE_APPROVAL_REQUIRED',
    risk: request.risk,
    immutable: false,
  };
}

/**
 * What the organization imposes, checked after the immutable rails and before
 * the project's own narrowing.
 *
 * Ordered that way because an organization may tighten what a project allows
 * but must never loosen a safety rail. An empty `allowedTools` means every tool
 * is permitted — the same convention the backend intersection uses, where an
 * empty allowlist is "everything" rather than "nothing".
 */
function organizationDecision(
  request: PolicyRequest,
  organization: OrganizationPolicyConstraints | undefined,
): PolicyV2Decision | undefined {
  if (organization === undefined) return undefined;
  const tool = request.subject?.tool;
  if (
    organization.allowedTools.length > 0 &&
    tool !== undefined &&
    !organization.allowedTools.includes(tool)
  ) {
    return {
      outcome: 'deny',
      code: 'ORGANIZATION_TOOL_DENIED',
      risk: request.risk,
      immutable: false,
    };
  }
  if (
    organization.deniedEffects.includes(request.effect) ||
    riskIndex(request.risk) > riskIndex(organization.maximumRisk)
  ) {
    return {
      outcome: 'deny',
      code: 'ORGANIZATION_POLICY_NARROWED',
      risk: request.risk,
      immutable: false,
    };
  }
  const trusted = organizationTrustDecision(request, organization);
  if (trusted !== undefined) return trusted;
  if (organization.requireApproval.includes(request.effect)) {
    return {
      outcome: 'ask',
      code: 'ORGANIZATION_APPROVAL_REQUIRED',
      risk: request.risk,
      immutable: false,
    };
  }
  return undefined;
}

function requiresExplicitApproval(request: PolicyRequest, project: ProjectPolicy): boolean {
  return request.mode === 'ASK' || project.requireApproval.includes(request.effect);
}

function parseOrganization(candidate: unknown): OrganizationPolicyConstraints | undefined {
  return candidate === undefined || candidate === null
    ? undefined
    : organizationPolicySchema.parse(candidate);
}

export function evaluatePolicyV2(
  candidate: unknown,
  projectCandidate?: unknown,
  organizationCandidate?: unknown,
): PolicyV2Decision {
  const request = policyRequestSchema.parse(candidate);
  const project = projectPolicySchema.parse(projectCandidate ?? {});
  const organization = parseOrganization(organizationCandidate);
  if (!request.workspaceTrusted) {
    return { outcome: 'deny', code: 'WORKSPACE_UNTRUSTED', risk: request.risk, immutable: true };
  }
  const immutableDecision = immutableRailDecision(request);
  if (immutableDecision !== undefined) return immutableDecision;
  const organizationOutcome = organizationDecision(request, organization);
  if (organizationOutcome?.outcome === 'deny') return organizationOutcome;
  const projectDecision = narrowedProjectDecision(request, project);
  if (projectDecision !== undefined) return projectDecision;
  // After the immutable rail, so a rule can never loosen a hard deny, and
  // before the mode defaults, so it can tighten one.
  const ruled = ruleDecision(request, project);
  // Every deny is collected before any ask, so an organization's "ask" can
  // never mask a project's hard deny of the same call.
  if (ruled?.outcome === 'deny') return ruled;
  return organizationOutcome ?? ruled ?? modeDecision(request, project);
}

/**
 * What the selected mode says, once every narrowing check has passed.
 *
 * Split out so `evaluatePolicyV2` reads as the order the checks happen in —
 * trust, immutable rail, project narrowing, project rules, then mode — rather
 * than as one long chain where the order is easy to disturb by accident.
 */
function modeDecision(request: PolicyRequest, project: ProjectPolicy): PolicyV2Decision {
  if (request.mode === 'PLAN' && request.effect !== 'read') {
    return { outcome: 'deny', code: 'PLAN_READ_ONLY', risk: request.risk, immutable: true };
  }
  if (requiresExplicitApproval(request, project)) {
    return {
      outcome: 'ask',
      code: 'EXPLICIT_APPROVAL_REQUIRED',
      risk: request.risk,
      immutable: false,
    };
  }
  if (request.mode === 'AUTO_EDIT' && request.risk !== 'R0' && request.risk !== 'R1') {
    return {
      outcome: 'ask',
      code: 'AUTO_EDIT_SCOPE_EXCEEDED',
      risk: request.risk,
      immutable: false,
    };
  }
  if (request.risk === 'R3') {
    return {
      outcome: 'ask',
      code: 'EXTERNAL_EFFECT_APPROVAL_REQUIRED',
      risk: request.risk,
      immutable: false,
    };
  }
  return { outcome: 'allow', code: 'POLICY_ALLOWED', risk: request.risk, immutable: false };
}

const capabilityPayloadSchema = z
  .object({
    request: policyRequestSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    nonce: z.string().regex(/^[a-f0-9]{32}$/u),
  })
  .strict();

export type CapabilityPayload = z.infer<typeof capabilityPayloadSchema>;

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');
const digest = (secret: Uint8Array, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export class OneShotCapabilityIssuer {
  private readonly consumed = new Set<string>();

  constructor(
    private readonly secret: Uint8Array,
    private readonly now: () => number = Date.now,
  ) {
    if (secret.byteLength < 32) throw new Error('Capability signing secret is too short');
  }

  issue(candidate: unknown, ttlMs: number): string {
    const request = policyRequestSchema.parse(candidate);
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 900_000)
      throw new Error('Capability lifetime is outside the safe bound');
    const issuedAt = this.now();
    const payload = encode(
      JSON.stringify({
        request,
        issuedAt,
        expiresAt: issuedAt + ttlMs,
        nonce: randomBytes(16).toString('hex'),
      }),
    );
    return `${payload}.${digest(this.secret, payload)}`;
  }

  consume(token: string, expectedRequest: unknown): CapabilityPayload {
    if (this.consumed.has(createHash('sha256').update(token).digest('hex')))
      throw new Error('Capability token was already consumed');
    const [payload, signature, extra] = token.split('.');
    if (payload === undefined || signature === undefined || extra !== undefined)
      throw new Error('Capability token is malformed');
    const expectedSignature = digest(this.secret, payload);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expectedSignature);
    if (
      actualBytes.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(actualBytes, expectedBytes)
    )
      throw new Error('Capability token signature is invalid');
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const capability = capabilityPayloadSchema.parse(decoded);
    const expected = policyRequestSchema.parse(expectedRequest);
    if (capability.expiresAt <= this.now()) throw new Error('Capability token expired');
    if (JSON.stringify(capability.request) !== JSON.stringify(expected))
      throw new Error('Capability token scope does not match the requested effect');
    this.consumed.add(createHash('sha256').update(token).digest('hex'));
    return capability;
  }
}
