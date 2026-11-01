/** Documents the backend's stateless extractor turns into text. */
export const DOCUMENT_READ_FORMATS = ['pdf', 'docx', 'xlsx', 'pptx', 'rtf'] as const;

/** How each format is named to a person and to the model. */
export const DOCUMENT_FORMAT_LABELS: Record<(typeof DOCUMENT_READ_FORMATS)[number], string> = {
  pdf: 'PDF',
  docx: 'Word document',
  xlsx: 'Excel workbook',
  pptx: 'PowerPoint deck',
  rtf: 'RTF document',
};

/**
 * Image extensions `vision.describe` accepts (png, jpeg, webp, up to 8 MB; mirrors
 * VISION_EXTENSION_TYPES in src/sdk, which core must not import).
 */
export const VISION_DESCRIBE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

/** Files that carry no text a read can return. SVG is left out: it is text. */
export const UNREADABLE_MEDIA_EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'avif'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mpeg', 'mpg', 'm4v'],
} as const;
