import { z } from 'zod';

import {
  pairedDevicePageSchema,
  routineSchema,
  type IntegrationRequester,
  type PairedDevice,
  type Routine,
} from './integration-contracts';

import type { PromptRoutineInput, RoutineInput, RoutineStatus } from '../core/routine.types';

const ROUTINES_PATH = '/agent/scheduled-commands';

/**
 * Cloud routines: agent-service scheduled commands.
 *
 * The server owns the schedule, so a routine keeps its cadence while VS Code
 * is closed; it fires on the paired device the routine names, and only while
 * that device holds a connected agent session. Nothing here runs anything.
 */
export const routineClient = {
  list(request: IntegrationRequester): Promise<Routine[]> {
    return request(ROUTINES_PATH, z.array(routineSchema));
  },

  async devices(request: IntegrationRequester): Promise<PairedDevice[]> {
    const page = await request('/agent/devices?status=ACTIVE&pageSize=100', pairedDevicePageSchema);
    return page.data;
  },

  create(request: IntegrationRequester, input: RoutineInput): Promise<Routine> {
    return request(ROUTINES_PATH, routineSchema, {
      method: 'POST',
      body: {
        deviceId: input.deviceId,
        name: input.name,
        command: input.command,
        intervalMinutes: input.intervalMinutes,
      },
    });
  },

  /** F099: a prompt routine; it runs on an online runner carrying every label. */
  createPrompt(request: IntegrationRequester, input: PromptRoutineInput): Promise<Routine> {
    return request(ROUTINES_PATH, routineSchema, {
      method: 'POST',
      body: {
        kind: 'PROMPT',
        name: input.name,
        prompt: input.prompt,
        runnerLabels: input.runnerLabels,
        intervalMinutes: input.intervalMinutes,
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.repoRef === undefined ? {} : { repoRef: input.repoRef }),
      },
    });
  },

  setStatus(request: IntegrationRequester, id: string, status: RoutineStatus): Promise<Routine> {
    return request(`${ROUTINES_PATH}/${encodeURIComponent(id)}/status`, routineSchema, {
      method: 'PATCH',
      body: { status },
    });
  },

  async remove(request: IntegrationRequester, id: string): Promise<void> {
    await request(`${ROUTINES_PATH}/${encodeURIComponent(id)}`, z.unknown(), {
      method: 'DELETE',
    });
  },
};
