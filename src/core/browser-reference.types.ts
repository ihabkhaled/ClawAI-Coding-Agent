/** What was read from the agent's browser page, before bounding and redaction. */
export interface BrowserPageCapture {
  readonly url: string;
  readonly title: string;
  readonly selectedText: string;
  readonly visibleText: string;
  /** PNG bytes of the visible viewport, when the user asked for one. */
  readonly screenshot?: Uint8Array;
}

/** A screenshot ready for the composer's own attachment path. */
export interface BrowserScreenshotAttachment {
  readonly filename: string;
  readonly mimeType: 'image/png';
  readonly content: string;
  readonly sizeBytes: number;
}
