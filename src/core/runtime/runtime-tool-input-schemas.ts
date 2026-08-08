import { COMMAND_EXPECTED_EFFECTS } from '../command-spec';

import type { RuntimeJsonObject } from './runtime-tool-contracts';

const text = { type: 'string', maxLength: 1_048_576 } as const;
const integer = { type: 'integer', minimum: 0, maximum: 16_777_216 } as const;
const wideInteger = { type: 'integer', minimum: 0, maximum: 1_000_000_000 } as const;
const flag = { type: 'boolean' } as const;
const opaque = { type: 'object', properties: {}, additionalProperties: true } as const;
const texts = { type: 'array', items: text, maxItems: 10_000 } as const;
const integers = { type: 'array', items: integer, maxItems: 1_000 } as const;
const objects = { type: 'array', items: opaque, maxItems: 1_000 } as const;

function strict(
  properties: RuntimeJsonObject,
  required: readonly string[] = [],
): RuntimeJsonObject {
  return { type: 'object', properties, required, additionalProperties: false, maxProperties: 64 };
}

const identifier = { type: 'string', minLength: 2, maxLength: 200 } as const;
const shortText = { type: 'string', minLength: 1, maxLength: 2_000 } as const;
const epochs = strict({ account: integer, workspace: integer, target: integer, policy: integer }, [
  'account',
  'workspace',
  'target',
  'policy',
]);
const modelPolicy = strict(
  {
    allowedProviders: texts,
    allowedModels: texts,
    localPreferred: flag,
    minimumContextTokens: integer,
  },
  ['allowedProviders', 'allowedModels', 'localPreferred', 'minimumContextTokens'],
);
const taskBudget = strict(
  { maxTokens: integer, maxToolCalls: integer, maxRuntimeMs: wideInteger, maxRetries: integer },
  ['maxTokens', 'maxToolCalls', 'maxRuntimeMs', 'maxRetries'],
);
const subAgentTask = strict(
  {
    taskId: identifier,
    role: {
      type: 'string',
      enum: [
        'explorer',
        'implementer',
        'tester',
        'reviewer',
        'security-reviewer',
        'documenter',
        'integrator',
      ],
    },
    goal: text,
    modelPolicy,
    contextNodeIds: texts,
    dependencies: texts,
    writeSet: texts,
    integrationSeams: texts,
    worktreeId: identifier,
    budget: taskBudget,
    tools: texts,
    riskCeiling: { type: 'string', enum: ['R0', 'R1', 'R2', 'R3'] },
    acceptanceChecks: texts,
    mandatoryGateIds: texts,
    epochs,
  },
  [
    'taskId',
    'role',
    'goal',
    'modelPolicy',
    'contextNodeIds',
    'dependencies',
    'writeSet',
    'integrationSeams',
    'worktreeId',
    'budget',
    'tools',
    'riskCeiling',
    'acceptanceChecks',
    'epochs',
  ],
);
const subAgentGraph = strict(
  {
    graphId: identifier,
    parentRunId: identifier,
    tasks: { type: 'array', items: subAgentTask, minItems: 1, maxItems: 1_000 },
    maxConcurrency: integer,
  },
  ['graphId', 'parentRunId', 'tasks', 'maxConcurrency'],
);
const integrationCommit = strict(
  {
    taskId: identifier,
    worktreeId: identifier,
    commit: text,
    changedPaths: texts,
    integrationSeams: texts,
  },
  ['taskId', 'worktreeId', 'commit', 'changedPaths', 'integrationSeams'],
);
const integrationRequest = strict(
  {
    integrationId: identifier,
    targetWorktreeId: identifier,
    commits: { type: 'array', items: integrationCommit, minItems: 1, maxItems: 1_000 },
    mandatoryGateIds: texts,
  },
  ['integrationId', 'targetWorktreeId', 'commits', 'mandatoryGateIds'],
);
const flagshipBudget = strict(
  {
    maxRuntimeMs: wideInteger,
    maxStageAttempts: integer,
    maxModelTurns: integer,
    maxToolCalls: integer,
    maxSubAgents: integer,
  },
  ['maxRuntimeMs', 'maxStageAttempts', 'maxModelTurns', 'maxToolCalls', 'maxSubAgents'],
);
const flagshipRequest = strict(
  {
    deliveryId: identifier,
    runId: identifier,
    goal: text,
    strategy: {
      type: 'string',
      enum: [
        'cross-stack-feature',
        'incident-fix',
        'architecture-refactor',
        'mobile-web-backend',
        'prompt-pack-audit',
      ],
    },
    repositories: texts,
    writeSet: texts,
    acceptanceChecks: texts,
    budget: flagshipBudget,
  },
  ['deliveryId', 'runId', 'goal', 'strategy', 'repositories', 'budget'],
);
const elevationCommand = strict(
  {
    executable: text,
    arguments: texts,
    cwdRootKey: identifier,
    cwd: text,
    environment: opaque,
    timeoutMs: integer,
    outputLimitBytes: integer,
    expectedEffect: text,
    targetId: identifier,
    elevation: flag,
  },
  [
    'executable',
    'arguments',
    'cwdRootKey',
    'cwd',
    'environment',
    'timeoutMs',
    'outputLimitBytes',
    'expectedEffect',
    'targetId',
    'elevation',
  ],
);
const elevationRecipe = strict(
  {
    recipeId: text,
    command: elevationCommand,
    explanation: shortText,
    verification: elevationCommand,
  },
  ['recipeId', 'command', 'explanation', 'verification'],
);

export const runtimeToolInputSchemas = {
  agents: strict({ graph: subAgentGraph }, ['graph']),
  browser: strict({
    sessionId: text,
    contextId: text,
    pageId: text,
    url: text,
    locator: opaque,
    targetLocator: opaque,
    value: text,
    values: texts,
    relativePaths: texts,
    artifactPath: text,
    viewport: opaque,
    timeoutMs: integer,
    fullPage: flag,
    attempts: integer,
    intervalMs: integer,
    requestTimeoutMs: integer,
    expectedStatuses: integers,
    processSessionId: text,
  }),
  command: strict(
    {
      executable: { type: 'string', minLength: 1, maxLength: 4_096 },
      arguments: {
        type: 'array',
        items: { type: 'string', maxLength: 32_768 },
        maxItems: 1_000,
      },
      cwdRootKey: { type: 'string', minLength: 1, maxLength: 100 },
      cwd: { type: 'string', minLength: 1, maxLength: 4_096 },
      environment: opaque,
      timeoutMs: { type: 'integer', minimum: 100, maximum: 7_200_000 },
      outputLimitBytes: { type: 'integer', minimum: 1_024, maximum: 16_777_216 },
      expectedEffect: { type: 'string', enum: [...COMMAND_EXPECTED_EFFECTS] },
      elevation: flag,
      stdin: text,
      shell: opaque,
    },
    ['executable', 'cwdRootKey', 'timeoutMs', 'outputLimitBytes', 'expectedEffect'],
  ),
  container: strict({
    rootKey: text,
    engine: text,
    resource: text,
    tail: integer,
    contextPath: text,
    dockerfile: text,
    tag: text,
    image: text,
    name: text,
    arguments: texts,
    ports: objects,
    environment: opaque,
    receipt: opaque,
    executable: text,
    stdin: text,
    composeFile: text,
    projectName: text,
    services: texts,
    service: text,
  }),
  database: strict({
    rootKey: text,
    profileId: text,
    statement: text,
    rowLimit: integer,
    timeoutMs: integer,
    outputLimitBytes: integer,
    backupAcknowledged: flag,
  }),
  evidence: strict({ input: opaque, bundle: opaque, output: opaque }),
  elevation: strict({ recipe: elevationRecipe }, ['recipe']),
  flagship: strict({ request: flagshipRequest }, ['request']),
  files: strict({
    rootKey: text,
    path: text,
    startLine: integer,
    endLine: integer,
    maxBytes: integer,
    cursor: integer,
    limit: integer,
    pattern: text,
    maxResults: integer,
    query: text,
    transaction: opaque,
  }),
  git: strict({
    rootKey: text,
    path: text,
    ref: text,
    branch: text,
    startPoint: text,
    paths: texts,
    message: text,
    amend: flag,
    includeUntracked: flag,
    remote: text,
    refspec: text,
    forceWithLease: opaque,
    name: text,
    target: text,
  }),
  integration: strict({ request: integrationRequest }, ['request']),
  intelligence: strict({ identity: opaque, query: text, nodeIds: texts, paths: texts }),
  journal: strict({ journal: opaque, query: text, runId: text }),
  planning: strict({ plan: opaque, output: opaque }),
  process: strict({
    executablePath: text,
    arguments: texts,
    cwdRootKey: text,
    cwd: text,
    environment: opaque,
    columns: integer,
    rows: integer,
    title: text,
    readinessPattern: text,
    expectedPorts: integers,
    receipt: opaque,
    receipts: objects,
    data: text,
  }),
  quality: strict({ rootKey: text, scope: text, projects: objects, gateId: text }),
  services: strict({
    rootKey: text,
    definitions: objects,
    serviceIds: texts,
    serviceId: text,
  }),
} as const satisfies Readonly<Record<string, RuntimeJsonObject>>;
