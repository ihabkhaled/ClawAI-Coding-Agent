export interface MediaTranscript {
  readonly text: string;
  readonly durationSeconds: number;
  readonly provider: string;
  readonly model?: string | undefined;
  readonly truncated: boolean;
}

export interface MediaTranscribeInput {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly mimeType?: string | undefined;
}

/** The one call the file tool needs to read audio or video. */
export interface MediaTranscribePort {
  transcribe(input: MediaTranscribeInput, signal?: AbortSignal): Promise<MediaTranscript>;
}
