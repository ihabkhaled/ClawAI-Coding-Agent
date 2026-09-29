import { decideCommandSandbox } from '../core/command-sandbox';
import { ConfigurationService } from '../services/configuration-service';

import { probeCommandSandboxHost, realPath } from './command-sandbox-host-probe';

import type { CommandSandboxBinding, CommandSandboxPort } from './command-launch-plan.types';
import type { CommandSandboxHost } from '../core/command-sandbox.types';

export class VscodeCommandSandbox implements CommandSandboxPort {
  private host: CommandSandboxHost | undefined;

  constructor(
    private readonly probe: () => CommandSandboxHost = probeCommandSandboxHost,
    private readonly configuration: ConfigurationService = new ConfigurationService(),
  ) {}

  /** Settings are read per command so a change applies to the next run. */
  bind(workspaceRoot: string): CommandSandboxBinding {
    const settings = this.configuration.commandSandbox();
    this.host ??= this.probe();
    return {
      plan: { settings, host: this.host, decision: decideCommandSandbox(settings, this.host) },
      workspaceRoot: realPath(workspaceRoot),
    };
  }
}
