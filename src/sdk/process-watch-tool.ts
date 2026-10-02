import { isAllowedExecutable } from '../headless/headless-command-policy';

import { systemCommandRuntime } from './command-tool';
import {
  disallowedCommandMessage,
  shellSyntaxArgument,
  shellSyntaxMessage,
} from './command-tool-hints';
import { ProcessRegistry } from './process-watch-registry';
import {
  cursorArgument,
  matchPattern,
  optionalName,
  outputLimit,
  parseStartRequest,
  requireName,
  waitTimeout,
} from './process-watch-request';

import type {
  ProcessWatchOptions,
  ProcessWatchTool,
  WatchRequest,
} from './process-watch-tool.types';
import type { ToolLimits } from '../headless/headless-main.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/**
 * `process.watch` for one toolkit: start a long-lived program, then wait on it,
 * read its new output by cursor, and stop it, across as many tool calls as it
 * takes. The allowlist, the no-shell rule, the Windows shim checks and the
 * working-directory containment are the ones `workspace.command` applies,
 * because the same helpers do the work; a refused start never spawns anything.
 */
export function createProcessWatchTool(
  options: Partial<ProcessWatchOptions> = {},
): ProcessWatchTool {
  const registry = new ProcessRegistry({ runtime: systemCommandRuntime(), ...options });
  return {
    execute: (operation, args, limits, signal) =>
      execute(registry, operation, args, limits, signal),
    dispose: () => {
      registry.dispose();
    },
  };
}

function execute(
  registry: ProcessRegistry,
  operation: string,
  args: ToolArguments,
  limits: ToolLimits,
  signal: AbortSignal | undefined,
): unknown {
  if (operation === 'start') return registry.start(checkedStart(args, limits));
  if (operation === 'status') return registry.status(optionalName(args));
  if (operation === 'list') return registry.status(undefined);
  const name = requireName(operation, args);
  if (operation === 'output') {
    return registry.output(name, cursorArgument(args.sinceCursor), outputLimit(args, operation));
  }
  if (operation === 'stop') return registry.stop(name, outputLimit(args, operation));
  if (operation === 'wait') {
    return registry.wait(
      name,
      {
        timeoutMs: waitTimeout(args),
        signal,
        sinceCursor: cursorArgument(args.sinceCursor),
        pattern: matchPattern(args.untilMatch),
      },
      outputLimit(args, operation),
    );
  }
  throw new Error(`Unsupported operation ${operation}`);
}

function checkedStart(args: ToolArguments, limits: ToolLimits): WatchRequest {
  const request = parseStartRequest(args, limits);
  if (!isAllowedExecutable(request.executable, limits.allowedExecutables)) {
    throw new Error(disallowedCommandMessage(request.executable, limits.allowedExecutables));
  }
  const shellToken = shellSyntaxArgument(request.arguments);
  if (shellToken !== undefined) throw new Error(shellSyntaxMessage(shellToken));
  return request;
}
