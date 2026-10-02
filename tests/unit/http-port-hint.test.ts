import { describe, expect, it } from 'vitest';

import { parseHostRules, portHint } from '../../src/sdk/http-host-rules';
import { approveTarget } from '../../src/sdk/http-tool-target';

import type { HttpHostRule, HttpResolver } from '../../src/sdk/http-tool.types';

function rules(...hosts: string[]): readonly HttpHostRule[] {
  const parsed = parseHostRules(hosts);
  if (typeof parsed === 'string') throw new Error(parsed);
  return parsed;
}

const nobody: HttpResolver = () => Promise.resolve([]);

describe('the refusal of a listed host on an unlisted port', () => {
  it('says a rule without a port means 80 and 443, and names the rule to add', async () => {
    await expect(
      approveTarget(new URL('http://127.0.0.1:4310/api/health'), rules('127.0.0.1'), nobody),
    ).rejects.toThrow(
      /127\.0\.0\.1:4310 is not an allowed host\. Allowed: 127\.0\.0\.1\. A rule without a port allows only ports 80 and 443.*--http-allow-host 127\.0\.0\.1:4310/u,
    );
  });

  it('says which port a pinned rule allows', async () => {
    await expect(
      approveTarget(new URL('http://127.0.0.1:4310/'), rules('127.0.0.1:3000'), nobody),
    ).rejects.toThrow(/127\.0\.0\.1 is allowed only on port 3000/u);
  });

  it('adds nothing for a host no rule names', async () => {
    await expect(
      approveTarget(new URL('http://evil.example.com:81/'), rules('claw.local'), nobody),
    ).rejects.toThrow(/Allowed: claw\.local\.$/u);
    expect(portHint(new URL('http://evil.example.com/'), rules('claw.local'))).toBe('');
  });

  it('still allows the pinned port', async () => {
    await expect(
      approveTarget(new URL('http://127.0.0.1:4310/'), rules('127.0.0.1:4310'), nobody),
    ).resolves.toMatchObject({ address: { address: '127.0.0.1' } });
  });
});
