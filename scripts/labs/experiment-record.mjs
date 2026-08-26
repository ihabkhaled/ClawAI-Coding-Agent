import { deserialize, serialize } from 'node:v8';

const STATUS_VALUES = new Set([
  'planned',
  'running',
  'passed',
  'failed',
  'inconclusive',
  'blocked',
]);
const RESULT_VALUES = new Set(['pass', 'fail', 'inconclusive', 'blocked']);
const FAILURE_VALUES = new Set([
  'none',
  'product',
  'test',
  'environment',
  'provider',
  'backend',
  'security',
  'unknown',
]);
const EXTERNAL_BLOCKER_VALUES = new Set(['environment', 'provider', 'backend']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function requireObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${field} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
  return value;
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  return value;
}

function requireFiniteMetrics(value) {
  const metrics = requireObject(value, 'metrics');
  for (const [name, metric] of Object.entries(metrics)) {
    if (typeof metric !== 'number' || !Number.isFinite(metric)) {
      throw new TypeError(`metrics.${name} must be finite`);
    }
  }
  return metrics;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export function validateExperimentRecord(value) {
  const record = deserialize(serialize(requireObject(value, 'experiment record')));
  if (record.schemaVersion !== 1) {
    throw new TypeError('schemaVersion must equal 1');
  }
  requireString(record.experimentId, 'experimentId');
  if (!Number.isInteger(record.wave) || record.wave < 0) {
    throw new TypeError('wave must be a non-negative integer');
  }
  if (!STATUS_VALUES.has(record.status)) {
    throw new TypeError('status is invalid');
  }
  if (!RESULT_VALUES.has(record.result)) {
    throw new TypeError('result is invalid');
  }
  if (!FAILURE_VALUES.has(record.failureClass)) {
    throw new TypeError('failureClass is invalid');
  }

  const baseline = requireObject(record.baseline, 'baseline');
  for (const field of [
    'extensionSha',
    'parentSha',
    'packageVersion',
    'installedVsixVersion',
    'backendDescriptorHash',
    'provider',
    'model',
    'os',
    'vscodeVersion',
  ]) {
    requireString(baseline[field], `baseline.${field}`);
  }
  if (!SHA256_PATTERN.test(requireString(baseline.vsixSha256, 'baseline.vsixSha256'))) {
    throw new TypeError('baseline.vsixSha256 must be a lowercase SHA-256 digest');
  }

  for (const field of [
    'hypothesis',
    'independentVariable',
    'control',
    'negativeControl',
    'fixture',
    'seed',
    'verifier',
  ]) {
    requireString(record[field], field);
  }
  requireString(record.rootCause, 'rootCause', true);
  requireString(record.blockedAction, 'blockedAction', true);
  for (const field of ['procedure', 'expected', 'observed', 'rawEvidencePaths', 'evidence']) {
    requireStringArray(record[field], field);
  }
  requireFiniteMetrics(record.metrics);
  requireObject(record.patch, 'patch');
  requireObject(record.versionCycle, 'versionCycle');
  requireObject(record.retest, 'retest');
  if (typeof record.scoreDelta !== 'number' || !Number.isFinite(record.scoreDelta)) {
    throw new TypeError('scoreDelta must be finite');
  }
  if (record.status === 'passed' && record.result !== 'pass') {
    throw new TypeError('passed status requires pass result');
  }
  if (record.result === 'pass' && record.evidence.length === 0) {
    throw new TypeError('passed experiment requires evidence');
  }
  if (
    record.result === 'blocked' &&
    (!EXTERNAL_BLOCKER_VALUES.has(record.failureClass) || record.blockedAction.trim().length === 0)
  ) {
    throw new TypeError('blocked experiment requires an external failure class and bounded action');
  }
  return deepFreeze(record);
}
