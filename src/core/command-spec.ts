import { z } from 'zod';

import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

const safeEnvironmentKey =
  /^(?!.*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH))[A-Z_][A-Z0-9_]{0,99}$/iu;
export const COMMAND_EXPECTED_EFFECTS = [
  'read',
  'build',
  'test',
  'local-mutation',
  'network',
  'install',
] as const;

export const commandSpecSchema = z
  .object({
    executable: z.string().trim().min(1).max(4_096),
    arguments: z.array(z.string().max(32_768)).max(1_000).default([]),
    cwdRootKey: z.string().min(1).max(100),
    cwd: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => value === '.' || isSafeRelativeWorkspacePath(value))
      .default('.'),
    environment: z.record(z.string().regex(safeEnvironmentKey), z.string().max(32_768)).default({}),
    timeoutMs: z.number().int().min(100).max(7_200_000),
    outputLimitBytes: z.number().int().min(1_024).max(16_777_216),
    expectedEffect: z.enum(COMMAND_EXPECTED_EFFECTS),
    targetId: z.string().min(8).max(128),
    elevation: z.boolean().default(false),
    stdin: z.string().max(1_048_576).optional(),
    shell: z
      .object({
        dialect: z.enum(['pwsh', 'powershell', 'cmd', 'bash', 'sh', 'zsh']),
        command: z.string().min(1).max(131_072),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((specification, context) => {
    if (
      specification.shell !== undefined &&
      (specification.arguments.length > 0 ||
        specification.executable !== specification.shell.dialect)
    )
      context.addIssue({
        code: 'custom',
        message: 'Shell mode must use its declared dialect without argv',
      });
  });

export type CommandSpec = z.infer<typeof commandSpecSchema>;

export interface CommandResult {
  readonly executablePath: string;
  readonly executableHash: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly truncated: boolean;
}

export const commandRecipeSchema = z
  .object({
    recipeId: z.string().min(3).max(200),
    prerequisites: z.array(z.string().min(1).max(200)).max(100),
    variants: z
      .object({
        windows: commandSpecSchema.optional(),
        macos: commandSpecSchema.optional(),
        linux: commandSpecSchema.optional(),
      })
      .strict(),
  })
  .strict();
