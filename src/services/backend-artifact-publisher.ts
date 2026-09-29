import { publishArtifact } from '../backend/artifact-client';

import type { ArtifactPublisherPort } from '../backend/artifact-client';
import type { BackendClient } from '../backend/backend-client';

/** Artifact publishing bound to whichever backend client is current. */
export function backendArtifactPublisher(backend: () => BackendClient): ArtifactPublisherPort {
  return {
    publish: (upload, signal) => publishArtifact(backend().artifactPost, upload, signal),
  };
}
