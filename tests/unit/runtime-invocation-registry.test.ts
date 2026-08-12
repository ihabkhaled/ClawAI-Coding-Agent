import { describe, expect, it } from 'vitest';

import {
  admitRuntimeInvocation,
  closeRuntimeInvocationRegistry,
  createRuntimeInvocationRegistry,
} from '../../src/core/runtime/runtime-invocation-registry';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition = {
  schemaVersion: '2.0',
  name: 'workspace.context',
  version: '1.0',
  description: 'Read bounded admitted workspace context.',
  operations: ['read'],
  riskClasses: ['inspect'],
  targetIds: ['target:primary'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['section'],
    properties: {
      section: { type: 'string', enum: ['architecture', 'tests'] },
      limits: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: { type: 'integer', minimum: 1, maximum: 20 },
          tags: { type: 'array', items: { type: 'string', maxLength: 20 }, maxItems: 3 },
        },
      },
    },
  },
} as const;
const invocation = {
  schemaVersion: '2.0',
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: definition.name,
  toolVersion: definition.version,
  operation: 'read',
  arguments: { section: 'architecture', limits: { files: 5, tags: ['api'] } },
  targetId: 'target:primary',
  epochs,
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-02T08:00:00.000Z',
} as const;

function registry() {
  return createRuntimeInvocationRegistry({
    runId: invocation.runId,
    turnId: invocation.turnId,
    epochs,
    definitions: [definition],
  });
}

// Argument-shape violations are handed back as a rejection the model can
// correct on its next turn, rather than thrown. Everything else about admission
// still throws, so these assertions read the rejection instead.
function rejectionMessage(...args: Parameters<typeof admitRuntimeInvocation>): string {
  const admission = admitRuntimeInvocation(...args);
  if (admission.rejection === undefined) throw new Error('expected an argument rejection');
  return admission.rejection.message;
}

describe('runtime invocation registry', () => {
  it('rejects an empty current turn when creating an active registry', () => {
    expect(() =>
      createRuntimeInvocationRegistry({
        runId: invocation.runId,
        turnId: '',
        epochs,
        definitions: [definition],
      }),
    ).toThrow(/turn/i);
  });

  it('admits a valid invocation immutably against the exact catalog definition', () => {
    const initial = registry();
    const result = admitRuntimeInvocation(initial, invocation);

    expect(result.replayed).toBe(false);
    expect(result.invocation).toEqual(invocation);
    expect(result.registry).not.toBe(initial);
    expect(initial.invocations).toEqual({});
    expect(result.registry.invocations[invocation.invocationId]).toBeDefined();
  });

  it.each([
    ['unknown tool', { toolName: 'workspace.missing' }],
    ['version', { toolVersion: '2.0' }],
    ['operation', { operation: 'delete' }],
    ['target', { targetId: 'target:secondary' }],
  ])('rejects a mismatched %s', (_label, patch) => {
    expect(() => admitRuntimeInvocation(registry(), { ...invocation, ...patch })).toThrow();
  });

  it('validates required, additional, enum, integer, and nested array arguments', () => {
    const invalidArguments = [
      {},
      { section: 'secrets' },
      { section: 'tests', unexpected: true },
      { section: 'tests', limits: { files: 1.5 } },
      { section: 'tests', limits: { files: 21 } },
      { section: 'tests', limits: { tags: ['a', 'b', 'c', 'd'] } },
    ];
    for (const arguments_ of invalidArguments) {
      expect(rejectionMessage(registry(), { ...invocation, arguments: arguments_ })).toMatch(
        /arguments/i,
      );
    }
  });

  it('names the valid keys when rejecting an unrecognized argument', () => {
    expect(
      rejectionMessage(registry(), {
        ...invocation,
        arguments: { section: 'tests', unexpected: true },
      }),
    ).toContain('expected one of: section, limits');
  });

  it('omits the hint when the schema allows no properties at all', () => {
    const emptyDefinition = {
      ...definition,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    } as const;
    const emptyRegistry = createRuntimeInvocationRegistry({
      runId: invocation.runId,
      turnId: invocation.turnId,
      epochs,
      definitions: [emptyDefinition],
    });

    const message = rejectionMessage(emptyRegistry, { ...invocation, arguments: { stray: true } });
    expect(message).toMatch(/not allowed$/);
  });

  it('rejects unsupported or ambiguous JSON Schema keywords', () => {
    expect(() =>
      createRuntimeInvocationRegistry({
        runId: invocation.runId,
        turnId: invocation.turnId,
        epochs,
        definitions: [
          {
            ...definition,
            inputSchema: { type: 'object', properties: {}, patternProperties: {} },
          },
        ],
      }),
    ).toThrow(/schema/i);
  });

  it.each([
    ['requires closed object schemas', { type: 'object', properties: {} }],
    [
      'requires an object property map',
      { type: 'object', additionalProperties: false, properties: [] },
    ],
    [
      'rejects unknown required properties',
      { type: 'object', additionalProperties: false, properties: {}, required: ['missing'] },
    ],
    [
      'rejects duplicate required properties',
      {
        type: 'object',
        additionalProperties: false,
        properties: { section: { type: 'string' } },
        required: ['section', 'section'],
      },
    ],
    [
      'rejects inverted object bounds',
      {
        type: 'object',
        additionalProperties: false,
        properties: {},
        minProperties: 2,
        maxProperties: 1,
      },
    ],
    [
      'rejects invalid object bounds',
      { type: 'object', additionalProperties: false, properties: {}, minProperties: -1 },
    ],
    [
      'rejects arrays without item schemas',
      { type: 'object', additionalProperties: false, properties: { items: { type: 'array' } } },
    ],
    [
      'rejects inverted array bounds',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 1 },
        },
      },
    ],
    [
      'rejects inverted string bounds',
      {
        type: 'object',
        additionalProperties: false,
        properties: { section: { type: 'string', minLength: 2, maxLength: 1 } },
      },
    ],
    [
      'rejects inverted number bounds',
      {
        type: 'object',
        additionalProperties: false,
        properties: { rank: { type: 'number', minimum: 2, maximum: 1 } },
      },
    ],
    [
      'rejects non-finite numeric bounds',
      {
        type: 'object',
        additionalProperties: false,
        properties: { rank: { type: 'number', minimum: 'one' } },
      },
    ],
    [
      'rejects malformed required declarations',
      { type: 'object', additionalProperties: false, properties: {}, required: [1] },
    ],
    [
      'rejects empty enums',
      {
        type: 'object',
        additionalProperties: false,
        properties: { section: { type: 'string', enum: [] } },
      },
    ],
    [
      'rejects duplicate enum values',
      {
        type: 'object',
        additionalProperties: false,
        properties: { section: { type: 'string', enum: ['a', 'a'] } },
      },
    ],
    [
      'rejects non-string descriptions',
      { type: 'object', additionalProperties: false, description: 1, properties: {} },
    ],
    ['rejects unsupported schema types', { type: 'date' }],
  ])('validates catalog schema: %s', (_label, inputSchema) => {
    expect(() =>
      createRuntimeInvocationRegistry({
        runId: invocation.runId,
        turnId: invocation.turnId,
        epochs,
        definitions: [{ ...definition, inputSchema }],
      }),
    ).toThrow(/schema|input/i);
  });

  it('rejects a primitive root schema and an input schema beyond the JSON depth budget', () => {
    const nestedSchema = Array.from({ length: 10 }).reduce<unknown>(
      (child) => ({
        type: 'object',
        additionalProperties: false,
        properties: { child },
      }),
      { type: 'string' },
    );

    expect(() =>
      createRuntimeInvocationRegistry({
        runId: invocation.runId,
        turnId: invocation.turnId,
        epochs,
        definitions: [{ ...definition, inputSchema: { type: 'string' } }],
      }),
    ).toThrow(/must describe an object/i);
    expect(() =>
      createRuntimeInvocationRegistry({
        runId: invocation.runId,
        turnId: invocation.turnId,
        epochs,
        definitions: [{ ...definition, inputSchema: nestedSchema }],
      }),
    ).toThrow();
  });

  it('enforces every admitted primitive and collection constraint', () => {
    const typedDefinition = {
      ...definition,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['flag', 'nothing', 'ratio', 'whole', 'tags', 'title'],
        minProperties: 6,
        maxProperties: 6,
        properties: {
          flag: { type: 'boolean' },
          nothing: { type: 'null' },
          ratio: { type: 'number', minimum: 1, maximum: 2 },
          whole: { type: 'integer', minimum: 1, maximum: 2 },
          tags: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: { type: 'string', minLength: 2, maxLength: 3 },
          },
          title: { type: 'string', minLength: 2, maxLength: 3 },
        },
      },
    };
    const typedRegistry = createRuntimeInvocationRegistry({
      runId: invocation.runId,
      turnId: invocation.turnId,
      epochs,
      definitions: [typedDefinition],
    });
    const valid = {
      ...invocation,
      arguments: { flag: true, nothing: null, ratio: 1.5, whole: 2, tags: ['ok'], title: 'yes' },
    };

    expect(admitRuntimeInvocation(typedRegistry, valid).replayed).toBe(false);
    for (const arguments_ of [
      { ...valid.arguments, flag: 'true' },
      { ...valid.arguments, nothing: false },
      { ...valid.arguments, ratio: 0 },
      { ...valid.arguments, ratio: 3 },
      { ...valid.arguments, whole: 1.5 },
      { ...valid.arguments, tags: 'not-an-array' },
      { ...valid.arguments, tags: [] },
      { ...valid.arguments, tags: ['x'] },
      { ...valid.arguments, tags: ['ok', 'yes', 'no'] },
      { ...valid.arguments, title: 1 },
      { ...valid.arguments, title: 'x' },
      { ...valid.arguments, title: 'long' },
    ]) {
      expect(rejectionMessage(typedRegistry, { ...valid, arguments: arguments_ })).toMatch(
        /arguments/i,
      );
    }
  });

  it('enforces object cardinality after schema admission', () => {
    const boundedDefinition = {
      ...definition,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        maxProperties: 1,
        properties: {
          config: { type: 'object', additionalProperties: false, properties: {} },
        },
      },
    };
    const boundedRegistry = createRuntimeInvocationRegistry({
      runId: invocation.runId,
      turnId: invocation.turnId,
      epochs,
      definitions: [boundedDefinition],
    });

    expect(rejectionMessage(boundedRegistry, { ...invocation, arguments: {} })).toMatch(
      /too few properties/i,
    );
    expect(
      rejectionMessage(boundedRegistry, {
        ...invocation,
        arguments: { config: {}, unexpected: true },
      }),
    ).toMatch(/not allowed/i);
    // A model correcting an unrecognized key needs the valid ones named, not
    // just told the one it sent was wrong — see the comment at the throw site.
    expect(
      rejectionMessage(boundedRegistry, {
        ...invocation,
        arguments: { config: {}, unexpected: true },
      }),
    ).toContain('expected one of: config');
    expect(
      rejectionMessage(boundedRegistry, {
        ...invocation,
        arguments: { config: 'not-an-object' },
      }),
    ).toMatch(/must be an object/i);
  });

  it('allows absent optional bounds and rejects a max-property overflow', () => {
    const unboundedDefinition = {
      ...definition,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', items: { type: 'string' } },
          rank: { type: 'number' },
        },
      },
    };
    const unboundedRegistry = createRuntimeInvocationRegistry({
      runId: invocation.runId,
      turnId: invocation.turnId,
      epochs,
      definitions: [unboundedDefinition],
    });
    const maxedDefinition = {
      ...definition,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        maxProperties: 1,
        properties: { first: { type: 'string' }, second: { type: 'string' } },
      },
    };
    const maxedRegistry = createRuntimeInvocationRegistry({
      runId: invocation.runId,
      turnId: invocation.turnId,
      epochs,
      definitions: [maxedDefinition],
    });

    expect(
      admitRuntimeInvocation(unboundedRegistry, {
        ...invocation,
        arguments: { items: ['one', 'two'], rank: 1 },
      }).replayed,
    ).toBe(false);
    expect(
      rejectionMessage(unboundedRegistry, {
        ...invocation,
        arguments: { items: ['one'], rank: 'not-a-number' },
      }),
    ).toMatch(/must be a number/i);
    expect(
      rejectionMessage(maxedRegistry, {
        ...invocation,
        arguments: { first: 'one', second: 'two' },
      }),
    ).toMatch(/too many properties/i);
  });

  it('treats an exact invocation and idempotency replay as inert', () => {
    const admitted = admitRuntimeInvocation(registry(), invocation).registry;
    const replay = admitRuntimeInvocation(admitted, invocation);

    expect(replay.replayed).toBe(true);
    expect(replay.registry).toBe(admitted);
  });

  it('rejects conflicting invocation-id or idempotency-key replay', () => {
    const admitted = admitRuntimeInvocation(registry(), invocation).registry;
    expect(() =>
      admitRuntimeInvocation(admitted, {
        ...invocation,
        arguments: { section: 'tests' },
      }),
    ).toThrow(/conflict/i);
    expect(() =>
      admitRuntimeInvocation(admitted, {
        ...invocation,
        invocationId: 'inv_01K11111111111111111111111',
      }),
    ).toThrow(/idempotency/i);
  });

  it('rejects another run and drift in every epoch', () => {
    expect(() =>
      admitRuntimeInvocation(registry(), {
        ...invocation,
        runId: 'run_01K11111111111111111111111',
      }),
    ).toThrow(/run/i);
    for (const key of ['account', 'workspace', 'target', 'policy'] as const) {
      expect(() =>
        admitRuntimeInvocation(registry(), {
          ...invocation,
          epochs: { ...epochs, [key]: epochs[key] + 1 },
        }),
      ).toThrow(/epoch/i);
    }
  });

  it('rejects an invocation from a different turn before admission', () => {
    const turnBoundRegistry = createRuntimeInvocationRegistry({
      runId: invocation.runId,
      turnId: invocation.turnId,
      epochs,
      definitions: [definition],
    });

    expect(() =>
      admitRuntimeInvocation(turnBoundRegistry, {
        ...invocation,
        turnId: 'turn_01K11111111111111111111111',
      }),
    ).toThrow(/another turn/i);
  });

  it.each(['completed', 'failed', 'blocked', 'cancelled'] as const)(
    'rejects admission after the run is %s',
    (status) => {
      const initial = registry();
      const closed = closeRuntimeInvocationRegistry(initial, status);
      expect(closed).not.toBe(initial);
      expect(initial.status).toBe('active');
      expect(() => admitRuntimeInvocation(closed, invocation)).toThrow(/terminal/i);
    },
  );

  it('makes closing to the same terminal status inert and rejects another terminal state', () => {
    const completed = closeRuntimeInvocationRegistry(registry(), 'completed');

    expect(closeRuntimeInvocationRegistry(completed, 'completed')).toBe(completed);
    expect(() => closeRuntimeInvocationRegistry(completed, 'failed')).toThrow(/already terminal/i);
  });

  it('rejects duplicate catalog identities and malformed invocation fields', () => {
    expect(() =>
      createRuntimeInvocationRegistry({
        runId: invocation.runId,
        turnId: invocation.turnId,
        epochs,
        definitions: [definition, definition],
      }),
    ).toThrow(/duplicate/i);
    expect(() =>
      admitRuntimeInvocation(registry(), { ...invocation, providerCallId: 'native-secret' }),
    ).toThrow();
  });
});
