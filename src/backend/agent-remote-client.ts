import { z } from 'zod';

import type { RemoteRequester } from './remote-session-client';

/**
 * The seam `BackendClient.agentKeyRequest` provides: agent-runtime routes that
 * authenticate with an agent session key instead of the signed-in user.
 */
export type AgentKeyRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  sessionKey: string | null,
  options?: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
) => Promise<T>;

export const remoteCommandSchema = z
  .object({
    id: z.string().min(1).max(200),
    command: z.string().max(4_096),
    workingDir: z.string().max(1_024).nullable().optional(),
  })
  .loose();

export type RemoteCommand = z.infer<typeof remoteCommandSchema>;

const registeredSessionSchema = z
  .object({ id: z.string().min(1), sessionKey: z.string().min(1) })
  .loose()
  .transform((value) => ({ sessionId: value.id, sessionKey: value.sessionKey }));

const registeredRunnerSchema = z
  .object({ runnerId: z.string().min(1), sessionKey: z.string().min(1) })
  .loose()
  .transform((value) => ({ sessionId: value.runnerId, sessionKey: value.sessionKey }));

const acknowledgementSchema = z.unknown();

export interface AgentHostIdentity {
  readonly hostname: string;
  readonly platform: string;
  readonly agentVersion: string;
}

export interface AgentRegistration {
  readonly sessionId: string;
  readonly sessionKey: string;
}

export interface RemoteCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * F096 / F100 client half of the agent-service command endpoints. Nothing
 * here decides whether a command runs; that is `remote-command-loop`.
 */
export const agentRemoteClient = {
  /** F096: this editor as a remote-control target, under the signed-in user. */
  registerSession(request: RemoteRequester, host: AgentHostIdentity): Promise<AgentRegistration> {
    return request('/agent/sessions', registeredSessionSchema, {
      method: 'POST',
      body: { ...host, metadata: { kind: 'editor' } },
    });
  },

  /** F100: this machine as a self-hosted runner. */
  registerRunner(
    request: RemoteRequester,
    host: AgentHostIdentity,
    runner: { readonly name: string; readonly labels: readonly string[] },
  ): Promise<AgentRegistration> {
    return request('/agent/runners', registeredRunnerSchema, {
      method: 'POST',
      body: { ...host, name: runner.name, labels: runner.labels },
    });
  },

  /** Approved commands for a remote-control session (up to five, each now EXECUTING). */
  pending(
    request: AgentKeyRequester,
    sessionKey: string,
    signal?: AbortSignal,
  ): Promise<RemoteCommand[]> {
    return request('/agent/commands/pending', z.array(remoteCommandSchema), sessionKey, {
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    });
  },

  /** One approved job for a runner, or none. */
  claim(
    request: AgentKeyRequester,
    sessionKey: string,
    signal?: AbortSignal,
  ): Promise<RemoteCommand[]> {
    return request('/agent/runners/claim', z.array(remoteCommandSchema), sessionKey, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
  },

  async heartbeat(request: AgentKeyRequester, registration: AgentRegistration): Promise<void> {
    await request(
      `/agent/sessions/${encodeURIComponent(registration.sessionId)}/heartbeat`,
      acknowledgementSchema,
      registration.sessionKey,
      { method: 'POST' },
    );
  },

  async complete(
    request: AgentKeyRequester,
    sessionKey: string,
    commandId: string,
    result: RemoteCommandResult,
  ): Promise<void> {
    await request(
      `/agent/commands/${encodeURIComponent(commandId)}/complete`,
      acknowledgementSchema,
      sessionKey,
      { method: 'POST', body: result },
    );
  },
};
