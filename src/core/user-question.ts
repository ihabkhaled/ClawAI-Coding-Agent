import { z } from 'zod';

export const MIN_QUESTION_OPTIONS = 2;
export const MAX_QUESTION_OPTIONS = 4;

const optionSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

/**
 * A structured question the agent may put to the user mid-run.
 *
 * Two options is the floor because a one-option question is a statement, and
 * four is the ceiling because the panel has to stay readable in a narrow
 * sidebar and navigable from the keyboard. `allowOther` is how a question stays
 * honest when the options may not cover the real answer.
 */
export const userQuestionInputSchema = z
  .object({
    header: z.string().trim().min(1).max(24),
    question: z.string().trim().min(1).max(1_000),
    options: z
      .array(optionSchema)
      .min(MIN_QUESTION_OPTIONS)
      .max(MAX_QUESTION_OPTIONS)
      .superRefine((options, context) => {
        const labels = options.map((option) => option.label.toLowerCase());
        if (new Set(labels).size !== labels.length) {
          context.addIssue({
            code: 'custom',
            message: 'Question options must be distinguishable from each other.',
          });
        }
      }),
    allowOther: z.boolean().default(true),
  })
  .strict();

export type UserQuestionInput = z.infer<typeof userQuestionInputSchema>;

export interface UserQuestion extends UserQuestionInput {
  readonly id: string;
}

export type UserQuestionAnswer =
  | { readonly kind: 'option'; readonly label: string }
  | { readonly kind: 'other'; readonly text: string }
  | { readonly kind: 'dismissed' };

export const MAX_OTHER_ANSWER_LENGTH = 2_000;

/**
 * Turns a webview selection into an answer, or refuses it.
 *
 * The webview is untrusted input like any other, so a selection is checked
 * against the question that was actually asked rather than believed. Returning
 * `undefined` for anything unrecognised keeps a forged or stale selection —
 * one naming an option from a previous question, say — from resolving the run
 * with an answer the user never gave.
 */
export function resolveQuestionAnswer(
  question: UserQuestion,
  selection: unknown,
): UserQuestionAnswer | undefined {
  const parsed = z
    .object({
      label: z.string().max(80).optional(),
      other: z.string().max(MAX_OTHER_ANSWER_LENGTH).optional(),
    })
    .strip()
    .safeParse(selection);
  if (!parsed.success) return undefined;

  const { label, other } = parsed.data;
  if (label !== undefined) {
    const matched = question.options.find((option) => option.label === label);
    return matched === undefined ? undefined : { kind: 'option', label: matched.label };
  }
  if (other !== undefined) {
    const text = other.trim();
    if (!question.allowOther || text.length === 0) return undefined;
    return { kind: 'other', text };
  }
  return undefined;
}

/**
 * What the model is told, once the user has answered.
 *
 * A dismissed question is reported as dismissed rather than as a default
 * choice. The agent asked because it could not decide; answering on the user's
 * behalf would put words in their mouth and hide that the question went
 * unanswered.
 */
export function describeQuestionAnswer(answer: UserQuestionAnswer): string {
  if (answer.kind === 'option') return answer.label;
  if (answer.kind === 'other') return answer.text;
  return 'The user dismissed the question without answering.';
}
