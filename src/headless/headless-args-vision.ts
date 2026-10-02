import path from 'node:path';

import { VISION_MAX_PROMPT_IMAGES } from '../sdk/vision-tool.constants';

import type { HeadlessInvocation } from './headless-args.types';

type Values = ReadonlyMap<string, readonly string[]>;
type Flags = ReadonlySet<string>;
type VisionFlags = Partial<Pick<HeadlessInvocation, 'images' | 'visionModel' | 'vision'>>;

/**
 * `--image` (repeatable), `--vision-model` and `--vision`, validated.
 *
 * Image paths are resolved against the working directory here, so the SDK gets
 * absolute ones; whether the files exist and are real images is checked when
 * the agent is built, before any request. Naming an image or a vision model is
 * the request to use the vision tool, as naming MCP servers is for MCP.
 */
export function visionFlags(values: Values, flags: Flags, cwd: string): VisionFlags | string {
  const images = (values.get('image') ?? []).map((entry) => path.resolve(cwd, entry));
  if (images.length > VISION_MAX_PROMPT_IMAGES) {
    return `--image can be given at most ${String(VISION_MAX_PROMPT_IMAGES)} times.`;
  }
  const model = values.get('visionModel')?.at(-1)?.trim();
  if (model?.length === 0) return '--vision-model needs a model name.';
  const enabled = flags.has('--vision') || images.length > 0 || model !== undefined;
  return {
    ...(images.length === 0 ? {} : { images }),
    ...(model === undefined ? {} : { visionModel: model }),
    ...(enabled ? { vision: true as const } : {}),
  };
}
