import { describe, expect, it, vi } from 'vitest';

import { extractPdfText, extractTextResultSchema } from '../../src/backend/pdf-text-client';
import { backendPdfText } from '../../src/services/backend-pdf-text';

import type { BackendClient } from '../../src/backend/backend-client';
import type { ResearchRequester } from '../../src/backend/research-client';

const answer = {
  text: 'one',
  pages: [{ number: 1, text: 'one' }],
  totalPages: 1,
  isScanned: false,
};

function requesterReturning(value: unknown): ResearchRequester & ReturnType<typeof vi.fn> {
  return vi.fn(async () => value) as ResearchRequester & ReturnType<typeof vi.fn>;
}

describe('extractPdfText', () => {
  it('posts to the extraction endpoint, not the upload one', async () => {
    // An upload would put a copy of a repository file in the user's file list.
    const request = requesterReturning(answer);

    await extractPdfText(request, { filename: 'a.pdf', contentBase64: 'JVBERg==' });

    expect(request.mock.calls[0]?.[0]).toBe('/files/extract-text');
    expect(request.mock.calls[0]?.[2]).toMatchObject({ method: 'POST' });
  });

  it('sends the page range it was given', async () => {
    const request = requesterReturning(answer);

    await extractPdfText(request, {
      filename: 'a.pdf',
      contentBase64: 'JVBERg==',
      pages: { from: 3, to: 5 },
    });

    expect(request.mock.calls[0]?.[2]).toMatchObject({ body: { pages: { from: 3, to: 5 } } });
  });

  it('accepts a field the backend adds later', () => {
    // A strict schema would fail every PDF read on a client that was not
    // updated in step with the backend.
    expect(extractTextResultSchema.safeParse({ ...answer, language: 'en' }).success).toBe(true);
  });
});

describe('backendPdfText', () => {
  it('asks for the backend at call time, not when it was built', async () => {
    // Signing in again replaces the client; a port holding the old one would
    // send the user's files to the account they had just left.
    const first = requesterReturning(answer);
    const second = requesterReturning(answer);
    let current = { filesPost: first } as Pick<BackendClient, 'filesPost'>;
    const port = backendPdfText(() => current as BackendClient);

    current = { filesPost: second };
    await port.extract({ filename: 'a.pdf', contentBase64: 'JVBERg==' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
