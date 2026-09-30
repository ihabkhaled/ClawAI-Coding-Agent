import { commandSpecSchema } from '../core/command-spec';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import { prepareBackgroundLaunch, runCommandSpec } from './bounded-command-runner';
import { realPath } from './command-sandbox-host-probe';
import { awaitOrYield } from './command-yield';
import { sandboxBackgroundLaunch } from './sandboxed-background-launch';

import type { CommandSandboxPort } from './command-launch-plan.types';
import type { BackgroundCommandPort } from './structured-command-tool-executor.types';
import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const structuredCommandToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.command',
  version: '2.0.0',
  description: [
    'Run one bounded executable and argv without implicit shell interpolation.',
    'Use cwd "." for the workspace root.',
    'expectedEffect must be read, build, test, local-mutation, network, or install.',
    'Set background true for a server or watcher that does not exit: the call returns a receipt at once, and you read its output with workspace.process inspect, wait with join, and stop it with terminate. A background command takes no stdin and no timeout.',
    'Set yieldAfterMs (1000-600000, below timeoutMs) for a long build or test: if it has not exited by then, the call returns the output so far with yielded true and a receipt, and the command keeps running under workspace.process. Output is the merged terminal log. No stdin.',
    'Example arguments: {"executable":"npm","arguments":["test"],"cwdRootKey":"workspace-1","cwd":".","timeoutMs":120000,"outputLimitBytes":524288,"expectedEffect":"test"}.',
  ].join(' '),
  operations: ['run'],
  riskClasses: ['process', 'network'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.command,
};

export class StructuredCommandToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly files: VscodeFileTransactionAdapter,
    private readonly background?: BackgroundCommandPort,
    private readonly sandbox?: CommandSandboxPort,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (
      invocation.toolName !== structuredCommandToolDefinition.name ||
      invocation.operation !== 'run'
    )
      throw new Error('Unknown structured command operation');
    const specification = commandSpecSchema.parse({
      ...invocation.arguments,
      targetId: invocation.targetId,
    });
    const rootUri = this.files.workspaceRootUri(specification.cwdRootKey);
    const cwdUri = await this.files.uriFor(specification.cwdRootKey, specification.cwd, 'update');
    if (specification.background === true || specification.yieldAfterMs !== undefined)
      return this.launchBackground(invocation, specification, cwdUri, rootUri, signal);
    if (this.sandbox === undefined) {
      const result = await runCommandSpec(specification, cwdUri.fsPath, signal);
      return { structured: { ...result } };
    }
    const binding = this.sandbox.bind(rootUri.fsPath);
    const result = await runCommandSpec(
      specification,
      realPath(cwdUri.fsPath),
      signal,
      {},
      binding,
    );
    return { structured: { ...result } };
  }

  /**
   * A command that outlives the call.
   *
   * The foreground path waits for exit, so a dev server or a watcher could only
   * ever run until its timeout and then be killed. The process supervisor
   * already owns long-lived sessions with a log, a lifecycle and a terminal, so
   * the command is handed to it and the receipt returned; the model then drives
   * it with the `workspace.process` operations it already has.
   */
  private async launchBackground(
    invocation: ToolInvocation,
    specification: ReturnType<typeof commandSpecSchema.parse>,
    cwdUri: { readonly fsPath: string },
    rootUri: { readonly fsPath: string },
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (this.background === undefined)
      throw new Error('Background commands are not available in this host.');
    const plan = await sandboxBackgroundLaunch(
      await prepareBackgroundLaunch(specification),
      specification,
      cwdUri.fsPath,
      this.sandbox?.bind(rootUri.fsPath),
    );
    const startedAtMs = Date.now();
    const receipt = await this.background.supervisor.create({
      executablePath: plan.executablePath,
      arguments: [...plan.arguments],
      cwd: plan.cwd,
      environment: plan.environment,
      title: `${specification.executable} (background)`.slice(0, 200),
      ownerId: this.background.ownerId(),
      runId: invocation.runId,
      targetId: invocation.targetId,
    });
    if (specification.yieldAfterMs !== undefined)
      return awaitOrYield({
        supervisor: this.background.supervisor,
        receipt,
        yieldAfterMs: specification.yieldAfterMs,
        outputLimitBytes: specification.outputLimitBytes,
        startedAtMs,
        ...(signal === undefined ? {} : { signal }),
        ...(plan.sandbox === undefined ? {} : { sandbox: plan.sandbox }),
      });
    return {
      structured: {
        background: true,
        receipt: { ...receipt },
        ...(plan.sandbox === undefined ? {} : { sandbox: plan.sandbox }),
        next: 'Use workspace.process inspect with this receipt to read output, join to wait, terminate to stop.',
      },
    };
  }
}
