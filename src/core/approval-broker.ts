import { randomUUID } from 'node:crypto';

import type { PermissionOperation } from './permission-policy.types';

export type ApprovalKind = PermissionOperation | 'command' | 'enableFullAccess' | 'undo';

export interface ApprovalRequestInput {
  details?: string[];
  kind: ApprovalKind;
  message: string;
  title: string;
}

export interface ApprovalRequest extends ApprovalRequestInput {
  id: string;
}

export interface ApprovalStatePort {
  update(patch: { approvalRequest: ApprovalRequest | undefined }): void;
}

interface PendingApproval {
  abort?: () => void;
  request: ApprovalRequest;
  resolve(approved: boolean): void;
  signal?: AbortSignal;
}

export class ApprovalBroker {
  private active: PendingApproval | undefined;
  private readonly pending: PendingApproval[] = [];
  private disposed = false;

  constructor(private readonly state: ApprovalStatePort) {}

  get current(): ApprovalRequest | undefined {
    return this.active?.request;
  }

  request(input: ApprovalRequestInput, signal?: AbortSignal): Promise<boolean> {
    if (this.disposed || signal?.aborted === true) {
      return Promise.resolve(false);
    }
    const request: ApprovalRequest = {
      ...input,
      ...(input.details === undefined ? {} : { details: input.details.slice(0, 100) }),
      id: randomUUID(),
    };
    let resolveApproval: ((approved: boolean) => void) | undefined;
    const completion = new Promise<boolean>((resolve) => {
      resolveApproval = resolve;
    });
    const pending: PendingApproval = {
      request,
      resolve: (approved) => {
        resolveApproval?.(approved);
      },
      ...(signal === undefined ? {} : { signal }),
    };
    if (signal !== undefined) {
      pending.abort = () => {
        this.cancel(pending);
      };
      signal.addEventListener('abort', pending.abort, { once: true });
    }
    this.pending.push(pending);
    this.activateNext();
    return completion;
  }

  resolve(id: string, approved: boolean): boolean {
    if (this.active?.request.id !== id) {
      return false;
    }
    const completed = this.active;
    this.active = undefined;
    this.settle(completed, approved);
    this.activateNext();
    return true;
  }

  cancelCurrent(): boolean {
    const id = this.active?.request.id;
    return id === undefined ? false : this.resolve(id, false);
  }

  cancelAll(): boolean {
    const active = this.active;
    const pending = this.pending.splice(0);
    this.active = undefined;
    if (active !== undefined) {
      this.settle(active, false);
    }
    for (const approval of pending) {
      this.settle(approval, false);
    }
    this.publish();
    return active !== undefined || pending.length > 0;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAll();
  }

  private activateNext(): void {
    this.active ??= this.pending.shift();
    this.publish();
  }

  private cancel(approval: PendingApproval): void {
    if (this.active === approval) {
      this.active = undefined;
      this.settle(approval, false);
      this.activateNext();
      return;
    }
    const index = this.pending.indexOf(approval);
    if (index < 0) {
      return;
    }
    this.pending.splice(index, 1);
    this.settle(approval, false);
    this.publish();
  }

  private settle(approval: PendingApproval, approved: boolean): void {
    if (approval.signal !== undefined && approval.abort !== undefined) {
      approval.signal.removeEventListener('abort', approval.abort);
    }
    approval.resolve(approved);
  }

  private publish(): void {
    this.state.update({ approvalRequest: this.active?.request });
  }
}
