import { z } from 'zod';

import { notesForReader, postNote } from '../core/agent-board';
import { MAX_NOTE_LENGTH } from '../core/agent-board.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { AgentBoardPort } from './agent-board-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const postSchema = z.object({
  kind: z.enum(['finding', 'claim', 'warning', 'done']),
  text: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
});

const readSchema = z.object({
  since: z.number().int().nonnegative().max(1_000_000).default(0),
});

export const agentBoardToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.board',
  version: '2.0.0',
  description:
    'A shared note board for the agents working on this graph. post takes kind — finding, ' +
    'claim, warning, or done — and text; claim before you start on a seam another agent may ' +
    'touch, warning when you find something that changes their work. read takes since, the ' +
    'highest sequence you have already seen, and returns only newer notes from OTHER agents. ' +
    'Your quota is twenty notes: post what changes what someone else does, not what you did.',
  operations: ['post', 'read'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.board,
};

/**
 * Agent-to-agent messaging, bounded so it cannot become the run.
 *
 * Steering was parent to child only: a coordinator could tell an agent
 * something, and an agent could tell nobody. Two agents editing adjacent code
 * could not warn each other, and the only way one learned what another found
 * was for both to finish and the parent to read both reports.
 *
 * The caller's task id comes from the port, never from the arguments. An agent
 * that could name itself could post as another agent, and a warning attributed
 * to the security reviewer carries weight the poster did not earn.
 */
export class AgentBoardToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly port: AgentBoardPort) {}

  execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== agentBoardToolDefinition.name) {
      throw new Error('Unknown board tool');
    }
    if (invocation.operation === 'post') {
      return Promise.resolve(this.post(invocation.arguments));
    }
    if (invocation.operation === 'read') {
      return Promise.resolve(this.read(invocation.arguments));
    }
    throw new Error('Unknown board operation');
  }

  private post(args: unknown): RuntimeToolExecutionOutput {
    const { kind, text } = postSchema.parse(args);
    const result = postNote(this.port.read(), this.port.callerTaskId(), kind, text);
    if (!result.posted) {
      // Reported, not thrown. A full quota is a fact about how much this agent
      // has already said, and failing the call would end a run over a note.
      return { structured: { posted: false, reason: result.reason } };
    }
    this.port.write(result.board);
    return { structured: { posted: true, sequence: result.sequence } };
  }

  private read(args: unknown): RuntimeToolExecutionOutput {
    const { since } = readSchema.parse(args);
    const notes = notesForReader(this.port.read(), this.port.callerTaskId(), since);
    return {
      structured: {
        notes: notes.map((note) => ({
          from: note.taskId,
          kind: note.kind,
          text: note.text,
          sequence: note.sequence,
        })),
        latest: notes.at(-1)?.sequence ?? since,
      },
    };
  }
}
