import { z } from 'zod';

/**
 * The summary a finished tool call carries alongside its receipt.
 *
 * Its own file rather than sitting with the other payload schemas, because the
 * reducer is at its length ceiling and this is the part that can stand alone:
 * the receipt describes the transfer, this describes the result, and nothing
 * else in the reducer needs to know about it.
 *
 * Shape mirrors `ToolOutcome` in `core/tool-outcome.types`. Bounds are here
 * because an event payload is untrusted at the boundary even when this build
 * produced it — a resumed journal may carry events an older build wrote.
 */
export const outcomePayloadSchema = z
  .object({
    kind: z.enum(['count', 'code', 'reason', 'none']),
    label: z.string().max(80),
    value: z.number().int(),
    reason: z.string().max(200),
  })
  .strict();
