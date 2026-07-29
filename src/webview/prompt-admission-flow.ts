interface PromptAdmissionFlow<Admission> {
  bindRequest(sessionId: string): boolean;
  captureAdmission(threadId?: string): Admission;
  dispatch(admission: Admission, sessionId: string): Promise<void>;
  resolveSession(): Promise<string>;
  threadId: string | undefined;
  titleSession(sessionId: string): Promise<void>;
}

export async function runPromptAdmissionFlow<Admission>(
  flow: PromptAdmissionFlow<Admission>,
): Promise<boolean> {
  const admission = flow.captureAdmission(flow.threadId);
  const sessionId = await flow.resolveSession();
  if (!flow.bindRequest(sessionId)) {
    return false;
  }
  await flow.titleSession(sessionId);
  await flow.dispatch(admission, sessionId);
  return true;
}
