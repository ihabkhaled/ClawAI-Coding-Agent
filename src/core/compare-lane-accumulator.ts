import type { CompareLaneState } from './compare-lane-accumulator.types';
import type { ParallelResponse } from '../backend/contracts';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Folds the lane-tagged events of one async compare run into per-model results.
 * The server accepts a compare run with `responses: []` and streams every lane
 * on the thread stream; a lane's id is `<messageId>:<provider>:<model>`.
 * Events that belong to another run on the same thread are ignored, and a DONE
 * seen before any lane of this run spoke is a replayed earlier turn.
 */
export class CompareLaneAccumulator {
  private readonly lanes = new Map<string, CompareLaneState>();
  private done = false;

  constructor(private readonly groupId: string) {}

  get finished(): boolean {
    return this.done;
  }

  apply(event: Record<string, unknown>): void {
    const laneId = text(event.laneId);
    if (laneId === undefined) {
      this.applyRunEvent(event);
      return;
    }
    if (!laneId.startsWith(`${this.groupId}:`)) {
      return;
    }
    const lane = this.laneFor(laneId, event);
    if (event.type === 'CONTENT_DELTA' && typeof event.delta === 'string') {
      lane.content += event.delta;
    } else if (event.type === 'USAGE') {
      this.applyUsage(lane, event.usage);
    } else if (event.type === 'ERROR') {
      lane.status = 'failed';
      lane.errorMessage = text(event.description) ?? text(event.error) ?? 'Model failed';
    }
  }

  result(accepted: ParallelResponse): ParallelResponse {
    const responses = [...this.lanes.values()].map((lane) => ({
      ...lane,
      latencyMs: 0,
    }));
    return {
      ...accepted,
      responses,
      completedCount: responses.filter((lane) => lane.status === 'completed').length,
      failedCount: responses.filter((lane) => lane.status === 'failed').length,
    };
  }

  private applyRunEvent(event: Record<string, unknown>): void {
    if (event.type === 'DONE') {
      this.done = this.lanes.size > 0 || this.done;
    } else if (event.type === 'ERROR' && this.lanes.size > 0) {
      throw new Error(text(event.description) ?? text(event.error) ?? 'Compare run failed');
    }
  }

  private laneFor(laneId: string, event: Record<string, unknown>): CompareLaneState {
    const existing = this.lanes.get(laneId);
    if (existing !== undefined) {
      return existing;
    }
    const created: CompareLaneState = {
      content: '',
      errorMessage: null,
      inputTokens: null,
      model: text(event.model) ?? laneId,
      outputTokens: null,
      provider: text(event.provider) ?? 'unknown',
      status: 'completed',
    };
    this.lanes.set(laneId, created);
    return created;
  }

  private applyUsage(lane: CompareLaneState, usage: unknown): void {
    if (typeof usage !== 'object' || usage === null) {
      return;
    }
    const reported = usage as Record<string, unknown>;
    lane.inputTokens = count(reported.promptTokens) ?? lane.inputTokens;
    lane.outputTokens = count(reported.completionTokens) ?? lane.outputTokens;
  }
}
