import {
  COMPARE_FINISHING_PERCENT,
  COMPARE_JUDGE_STAGE_PREFIX,
  COMPARE_PHASE_ORDER,
  COMPARE_STAGE_PHASES,
} from './compare-lane-accumulator.constants';

import type {
  CompareLanePhase,
  CompareLaneState,
  CompareLiveChange,
} from './compare-lane-accumulator.types';
import type { ParallelResponse } from '../backend/contracts';

interface LiveLane {
  elapsedMs: number | null;
  phase: CompareLanePhase;
}

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
 *
 * `apply` also reports what each event changed, so a card can be drawn and
 * filled while the lane runs; the same fold produces the final result.
 */
export class CompareLaneAccumulator {
  private readonly lanes = new Map<string, CompareLaneState>();
  private readonly live = new Map<string, LiveLane>();
  private done = false;
  private judging = false;

  constructor(private readonly groupId: string) {}

  get finished(): boolean {
    return this.done;
  }

  apply(event: Record<string, unknown>): CompareLiveChange | undefined {
    const laneId = text(event.laneId);
    if (laneId === undefined) {
      return this.applyRunEvent(event);
    }
    if (!laneId.startsWith(`${this.groupId}:`)) {
      return undefined;
    }
    const isNew = !this.lanes.has(laneId);
    const lane = this.laneFor(laneId, event);
    const live = this.liveFor(laneId);
    const before = { elapsedMs: live.elapsedMs, phase: live.phase };
    const delta = this.applyLaneEvent(lane, live, event);
    const changed =
      isNew ||
      delta.length > 0 ||
      before.phase !== live.phase ||
      before.elapsedMs !== live.elapsedMs ||
      event.type === 'USAGE';
    return changed ? this.change(laneId, lane, live, delta) : undefined;
  }

  result(accepted: ParallelResponse): ParallelResponse {
    const responses = [...this.lanes.entries()].map(([laneId, lane]) => ({
      ...lane,
      latencyMs: this.live.get(laneId)?.elapsedMs ?? 0,
    }));
    return {
      ...accepted,
      responses,
      completedCount: responses.filter((lane) => lane.status === 'completed').length,
      failedCount: responses.filter((lane) => lane.status === 'failed').length,
    };
  }

  private applyRunEvent(event: Record<string, unknown>): CompareLiveChange | undefined {
    if (event.type === 'DONE') {
      this.done = this.lanes.size > 0 || this.done;
    } else if (event.type === 'ERROR' && this.lanes.size > 0) {
      throw new Error(text(event.description) ?? text(event.error) ?? 'Compare run failed');
    }
    return this.judgeChange(event);
  }

  /** The judge starts after every lane has ended; the server never streams its verdict. */
  private judgeChange(event: Record<string, unknown>): CompareLiveChange | undefined {
    const stageId = text(event.stageId) ?? '';
    const starts =
      event.type === 'JUDGE_EVALUATING' ||
      (event.type === 'RESPONSE_STREAMING' &&
        event.status === 'active' &&
        stageId.startsWith(COMPARE_JUDGE_STAGE_PREFIX));
    if (!starts || this.judging || this.lanes.size === 0) {
      return undefined;
    }
    this.judging = true;
    return {
      kind: 'judge-ranking',
      judgeModel: text(event.judgeModel) ?? text(event.description) ?? null,
    };
  }

  private applyLaneEvent(lane: CompareLaneState, live: LiveLane, event: Record<string, unknown>) {
    if (event.type === 'CONTENT_DELTA' && typeof event.delta === 'string') {
      lane.content += event.delta;
      this.advance(live, 'generating');
      return event.delta;
    }
    if (event.type === 'USAGE') {
      this.applyUsage(lane, event.usage);
    } else if (event.type === 'ERROR') {
      lane.status = 'failed';
      lane.errorMessage = text(event.description) ?? text(event.error) ?? 'Model failed';
      live.phase = 'failed';
    } else if (event.type === 'LIFECYCLE') {
      this.advance(live, COMPARE_STAGE_PHASES[String(event.stage)]);
    } else if (event.type === 'REASONING_DELTA') {
      this.advance(live, 'thinking');
    } else if (event.type === 'METRICS') {
      this.applyMetrics(live, event.metrics);
    }
    return '';
  }

  private advance(live: LiveLane, phase: CompareLanePhase | undefined): void {
    if (phase === undefined || live.phase === 'failed') {
      return;
    }
    if (COMPARE_PHASE_ORDER[phase] > COMPARE_PHASE_ORDER[live.phase]) {
      live.phase = phase;
    }
  }

  private applyMetrics(live: LiveLane, metrics: unknown): void {
    if (typeof metrics !== 'object' || metrics === null) {
      return;
    }
    const reported = metrics as Record<string, unknown>;
    live.elapsedMs = count(reported.elapsedMs) ?? live.elapsedMs;
    const percent = count(reported.progressPercent);
    if (percent !== null && percent >= COMPARE_FINISHING_PERCENT) {
      this.advance(live, 'finishing');
    }
  }

  private change(
    laneId: string,
    lane: CompareLaneState,
    live: LiveLane,
    delta: string,
  ): CompareLiveChange {
    return {
      kind: 'lane',
      lane: {
        delta,
        elapsedMs: live.elapsedMs,
        errorMessage: lane.errorMessage,
        inputTokens: lane.inputTokens,
        laneId,
        model: lane.model,
        outputTokens: lane.outputTokens,
        phase: live.phase,
        provider: lane.provider,
      },
    };
  }

  private liveFor(laneId: string): LiveLane {
    const existing = this.live.get(laneId);
    if (existing !== undefined) {
      return existing;
    }
    const created: LiveLane = { elapsedMs: null, phase: 'connecting' };
    this.live.set(laneId, created);
    return created;
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
