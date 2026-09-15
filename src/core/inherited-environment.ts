import { INHERITED_ENVIRONMENT_KEYS } from './inherited-environment.constants';

/**
 * The environment a spawned command may see, built from nothing.
 *
 * Starting empty and adding what is needed is the whole point. A child that
 * inherits the parent's environment inherits every secret in it, and the
 * process running an agent is exactly the process most likely to be holding
 * one — an API key, a session password, a CI token. The command the model
 * chooses then only has to print it.
 */
export function inheritedEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  additions: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(additions)) environment[key] = value;
  return environment;
}
