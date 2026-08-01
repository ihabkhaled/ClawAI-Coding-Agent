import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { tokenizeWorkspaceCommand } from './command-tokenizer';
import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

const shellControlPattern = /[\r\n;&|<>`$^\\!~*?()[\]{}@]/u;
const environmentExpansionPattern = /%[^%\s]+%/u;
const nestedParentPathPattern = /(?:^|[\\/=])\.\.(?:[\\/]|$)/u;
const outsideWorkspaceArgumentPattern =
  /(?:^|[\s=])["']?(?:\.\.(?:[\\/]|(?=["']?(?:\s|$)))|[A-Za-z]:[\\/]|\/(?!\/)|\\\\)/u;
const externalUriArgumentPattern =
  /(?:^|=)(?:(?:bitbucket|data|file|ftp|ftps|git(?:\+(?:http|https|ssh))?|github|gitlab|http|https|jsr|npm|ssh|ws|wss):|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/iu;
const allowedExecutables = new Set([
  'bun',
  'cargo',
  'cmake',
  'deno',
  'docker',
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
const safeGitSubcommands = new Set(['diff', 'log', 'ls-files', 'rev-parse', 'show', 'status']);
const safeDockerSubcommands = new Set([
  'images',
  'info',
  'inspect',
  'logs',
  'network',
  'port',
  'ps',
  'stats',
  'top',
  'version',
]);
const inlineInterpreterArgumentPatterns = new Map<string, RegExp>([
  ['bun', /^(?:-[^-]*[ep]|--(?:eval|print)(?:=|$))/u],
  ['deno', /^eval$/u],
  ['node', /^(?:-[^-]*[ep]|--(?:eval|print)(?:=|$))/u],
  ['python', /^-c/u],
  ['python3', /^-c/u],
]);

function usesInlineInterpreter(executable: string, arguments_: string[]): boolean {
  const blockedArgumentPattern = inlineInterpreterArgumentPatterns.get(executable);
  return (
    blockedArgumentPattern !== undefined &&
    arguments_.some((argument) => blockedArgumentPattern.test(argument.toLowerCase()))
  );
}

function invalidDockerCommandReason(subcommand: string, arguments_: string[]): string | undefined {
  const normalizedSubcommand = subcommand.toLowerCase();
  if (!safeDockerSubcommands.has(normalizedSubcommand)) {
    return 'Only read-only Docker diagnostics are allowed.';
  }
  if (normalizedSubcommand === 'network' && arguments_[0]?.toLowerCase() !== 'inspect') {
    return 'Only docker network inspect is allowed.';
  }
  if (normalizedSubcommand === 'stats' && !arguments_.includes('--no-stream')) {
    return 'Docker stats must use --no-stream.';
  }
  return undefined;
}

function unsafeCommandReason(
  executable: string,
  arguments_: string[],
  command: string,
): string | undefined {
  if (usesInlineInterpreter(executable, arguments_)) {
    return 'Inline interpreter programs are blocked.';
  }
  if (nestedParentPathPattern.test(command) || outsideWorkspaceArgumentPattern.test(command)) {
    return 'Command arguments must stay inside the workspace.';
  }
  if (arguments_.some((argument) => externalUriArgumentPattern.test(argument))) {
    return 'Command arguments must not load external URI resources.';
  }
  return undefined;
}

function invalidWorkspaceCommandReason(command: string): string | undefined {
  if (shellControlPattern.test(command) || environmentExpansionPattern.test(command)) {
    return 'Command chaining, redirection, substitution, and environment expansion are blocked.';
  }
  const tokens = tokenizeWorkspaceCommand(command);
  if (tokens === undefined) {
    return 'Command arguments contain an unterminated quoted value.';
  }
  const [executable = '', subcommand = '', ...remainingArguments] = tokens;
  const normalizedExecutable = executable.toLowerCase();
  if (!allowedExecutables.has(normalizedExecutable)) {
    return 'Command executable is not in the development-tool allowlist.';
  }
  if (normalizedExecutable === 'git' && !safeGitSubcommands.has(subcommand.toLowerCase())) {
    return 'Only read-only Git commands are allowed.';
  }
  if (normalizedExecutable === 'docker') {
    const reason = invalidDockerCommandReason(subcommand, remainingArguments);
    if (reason !== undefined) {
      return reason;
    }
  }
  return unsafeCommandReason(normalizedExecutable, [subcommand, ...remainingArguments], command);
}

const editFileSchema = z
  .object({
    rootKey: z.string().min(1).max(100).optional(),
    path: z.string().min(1).max(1_000),
    operation: z.enum(['create', 'update', 'delete']),
    content: z.string().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((file, context) => {
    if (!isSafeRelativeWorkspacePath(file.path)) {
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

const editFileInputSchema = z
  .object({
    rootKey: z.string().min(1).max(100).optional(),
    path: z.string().min(1).max(1_000),
    operation: z.enum(['create', 'update', 'delete']),
    content: z.string().max(1_000_000).optional(),
    contents: z.string().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((file, context) => {
    if (file.content !== undefined && file.contents !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['contents'],
        message: 'Edit operations must not provide both content and contents.',
      });
    }
  })
  .transform((file) => ({
    ...(file.rootKey === undefined ? {} : { rootKey: file.rootKey }),
    path: file.path,
    operation: file.operation,
    ...(file.content === undefined && file.contents === undefined
      ? {}
      : { content: file.content ?? file.contents }),
  }));

const workspaceCommandSchema = z
  .object({
    command: z.string().trim().min(1).max(500),
    cwd: z.string().trim().min(1).max(1_000).optional(),
    purpose: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((entry, context) => {
    const commandReason = invalidWorkspaceCommandReason(entry.command);
    if (commandReason !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message: commandReason,
      });
    }
    if (entry.cwd !== undefined && entry.cwd !== '.' && !isSafeRelativeWorkspacePath(entry.cwd)) {
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
  .strict();

const editPlanInputSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    files: z.array(editFileInputSchema).max(50),
    commands: z.array(z.unknown()).max(10).optional(),
  })
  .strict();

export type EditPlan = z.infer<typeof editPlanSchema>;
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;

interface EditPlanParseOptions {
  externalRootKeys?: readonly string[];
  externalRoots?: readonly { rootKey: string; uri: string }[];
}

function normalizeExternalAbsolutePath(
  file: z.infer<typeof editFileInputSchema>,
  roots: readonly { rootKey: string; uri: string }[],
): z.infer<typeof editFileInputSchema> {
  if (file.rootKey !== undefined) return file;
  const flavor = path.win32.isAbsolute(file.path)
    ? path.win32
    : path.posix.isAbsolute(file.path)
      ? path.posix
      : undefined;
  if (flavor === undefined) return file;
  for (const root of roots) {
    const rootPath = fileURLToPath(root.uri);
    const relative = flavor.relative(rootPath, file.path);
    if (
      relative !== '..' &&
      !relative.startsWith(`..${flavor.sep}`) &&
      !flavor.isAbsolute(relative)
    ) {
      return { ...file, rootKey: root.rootKey, path: relative.replaceAll('\\', '/') };
    }
  }
  return file;
}

function normalizeWorkspaceCommand(command: WorkspaceCommand): WorkspaceCommand {
  const cwd = command.cwd
    ?.replaceAll('\\', '/')
    .replace(/^\.\/+/u, '')
    .replace(/\/+$/u, '');
  if (cwd === undefined || cwd === '' || cwd === '.') {
    return command;
  }
  const repeatsWorkingDirectory = command.command
    .split(/\s+/u)
    .slice(1)
    .map((part) =>
      part
        .replace(/^["']|["']$/gu, '')
        .replaceAll('\\', '/')
        .replace(/^\.\/+/u, ''),
    )
    .some((part) => part === cwd || part.startsWith(`${cwd}/`));
  if (!repeatsWorkingDirectory) {
    return command;
  }
  const workspaceRootCommand = { ...command };
  delete workspaceRootCommand.cwd;
  return workspaceRootCommand;
}

export function parseEditPlan(value: unknown, options: EditPlanParseOptions = {}): EditPlan {
  const parsedInput = editPlanInputSchema.parse(value);
  const input = {
    ...parsedInput,
    files: parsedInput.files.map((file) =>
      normalizeExternalAbsolutePath(file, options.externalRoots ?? []),
    ),
  };
  const admittedRoots = new Set([
    ...(options.externalRootKeys ?? []),
    ...(options.externalRoots?.map((root) => root.rootKey) ?? []),
  ]);
  for (const file of input.files) {
    if (file.rootKey === undefined) continue;
    if (!admittedRoots.has(file.rootKey)) {
      throw new Error(`The rootKey "${file.rootKey}" is not an admitted external output folder.`);
    }
    if (file.operation === 'delete') {
      throw new Error('External output folders cannot delete files.');
    }
  }
  const commands = (input.commands ?? []).flatMap((command) => {
    const parsed = workspaceCommandSchema.safeParse(command);
    return parsed.success ? [normalizeWorkspaceCommand(parsed.data)] : [];
  });
  return editPlanSchema.parse({
    ...input,
    ...(input.commands === undefined ? {} : { commands }),
  });
}
