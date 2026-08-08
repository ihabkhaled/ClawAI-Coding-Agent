import { describe, expect, it } from 'vitest';

import {
  isSafeRelativeWorkspacePath,
  isSensitiveWorkspacePath,
} from '../../src/core/workspace-path-policy';

describe('workspace path policy sensitivity', () => {
  it('keeps denying secret-shaped names', () => {
    // The protection the policy exists for: files that STORE credentials.
    const sensitive = [
      '.env',
      '.env.local',
      '.git/config',
      '.ssh/id_rsa',
      '.npmrc',
      '.netrc',
      'config/password.txt',
      'passwords.txt',
      'passwd',
      'etc/passwd',
      'backup/passwords.csv',
      'user-passwords.csv',
      'password-list.txt',
      'passwords/dump.log',
      'config/private-key.pem',
      'config/access_token.json',
      'config/token.txt',
      'credentials.json',
      'client-secret.yaml',
    ];
    for (const path of sensitive) {
      expect(isSensitiveWorkspacePath(path), path).toBe(true);
    }
  });

  it('does not mistake password-feature source files for credential stores', () => {
    // A password-reset feature cannot be implemented by an agent that may not
    // read or write any file with "password" in its name. Screened live: a
    // model asked to read docs/…/password-reset-task.md produced the correct
    // path 38 times and was refused every time, then ran out of budget. The
    // `token` term already had word-boundary care — reset-tokens.ts was never
    // flagged; password gets the same treatment here.
    const safe = [
      'docs/16-quality-engineering/coding-agent-lab/password-reset-task.md',
      'src/auth/password-reset.controller.ts',
      'src/auth/password-reset.service.spec.ts',
      'src/auth/password-policy.ts',
      'app/[locale]/reset-password/page.tsx',
      'app/[locale]/forgot-password/page.tsx',
      'prisma/migrations/20260808_add_password_reset_token/migration.sql',
      'src/auth/password-hashing.service.ts',
      'src/components/password-strength-meter.tsx',
      'docs/password-reset-flow.md',
      'src/lib/password.ts',
      'src/tokenizer.ts',
      'src/auth/reset-tokens.ts',
    ];
    for (const path of safe) {
      expect(isSensitiveWorkspacePath(path), path).toBe(false);
      expect(isSafeRelativeWorkspacePath(path), path).toBe(true);
    }
  });

  it('still protects standalone password names outside code modules', () => {
    // A directory or document named only "password(s)" is a plausible
    // credential store; a .ts module of that name is a hashing helper.
    expect(isSensitiveWorkspacePath('passwords/anything.md')).toBe(true);
    expect(isSensitiveWorkspacePath('notes/password.md')).toBe(true);
    expect(isSensitiveWorkspacePath('PASSWORDS.TXT')).toBe(true);
  });

  it('keeps compound password names denied when the file is data-shaped', () => {
    for (const path of [
      'export/password-dump.json',
      'notes/password-backup.zip',
      'password-recovery-codes.txt',
      'password-reset.env',
    ]) {
      expect(isSensitiveWorkspacePath(path), path).toBe(true);
    }
  });
});
