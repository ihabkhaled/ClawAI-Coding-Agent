import { randomUUID } from 'node:crypto';

import { promptQuestion, promptWorkflowRequest } from './agent-coordinator-prompts';
import { generationConcurrencyKey, type GenerationScheduler } from './generation-scheduler';

import type { ChatPromptInput, RequestAdmission } from './agent-coordinator.types';
import type { AgentWorkflowService } from './agent-workflow-service';
import type { PromptExecutionService } from './prompt-execution-service';
import type { WorkflowKind } from './workflow-service';
import type { ContextMode } from '../core/context-mode';

export class AgentCoordinatorWorkflowActions {
  constructor(
    private readonly captureAdmission: () => RequestAdmission,
    private readonly openChat: () => Promise<string | undefined>,
    private readonly send: (input: ChatPromptInput) => Promise<void>,
    private readonly promptExecutions: PromptExecutionService,
    private readonly agentWorkflows: AgentWorkflowService,
    private readonly generations: GenerationScheduler,
  ) {}

  async ask(contextMode: ContextMode): Promise<void> {
    const content = await promptQuestion();
    if (content === null) return;
    const sessionId = await this.openChat();
    await this.send({
      admission: this.captureAdmission(),
      content,
      contextMode,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  }

  async runReadOnly(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    const request = await promptWorkflowRequest(kind);
    if (request !== null) await this.promptExecutions.runReadOnly(kind, contextMode, request);
  }

  async runEdit(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    const request = await promptWorkflowRequest(kind);
    if (request === null) return;
    const requestId = randomUUID();
    const queuedInput = await this.agentWorkflows.snapshot({ content: request, contextMode, kind });
    const sessionId = await this.agentWorkflows.prepare(queuedInput, requestId);
    await this.generations.enqueue(
      requestId,
      'agent',
      request,
      (signal) => this.agentWorkflows.execute(queuedInput, signal, requestId),
      {
        concurrencyKey: generationConcurrencyKey(sessionId, queuedInput.admission.threadId),
        modelLabel: queuedInput.modelLabel,
      },
    );
  }
}
