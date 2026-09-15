import * as vscode from 'vscode';

import { nextOnboardingStep, onboardingChecklist } from '../core/onboarding-checklist';
import { groupedThreads } from '../core/thread-group';

import { attentionItems } from './attention-items';

import type { ChatThread } from '../backend/contracts';
import type { AgentTaskStatus } from '../core/agent-tasks';
import type { ContextInclusion } from '../core/context-collector';
import type { ContextFreshness } from '../core/context-freshness.types';
import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';
import type { FindingSeverity } from '../core/findings';
import type { OnboardingStepId } from '../core/onboarding-checklist.types';
import type { ThreadGroupAssignments } from '../core/thread-group.types';

export type TreeKind =
  'artifacts' | 'attention' | 'context' | 'findings' | 'history' | 'model' | 'setup' | 'tasks';

function modelItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  const auto = new vscode.TreeItem(
    vscode.l10n.t('AUTO Router'),
    vscode.TreeItemCollapsibleState.None,
  );
  auto.description = snapshot.routingMode === 'AUTO' ? vscode.l10n.t('active') : '';
  auto.iconPath = new vscode.ThemeIcon('sparkle');
  auto.command = {
    command: 'clawAI.selectModel',
    title: vscode.l10n.t('Select AUTO Router'),
    arguments: ['AUTO'],
  };
  return [
    auto,
    ...snapshot.models.map((model) => {
      const item = new vscode.TreeItem(model.displayName, vscode.TreeItemCollapsibleState.None);
      item.description = [
        model.provider,
        model.isLocal ? vscode.l10n.t('local') : vscode.l10n.t('connected'),
        snapshot.selectedModel === model.key ? vscode.l10n.t('active') : '',
      ]
        .filter((part) => part.length > 0)
        .join(' · ');
      item.tooltip = [
        model.key,
        model.supportsStreaming ? vscode.l10n.t('Streaming') : '',
        model.supportsTools ? vscode.l10n.t('Tools') : '',
        model.supportsVision ? vscode.l10n.t('Vision') : '',
      ]
        .filter((part) => part.length > 0)
        .join(' · ');
      item.iconPath = new vscode.ThemeIcon(model.isLocal ? 'server-environment' : 'cloud');
      item.command = {
        command: 'clawAI.selectModel',
        title: vscode.l10n.t('Select model'),
        arguments: [model.key],
      };
      return item;
    }),
  ];
}

/**
 * A collected row, marked if what it names has moved on since it was read.
 *
 * A ranged reference is a snapshot. Once the file is saved the same line
 * numbers point at different code, and a receipt that still reads as current is
 * the quiet kind of wrong: nothing errors, and the conversation looks like it
 * is about code the model never saw.
 */
function inclusionItem(
  entry: ContextInclusion,
  freshness: (key: string) => ContextFreshness,
): vscode.TreeItem {
  const label =
    entry.startLine === undefined
      ? entry.path
      : `${entry.path}:${String(entry.startLine)}-${String(entry.endLine)}`;
  const item = new vscode.TreeItem(label);
  const state = freshness(label);
  if (state === 'changed') {
    item.description = vscode.l10n.t('changed since it was read');
    item.iconPath = new vscode.ThemeIcon('warning');
  } else if (state === 'gone') {
    item.description = vscode.l10n.t('no longer there');
    item.iconPath = new vscode.ThemeIcon('error');
  } else {
    item.iconPath = new vscode.ThemeIcon('file-code');
  }
  return item;
}

function contextItems(
  snapshot: ExtensionSnapshot,
  freshness: (key: string) => ContextFreshness,
): vscode.TreeItem[] {
  const receipt = snapshot.contextReceipt;
  if (receipt === undefined) {
    return [new vscode.TreeItem(vscode.l10n.t('No context collected yet'))];
  }
  const summary = new vscode.TreeItem(
    vscode.l10n.t('{0} files · {1} bytes', receipt.included.length, receipt.totalBytes),
  );
  summary.iconPath = new vscode.ThemeIcon('list-selection');
  return [
    summary,
    ...receipt.included.map((entry) => inclusionItem(entry, freshness)),
    ...receipt.excluded.slice(0, 20).map((entry) => {
      const item = new vscode.TreeItem(entry.path);
      item.description = entry.reason;
      item.iconPath = new vscode.ThemeIcon('exclude');
      return item;
    }),
  ];
}

/**
 * The files the agent produced for the user, newest first.
 *
 * Every row opens: an artifact nobody can open is the state this view exists
 * to end. `vscode.open` is used directly rather than through a ClawAI command
 * because the only thing to decide is which file, and the row already knows.
 */
function artifactItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  if (snapshot.artifacts.length === 0) {
    return [new vscode.TreeItem(vscode.l10n.t('No files delivered yet'))];
  }
  return snapshot.artifacts.map((artifact) => {
    const item = new vscode.TreeItem(artifact.path, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('file');
    item.resourceUri = vscode.Uri.file(artifact.fsPath);
    item.tooltip = artifact.fsPath;
    item.command = {
      command: 'vscode.open',
      title: vscode.l10n.t('Open delivered file'),
      arguments: [vscode.Uri.file(artifact.fsPath)],
    };
    return item;
  });
}

/** Titles live here rather than in core: the checklist is state, not wording. */
const SETUP_TITLES: Readonly<Record<OnboardingStepId, () => string>> = {
  connect: () => vscode.l10n.t('Sign in to ClawAI'),
  folder: () => vscode.l10n.t('Open a project folder'),
  trust: () => vscode.l10n.t('Trust this workspace'),
  model: () => vscode.l10n.t('Load the model catalog'),
};

/**
 * What is left before the extension can be used, derived from the snapshot.
 *
 * Every row stays visible once done rather than disappearing, because a list
 * that shrinks as you work it gives no sense of how much is left. The view
 * itself hides once everything is done.
 */
function setupItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  const steps = onboardingChecklist(snapshot);
  const next = nextOnboardingStep(steps);
  return steps.map((step) => {
    const title = SETUP_TITLES[step.id]();
    const item = new vscode.TreeItem(title);
    item.iconPath = new vscode.ThemeIcon(step.done ? 'pass-filled' : 'circle-large-outline');
    if (step.done) return item;
    if (step.id === next?.id) item.description = vscode.l10n.t('Do this next');
    item.command = { command: step.command, title };
    return item;
  });
}

function threadItem(thread: ChatThread): vscode.TreeItem {
  const title = thread.title?.trim();
  const item = new vscode.TreeItem(
    title === undefined || title.length === 0 ? vscode.l10n.t('Untitled conversation') : title,
  );
  item.description = thread._count === undefined ? '' : String(thread._count.messages);
  item.iconPath = new vscode.ThemeIcon('comment-discussion');
  item.command = {
    command: 'clawAI.openChat',
    title: vscode.l10n.t('Open conversation'),
    arguments: [thread.id],
  };
  return item;
}

/**
 * The history list, with groups as folders.
 *
 * Groups are expanded by default. A group somebody made is a group they want
 * to see into; collapsing it by default would hide the thing they just filed
 * and make the feature look like it did nothing.
 */
function historyItems(
  snapshot: ExtensionSnapshot,
  assignments: ThreadGroupAssignments,
): vscode.TreeItem[] {
  if (snapshot.history.length === 0) {
    return [new vscode.TreeItem(vscode.l10n.t('No recent conversations'))];
  }
  const grouped = groupedThreads(snapshot.history, assignments);
  const groups = grouped.groups.map((group) => {
    const item = new vscode.TreeItem(group.name, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = new vscode.ThemeIcon('folder');
    item.description = String(group.threads.length);
    item.contextValue = 'clawAI.threadGroup';
    return item;
  });
  return [...groups, ...grouped.ungrouped.map(threadItem)];
}

const severityIcons: Readonly<Record<FindingSeverity, string>> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
  info: 'info',
};

/**
 * Reported findings, in the order a reader should triage them.
 *
 * A review that reported into a void would be the defect this program keeps
 * finding, so the tool that records a finding puts it here, where a person sees
 * it and can open the line it names.
 */
function findingItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  if (snapshot.findings.length === 0) {
    return [new vscode.TreeItem(vscode.l10n.t('No findings reported'))];
  }
  return snapshot.findings.map((finding) => {
    const item = new vscode.TreeItem(finding.title);
    item.description = `${finding.severity} · ${finding.path}${
      finding.line === undefined ? '' : `:${String(finding.line)}`
    }`;
    // The detail and the fix are the point of a finding, and a tree row has no
    // space for either, so the hover carries both.
    item.tooltip = `${finding.detail}

${finding.remediation}`;
    item.iconPath = new vscode.ThemeIcon(severityIcons[finding.severity]);
    return item;
  });
}

const taskIcons: Readonly<Record<AgentTaskStatus, string>> = {
  pending: 'circle-large-outline',
  'in-progress': 'sync',
  blocked: 'warning',
  done: 'pass-filled',
};

/**
 * The task list the agent is working through, in the order it wrote it.
 *
 * Shown rather than only returned to the model, for the reason the Findings
 * view exists: a list the agent keeps for itself is a list nobody can check
 * against what is actually happening.
 */
function taskItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  if (snapshot.tasks.length === 0) {
    return [new vscode.TreeItem(vscode.l10n.t('No tasks yet'))];
  }
  return snapshot.tasks.map((task) => {
    const item = new vscode.TreeItem(task.title);
    item.description = task.status;
    item.iconPath = new vscode.ThemeIcon(taskIcons[task.status]);
    if (task.note !== undefined) item.tooltip = task.note;
    return item;
  });
}

export class StateTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  private readonly unsubscribe: () => void;
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly kind: TreeKind,
    private readonly state: ExtensionState,
    /** Read at render time so filing a conversation shows up without a reload. */
    private readonly groups?: () => ThreadGroupAssignments,
    /** Read at render time so a save marks the row without a reload. */
    private readonly freshness?: (key: string) => ContextFreshness,
  ) {
    this.unsubscribe = state.subscribe(() => {
      this.changeEmitter.fire(undefined);
    });
  }

  /** Redraws when something outside the snapshot changed, such as a group. */
  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /** The conversations filed into one group, in the order the list shows them. */
  private groupChildren(element: vscode.TreeItem): vscode.TreeItem[] {
    const name = typeof element.label === 'string' ? element.label : '';
    const grouped = groupedThreads(this.state.snapshot.history, this.groups?.() ?? {});
    const members = grouped.groups.find((group) => group.name === name)?.threads ?? [];
    return members.map(threadItem);
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    // A group's children are its conversations; everything else is flat.
    if (element?.contextValue === 'clawAI.threadGroup') return this.groupChildren(element);
    if (this.kind === 'model') {
      return modelItems(this.state.snapshot);
    }
    if (this.kind === 'context') {
      return contextItems(this.state.snapshot, (key) => this.freshness?.(key) ?? 'fresh');
    }
    if (this.kind === 'findings') {
      return findingItems(this.state.snapshot);
    }
    if (this.kind === 'tasks') {
      return taskItems(this.state.snapshot);
    }
    if (this.kind === 'setup') {
      return setupItems(this.state.snapshot);
    }
    if (this.kind === 'artifacts') {
      return artifactItems(this.state.snapshot);
    }
    if (this.kind === 'attention') {
      return attentionItems(this.state.snapshot, Date.now());
    }
    return historyItems(this.state.snapshot, this.groups?.() ?? {});
  }

  dispose(): void {
    this.unsubscribe();
    this.changeEmitter.dispose();
  }
}
