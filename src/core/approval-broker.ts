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
  request: ApprovalRequest;
  resolve(approved: boolean): void;
}

export class ApprovalBroker {
  private active: PendingApproval | undefined;
  private readonly pending: PendingApproval[] = [];
  private disposed = false;

  constructor(private readonly state: ApprovalStatePort) {}

  get current(): ApprovalRequest | undefined {
    return this.active?.request;
  }

  request(input: ApprovalRequestInput): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    const request: ApprovalRequest = {
      ...input,
      ...(input.details === undefined ? {} : { details: input.details.slice(0, 100) }),
      id: randomUUID(),
    };
    const completion = new Promise<boolean>((resolve) => {
      this.pending.push({ request, resolve });
    });
    this.activateNext();
    return completion;
  }

  resolve(id: string, approved: boolean): boolean {
    if (this.active?.request.id !== id) {
      return false;
    }
    const completed = this.active;
    this.active = undefined;
    completed.resolve(approved);
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
    active?.resolve(false);
    for (const approval of pending) {
      approval.resolve(false);
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

  private publish(): void {
    this.state.update({ approvalRequest: this.active?.request });
  }
}
