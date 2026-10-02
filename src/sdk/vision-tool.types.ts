/** An image type this agent accepts. */
export type VisionMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

/** An image that passed every check and is ready to upload. */
export interface VisionImage {
  readonly bytes: Buffer;
  readonly mimeType: VisionMimeType;
  /** A plain file name, never a path. */
  readonly filename: string;
  /** True when metadata (text, EXIF, comments) was removed from the bytes. */
  readonly stripped: boolean;
}

/** One connector model, as far as picking a vision model needs it. */
export interface VisionCatalogModel {
  readonly provider: string;
  readonly modelKey: string;
  readonly supportsVision: boolean;
  /** Input price per million tokens, or undefined when the catalog has none. */
  readonly inputUsdPerMillion?: number | undefined;
}

/** What one vision question needs. */
export interface VisionAskInput {
  readonly image: VisionImage;
  readonly question: string;
  readonly model: VisionCatalogModel;
}

/**
 * The backend, as the vision tool sees it. Substituted in tests, and by a
 * caller speaking to a different backend.
 */
export interface VisionPort {
  /** The connector models the account may use. */
  readonly models: (signal?: AbortSignal) => Promise<readonly VisionCatalogModel[]>;
  /** One question about one image, answered in a throwaway thread. */
  readonly ask: (input: VisionAskInput, signal?: AbortSignal) => Promise<string>;
}

/** Turns the vision tool on; its presence in `AgentConfig.vision` is the opt-in. */
export interface AgentVisionOptions {
  /** `provider/model` or a bare model key. Default: the first suitable catalog model with vision. */
  readonly model?: string | undefined;
  /** Substituted in tests. */
  readonly port?: VisionPort | undefined;
}
