/** What the status line reports the extension is doing, loudest first. */
export type StatusLineActivity =
  'awaiting-you' | 'connecting' | 'disconnected' | 'idle' | 'queued' | 'running';

/** Which model the next prompt goes to, or that routing decides. */
export type StatusLineModel = { automatic: true } | { automatic: false; name: string };
