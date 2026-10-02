import { createHash } from 'node:crypto';

import { redactText } from '../core/redaction';

import { isApproved } from './permission-modes';
import { VisionModelError } from './vision-errors';
import { readWorkspaceImage } from './vision-image-files';
import {
  modelId,
  namedVisionModel,
  VISION_NO_MODEL_MESSAGE,
  visionCandidates,
} from './vision-models';
import {
  VISION_MAX_ANSWER_CHARS,
  VISION_MAX_CACHED_ANSWERS,
  VISION_MAX_CALLS_PER_RUN,
  VISION_MAX_QUESTION_CHARS,
  VISION_TOOL_DESCRIPTION,
  VISION_TOOL_INPUT_SCHEMA,
  VISION_TOOL_NAME,
  VISION_TOOL_OPERATION,
} from './vision-tool.constants';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type { VisionCatalogModel, VisionPort } from './vision-tool.types';
import type { AgentPermissions } from './workspace-toolkit.types';

/** The definition the model is offered; the runtime tool contract's fields. */
export const VISION_TOOL_DEFINITION = {
  schemaVersion: '2.0',
  name: VISION_TOOL_NAME,
  version: '1.0.0',
  description: VISION_TOOL_DESCRIPTION,
  operations: [VISION_TOOL_OPERATION],
  riskClasses: ['inspect', 'network'],
  targetIds: ['target:workspace'],
  inputSchema: VISION_TOOL_INPUT_SCHEMA,
} as const;

interface VisionToolkitOptions {
  readonly workspace: string;
  readonly permissions: AgentPermissions;
  readonly port: VisionPort;
  /** `--vision-model`: `provider/model` or a bare key. */
  readonly model?: string | undefined;
}

/**
 * `vision.describe`: any tool-capable model can inspect a screenshot, because
 * the looking is done by a vision model in a separate thread.
 *
 * It reads a workspace image and asks a model, so it needs the `read` grant and
 * costs tokens; the run may make `VISION_MAX_CALLS_PER_RUN` calls. The catalog
 * is read once, a model that fails (no credit, refusal) is skipped for the rest
 * of the run, and when no model can look the model is told so in words.
 */
export function visionToolkit(options: VisionToolkitOptions): AgentToolkit {
  const state = { catalog: undefined as readonly VisionCatalogModel[] | undefined, calls: 0 };
  const failed = new Set<string>();
  const answered = new Map<string, Record<string, unknown>>();
  const catalogOf = async (
    signal: AbortSignal | undefined,
  ): Promise<readonly VisionCatalogModel[]> =>
    (state.catalog ??= await options.port.models(signal));
  return {
    definitions: [VISION_TOOL_DEFINITION],
    // Put to the approver like every other category: the permission table decides whether that is
    // a question (strict: the image leaves the machine) or an immediate yes.
    authorize: async (call) => {
      const { permissions } = options;
      if (call.toolName !== VISION_TOOL_NAME || call.operation !== VISION_TOOL_OPERATION) {
        return false;
      }
      if (!permissions.allow.includes('read')) return false;
      if (permissions.approve === undefined) return true;
      return isApproved(await permissions.approve({ ...call, category: 'read' }));
    },
    execute: async (call, signal) => {
      const { path, question } = describeArguments(call);
      const image = readWorkspaceImage(options.workspace, path);
      // The same picture asked the same thing is answered from memory: a loop on one question costs one call.
      const key = createHash('sha256')
        .update(image.bytes)
        .update('|')
        .update(question)
        .digest('hex');
      const known = answered.get(key);
      if (known !== undefined) return { ...known, path, cached: true };
      if (state.calls >= VISION_MAX_CALLS_PER_RUN) {
        throw new Error(
          `Vision call limit reached (${String(VISION_MAX_CALLS_PER_RUN)} per run). Stop looking at screenshots and decide from what you have.`,
        );
      }
      state.calls += 1;
      const catalog = await catalogOf(signal);
      const candidates = candidatesFor(catalog, options.model, failed);
      const attempts: string[] = [];
      for (const model of candidates) {
        try {
          const answer = await options.port.ask({ image, question, model }, signal);
          const result = {
            answer: redactText(answer).slice(0, VISION_MAX_ANSWER_CHARS),
            model: modelId(model),
            path,
            bytes: image.bytes.length,
            ...(image.stripped ? { metadataRemoved: true } : {}),
            untrusted: true,
          };
          if (answered.size < VISION_MAX_CACHED_ANSWERS) answered.set(key, result);
          return result;
        } catch (error) {
          if (!(error instanceof VisionModelError)) throw error;
          failed.add(modelId(model));
          attempts.push(`${modelId(model)}: ${error.code}`);
        }
      }
      throw new Error(unavailableMessage(attempts));
    },
  };
}

function describeArguments(call: AgentToolCall): { path: string; question: string } {
  const { path, question } = call.arguments;
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('vision.describe requires a "path" argument: the workspace path of the image.');
  }
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new Error('vision.describe requires a "question" argument: what to find out.');
  }
  if (question.length > VISION_MAX_QUESTION_CHARS) {
    throw new Error(
      `"question" is over ${String(VISION_MAX_QUESTION_CHARS)} characters; ask something shorter.`,
    );
  }
  return { path: path.trim(), question: question.trim() };
}

function candidatesFor(
  catalog: readonly VisionCatalogModel[],
  requested: string | undefined,
  failed: ReadonlySet<string>,
): readonly VisionCatalogModel[] {
  if (requested !== undefined) {
    const named = namedVisionModel(catalog, requested);
    if (failed.has(modelId(named))) {
      throw new Error(`The vision model ${modelId(named)} already failed in this run.`);
    }
    return [named];
  }
  const found = visionCandidates(catalog, failed);
  if (found.length === 0) throw new Error(VISION_NO_MODEL_MESSAGE);
  return found;
}

function unavailableMessage(attempts: readonly string[]): string {
  return (
    `No vision model could answer (${attempts.join('; ')}). ` +
    'The provider may be out of credit or refusing the image; try again later, or pass --vision-model.'
  );
}
