/**
 * A model that could not answer: out of credit, refused, or failed.
 *
 * Kept apart from a usage mistake so the next candidate model can be tried,
 * while a bad image or a bad question stops at once.
 */
export class VisionModelError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VisionModelError';
  }
}
