import os from 'node:os';

import { mcpToolDefinition } from '../../src/core/mcp/mcp-tool-definition';
import { webResearchToolDefinition } from '../../src/core/web-research-operations';
import { HEADLESS_TOOL_CATEGORIES } from '../../src/headless/headless-args.constants';
import { createTeam } from '../../src/sdk/agent-team';
import { AGENT_TEAM_TOOL_OPERATIONS } from '../../src/sdk/agent-team-tool.constants';
import { agentToolkit } from '../../src/sdk/agent-toolkit';
import { BROWSER_TOOL_OPERATIONS } from '../../src/sdk/browser-tool.constants';
import { createAgent } from '../../src/sdk/create-agent';
import { KNOWLEDGE_TOOL_OPERATIONS } from '../../src/sdk/knowledge-tool.constants';
import { isPolicyDrivenMode, policyOutcome } from '../../src/sdk/permission-mode-policy';
import { needsApproval } from '../../src/sdk/permission-modes';
import { AGENT_PLAN_TOOL_CATEGORIES } from '../../src/sdk/permission-modes.constants';
import { PROCESS_WATCH_OPERATIONS } from '../../src/sdk/process-watch-tool.constants';
import { VISION_TOOL_OPERATIONS } from '../../src/sdk/vision-tool.constants';
import { toolCategory } from '../../src/sdk/workspace-toolkit';

import { CORE_TOOL_NOTES } from './tools-doc-notes-core';
import { TEST_TOOL_NOTES } from './tools-doc-notes-test';

import type { ToolNote } from './tools-doc.types';
import type { AgentConfig } from '../../src/sdk/create-agent.types';
import type { AgentPermissionMode } from '../../src/sdk/permission-modes.types';
import type { AgentToolCategory } from '../../src/sdk/workspace-toolkit.types';

/** What the model is sent for one tool. */
export interface RealDefinition {
  readonly name: string;
  readonly description: string;
  readonly operations: readonly string[];
  readonly inputSchema: { readonly properties?: Readonly<Record<string, SchemaProperty>> };
}

interface SchemaProperty {
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly maxItems?: number;
}

export const ALL_NOTES: readonly ToolNote[] = [...CORE_TOOL_NOTES, ...TEST_TOOL_NOTES];

const MODES: readonly AgentPermissionMode[] = [
  'ask',
  'accept-edits',
  'autonomous-scoped',
  'strict',
];
const EVERY: readonly AgentToolCategory[] = [...HEADLESS_TOOL_CATEGORIES];

/** The definitions of every tool the toolkit can offer, as the model receives them. */
export function realDefinitions(): readonly RealDefinition[] {
  const config: AgentConfig = {
    auth: { token: 'x' },
    workspaceRoot: os.tmpdir(),
    permissions: { allow: EVERY, httpAllowHosts: ['localhost'], shell: {} },
    loadKnowledge: true,
    taskPlan: true,
    vision: {},
    browser: {},
  };
  const team = createTeam(config, createAgent);
  const toolkit = agentToolkit(config, undefined, () => undefined, team);
  const found = toolkit.definitions as readonly RealDefinition[];
  toolkit.dispose?.();
  return [...found, webResearchToolDefinition, mcpToolDefinition] as readonly RealDefinition[];
}

/** The tools the workspace toolkit does not run itself; each owns its own category table. */
const OWN_CATEGORIES: Readonly<Record<string, Readonly<Record<string, string | undefined>>>> = {
  'browser.page': BROWSER_TOOL_OPERATIONS,
  'process.watch': PROCESS_WATCH_OPERATIONS,
  'knowledge.context': KNOWLEDGE_TOOL_OPERATIONS,
  'vision.describe': VISION_TOOL_OPERATIONS,
  'agent.team': AGENT_TEAM_TOOL_OPERATIONS,
};

function categoriesOf(tool: string, operation: string): readonly AgentToolCategory[] {
  if (tool === 'http.request') return ['http', 'http-write'];
  if (tool === 'runtime.mcp') return ['mcp'];
  const own = OWN_CATEGORIES[tool]?.[operation];
  const found = own ?? toolCategory({ toolName: tool, operation, arguments: {} });
  return found === undefined ? [] : [found as AgentToolCategory];
}

function cell(
  mode: AgentPermissionMode,
  tool: string,
  operation: string,
  category: AgentToolCategory,
): string {
  const request = { toolName: tool, operation, arguments: {}, category };
  if (category !== 'agents' && isPolicyDrivenMode(mode)) {
    const outcome = policyOutcome(mode, request);
    return outcome === 'ask' ? 'asks' : outcome === 'deny' ? 'refused' : 'runs';
  }
  return needsApproval(mode, request) ? 'asks' : 'runs';
}

function permissionRows(definition: RealDefinition): string[] {
  const rows: string[] = [];
  for (const operation of definition.operations) {
    const categories = categoriesOf(definition.name, operation);
    for (const category of categories.length === 0 ? (['none'] as const) : categories) {
      const label =
        definition.name === 'http.request'
          ? `${operation} (${category === 'http' ? 'GET, HEAD' : 'POST, PUT, PATCH, DELETE'})`
          : operation;
      if (category === 'none') {
        rows.push(`| ${label} | none (research mode) | runs | runs | runs | runs | runs |`);
        continue;
      }
      const plan = AGENT_PLAN_TOOL_CATEGORIES.includes(category) ? 'runs' : 'removed';
      const modes = MODES.map((mode) => cell(mode, definition.name, operation, category));
      rows.push(`| ${label} | \`${category}\` | ${plan} | ${modes.join(' | ')} |`);
    }
  }
  return rows;
}

function describeProperty(name: string, property: SchemaProperty): string {
  const kind =
    property.enum === undefined ? (property.type ?? 'any') : `one of ${property.enum.join(', ')}`;
  const bounds: string[] = [];
  if (property.minimum !== undefined || property.maximum !== undefined) {
    bounds.push(`${String(property.minimum ?? '')}..${String(property.maximum ?? '')}`);
  }
  if (property.maxLength !== undefined) bounds.push(`max ${String(property.maxLength)} chars`);
  if (property.maxItems !== undefined) bounds.push(`max ${String(property.maxItems)} items`);
  return `| \`${name}\` | ${kind} | ${bounds.join(', ')} |`;
}

function argumentRows(definition: RealDefinition): string[] {
  const properties = definition.inputSchema.properties ?? {};
  return Object.entries(properties).map(([name, property]) => describeProperty(name, property));
}

function bullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function renderTool(note: ToolNote, definition: RealDefinition): string[] {
  const size = JSON.stringify(definition).length;
  const operationLines = Object.entries(note.operations).map(
    ([operation, text]) => `- \`${operation}\` ${text}`,
  );
  return [
    `### \`${note.tool}\``,
    '',
    note.purpose,
    '',
    `- **Turn it on:** ${note.enable}`,
    `- **Cost:** the definition is ${String(size)} characters (about ${String(Math.round(size / 4))} tokens), sent on every turn the tool is offered.`,
    '',
    '**Operations**',
    '',
    ...operationLines,
    '',
    '**Who is asked, per permission mode** (`runs` = no prompt, `asks` = the approval callback, `removed` = the tool is refused in `plan`, `refused` = never allowed)',
    '',
    '| Operation | Grant | plan | ask | accept-edits | autonomous-scoped | strict |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...permissionRows(definition),
    '',
    '**Arguments the model may send** (from the tool definition)',
    '',
    '| Name | Type | Bounds |',
    '| --- | --- | --- |',
    ...argumentRows(definition),
    '',
    '**Limits**',
    '',
    ...bullets(note.limits),
    '',
    ...(note.failures.length === 0
      ? []
      : [
          '**What the model sees when it fails**',
          '',
          ...bullets(note.failures.map((f) => `\`${f.message}…\`: ${f.meaning}`)),
          '',
        ]),
    '**CLI**',
    '',
    '```sh',
    note.cli,
    '```',
    '',
    '**SDK**',
    '',
    '```ts',
    note.sdk,
    '```',
    '',
  ];
}

function sizeTable(definitions: readonly RealDefinition[]): string[] {
  const rows = definitions.map((definition) => {
    const size = JSON.stringify(definition).length;
    return `| \`${definition.name}\` | ${String(definition.operations.length)} | ${String(size)} | ${String(Math.round(size / 4))} |`;
  });
  return [
    '| Tool | Operations | Characters | About tokens |',
    '| --- | --- | --- | --- |',
    ...rows,
  ];
}

const INTRO: readonly string[] = [
  '# Agent tools',
  '',
  '<!-- GENERATED by `npm run docs:tools` (scripts/generate-tools-doc.mjs). Do not edit by hand: change',
  'tests/unit/tools-doc-notes-core.ts, tests/unit/tools-doc-notes-test.ts or the tool itself. -->',
  '',
  'Every tool the coding agent can use, in one place, for people and for other agents. The tables are produced from the real',
  'tool definitions and the real permission code, and `tests/unit/tools-doc.test.ts` fails when this file is stale.',
  'Flags are in [HEADLESS.md](HEADLESS.md); common questions are in [FAQ-AGENT-TOOLS.md](FAQ-AGENT-TOOLS.md);',
  'step-by-step recipes are in `skills/`.',
  '',
  '## How a tool gets offered',
  '',
  'A run starts with `read` and `git` only (files, git reads and working notes). Each other tool needs its own grant, and the',
  'most powerful ones need a second switch. A permission mode never adds a tool; it only decides what is asked.',
  '',
];

const GUIDE: readonly string[] = [
  '## Which tool for which job',
  '',
  '| I want the agent to… | Use |',
  '| --- | --- |',
  '| read, search and change files | `workspace.file` |',
  '| run one program (tests, a build) | `workspace.command`, or `code.gates` for a short structured answer |',
  '| keep a server or slow job running while it works | `process.watch` |',
  '| use `&&`, pipes or redirects | `workspace.shell` (off by default) |',
  '| call my API and check status codes | `http.request` |',
  '| click through my web page | `browser.page`, then `vision.describe` for a screenshot |',
  '| follow a plan it cannot skip | `task.plan` |',
  '| follow the repo’s own rules | `knowledge.context` |',
  '| split a job into parallel parts | `agent.team` |',
  '',
];

/** The whole document, before it is formatted. */
export function renderToolsDoc(): string {
  const definitions = realDefinitions();
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const sections = ALL_NOTES.flatMap((note) => {
    const definition = byName.get(note.tool);
    if (definition === undefined) throw new Error(`No real definition for ${note.tool}`);
    return renderTool(note, definition);
  });
  const grants = [
    '## Grants',
    '',
    `\`--allow-tools\` takes: ${HEADLESS_TOOL_CATEGORIES.map((category) => `\`${category}\``).join(', ')}. The default is \`read,git\`.`,
    '',
    '## What each tool costs',
    '',
    'The model pays for every offered definition on every turn, so tools stay off until asked for.',
    '',
    ...sizeTable(definitions),
    '',
  ];
  return [...INTRO, ...grants, ...GUIDE, '## The tools', '', ...sections].join('\n');
}
