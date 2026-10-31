import type { RuntimeJsonObject, ToolResult } from '../core/runtime/runtime-tool-contracts';

/** The part of a dispatch outcome the repetition guard reads or produces. */
export interface RuntimeRepeatOutcome {
  readonly status: ToolResult['status'];
  readonly structured?: RuntimeJsonObject;
  readonly modelText?: string;
}
