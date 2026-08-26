import assert from 'node:assert/strict';
import test from 'node:test';

import {
  READINESS_CATEGORIES,
  calculateReadinessScore,
} from '../../scripts/labs/readiness-score.mjs';

function completeInput() {
  return {
    categories: READINESS_CATEGORIES.map(({ id }) => ({
      id,
      earnedFraction: 1,
      evidenceIds: [`${id}-proof`],
    })),
    hardGates: {
      criticalSecurityFinding: false,
      falseCompletion: false,
      installedVsixReplay: true,
      extensionHostUiEvidence: true,
      durabilityEvidence: true,
      silentCapabilityLoss: false,
      releaseDrift: false,
      skippedTestsCountedAsPass: false,
    },
  };
}

test('defines the exact eleven categories with weights totaling 100', () => {
  assert.equal(READINESS_CATEGORIES.length, 11);
  assert.equal(
    READINESS_CATEGORIES.reduce((total, category) => total + category.weight, 0),
    100,
  );
});

test('scores a fully evidenced input at 100', () => {
  const result = calculateReadinessScore(completeInput());
  assert.equal(result.rawScore, 100);
  assert.equal(result.cappedScore, 100);
  assert.equal(result.eligible, true);
});

test('applies the installed VSIX and critical security caps', () => {
  const noVsix = completeInput();
  noVsix.hardGates.installedVsixReplay = false;
  assert.equal(calculateReadinessScore(noVsix).cappedScore, 69);
  const securityFailure = completeInput();
  securityFailure.hardGates.criticalSecurityFinding = true;
  assert.equal(calculateReadinessScore(securityFailure).cappedScore, 49);
});

test('does not award points without evidence', () => {
  const input = completeInput();
  input.categories[0].evidenceIds = [];
  assert.throws(() => calculateReadinessScore(input), /evidence/u);
});

test('rejects an otherwise high score when a category minimum fails', () => {
  const input = completeInput();
  const performance = input.categories.find(({ id }) => id === 'performance');
  performance.earnedFraction = 0.69;
  const result = calculateReadinessScore(input);
  assert.equal(result.rawScore >= 85, true);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.failedMinimums, ['performance']);
});

test('uses the most restrictive cap and records every applicable cap', () => {
  const input = completeInput();
  input.hardGates.installedVsixReplay = false;
  input.hardGates.releaseDrift = true;
  input.hardGates.skippedTestsCountedAsPass = true;
  const result = calculateReadinessScore(input);
  assert.equal(result.cappedScore, 69);
  assert.deepEqual(
    result.appliedCaps.map(({ cap }) => cap),
    [69, 84, 84],
  );
});
