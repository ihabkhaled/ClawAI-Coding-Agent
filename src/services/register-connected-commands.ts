import { registerIntegrations } from './integration-registration';
import { registerPluginCommands } from './register-plugin-commands';
import { registerRemoteControlCommands } from './remote-control-commands';

import type { ConnectedCommandDependencies } from './register-connected-commands.types';

/**
 * Remote control, product integrations and plugins, in the order `activate`
 * registered them. One call from the entry point, so it grows by a line rather
 * than by a feature.
 */
export function registerConnectedCommands(deps: ConnectedCommandDependencies): void {
  const { context, state, backend, logger, workspaceScope, version } = deps;
  context.subscriptions.push(
    ...registerRemoteControlCommands({ backend, secrets: context.secrets, logger, version }),
  );
  registerIntegrations(context, state, backend, (message) => {
    logger.warn(message);
  });
  registerPluginCommands(
    context,
    workspaceScope,
    () => state.snapshot.organizationPolicy?.allowedPluginMarketplaces,
    undefined,
    () => state.snapshot.organizationPolicy?.trustedPluginPublishers,
  );
}
