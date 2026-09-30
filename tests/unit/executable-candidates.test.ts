import { describe, expect, it } from 'vitest';

import { executableCandidates } from '../../src/core/executable-candidates';

describe('executableCandidates on Windows', () => {
  const env = { Path: 'C:\\bin;"C:\\Program Files\\Git\\cmd";;', PATHEXT: '.EXE;.CMD' };

  it('tries PATHEXT extensions for a bare name and finds npm.cmd shims', () => {
    expect(executableCandidates('npm', env, 'win32')).toEqual([
      'C:\\bin\\npm.EXE',
      'C:\\bin\\npm.CMD',
      'C:\\Program Files\\Git\\cmd\\npm.EXE',
      'C:\\Program Files\\Git\\cmd\\npm.CMD',
    ]);
  });

  it('accepts a name that already carries a known extension, any case', () => {
    expect(executableCandidates('git.exe', { PATH: 'C:\\bin' }, 'win32')[0]).toBe(
      'C:\\bin\\git.exe',
    );
  });

  it('applies extensions to an explicit path too', () => {
    expect(executableCandidates('C:\\tools\\gh', env, 'win32')).toEqual([
      'C:\\tools\\gh.EXE',
      'C:\\tools\\gh.CMD',
    ]);
  });

  it('never searches the current directory for an empty PATH entry', () => {
    const found = executableCandidates('git', { PATH: ';C:\\bin' }, 'win32');
    expect(found.every((candidate) => candidate.startsWith('C:\\bin'))).toBe(true);
  });
});

describe('executableCandidates on POSIX', () => {
  it('uses the name as is and skips empty entries', () => {
    expect(executableCandidates('git', { PATH: '/usr/bin::/bin' }, 'linux')).toEqual([
      '/usr/bin/git',
      '/bin/git',
    ]);
  });

  it('returns an explicit path unchanged', () => {
    expect(executableCandidates('./gradlew', {}, 'darwin')).toEqual(['./gradlew']);
  });
});
