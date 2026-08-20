export interface SmallPatchPolicy {
  readonly enabled: boolean;
  readonly allowReplacement: boolean;
}

const SMALL_PATCH_INTENT = /\b(?:small\s+patch|add\s+only|only\s+add)\b/iu;
const REPLACEMENT_INTENT =
  /\b(?:replace|overwrite|rewrite)\s+(?:the\s+)?(?:entire|whole)\s+file\b/iu;

export function parseSmallPatchPolicy(prompt: string): SmallPatchPolicy {
  return {
    enabled: /\bONE\s+(?:NEW\s+)?FILE\s+ONLY:/iu.test(prompt) && SMALL_PATCH_INTENT.test(prompt),
    allowReplacement: REPLACEMENT_INTENT.test(prompt),
  };
}

function lineCount(content: string): number {
  return content === '' ? 0 : content.split(/\r?\n/u).length;
}

export function assertSmallPatchIsNonDestructive(
  before: string | null,
  after: string | null,
  path: string,
  policy: SmallPatchPolicy,
): void {
  if (!policy.enabled || policy.allowReplacement || before === null || after === null) return;
  const removedBytes = before.length - after.length;
  const removedLines = lineCount(before) - lineCount(after);
  const massiveByteShrink = before.length >= 4_096 && removedBytes >= before.length / 2;
  const massiveLineShrink = lineCount(before) >= 100 && removedLines >= lineCount(before) / 2;
  if (massiveByteShrink || massiveLineShrink) {
    throw new Error(
      `Rejected destructive whole-file replacement during an explicit small-patch run: ${path}. Use a targeted patch, or explicitly authorize replacing the entire file.`,
    );
  }
}
