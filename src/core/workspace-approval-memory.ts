export interface WorkspaceApprovalStatePort {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

const ROUTINE_ACCESS_APPROVAL_KEY = 'clawAI.routineAccessApproval';

export class WorkspaceApprovalMemory {
  constructor(private readonly state: WorkspaceApprovalStatePort) {}

  hasRoutineAccess(): boolean {
    return this.state.get(ROUTINE_ACCESS_APPROVAL_KEY) === true;
  }

  async rememberRoutineAccess(): Promise<void> {
    await this.state.update(ROUTINE_ACCESS_APPROVAL_KEY, true);
  }
}
