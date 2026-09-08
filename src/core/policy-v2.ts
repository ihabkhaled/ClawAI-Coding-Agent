import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

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
    outcome: z.enum(['ask', 'deny']),
    reason: z.string().min(1).max(500),
  })
  .strict()
  .refine(
    (rule) =>
      rule.tool !== undefined ||
      rule.operation !== undefined ||
      rule.pathGlob !== undefined ||
      rule.commandGlob !== undefined,
    'A policy rule must match on at least one of tool, operation, pathGlob or commandGlob',
  );

export const projectPolicySchema = z
  .object({
    deniedEffects: z.array(z.enum(EFFECT_KINDS)).max(EFFECT_KINDS.length).default([]),
    maximumRisk: z.enum(RISK_CLASSES).default('R4'),
    requireApproval: z.array(z.enum(EFFECT_KINDS)).max(EFFECT_KINDS.length).default([]),
    rules: z.array(policyRuleSchema).max(200).default([]),
  })
  .strict();

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
 * Compiles a `*` glob into a matcher.
 *
 * Every other character is escaped, so the only metacharacter is `*` and the
 * result contains no nested quantifier. A pattern from an untrusted file can
 * therefore be slow at worst, never catastrophic.
 */
function globMatches(pattern: string, value: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join(String.raw`[\s\S]*`);
  return new RegExp(`^${source}$`, 'iu').test(value);
}

function ruleMatches(rule: PolicyRule, subject: PolicySubject): boolean {
  if (rule.tool !== undefined && rule.tool !== subject.tool) return false;
  if (rule.operation !== undefined && rule.operation !== subject.operation) return false;
  if (
    rule.pathGlob !== undefined &&
    !subject.paths.some((path) => globMatches(rule.pathGlob ?? '', path))
  ) {
    return false;
  }
  if (
    rule.commandGlob !== undefined &&
    (subject.command === undefined || !globMatches(rule.commandGlob, subject.command))
  ) {
    return false;
  }
  return true;
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

function requiresExplicitApproval(request: PolicyRequest, project: ProjectPolicy): boolean {
  return request.mode === 'ASK' || project.requireApproval.includes(request.effect);
}

export function evaluatePolicyV2(candidate: unknown, projectCandidate?: unknown): PolicyV2Decision {
  const request = policyRequestSchema.parse(candidate);
  const project = projectPolicySchema.parse(projectCandidate ?? {});
  if (!request.workspaceTrusted) {
    return { outcome: 'deny', code: 'WORKSPACE_UNTRUSTED', risk: request.risk, immutable: true };
  }
  const immutableDecision = immutableRailDecision(request);
  if (immutableDecision !== undefined) return immutableDecision;
  const projectDecision = narrowedProjectDecision(request, project);
  if (projectDecision !== undefined) return projectDecision;
  // After the immutable rail, so a rule can never loosen a hard deny, and
  // before the mode defaults, so it can tighten one.
  const ruled = ruleDecision(request, project);
  if (ruled !== undefined) return ruled;
  return modeDecision(request, project);
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
