import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const READINESS_CATEGORIES = Object.freeze([
  { id: 'end-to-end-correctness', weight: 18, minimumFraction: 0.85 },
  { id: 'tool-edit-integrity', weight: 12, minimumFraction: 0.9 },
  { id: 'session-durability', weight: 12, minimumFraction: 0.9 },
  { id: 'streaming-observability', weight: 10, minimumFraction: 0.7 },
  { id: 'recovery-idempotency', weight: 10, minimumFraction: 0.9 },
  { id: 'regression-test-quality', weight: 10, minimumFraction: 0.7 },
  { id: 'security-isolation', weight: 10, minimumFraction: 0.9 },
  { id: 'prompt-context-planning', weight: 8, minimumFraction: 0.7 },
  { id: 'performance', weight: 5, minimumFraction: 0.7 },
  { id: 'ux-accessibility', weight: 3, minimumFraction: 0.7 },
  { id: 'packaging-release', weight: 2, minimumFraction: 0.7 },
]);

const HARD_CAPS = Object.freeze([
  { field: 'criticalSecurityFinding', when: true, cap: 49, reason: 'critical security failure' },
  { field: 'falseCompletion', when: true, cap: 59, reason: 'false completion' },
  { field: 'installedVsixReplay', when: false, cap: 69, reason: 'no installed VSIX replay' },
  {
    field: 'extensionHostUiEvidence',
    when: false,
    cap: 74,
    reason: 'no extension-host UI evidence',
  },
  { field: 'durabilityEvidence', when: false, cap: 79, reason: 'no durability evidence' },
  { field: 'silentCapabilityLoss', when: true, cap: 80, reason: 'silent capability loss' },
  { field: 'releaseDrift', when: true, cap: 84, reason: 'release identity drift' },
  {
    field: 'skippedTestsCountedAsPass',
    when: true,
    cap: 84,
    reason: 'skipped tests counted as pass',
  },
]);

function roundScore(value) {
  return Math.round(value * 100) / 100;
}

export function calculateReadinessScore(input) {
  if (input === null || typeof input !== 'object' || !Array.isArray(input.categories)) {
    throw new TypeError('readiness input must contain categories');
  }
  const supplied = new Map(input.categories.map((category) => [category.id, category]));
  const failedMinimums = [];
  let rawScore = 0;
  for (const definition of READINESS_CATEGORIES) {
    const category = supplied.get(definition.id);
    if (category === undefined) {
      throw new TypeError(`missing readiness category: ${definition.id}`);
    }
    if (
      typeof category.earnedFraction !== 'number' ||
      !Number.isFinite(category.earnedFraction) ||
      category.earnedFraction < 0 ||
      category.earnedFraction > 1
    ) {
      throw new TypeError(`${definition.id} earnedFraction must be between 0 and 1`);
    }
    if (
      !Array.isArray(category.evidenceIds) ||
      category.evidenceIds.some((id) => typeof id !== 'string')
    ) {
      throw new TypeError(`${definition.id} evidence must be string IDs`);
    }
    if (category.earnedFraction > 0 && category.evidenceIds.length === 0) {
      throw new TypeError(`${definition.id} cannot earn points without evidence`);
    }
    rawScore += definition.weight * category.earnedFraction;
    if (category.earnedFraction < definition.minimumFraction) {
      failedMinimums.push(definition.id);
    }
  }

  const hardGates = input.hardGates ?? {};
  const appliedCaps = HARD_CAPS.filter(({ field, when }) => hardGates[field] === when).map(
    ({ cap, reason }) => ({ cap, reason }),
  );
  const maximum = appliedCaps.reduce((cap, item) => Math.min(cap, item.cap), 100);
  const roundedRawScore = roundScore(rawScore);
  const cappedScore = roundScore(Math.min(roundedRawScore, maximum));
  return Object.freeze({
    rawScore: roundedRawScore,
    cappedScore,
    eligible: cappedScore >= 85 && failedMinimums.length === 0,
    failedMinimums: Object.freeze(failedMinimums),
    appliedCaps: Object.freeze(appliedCaps),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const emptyInput = {
    categories: READINESS_CATEGORIES.map(({ id }) => ({ id, earnedFraction: 0, evidenceIds: [] })),
    hardGates: {
      criticalSecurityFinding: false,
      falseCompletion: false,
      installedVsixReplay: false,
      extensionHostUiEvidence: false,
      durabilityEvidence: false,
      silentCapabilityLoss: false,
      releaseDrift: true,
      skippedTestsCountedAsPass: false,
    },
  };
  process.stdout.write(`${JSON.stringify(calculateReadinessScore(emptyInput), null, 2)}\n`);
}
