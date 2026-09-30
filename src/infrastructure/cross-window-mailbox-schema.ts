import { z } from 'zod';

import { MAX_WINDOW_MESSAGE_LENGTH } from '../core/cross-window-mailbox.constants';

export const windowMessageSchema = z.object({
  id: z.string().min(1).max(80),
  fromWindowId: z.string().min(1).max(64),
  fromWorkspace: z.string().max(200),
  fromAddress: z.string().max(200),
  text: z.string().max(MAX_WINDOW_MESSAGE_LENGTH),
  createdAt: z.number().int().nonnegative(),
});

export const heartbeatSchema = z.object({
  windowId: z.string().min(1).max(64),
  workspaceName: z.string().max(200),
  at: z.number().int().nonnegative(),
});
