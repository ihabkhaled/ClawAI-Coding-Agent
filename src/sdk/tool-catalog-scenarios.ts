import { createTeam } from './agent-team';
import { agentToolkit } from './agent-toolkit';
import { splitCatalog } from './deferred-tools';
import { AGENT_DEFAULT_TOOL_CATEGORIES } from './workspace-toolkit.constants';

import type { AgentConfig } from './create-agent.types';
import type { CatalogScenario } from './tool-catalog-size.types';
import type { VisionPort } from './vision-tool.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

const NO_VISION: VisionPort = {
  models: () => Promise.resolve([]),
  ask: () => Promise.resolve(''),
};

const ALL_CATEGORIES: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'http',
  'http-write',
  'browser',
  'shell',
  'agents',
];

/** The definitions a run with these grants would send; `everything` also switches on every optional tool. */
export function definitionsFor(
  allow: readonly AgentToolCategory[],
  everything: boolean,
  toolsProfile?: string,
): readonly unknown[] {
  const config: AgentConfig = {
    auth: { token: 'size-report' },
    workspaceRoot: process.cwd(),
    permissions: {
      allow,
      ...(everything ? { httpAllowHosts: ['example.com'], shell: {} } : {}),
    },
    ...(everything
      ? { taskPlan: true, loadKnowledge: true, vision: { port: NO_VISION }, maxAgents: 4 }
      : {}),
    ...(toolsProfile === undefined ? {} : { toolsProfile }),
  };
  const team = createTeam(config, () => {
    throw new Error('The size report never starts an agent');
  });
  const toolkit = agentToolkit(config, undefined, () => undefined, team);
  const { definitions } = toolkit;
  toolkit.dispose?.();
  return definitions;
}

/**
 * The catalogs a run actually sends: the default grants, the grants most coding
 * runs add, and every category the operator could allow.
 */
export function catalogScenarios(): readonly CatalogScenario[] {
  const everything = definitionsFor(ALL_CATEGORIES, true);
  return [
    {
      label: 'default (read,git)',
      definitions: definitionsFor(AGENT_DEFAULT_TOOL_CATEGORIES, false),
    },
    {
      label: 'default + command',
      definitions: definitionsFor([...AGENT_DEFAULT_TOOL_CATEGORIES, 'command'], false),
    },
    { label: 'every category', definitions: everything },
    {
      label: 'every category, profile minimal',
      definitions: definitionsFor(ALL_CATEGORIES, true, 'minimal'),
    },
    {
      label: 'every category, profile dev',
      definitions: definitionsFor(ALL_CATEGORIES, true, 'dev'),
    },
    { label: 'every category, deferred stubs', definitions: splitCatalog(everything).wire },
  ];
}
