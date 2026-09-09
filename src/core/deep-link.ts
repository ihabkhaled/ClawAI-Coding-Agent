import { z } from 'zod';

export type DeepLinkRequest =
  { readonly kind: 'open' } | { readonly kind: 'session'; readonly threadId: string };

const sessionQuerySchema = z.object({ id: z.uuid() });

/**
 * Parses an inbound `vscode://` link into the only two things it may ask for.
 *
 * A `vscode://` link is triggerable by any web page, so this deliberately
 * cannot express a prompt, a command, an approval or a connection. See
 * `docs/adr/0001-uri-handler-navigation-only.md`: the surface is narrow because
 * accepting text would make any page able to seed the composer of a coding
 * agent, and a user who then pressed send would have become the delivery
 * mechanism for someone else's instruction.
 *
 * Anything unrecognised returns `undefined` rather than an error. A dialog
 * raised by a link the user did not knowingly click is a nuisance a page could
 * trigger repeatedly, and there is nothing for the user to do about it.
 */
export function parseDeepLink(path: string, query: string): DeepLinkRequest | undefined {
  const route = path.replace(/^\/+|\/+$/gu, '').toLowerCase();
  if (route === 'open') return { kind: 'open' };
  if (route !== 'session') return undefined;

  // `URLSearchParams` is used rather than a hand-rolled split so that
  // percent-encoding, repeated keys and empty values behave the way the rest of
  // the platform behaves.
  const parsed = sessionQuerySchema.safeParse(
    Object.fromEntries(new URLSearchParams(query).entries()),
  );
  return parsed.success ? { kind: 'session', threadId: parsed.data.id } : undefined;
}
