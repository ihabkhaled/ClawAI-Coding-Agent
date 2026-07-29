export function parallelResponse() {
  return {
    completedCount: 2,
    failedCount: 0,
    judgeEnabled: false,
    judgeModel: null,
    messageId: 'message-1',
    prompt: 'Compare these',
    responses: [
      {
        content: 'First answer',
        errorMessage: null,
        inputTokens: 10,
        latencyMs: 20,
        model: 'model-a',
        outputTokens: 5,
        provider: 'PROVIDER_A',
        status: 'completed',
      },
      {
        content: 'Second answer',
        errorMessage: null,
        inputTokens: null,
        latencyMs: 30,
        model: 'model-b',
        outputTokens: null,
        provider: 'PROVIDER_B',
        status: 'completed',
      },
    ],
    threadId: 'thread-from-compare',
    totalLatencyMs: 50,
  };
}
