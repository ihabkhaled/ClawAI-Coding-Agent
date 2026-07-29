export interface WorkspaceApprovalStatePort {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

const ROUTINE_ACCESS_APPROVAL_KEY_PREFIX = 'clawAI.routineAccessApproval.v2';

export class WorkspaceApprovalMemory {
  constructor(
    private readonly state: WorkspaceApprovalStatePort,
    private readonly workspaceIdentity: () => string | undefined,
  ) {}

  hasRoutineAccess(): boolean {
    const key = this.key();
    return key !== undefined && this.state.get(key) === true;
  }

  async rememberRoutineAccess(): Promise<void> {
    const key = this.key();
    if (key !== undefined) {
      await this.state.update(key, true);
    }
  }

  private key(): string | undefined {
    const identity = this.workspaceIdentity();
    return identity === undefined
      ? undefined
      : `${ROUTINE_ACCESS_APPROVAL_KEY_PREFIX}.${identity}`;
  }
}
