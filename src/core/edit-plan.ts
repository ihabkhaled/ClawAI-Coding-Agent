import { z } from 'zod';

const dangerousSegmentPattern =
  /(?:^|\/)(?:\.git|\.env(?:\.|$)|[^/]*(?:secret|credential|api[-_]?key)[^/]*)(?:\/|$)/iu;
const windowsAbsolutePattern = /^[A-Za-z]:[\\/]/u;
const shellControlPattern = /[\r\n;&|<>`$]/u;
const environmentExpansionPattern = /%[^%\s]+%/u;
const allowedExecutables = new Set([
  'bun',
  'cargo',
  'cmake',
  'deno',
  'dotnet',
  'eslint',
  'git',
  'go',
  'gradle',
  'gradlew',
  'gradlew.bat',
  'jest',
  'make',
  'mvn',
  'mvnw',
  'mvnw.cmd',
  'node',
  'npm',
  'npm.cmd',
  'npx',
  'npx.cmd',
  'pnpm',
  'pnpm.cmd',
  'prettier',
  'pytest',
  'python',
  'python3',
  'tsc',
  'tsgo',
  'vitest',
  'yarn',
  'yarn.cmd',
]);
const safeGitSubcommands = new Set([
  'branch',
  'diff',
  'log',
  'ls-files',
  'rev-parse',
  'show',
  'status',
]);

function isSafeRelativePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    !normalized.startsWith('/') &&
    !windowsAbsolutePattern.test(path) &&
    !segments.includes('..') &&
    !dangerousSegmentPattern.test(normalized)
  );
}

const editFileSchema = z
  .object({
    path: z.string().min(1).max(1_000),
    operation: z.enum(['create', 'update', 'delete']),
    content: z.string().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((file, context) => {
    if (!isSafeRelativePath(file.path)) {
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

const workspaceCommandSchema = z
  .object({
    command: z.string().trim().min(1).max(500),
    cwd: z.string().trim().min(1).max(1_000).optional(),
    purpose: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      shellControlPattern.test(entry.command) ||
      environmentExpansionPattern.test(entry.command)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message:
          'Command chaining, redirection, substitution, and environment expansion are blocked.',
      });
      return;
    }
    const [executable = '', subcommand = ''] = entry.command.split(/\s+/u);
    const normalizedExecutable = executable.toLowerCase();
    if (!allowedExecutables.has(normalizedExecutable)) {
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'Command executable is not in the development-tool allowlist.',
      });
    }
    if (normalizedExecutable === 'git' && !safeGitSubcommands.has(subcommand.toLowerCase())) {
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'Only read-only Git commands are allowed.',
      });
    }
    if (entry.cwd !== undefined && !isSafeRelativePath(entry.cwd)) {
      context.addIssue({
        code: 'custom',
        path: ['cwd'],
        message: 'Command working directory must be a safe relative workspace path.',
      });
    }
  });

const editPlanSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    files: z.array(editFileSchema).max(50),
    commands: z.array(workspaceCommandSchema).max(10).optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.files.length === 0 && (plan.commands?.length ?? 0) === 0) {
      context.addIssue({
        code: 'custom',
        message: 'An edit plan must contain a file change or a safe workspace command.',
      });
    }
  });

const editPlanInputSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    files: z.array(editFileSchema).max(50),
    commands: z.array(z.unknown()).max(10).optional(),
  })
  .strict();

export type EditPlan = z.infer<typeof editPlanSchema>;
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;

export function parseEditPlan(value: unknown): EditPlan {
  const input = editPlanInputSchema.parse(value);
  const commands = (input.commands ?? []).flatMap((command) => {
    const parsed = workspaceCommandSchema.safeParse(command);
    return parsed.success ? [parsed.data] : [];
  });
  return editPlanSchema.parse({
    ...input,
    ...(input.commands === undefined ? {} : { commands }),
  });
}
