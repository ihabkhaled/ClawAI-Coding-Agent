import { zeroRetentionBlockedFeature, zeroRetentionHeaders } from '../core/zero-retention';
import { zeroRetentionPosture } from '../core/zero-retention-posture';
import { ZERO_RETENTION_REFUSALS } from '../core/zero-retention.constants';

import { BackendRequestError } from './backend-errors';

import type {
  ZeroRetentionBlockedFeature,
  ZeroRetentionMethod,
  ZeroRetentionPosture,
} from '../core/zero-retention.types';

/**
 * A request refused on this machine because zero data retention is on.
 *
 * 403 and not retryable: retrying cannot change the answer, only turning zero
 * data retention off can. The message is English like every backend error;
 * `zeroRetentionRefusalMessage` gives the translated one from the feature.
 */
export class ZeroRetentionRefusedError extends BackendRequestError {
  constructor(readonly feature: ZeroRetentionBlockedFeature) {
    super(ZERO_RETENTION_REFUSALS[feature], 403, false);
    this.name = 'ZeroRetentionRefusedError';
  }
}

/**
 * The retention check every backend request passes through.
 *
 * Returns the headers that carry the posture, or throws before anything is
 * sent when the request's only purpose is to store content on the server.
 * Free of `vscode` so the headless client shares it.
 */
export function retentionRequestHeaders(
  method: ZeroRetentionMethod,
  path: string,
  posture: ZeroRetentionPosture = zeroRetentionPosture.current(),
): Record<string, string> {
  if (posture.active) {
    const feature = zeroRetentionBlockedFeature(method, path);
    if (feature !== undefined) throw new ZeroRetentionRefusedError(feature);
  }
  return zeroRetentionHeaders(posture);
}
