import { randomUUID } from 'node:crypto';

import { resolveQuestionAnswer } from './user-question';

import type { PermissionOperation } from './permission-policy.types';
import type { UserQuestion, UserQuestionAnswer, UserQuestionInput } from './user-question';

export type ApprovalKind =
  | PermissionOperation
  | 'command'
  | 'enableFullAccess'
  | 'runtimeEffect'
  | 'runtimeQuestion'
  | 'undo';

/** The kind every Runtime Protocol tool approval is filed under. */
export const RUNTIME_EFFECT_APPROVAL_KIND: ApprovalKind = 'runtimeEffect';

/**
 * The kind agent questions are filed under, distinct from tool approvals so a
 * run can withdraw one without withdrawing the other.
 */
export const RUNTIME_QUESTION_APPROVAL_KIND: ApprovalKind = 'runtimeQuestion';

export interface ApprovalEffectSummary {
  readonly purpose: string;
  readonly target: string;
  readonly risk: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  readonly sideEffects: readonly string[];
  readonly reversibility: 'reversible' | 'partially-reversible' | 'irreversible';
  readonly sanitizedPreview?: string;
}

export interface ApprovalRequestInput {
  details?: string[];
  kind: ApprovalKind;
  message: string;
  title: string;
  effect?: ApprovalEffectSummary;
}

export interface ApprovalRequest extends ApprovalRequestInput {
  id: string;
}

export interface ApprovalStatePort {
  update(patch: {
    approvalRequest: ApprovalRequest | undefined;
    questionRequest: UserQuestion | undefined;
  }): void;
}

/**
 * One queued interruption, either an approval or a structured question.
 *
 * Both live in the same queue on purpose. There is one modal slot in the panel,
 * one cancellation story and one epoch that invalidates them, so a second
 * channel would mean a second thing to withdraw when a run ends and a second
 * way to leave a prompt stranded over the composer. `question` is what tells
 * the two apart; an approval settles to a boolean, a question to an answer.
 */
interface PendingApproval {
  abort?: () => void;
  request: ApprovalRequest;
  question?: UserQuestion;
  resolve(approved: boolean): void;
  answer?: (answer: UserQuestionAnswer) => void;
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
      ...(input.effect === undefined
        ? {}
        : {
            effect: {
              ...input.effect,
              sideEffects: input.effect.sideEffects.slice(0, 20),
              ...(input.effect.sanitizedPreview === undefined
                ? {}
                : { sanitizedPreview: input.effect.sanitizedPreview.slice(0, 4_096) }),
            },
          }),
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

  /**
   * Puts a structured question to the user and waits for the answer.
   *
   * It rides the approval queue rather than a channel of its own, so a question
   * is withdrawn by the same `cancelKind` a run already calls when it ends, and
   * invalidated by the same account and workspace epochs. The panel shows one
   * interruption at a time either way.
   */
  ask(input: UserQuestionInput, signal?: AbortSignal): Promise<UserQuestionAnswer> {
    if (this.disposed || signal?.aborted === true) {
      return Promise.resolve({ kind: 'dismissed' });
    }
    const question: UserQuestion = { ...input, id: randomUUID() };
    let resolveAnswer: ((answer: UserQuestionAnswer) => void) | undefined;
    const completion = new Promise<UserQuestionAnswer>((resolve) => {
      resolveAnswer = resolve;
    });
    const pending: PendingApproval = {
      // The question carries the panel copy, so the approval request beside it
      // exists to give the queue an id and a kind to cancel by.
      request: {
        id: question.id,
        kind: RUNTIME_QUESTION_APPROVAL_KIND,
        title: question.header,
        message: question.question,
      },
      question,
      resolve: () => undefined,
      answer: (answer) => {
        resolveAnswer?.(answer);
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

  /**
   * Records the user's answer to the question currently on screen.
   *
   * The selection is validated against the question that was actually asked, so
   * a stale or forged one resolves nothing and leaves the question standing
   * rather than completing the run with an answer the user never gave.
   */
  answer(id: string, selection: unknown): boolean {
    const active = this.active;
    if (active?.question === undefined || active.request.id !== id) return false;
    const answer = resolveQuestionAnswer(active.question, selection);
    if (answer === undefined) return false;
    this.active = undefined;
    if (active.signal !== undefined && active.abort !== undefined) {
      active.signal.removeEventListener('abort', active.abort);
    }
    active.answer?.(answer);
    this.activateNext();
    return true;
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

  /**
   * Withdraw every question of one kind, on screen or queued behind it.
   *
   * A run that ends leaves its approvals unanswerable: the dispatch that would
   * have read the answer is gone, so the panel sits there modal, swallowing
   * every click meant for the composer, and the user cannot type again at all
   * until the window is reloaded. Withdrawing by kind keeps that cleanup inside
   * the lane that ended, so a question another lane is legitimately waiting on
   * is left standing.
   */
  cancelKind(kind: ApprovalKind): boolean {
    const active = this.active?.request.kind === kind ? this.active : undefined;
    const queued = this.pending.filter((approval) => approval.request.kind === kind);
    if (active === undefined && queued.length === 0) return false;
    for (const approval of queued) {
      this.pending.splice(this.pending.indexOf(approval), 1);
      this.settle(approval, false);
    }
    if (active !== undefined) {
      this.active = undefined;
      this.settle(active, false);
      this.activateNext();
    }
    this.publish();
    return true;
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
    // A withdrawn question is dismissed, never silently answered. Every path
    // that cancels an approval reaches here with `approved: false`, and a
    // question has no equivalent of "denied" — the user simply did not answer.
    if (approval.answer !== undefined) {
      approval.answer({ kind: 'dismissed' });
      return;
    }
    approval.resolve(approved);
  }

  private publish(): void {
    this.state.update({
      approvalRequest: this.active?.request,
      questionRequest: this.active?.question,
    });
  }
}
