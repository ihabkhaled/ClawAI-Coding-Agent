import * as vscode from 'vscode';

import { resolveZeroRetention } from '../core/zero-retention';
import {
  zeroRetentionPosture,
  type ZeroRetentionPostureStore,
} from '../core/zero-retention-posture';
import { ZERO_RETENTION_SETTING } from '../core/zero-retention.constants';

import { ConfigurationService } from './configuration-service';

import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';

function organizationRetentionDays(snapshot: ExtensionSnapshot): number | undefined {
  return snapshot.organizationPolicy?.maximumRetentionDays;
}

/**
 * Keeps the process-wide zero-retention posture in step with its two inputs:
 * the user's setting and the organization's retention ceiling.
 *
 * Recomputed on either change rather than cached, because an organization
 * policy arrives with the account refresh, after activation, and a posture
 * computed only once would miss the organization forcing it on.
 */
export class ZeroRetentionController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly unsubscribe: () => void;
  private retentionDays: number | undefined;

  constructor(
    state: ExtensionState,
    private readonly store: ZeroRetentionPostureStore = zeroRetentionPosture,
    private readonly configuration: ConfigurationService = new ConfigurationService(),
  ) {
    this.retentionDays = organizationRetentionDays(state.snapshot);
    this.apply();
    this.unsubscribe = state.subscribe((snapshot) => {
      const days = organizationRetentionDays(snapshot);
      if (days === this.retentionDays) return;
      this.retentionDays = days;
      this.apply();
    });
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`clawAI.${ZERO_RETENTION_SETTING}`)) this.apply();
      }),
    );
  }

  dispose(): void {
    this.unsubscribe();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private apply(): void {
    this.store.set(
      resolveZeroRetention({
        setting: this.configuration.zeroDataRetention(),
        organizationRetentionDays: this.retentionDays,
      }),
    );
  }
}
