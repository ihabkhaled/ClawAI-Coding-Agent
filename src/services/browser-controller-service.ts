import { randomUUID } from 'node:crypto';

import {
  browserOperationSchema,
  browserOrigin,
  isOriginAllowed,
  BrowserTakeoverState,
  type BrowserEvidence,
  type BrowserOperation,
  type BrowserScope,
} from '../core/browser-operation';
import { redactText } from '../core/redaction';

export interface BrowserDriverResult {
  readonly origin?: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly artifactPath?: string;
  readonly artifactHash?: string;
  readonly consoleFailures: readonly string[];
  readonly networkFailures: readonly string[];
  readonly accessibilityViolations: number;
  readonly structured: Readonly<Record<string, unknown>>;
}

export interface BrowserDriverPort {
  execute(
    operation: BrowserOperation,
    scope: BrowserScope,
    signal?: AbortSignal,
  ): Promise<BrowserDriverResult>;
  disposeSession(sessionId: string): Promise<void>;
}

export interface BrowserNavigationApprovalPort {
  approveOrigin(origin: string, signal?: AbortSignal): Promise<boolean>;
}

export interface BrowserControllerResult {
  readonly evidence: BrowserEvidence;
  readonly structured: Readonly<Record<string, unknown>>;
}

export class BrowserControllerService {
  private readonly takeover = new Map<string, BrowserTakeoverState>();

  constructor(
    private readonly driver: BrowserDriverPort,
    private readonly scope: () => BrowserScope,
    private readonly approval: BrowserNavigationApprovalPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(candidate: unknown, signal?: AbortSignal): Promise<BrowserControllerResult> {
    const operation = browserOperationSchema.parse(candidate);
    const takeover = this.takeover.get(operation.sessionId) ?? new BrowserTakeoverState();
    this.takeover.set(operation.sessionId, takeover);
    if (operation.operation === 'takeover') {
      takeover.takeOver();
      return this.stateResult(operation, 'user');
    }
    if (operation.operation === 'return-control') {
      takeover.returnControl();
      return this.stateResult(operation, 'agent');
    }
    takeover.assertAgentControl();
    const scope = this.scope();
    if (operation.operation === 'download' && !scope.allowDownloads) {
      throw new Error('Browser downloads are disabled by the active scope');
    }
    await this.authorizeNavigation(operation, signal);
    signal?.throwIfAborted();
    const result = await this.driver.execute(operation, scope, signal);
    const evidence: BrowserEvidence = {
      evidenceId: `browser-evidence:${randomUUID()}`,
      timestamp: this.now().toISOString(),
      operation: operation.operation,
      ...(result.origin === undefined ? {} : { origin: result.origin }),
      ...(result.viewport === undefined ? {} : { viewport: result.viewport }),
      ...(result.artifactPath === undefined ? {} : { artifactPath: result.artifactPath }),
      ...(result.artifactHash === undefined ? {} : { artifactHash: result.artifactHash }),
      consoleFailures: result.consoleFailures.map(redactText),
      networkFailures: result.networkFailures.map(redactText),
      accessibilityViolations: result.accessibilityViolations,
      redactionApplied: true,
    };
    if (operation.operation === 'close') {
      this.takeover.delete(operation.sessionId);
    }
    return { evidence, structured: result.structured };
  }

  private async authorizeNavigation(
    operation: BrowserOperation,
    signal?: AbortSignal,
  ): Promise<void> {
    if (operation.operation !== 'navigate' || operation.url === undefined) return;
    const scope = this.scope();
    if (isOriginAllowed(operation.url, scope)) return;
    const origin = browserOrigin(operation.url);
    if (
      !scope.allowExternalNavigationWithApproval ||
      !(await this.approval.approveOrigin(origin, signal))
    ) {
      throw new Error('Browser navigation origin is outside the approved scope');
    }
  }

  private stateResult(
    operation: BrowserOperation,
    owner: 'agent' | 'user',
  ): BrowserControllerResult {
    return {
      evidence: {
        evidenceId: `browser-evidence:${randomUUID()}`,
        timestamp: this.now().toISOString(),
        operation: operation.operation,
        consoleFailures: [],
        networkFailures: [],
        accessibilityViolations: 0,
        redactionApplied: false,
      },
      structured: { owner },
    };
  }
}
