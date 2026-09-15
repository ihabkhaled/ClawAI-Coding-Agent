/** What a drop should do, once the modifier and the payload are both known. */
export type DropIntent = 'attach' | 'mention' | 'path-only' | 'ignore';

export interface DropPayload {
  /** The `text/uri-list` the editor or explorer put on the drag. */
  readonly uriList: string;
  /** True when the drag carried real file data rather than references. */
  readonly hasFiles: boolean;
  /** Shift was held, which asks for the reference rather than the content. */
  readonly shiftKey: boolean;
}

export interface DropResolution {
  readonly intent: DropIntent;
  /** Workspace-relative paths, in the order they were dropped. */
  readonly paths: readonly string[];
  /** URIs that were refused, so the panel can say why nothing happened. */
  readonly refused: readonly string[];
}
