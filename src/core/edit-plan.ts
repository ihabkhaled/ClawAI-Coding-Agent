import { z } from 'zod';

const dangerousSegmentPattern =
  /(?:^|\/)(?:\.git|\.env(?:\.|$)|[^/]*(?:secret|credential|api[-_]?key)[^/]*)(?:\/|$)/iu;
const windowsAbsolutePattern = /^[A-Za-z]:[\\/]/u;

const editFileSchema = z
  .object({
    path: z.string().min(1).max(1_000),
    operation: z.enum(['create', 'update', 'delete']),
    content: z.string().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((file, context) => {
    const normalized = file.path.replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (
      normalized.startsWith('/') ||
      windowsAbsolutePattern.test(file.path) ||
      segments.includes('..') ||
      dangerousSegmentPattern.test(normalized)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'Edit target must be a safe relative workspace path.',
      });
    }
    if (file.operation === 'delete' && file.content !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Delete operations must not include content.',
      });
    }
    if (file.operation !== 'delete' && file.content === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Create and update operations require content.',
      });
    }
  });

const editPlanSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    files: z.array(editFileSchema).min(1).max(50),
  })
  .strict();

export type EditPlan = z.infer<typeof editPlanSchema>;

export function parseEditPlan(value: unknown): EditPlan {
  return editPlanSchema.parse(value);
}
