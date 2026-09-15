import { mergeDeliveredArtifacts } from '../core/delivered-artifact';

import type { DeliveredArtifact } from '../core/delivered-artifact';

interface ArtifactStatePort {
  update(patch: { artifacts: readonly DeliveredArtifact[] }): void;
}

/**
 * Holds the artifacts this session produced for the user, newest first.
 *
 * Writing one is not delivering it. The artifact operation has carried
 * provenance, a hash and a size since the transaction model was built, and
 * every one of them landed somewhere the user was never shown — the parity
 * audit's "present is not wired" defect, in the one place where being unwired
 * means the user never gets the file they asked for. Publishing into the
 * extension state is what makes the Artifacts view able to open it.
 */
export class ArtifactDeliveryService {
  private artifacts: readonly DeliveredArtifact[] = [];

  constructor(private readonly state: ArtifactStatePort) {}

  record(delivered: readonly DeliveredArtifact[]): readonly DeliveredArtifact[] {
    if (delivered.length === 0) return this.artifacts;
    this.artifacts = mergeDeliveredArtifacts(this.artifacts, delivered);
    this.state.update({ artifacts: this.artifacts });
    return this.artifacts;
  }

  current(): readonly DeliveredArtifact[] {
    return this.artifacts;
  }

  /**
   * Cleared on an account or workspace boundary, like every other run-scoped
   * value: the paths name files in a tree that is no longer open.
   */
  clear(): void {
    this.artifacts = [];
    this.state.update({ artifacts: this.artifacts });
  }
}
