import { RuntimePolicyV2Adapter } from '../../src/services/runtime-policy-v2-adapter';

import type { PermissionMode } from '../../src/core/permission-policy.types';
import type { ProjectPolicy } from '../../src/core/policy-v2';
import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';

export type Verdict = 'allow' | 'ask' | 'deny';

export const MATRIX_MODES = [
  'PLAN',
  'ENTERPRISE_LOCKED',
  'ASK',
  'AUTO_EDIT',
  'AUTONOMOUS_SCOPED',
] as const satisfies readonly PermissionMode[];

/** The ceilings an organization can name, plus none. `null` is "no organization ceiling". */
export const MATRIX_CEILINGS = [null, 'PLAN', 'ASK'] as const;
export type MatrixCeiling = (typeof MATRIX_CEILINGS)[number];

export interface MatrixScenario {
  readonly mode: PermissionMode;
  readonly ceiling?: MatrixCeiling;
  readonly trusted?: boolean;
  readonly project?: Partial<ProjectPolicy>;
  readonly organization?: Record<string, unknown>;
  readonly userPresent?: boolean;
  readonly arguments?: RuntimeJsonObject;
}

export interface MatrixDecision {
  readonly verdict: Verdict;
  readonly code: string;
}

const EMPTY_PROJECT: ProjectPolicy = {
  deniedEffects: [],
  maximumRisk: 'R4',
  requireApproval: [],
  rules: [],
};

function invocationOf(tool: string, operation: string, args: RuntimeJsonObject) {
  return {
    schemaVersion: '2.0',
    invocationId: `invocation:${tool}:${operation}`,
    runId: 'runtime:permission-matrix',
    turnId: 'turn:permission-matrix',
    toolName: tool,
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:permission-matrix',
    requestedAt: '2026-09-30T12:00:00.000Z',
  } satisfies ToolInvocation;
}

/**
 * The decision the real adapter reaches for one operation in one scenario.
 *
 * Runs `RuntimePolicyV2Adapter.evaluate`, not a copy of it, so the matrix
 * cannot drift from what the runtime does. `ask` is observed as the adapter
 * calling its approval hook; the hook approves so the call completes.
 */
export async function decide(
  tool: string,
  operation: string,
  scenario: MatrixScenario,
): Promise<MatrixDecision> {
  const state = { asked: false };
  const organization =
    scenario.organization ??
    (scenario.ceiling === null || scenario.ceiling === undefined
      ? undefined
      : { minimumPermissionMode: scenario.ceiling });
  const adapter = new RuntimePolicyV2Adapter(
    {
      accountId: () => 'account:matrix',
      backendOrigin: () => 'https://claw.local',
      workspaceId: () => 'workspace:matrix',
      workspaceRoot: () => 'D:/workspace',
      mode: () => scenario.mode,
      workspaceTrusted: () => scenario.trusted ?? true,
      userPresent: () => scenario.userPresent ?? true,
      organizationPolicy: () => organization,
      approve: async () => {
        state.asked = true;
        return true;
      },
    },
    { load: async () => ({ ...EMPTY_PROJECT, ...scenario.project }) },
  );
  const result = await adapter.evaluate(invocationOf(tool, operation, scenario.arguments ?? {}));
  if (result.decision === 'deny') return { verdict: 'deny', code: result.code };
  return { verdict: state.asked ? 'ask' : 'allow', code: result.code };
}
