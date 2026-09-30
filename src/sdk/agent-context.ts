import path from 'node:path';

import { collectContext, workspaceGlobToRegExp } from '../core/context-collector';
import {
  DEFAULT_CONTEXT_EXCLUDES,
  DEFAULT_MAX_CONTEXT_BYTES,
  DEFAULT_MAX_CONTEXT_FILES,
} from '../core/context-defaults.constants';
import { resolveSmartContext } from '../core/context-mode';
import { contextualPrompt } from '../core/context-prompt';
import { parseFileRangeReference } from '../core/file-range-reference';
import { DEFAULT_SPEED_MODE, forEachPrefetched, readConcurrency } from '../core/speed-mode';
import { isSensitiveWorkspacePath, normalizeWorkspacePath } from '../core/workspace-path-policy';

import { nodeContextFileSystem } from './agent-context-files';
import { AGENT_CONTEXT_SCAN_MULTIPLIER } from './agent-context.constants';

import type {
  AgentContextConfig,
  AgentContextFileSystem,
  AgentContextResult,
} from './agent-context.types';
import type { ContextCandidate, ContextReceipt } from '../core/context-collector';
import type { ContextMode } from '../core/context-mode';
import type { SpeedMode } from '../core/speed-mode';

type Resolved = Exclude<ContextMode, 'smart'>;
type Exclusions = ContextReceipt['excluded'];

interface ContextSource {
  readonly root: string;
  readonly files: AgentContextFileSystem;
  readonly speed: SpeedMode;
}

/**
 * The mistake in a context setting, or undefined when it is usable.
 *
 * Checked before any request so a run never starts with less context than was
 * asked for: `file` without a file, or `selection` without a range, would
 * otherwise send an empty context and look like a success.
 */
export function contextProblem(context: AgentContextConfig): string | undefined {
  if (context.selection !== undefined && parseFileRangeReference(context.selection) === undefined) {
    return 'The context selection must look like path:START-END, with lines counted from 1.';
  }
  if (context.mode === 'file' && context.file === undefined) {
    return 'Context mode "file" needs a file.';
  }
  if (context.mode === 'selection' && context.selection === undefined) {
    return 'Context mode "selection" needs a selection.';
  }
  return undefined;
}

/**
 * The mode a run actually uses. `smart` resolves exactly as the editor does:
 * a selection first, then a file, then the workspace, then nothing. A headless
 * workspace is always trusted, because naming it on the command line is the
 * trust decision.
 */
export function resolvedContextMode(context: AgentContextConfig): Resolved {
  if (context.mode !== 'smart') return context.mode;
  return resolveSmartContext({
    hasActiveFile: context.file !== undefined,
    hasSelection: context.selection !== undefined,
    hasWorkspace: true,
    trusted: true,
  });
}

/**
 * The prompt with its context, built by the same collector and envelope the
 * editor uses, so the same mode reads the same way in both.
 */
export async function promptWithContext(
  input: {
    readonly workspaceRoot: string;
    readonly context: AgentContextConfig;
    readonly speed?: SpeedMode | undefined;
  },
  prompt: string,
  files: AgentContextFileSystem = nodeContextFileSystem,
): Promise<AgentContextResult> {
  const problem = contextProblem(input.context);
  if (problem !== undefined) throw new RangeError(problem);
  const resolved = resolvedContextMode(input.context);
  if (resolved === 'none') return { prompt, resolved };
  const source: ContextSource = {
    root: path.resolve(input.workspaceRoot),
    files,
    speed: input.speed ?? DEFAULT_SPEED_MODE,
  };
  const gathered = await gather(resolved, input.context, source);
  const collected = collectContext(gathered.candidates, {
    exclude: [...DEFAULT_CONTEXT_EXCLUDES],
    maxBytes: DEFAULT_MAX_CONTEXT_BYTES,
    maxFiles: DEFAULT_MAX_CONTEXT_FILES,
  });
  const excluded = [...gathered.excluded, ...collected.receipt.excluded];
  const receipt: ContextReceipt = {
    ...collected.receipt,
    excluded,
    truncated: excluded.some((entry) => entry.reason === 'limit'),
  };
  const envelope = contextualPrompt(prompt, collected.files, receipt);
  return { prompt: envelope.content, resolved, receipt: envelope.contextReceipt };
}

async function gather(
  resolved: Exclude<Resolved, 'none'>,
  context: AgentContextConfig,
  source: ContextSource,
): Promise<{ candidates: ContextCandidate[]; excluded: Exclusions }> {
  if (resolved === 'workspace') return workspaceCandidates(source);
  if (resolved === 'selection')
    return { candidates: [await selected(context, source)], excluded: [] };
  return { candidates: [await wholeFile(context.file ?? '', source)], excluded: [] };
}

async function wholeFile(relativePath: string, source: ContextSource): Promise<ContextCandidate> {
  const info = await source.files.stat(source.root, relativePath);
  if (!info.isFile) throw new RangeError(`${relativePath} is not a file.`);
  if (info.size > DEFAULT_MAX_CONTEXT_BYTES) {
    throw new RangeError(
      `${relativePath} is larger than the ${String(DEFAULT_MAX_CONTEXT_BYTES)} byte context limit.`,
    );
  }
  const bytes = await source.files.read(source.root, relativePath);
  return {
    path: normalizeWorkspacePath(relativePath),
    content: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
  };
}

async function selected(
  context: AgentContextConfig,
  source: ContextSource,
): Promise<ContextCandidate> {
  const reference = parseFileRangeReference(context.selection ?? '');
  if (reference === undefined) throw new RangeError(contextProblem(context) ?? 'Bad selection.');
  const whole = await wholeFile(reference.path, source);
  const lines = whole.content.split('\n');
  if (reference.startLine > lines.length) {
    throw new RangeError(
      `${reference.path} has ${String(lines.length)} lines; the selection starts at ${String(reference.startLine)}.`,
    );
  }
  const endLine = Math.min(reference.endLine, lines.length);
  return {
    path: whole.path,
    content: lines.slice(reference.startLine - 1, endLine).join('\n'),
    startLine: reference.startLine,
    endLine,
  };
}

/**
 * Every eligible workspace file that fits, read the way the editor reads them.
 *
 * The containment check and the stat run `readConcurrency(speed)` at a time;
 * the decision about which file fits stays sequential and in order, so a
 * faster speed changes how long this takes and never which files are chosen.
 */
async function workspaceCandidates(
  source: ContextSource,
): Promise<{ candidates: ContextCandidate[]; excluded: Exclusions }> {
  const patterns = DEFAULT_CONTEXT_EXCLUDES.map(workspaceGlobToRegExp);
  const listed = await source.files.list(
    source.root,
    DEFAULT_MAX_CONTEXT_FILES * AGENT_CONTEXT_SCAN_MULTIPLIER,
  );
  const excluded: Exclusions = [];
  const eligible = listed.filter((entry) => {
    if (isSensitiveWorkspacePath(entry)) {
      excluded.push({ path: entry, reason: 'sensitive' });
      return false;
    }
    if (patterns.some((pattern) => pattern.test(entry))) {
      excluded.push({ path: entry, reason: 'excluded' });
      return false;
    }
    return true;
  });
  const candidates: ContextCandidate[] = [];
  let readBytes = 0;
  await forEachPrefetched(
    eligible,
    readConcurrency(source.speed),
    (entry) => source.files.stat(source.root, entry),
    async (entry, fetched, index) => {
      if (
        readBytes >= DEFAULT_MAX_CONTEXT_BYTES ||
        candidates.length >= DEFAULT_MAX_CONTEXT_FILES
      ) {
        for (const rest of eligible.slice(index)) excluded.push({ path: rest, reason: 'limit' });
        return 'stop';
      }
      if (!fetched.ok) throw fetched.error instanceof Error ? fetched.error : new Error(entry);
      if (!fetched.value.isFile) return 'continue';
      if (fetched.value.size > DEFAULT_MAX_CONTEXT_BYTES - readBytes) {
        excluded.push({ path: entry, reason: 'limit' });
        return 'continue';
      }
      const bytes = await source.files.read(source.root, entry);
      readBytes += bytes.byteLength;
      candidates.push({
        path: entry,
        content: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      });
      return 'continue';
    },
  );
  return { candidates, excluded };
}
