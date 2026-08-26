import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExperimentRecord } from '../../scripts/labs/experiment-record.mjs';

function validRecord() {
  return {
    schemaVersion: 1,
    experimentId: 'B-001',
    wave: 0,
    status: 'passed',
    baseline: {
      extensionSha: '6bf89117b2cc3a4340937b3139d81327857c3fe8',
      parentSha: '59c2dfe6f8b3210ecd8762ff2ef55fcb836b7a0f',
      packageVersion: '0.64.2',
      installedVsixVersion: '0.64.2',
      vsixSha256: 'a'.repeat(64),
      backendDescriptorHash: 'blocked-external',
      provider: 'deterministic-fixture',
      model: 'fixture-v1',
      os: 'win32-x64',
      vscodeVersion: '1.134.0',
    },
    hypothesis: 'baseline identity is reproducible',
    independentVariable: 'clean profile',
    control: 'source checkout identity',
    negativeControl: 'mismatched package version is rejected',
    fixture: 'repository-baseline',
    seed: 'wave-0',
    procedure: ['read identities'],
    expected: ['all identities agree'],
    observed: ['all identities agree'],
    metrics: { mismatches: 0 },
    rawEvidencePaths: ['.clawai-lab/runs/B-001/1/record.json'],
    evidence: ['sha256:baseline-record'],
    result: 'pass',
    failureClass: 'none',
    rootCause: '',
    patch: { required: false, files: [], testsAdded: [] },
    versionCycle: {
      previous: '0.64.2',
      next: '0.64.2',
      bumpReason: 'measurement-only',
    },
    retest: {
      exactReplayAttempts: 1,
      negativeControl: 'passed',
      adjacentSuites: [],
      fullGate: 'not-required',
    },
    scoreDelta: 0,
    verifier: 'baseline-archivist',
    blockedAction: '',
  };
}

test('accepts and deeply freezes a complete experiment record', () => {
  const record = validateExperimentRecord(validRecord());
  assert.equal(record.experimentId, 'B-001');
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.baseline), true);
  assert.equal(Object.isFrozen(record.procedure), true);
});

test('rejects a record without a negative control', () => {
  const record = validRecord();
  delete record.negativeControl;
  assert.throws(() => validateExperimentRecord(record), /negativeControl/u);
});

test('rejects a passed record without evidence', () => {
  const record = validRecord();
  record.evidence = [];
  assert.throws(() => validateExperimentRecord(record), /passed experiment requires evidence/u);
});

test('accepts a bounded external blocker', () => {
  const record = validRecord();
  record.status = 'blocked';
  record.result = 'blocked';
  record.failureClass = 'provider';
  record.blockedAction = 'Provide one synthetic provider credential.';
  assert.equal(validateExperimentRecord(record).result, 'blocked');
});

test('rejects a blocker without an external class and bounded action', () => {
  const record = validRecord();
  record.status = 'blocked';
  record.result = 'blocked';
  record.failureClass = 'product';
  record.blockedAction = '';
  assert.throws(() => validateExperimentRecord(record), /blocked experiment/u);
});

test('rejects malformed artifact hashes and non-finite metrics', () => {
  const badHash = validRecord();
  badHash.baseline.vsixSha256 = 'not-a-hash';
  assert.throws(() => validateExperimentRecord(badHash), /vsixSha256/u);
  const badMetric = validRecord();
  badMetric.metrics.mismatches = Number.NaN;
  assert.throws(() => validateExperimentRecord(badMetric), /metrics/u);
});
