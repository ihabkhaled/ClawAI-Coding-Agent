export type ArtifactBlockReason = 'too-large' | 'binary' | 'secret-remains';

export type PreparedArtifact =
  | {
      readonly status: 'ready';
      readonly filename: string;
      readonly mimeType: string;
      /** The scrubbed text. This, not the file on disk, is what would be uploaded. */
      readonly content: string;
      readonly sha256: string;
      readonly bytes: number;
      /** Lines the scrub changed. Zero means the file went through untouched. */
      readonly redactedLines: number;
      readonly preview: string;
      readonly previewTruncated: boolean;
    }
  | {
      readonly status: 'blocked';
      readonly reason: ArtifactBlockReason;
      readonly detail: string;
    };
