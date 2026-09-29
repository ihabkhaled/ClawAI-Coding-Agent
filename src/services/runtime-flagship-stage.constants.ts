import type { FlagshipStage } from '../core/flagship-delivery';
import type { SubAgentTask } from '../core/multi-agent-dag';

/** The sub-agent role each stage kind runs as. */
export const FLAGSHIP_STAGE_ROLES: Readonly<Record<FlagshipStage, SubAgentTask['role']>> = {
  discover: 'explorer',
  plan: 'explorer',
  authorize: 'reviewer',
  implement: 'implementer',
  integrate: 'integrator',
  verify: 'tester',
  review: 'reviewer',
  commit: 'integrator',
  'publish-ready': 'reviewer',
  report: 'documenter',
};

/** The tool families each stage kind's sub-agent may call. */
export const FLAGSHIP_STAGE_TOOLS: Readonly<Record<FlagshipStage, readonly string[]>> = {
  discover: ['workspace.files', 'workspace.intelligence', 'workspace.git'],
  plan: ['workspace.intelligence', 'workspace.planning', 'runtime.journal'],
  authorize: ['workspace.planning', 'runtime.evidence'],
  implement: [
    'workspace.files',
    'workspace.command',
    'workspace.process',
    'workspace.quality',
    'workspace.container',
    'workspace.database',
    'workspace.browser',
    'runtime.services',
  ],
  integrate: ['runtime.integration', 'workspace.git'],
  verify: ['workspace.quality', 'workspace.browser', 'runtime.services', 'runtime.evidence'],
  review: ['workspace.git', 'workspace.intelligence', 'runtime.evidence'],
  commit: ['workspace.git', 'runtime.evidence'],
  'publish-ready': ['workspace.git', 'runtime.evidence'],
  report: ['workspace.files', 'runtime.evidence', 'runtime.journal'],
};
