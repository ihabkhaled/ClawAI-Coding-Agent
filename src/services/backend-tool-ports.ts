import { backendArtifactPublisher } from './backend-artifact-publisher';
import { backendPdfText } from './backend-pdf-text';
import { backendWebResearch } from './backend-web-research';

import type { ArtifactPublisherPort } from '../backend/artifact-client';
import type { BackendClient } from '../backend/backend-client';
import type { PdfTextPort } from '../backend/pdf-text-client';
import type { WebResearchPort } from '../backend/research-client';

/** The tool ports that talk to the backend on the agent's behalf. */
export interface BackendToolPorts {
  readonly research: WebResearchPort;
  readonly pdfText: PdfTextPort;
  readonly artifacts: ArtifactPublisherPort;
}

/**
 * Every backend-bound tool port, built in one place.
 *
 * Grouped out of the runtime studio, which is a composition root held to a
 * 500-line ceiling: each port used to cost it an import, a field and a
 * constructor line, and the PDF reader is what finally tipped it over. Each
 * port still reads the backend through the getter, so signing in again
 * reaches every one of them.
 */
export function backendToolPorts(backend: () => BackendClient): BackendToolPorts {
  return {
    research: backendWebResearch(backend),
    pdfText: backendPdfText(backend),
    artifacts: backendArtifactPublisher(backend),
  };
}
