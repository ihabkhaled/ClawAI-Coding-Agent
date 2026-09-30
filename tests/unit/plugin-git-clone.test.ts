import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCommandSpec: vi.fn(),
  rm: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({
  runCommandSpec: mocks.runCommandSpec,
}));
vi.mock('node:fs/promises', () => ({ rm: mocks.rm, mkdir: mocks.mkdir }));

const { cloneGitMarketplace } = await import('../../src/infrastructure/plugin-git-clone');

const location = { kind: 'git' as const, url: 'https://git.example/m.git', ref: 'v1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cloneGitMarketplace', () => {
  it('replaces the previous clone with a shallow, prompt-free clone', async () => {
    mocks.runCommandSpec.mockResolvedValueOnce({ exitCode: 0, timedOut: false });

    const target = await cloneGitMarketplace('/base', location);

    expect(target.replaceAll('\\', '/')).toMatch(/^\/base\/[a-f0-9]{24}$/u);
    expect(mocks.rm).toHaveBeenCalledWith(target, { recursive: true, force: true });
    expect(mocks.mkdir).toHaveBeenCalledWith('/base', { recursive: true });
    const [spec, cwd] = mocks.runCommandSpec.mock.calls[0] as [
      { executable: string; arguments: string[]; environment: Record<string, string> },
      string,
    ];
    expect(cwd).toBe('/base');
    expect(spec.executable).toBe('git');
    expect(spec.arguments).toContain('--depth');
    expect(spec.arguments.slice(-2)).toEqual(['https://git.example/m.git', target]);
    expect(spec.environment).toEqual({ GIT_TERMINAL_PROMPT: '0' });
  });

  it('removes a failed or timed-out clone and reports the URL as unreachable', async () => {
    mocks.runCommandSpec.mockResolvedValueOnce({ exitCode: 128, timedOut: false });
    await expect(cloneGitMarketplace('/base', location)).rejects.toMatchObject({
      code: 'unreachable',
      detail: 'https://git.example/m.git',
    });
    mocks.runCommandSpec.mockResolvedValueOnce({ exitCode: 0, timedOut: true });
    await expect(cloneGitMarketplace('/base', location)).rejects.toMatchObject({
      code: 'unreachable',
    });
    expect(mocks.rm).toHaveBeenCalledTimes(4);
  });
});
