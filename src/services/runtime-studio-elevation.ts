import * as vscode from 'vscode';

import { VscodeElevationVerificationAdapter } from '../infrastructure/elevation-tool-executor';
import { PackagedNativeElevationAdapter } from '../infrastructure/native-elevation-adapter';

import { ElevationBrokerService } from './elevation-broker-service';

import type { ApprovalBroker } from '../core/approval-broker';

/**
 * The administrator-consent broker, with the approval it must show first.
 *
 * Elevation is the one effect that cannot be undone by anything this extension
 * controls, so the approval is not a formality around it — it is the feature.
 * The dialog names the exact command, marks the risk R4 and says plainly that
 * the operating system will ask again, because a person clicking through a
 * vague prompt has not consented to anything in particular.
 */
export function elevationBroker(
  extensionUri: vscode.Uri,
  approvals: ApprovalBroker,
): ElevationBrokerService {
  return new ElevationBrokerService(
    new PackagedNativeElevationAdapter(
      vscode.Uri.joinPath(extensionUri, 'resources', 'elevation-helper.mjs').fsPath,
    ),
    {
      confirm: (recipe, signal) =>
        approvals.request(
          {
            kind: 'runtimeEffect',
            title: vscode.l10n.t('Approve administrator operation'),
            message: recipe.explanation,
            effect: {
              purpose: recipe.recipeId,
              target: `${recipe.command.executable} ${recipe.command.arguments.join(' ')}`,
              risk: 'R4',
              sideEffects: [
                vscode.l10n.t('Your operating system will show native administrator consent.'),
              ],
              reversibility: 'irreversible',
            },
          },
          signal,
        ),
    },
    new VscodeElevationVerificationAdapter(),
  );
}
