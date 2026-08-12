import {
  parseToolDefinition,
  parseToolInvocation,
  type RuntimeJsonObject,
  type ToolDefinition,
  type ToolInvocation,
} from './runtime-tool-contracts';

/**
 * Something arrived for a run that has already ended.
 *
 * The backend keeps streaming until it learns the run is over, so a frame for
 * the turn after a denied or blocked step is ordinary traffic, not a fault. It
 * used to be a bare Error, and its sentence went straight to the panel as the
 * assistant's answer: an Enterprise-locked run, which correctly refuses the
 * first tool it is asked for, replied "Runtime invocation registry is terminal"
 * and nothing else. Naming it lets the stream stop reading instead.
 */
export class RuntimeRunEndedError extends Error {
  constructor() {
    super('Runtime invocation registry is terminal');
    this.name = 'RuntimeRunEndedError';
  }
}

type RuntimeEpochs = ToolInvocation['epochs'];
export type RuntimeInvocationRegistryStatus =
  'active' | 'blocked' | 'cancelled' | 'completed' | 'failed';

export interface RuntimeInvocationIdentity {
  readonly fingerprint: string;
  readonly idempotencyKey: string;
  readonly invocation: ToolInvocation;
}

export interface RuntimeInvocationRegistry {
  readonly catalog: Readonly<Record<string, ToolDefinition>>;
  readonly epochs: RuntimeEpochs;
  readonly idempotencyKeys: Readonly<Record<string, string>>;
  readonly invocations: Readonly<Record<string, RuntimeInvocationIdentity>>;
  readonly runId: string;
  readonly turnId: string;
  readonly status: RuntimeInvocationRegistryStatus;
}

/**
 * Why a request was admitted but must not execute.
 *
 * The model authors the tool name, the operation and the arguments, so getting
 * any of them wrong is an ordinary mistake it can correct on the next turn —
 * not a protocol violation. Reporting it as a rejection rather than throwing
 * keeps the invocation on the record so the failure can be completed, stored
 * and replayed like any other result.
 */
export interface RuntimeInvocationRejection {
  readonly code: string;
  readonly message: string;
}

export interface RuntimeInvocationAdmission {
  readonly invocation: ToolInvocation;
  readonly registry: RuntimeInvocationRegistry;
  readonly replayed: boolean;
  readonly rejection?: RuntimeInvocationRejection;
}

interface RegistryInput {
  readonly definitions: readonly unknown[];
  readonly epochs: RuntimeEpochs;
  readonly runId: string;
  readonly turnId: string;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
  return value;
}

const schemaTypes = ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'] as const;
type SafeSchemaType = (typeof schemaTypes)[number];
const commonKeywords = new Set(['description', 'enum', 'type']);
const keywordsByType: Readonly<Record<SafeSchemaType, ReadonlySet<string>>> = {
  array: new Set(['items', 'maxItems', 'minItems']),
  boolean: new Set(),
  integer: new Set(['maximum', 'minimum']),
  null: new Set(),
  number: new Set(['maximum', 'minimum']),
  object: new Set([
    'additionalProperties',
    'maxProperties',
    'minProperties',
    'properties',
    'required',
  ]),
  string: new Set(['maxLength', 'minLength']),
};

function isObject(value: unknown): value is RuntimeJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaObject(value: unknown, path: string): RuntimeJsonObject {
  if (!isObject(value)) {
    throw new Error(`Tool input schema at ${path} must be an object`);
  }
  return value;
}

function isSafeSchemaType(value: unknown): value is SafeSchemaType {
  return schemaTypes.some((candidate) => candidate === value);
}

function schemaType(schema: RuntimeJsonObject, path: string): SafeSchemaType {
  const type = schema.type;
  if (!isSafeSchemaType(type)) {
    throw new Error(`Tool input schema at ${path} has an unsupported type`);
  }
  return type;
}

function integerKeyword(schema: RuntimeJsonObject, key: string, path: string): number | undefined {
  const value = schema[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Tool input schema ${path}.${key} must be a nonnegative integer`);
  }
  return value;
}

function numericKeyword(schema: RuntimeJsonObject, key: string, path: string): number | undefined {
  const value = schema[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Tool input schema ${path}.${key} must be finite`);
  }
  return value;
}

function assertKeywordBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  path: string,
): void {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new Error(`Tool input schema ${path} has inverted bounds`);
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(',')}}`;
  }
  throw new Error('Runtime invocation contains non-JSON data');
}

function validateEnum(schema: RuntimeJsonObject, path: string): void {
  if (schema.enum === undefined) return;
  if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 100) {
    throw new Error(`Tool input schema ${path}.enum must be a bounded non-empty array`);
  }
  const values = schema.enum.map(canonicalize);
  if (new Set(values).size !== values.length) {
    throw new Error(`Tool input schema ${path}.enum contains duplicates`);
  }
}

function validateKeywords(schema: RuntimeJsonObject, type: SafeSchemaType, path: string): void {
  const allowed = keywordsByType[type];
  for (const key of Object.keys(schema)) {
    if (!commonKeywords.has(key) && !allowed.has(key)) {
      throw new Error(`Tool input schema ${path} contains unsupported keyword ${key}`);
    }
  }
  if (schema.description !== undefined && typeof schema.description !== 'string') {
    throw new Error(`Tool input schema ${path}.description must be a string`);
  }
}

function validateObjectSchema(schema: RuntimeJsonObject, path: string): void {
  if (
    schema.additionalProperties !== false &&
    !(path !== '$' && schema.additionalProperties === true)
  ) {
    throw new Error(`Tool input schema ${path} must deny additional properties`);
  }
  const properties = schemaObject(schema.properties ?? {}, `${path}.properties`);
  for (const [key, value] of Object.entries(properties)) {
    validateSafeSchema(value, `${path}.properties.${key}`);
  }
  const required = schema.required ?? [];
  if (!Array.isArray(required) || !required.every((entry) => typeof entry === 'string')) {
    throw new Error(`Tool input schema ${path}.required must contain property names`);
  }
  if (new Set(required).size !== required.length) {
    throw new Error(`Tool input schema ${path}.required contains duplicates`);
  }
  for (const key of required) {
    if (!(key in properties)) {
      throw new Error(`Tool input schema ${path} requires unknown property ${key}`);
    }
  }
  assertKeywordBounds(
    integerKeyword(schema, 'minProperties', path),
    integerKeyword(schema, 'maxProperties', path),
    path,
  );
}

function validateArraySchema(schema: RuntimeJsonObject, path: string): void {
  validateSafeSchema(schema.items, `${path}.items`);
  assertKeywordBounds(
    integerKeyword(schema, 'minItems', path),
    integerKeyword(schema, 'maxItems', path),
    path,
  );
}

function validateSafeSchema(value: unknown, path = '$'): void {
  const schema = schemaObject(value, path);
  const type = schemaType(schema, path);
  validateKeywords(schema, type, path);
  validateEnum(schema, path);
  if (type === 'object') validateObjectSchema(schema, path);
  if (type === 'array') validateArraySchema(schema, path);
  if (type === 'string') {
    assertKeywordBounds(
      integerKeyword(schema, 'minLength', path),
      integerKeyword(schema, 'maxLength', path),
      path,
    );
  }
  if (type === 'number' || type === 'integer') {
    assertKeywordBounds(
      numericKeyword(schema, 'minimum', path),
      numericKeyword(schema, 'maximum', path),
      path,
    );
  }
}

function definitionKey(name: string, version: string): string {
  return `${name}\u0000${version}`;
}

function buildCatalog(definitions: readonly unknown[]): Readonly<Record<string, ToolDefinition>> {
  const catalog: Record<string, ToolDefinition> = {};
  for (const value of definitions) {
    const definition = parseToolDefinition(value);
    if (schemaType(definition.inputSchema, '$') !== 'object') {
      throw new Error(`Tool ${definition.name} input schema must describe an object`);
    }
    validateSafeSchema(definition.inputSchema);
    const key = definitionKey(definition.name, definition.version);
    if (catalog[key] !== undefined) {
      throw new Error(`Duplicate tool catalog identity ${definition.name}@${definition.version}`);
    }
    catalog[key] = freezeDeep(definition);
  }
  return catalog;
}

export function createRuntimeInvocationRegistry(input: RegistryInput): RuntimeInvocationRegistry {
  if (typeof input.turnId !== 'string' || input.turnId.length === 0) {
    throw new Error('Runtime invocation registry requires a turn');
  }
  return {
    catalog: freezeDeep(buildCatalog(input.definitions)),
    epochs: { ...input.epochs },
    idempotencyKeys: {},
    invocations: {},
    runId: input.runId,
    turnId: input.turnId,
    status: 'active',
  };
}

function enumMatches(value: unknown, allowed: unknown): boolean {
  return (
    !Array.isArray(allowed) || allowed.some((entry) => canonicalize(entry) === canonicalize(value))
  );
}

// Naming the key that broke was already an improvement over zod's bare
// "Invalid input", but a model that guessed a plausible-but-wrong shape (flat
// rootKey/path/content instead of a nested transaction) still had to guess
// again from there. Naming the keys that WOULD have worked is the difference
// between the model retrying blindly and correcting on the very next turn.
function throwUnknownPropertyError(
  path: string,
  key: string,
  properties: Readonly<Record<string, unknown>>,
): never {
  const allowed = Object.keys(properties);
  const hint = allowed.length > 0 ? ` (expected one of: ${allowed.join(', ')})` : '';
  throw new Error(`Tool arguments ${path}.${key} is not allowed${hint}`);
}

function validateObjectValue(
  value: RuntimeJsonObject,
  schema: RuntimeJsonObject,
  path: string,
): void {
  const properties = schemaObject(schema.properties ?? {}, `${path}.properties`);
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === 'string')
    : [];
  for (const key of required) {
    if (!(key in value)) throw new Error(`Tool arguments ${path}.${key} is required`);
  }
  for (const [key, entry] of Object.entries(value)) {
    const childSchema = properties[key];
    if (childSchema === undefined) {
      if (schema.additionalProperties === true) continue;
      throwUnknownPropertyError(path, key, properties);
    }
    validateValue(entry, schemaObject(childSchema, `${path}.${key}`), `${path}.${key}`);
  }
  const size = Object.keys(value).length;
  const minProperties = typeof schema.minProperties === 'number' ? schema.minProperties : 0;
  if (size < minProperties) {
    throw new Error(`Tool arguments ${path} has too few properties`);
  }
  const maxProperties =
    typeof schema.maxProperties === 'number' ? schema.maxProperties : Number.POSITIVE_INFINITY;
  if (size > maxProperties) {
    throw new Error(`Tool arguments ${path} has too many properties`);
  }
}

function validateArrayValue(
  value: readonly unknown[],
  schema: RuntimeJsonObject,
  path: string,
): void {
  const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
  if (value.length < minItems) {
    throw new Error(`Tool arguments ${path} has too few items`);
  }
  const maxItems = typeof schema.maxItems === 'number' ? schema.maxItems : Number.POSITIVE_INFINITY;
  if (value.length > maxItems) {
    throw new Error(`Tool arguments ${path} has too many items`);
  }
  const items = schemaObject(schema.items, `${path}.items`);
  value.forEach((entry, index) => {
    validateValue(entry, items, `${path}[${String(index)}]`);
  });
}

function validateNumberValue(value: unknown, schema: RuntimeJsonObject, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Tool arguments ${path} must be a number`);
  }
  if (schema.type === 'integer' && !Number.isInteger(value)) {
    throw new Error(`Tool arguments ${path} must be an integer`);
  }
  const minimum = typeof schema.minimum === 'number' ? schema.minimum : Number.NEGATIVE_INFINITY;
  if (value < minimum) {
    throw new Error(`Tool arguments ${path} is below the minimum`);
  }
  const maximum = typeof schema.maximum === 'number' ? schema.maximum : Number.POSITIVE_INFINITY;
  if (value > maximum) {
    throw new Error(`Tool arguments ${path} exceeds the maximum`);
  }
}

function validateStringValue(value: unknown, schema: RuntimeJsonObject, path: string): void {
  if (typeof value !== 'string') {
    throw new Error(`Tool arguments ${path} must be a string`);
  }
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
  if (value.length < minLength) {
    throw new Error(`Tool arguments ${path} is too short`);
  }
  const maxLength =
    typeof schema.maxLength === 'number' ? schema.maxLength : Number.POSITIVE_INFINITY;
  if (value.length > maxLength) {
    throw new Error(`Tool arguments ${path} is too long`);
  }
}

function validateObjectType(value: unknown, schema: RuntimeJsonObject, path: string): void {
  if (!isObject(value)) {
    throw new Error(`Tool arguments ${path} must be an object`);
  }
  validateObjectValue(value, schema, path);
}

function validateArrayType(value: unknown, schema: RuntimeJsonObject, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Tool arguments ${path} must be an array`);
  }
  validateArrayValue(value, schema, path);
}

function validateBooleanType(value: unknown, path: string): void {
  if (typeof value !== 'boolean') {
    throw new Error(`Tool arguments ${path} must be a boolean`);
  }
}

function validateNullType(value: unknown, path: string): void {
  if (value !== null) {
    throw new Error(`Tool arguments ${path} must be null`);
  }
}

function validateValue(value: unknown, schema: RuntimeJsonObject, path: string): void {
  if (!enumMatches(value, schema.enum)) throw new Error(`Tool arguments ${path} is not allowed`);
  const type = schemaType(schema, path);
  switch (type) {
    case 'object': {
      validateObjectType(value, schema, path);
      return;
    }
    case 'array': {
      validateArrayType(value, schema, path);
      return;
    }
    case 'string': {
      validateStringValue(value, schema, path);
      return;
    }
    case 'number':
    case 'integer': {
      validateNumberValue(value, schema, path);
      return;
    }
    case 'boolean': {
      validateBooleanType(value, path);
      return;
    }
    case 'null': {
      validateNullType(value, path);
      return;
    }
  }
}

function epochsMatch(left: RuntimeEpochs, right: RuntimeEpochs): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
}

function exactDefinition(
  registry: RuntimeInvocationRegistry,
  invocation: ToolInvocation,
): ToolDefinition {
  const definition = registry.catalog[definitionKey(invocation.toolName, invocation.toolVersion)];
  if (definition === undefined)
    throw new Error('Runtime invocation references an unknown tool or version');
  if (!definition.operations.includes(invocation.operation)) {
    throw new Error('Runtime invocation references an unsupported operation');
  }
  if (!definition.targetIds.includes(invocation.targetId)) {
    throw new Error('Runtime invocation references an unsupported target');
  }
  return definition;
}

export function admitRuntimeInvocation(
  registry: RuntimeInvocationRegistry,
  value: unknown,
): RuntimeInvocationAdmission {
  const invocation = parseToolInvocation(value);
  const fingerprint = canonicalize(invocation);
  const existing = registry.invocations[invocation.invocationId];
  if (existing !== undefined) {
    if (existing.fingerprint === fingerprint) {
      return { invocation: existing.invocation, registry, replayed: true };
    }
    throw new Error(
      `Runtime invocation ${invocation.invocationId} conflicts with an earlier request`,
    );
  }
  if (registry.status !== 'active') throw new RuntimeRunEndedError();
  if (registry.idempotencyKeys[invocation.idempotencyKey] !== undefined) {
    throw new Error(`Runtime invocation idempotency key ${invocation.idempotencyKey} conflicts`);
  }
  if (invocation.runId !== registry.runId)
    throw new Error('Runtime invocation belongs to another run');
  if (invocation.turnId !== registry.turnId)
    throw new Error('Runtime invocation belongs to another turn');
  if (!epochsMatch(invocation.epochs, registry.epochs))
    throw new Error('Runtime invocation epochs are stale');
  // A tool, version, operation or target the catalog never advertised still
  // throws: that is catalog or epoch drift between the two sides of the
  // protocol, not something the model can talk its way out of.
  const definition = exactDefinition(registry, invocation);
  // The argument object is different. The model authored it, so a shape it got
  // wrong is an ordinary mistake it can correct on the very next turn. Throwing
  // here escaped dispatch entirely and cancelled the whole run: a live mission
  // read the schema, wrote a file, then named `content` at the top level
  // instead of inside `operations[]` and the run ended on
  // `Tool arguments $.content is not allowed` without the model ever being told.
  // The request is recorded and handed back as a rejection so it completes as
  // an ordinary failed result the next turn can answer.
  let rejection: RuntimeInvocationRejection | undefined;
  try {
    validateValue(invocation.arguments, definition.inputSchema, '$');
  } catch (error: unknown) {
    rejection = {
      code: 'TOOL_ARGUMENTS_INVALID',
      message: error instanceof Error ? error.message : 'Tool arguments are not valid',
    };
  }
  const identity = freezeDeep<RuntimeInvocationIdentity>({
    fingerprint,
    idempotencyKey: invocation.idempotencyKey,
    invocation,
  });
  return {
    invocation,
    replayed: false,
    ...(rejection === undefined ? {} : { rejection }),
    registry: {
      ...registry,
      idempotencyKeys: {
        ...registry.idempotencyKeys,
        [invocation.idempotencyKey]: invocation.invocationId,
      },
      invocations: freezeDeep({ ...registry.invocations, [invocation.invocationId]: identity }),
    },
  };
}

export function closeRuntimeInvocationRegistry(
  registry: RuntimeInvocationRegistry,
  status: Exclude<RuntimeInvocationRegistryStatus, 'active'>,
): RuntimeInvocationRegistry {
  if (registry.status === status) return registry;
  if (registry.status !== 'active')
    throw new Error('Runtime invocation registry is already terminal');
  return { ...registry, status };
}

export function advanceRuntimeInvocationRegistryTurn(
  registry: RuntimeInvocationRegistry,
  turnId: string,
): RuntimeInvocationRegistry {
  if (typeof turnId !== 'string' || turnId.length === 0) {
    throw new Error('Runtime invocation registry requires a turn');
  }
  if (registry.status !== 'active') {
    throw new RuntimeRunEndedError();
  }
  if (registry.turnId === turnId) return registry;
  return { ...registry, turnId };
}
