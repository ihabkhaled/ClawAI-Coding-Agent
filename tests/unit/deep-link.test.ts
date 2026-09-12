import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseDeepLink } from '../../src/core/deep-link';

const threadId = '7a1f0f3e-2b1e-4a9c-9a2a-9d1f5a2c8e11';

describe('parseDeepLink', () => {
  it('opens the view', () => {
    expect(parseDeepLink('/open', '')).toEqual({ kind: 'open' });
    expect(parseDeepLink('open', '')).toEqual({ kind: 'open' });
    expect(parseDeepLink('/Open/', '')).toEqual({ kind: 'open' });
  });

  it('opens one conversation by id', () => {
    expect(parseDeepLink('/session', `id=${threadId}`)).toEqual({ kind: 'session', threadId });
  });

  it('refuses a session id that is not a uuid', () => {
    expect(parseDeepLink('/session', 'id=../../etc/passwd')).toBeUndefined();
    expect(parseDeepLink('/session', 'id=')).toBeUndefined();
    expect(parseDeepLink('/session', '')).toBeUndefined();
  });

  // A link is triggerable by any web page. Accepting text would make a page
  // able to seed the composer of a coding agent, and a user who then pressed
  // send would have become the delivery mechanism for someone else's
  // instruction.
  it('cannot express a prompt, a command, or anything with an effect', () => {
    expect(parseDeepLink('/prompt', 'text=delete%20everything')).toBeUndefined();
    expect(parseDeepLink('/send', `id=${threadId}`)).toBeUndefined();
    expect(parseDeepLink('/command', 'name=clawAI.connect')).toBeUndefined();
    expect(parseDeepLink('/connect', 'backend=https://evil.example')).toBeUndefined();
  });

  it('ignores extra parameters rather than acting on them', () => {
    expect(parseDeepLink('/session', `id=${threadId}&prompt=run%20rm&autoSend=true`)).toEqual({
      kind: 'session',
      threadId,
    });
  });

  // Unrecognised links return undefined rather than throwing: an error dialog
  // raised by a link the user did not knowingly click is a nuisance a page
  // could trigger repeatedly.
  it('returns undefined for anything unrecognised, without throwing', () => {
    expect(() => parseDeepLink('', '')).not.toThrow();
    expect(parseDeepLink('', '')).toBeUndefined();
    expect(parseDeepLink('/unknown/deeply/nested', 'a=b')).toBeUndefined();
    expect(parseDeepLink('/session/extra', `id=${threadId}`)).toBeUndefined();
  });
});

describe('authorization boundary', () => {
  // The assertion the extension-host test makes is about the manifest. This is
  // the same property at the source level: the loopback flow described in
  // docs/AUTHENTICATION.md must never start receiving codes through a URI.
  it('keeps authorization off the URI surface', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'services', 'browser-authorization-service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/registerUriHandler/u);
    expect(source).not.toMatch(/vscode:\/\//u);
  });
});
