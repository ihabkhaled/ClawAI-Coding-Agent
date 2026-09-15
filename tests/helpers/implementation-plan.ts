import type { ImplementationPlan } from '../../src/core/implementation-plan';

/** The smallest plan the schema accepts, so a test can vary one thing at a time. */
export function examplePlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
    schemaVersion: '1',
    planId: 'plan-parity',
    title: 'Parity plan',
    goal: 'Reach parity',
    strategy: 'feature',
    reportMode: 'concise',
    policyInheritance: 'global-and-project-policy-cannot-be-weakened',
    executionPermissionGranted: false,
    repositories: ['extension'],
    epics: [{ epicId: 'epic-one', title: 'Epic one', capabilityIds: ['cap-one'] }],
    capabilities: [{ capabilityId: 'cap-one', title: 'Capability one', storyIds: ['story-one'] }],
    stories: [{ storyId: 'story-one', title: 'Story one', taskIds: ['task-one'] }],
    tasks: [
      {
        taskId: 'task-one',
        title: 'Task one',
        description: 'Do the thing',
        ownedPaths: ['src/feature.ts'],
        integrationSeams: [],
        evidence: [],
        assumptions: [],
        missingEvidence: [],
        currentState: 'missing',
        acceptanceCriteria: [
          { criterionId: 'crit-one', statement: 'It works', evidenceRequired: 'A test' },
        ],
        verification: ['npm test'],
      },
    ],
    dependencies: [],
    risks: [],
    adrNeeds: [],
    migrations: [],
    releases: [
      {
        releaseId: 'rel-one',
        version: '1.0.0',
        title: 'First',
        taskIds: ['task-one'],
        definitionOfDone: ['Gates green'],
      },
    ],
    ...overrides,
  };
}
