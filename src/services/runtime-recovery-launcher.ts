import { randomUUID } from 'node:crypto';

import { RuntimeUiProjector } from './runtime-ui-projection';

import type { VscodeRuntimeStudio } from './vscode-runtime-studio';
import type { ExtensionState } from '../core/extension-state';
import type { OutputLogger } from '../infrastructure/output-logger';
import type { ChatViewProvider } from '../webview/chat-view-provider';

export class RuntimeRecoveryLauncher {
  private controller: AbortController | undefined;

  constructor(
    private readonly state: ExtensionState,
    private readonly studio: VscodeRuntimeStudio,
    private readonly logger: OutputLogger,
    private readonly view: () => ChatViewProvider | null,
  ) {}

  start(): void {
    if (!this.state.snapshot.connected || this.controller !== undefined) return;
    const controller = new AbortController();
    const requestId = `runtime-recovery:${randomUUID()}`;
    const projector = new RuntimeUiProjector(this.view, this.logger, requestId);
    this.controller = controller;
    void this.studio
      .recover({
        prompt: 'runtime recovery',
        threadId: 'runtime recovery',
        requestId,
        signal: controller.signal,
        onEvent: (event) => {
          projector.project(event);
        },
        onApproval: (phase, effect) => {
          projector.approval(phase, effect);
        },
      })
      .then(async (recovered) => {
        if (recovered) await projector.settle();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) this.logger.error('Runtime startup recovery failed', error);
      })
      .finally(() => {
        if (this.controller === controller) this.controller = undefined;
      });
  }

  dispose(): void {
    this.controller?.abort(new Error('ClawAI coordinator disposed'));
  }
}
