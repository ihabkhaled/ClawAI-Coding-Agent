export interface RunBoundaryQueue {
  cancelAll(): unknown;
}

export function cancelRunBoundary(
  generations: RunBoundaryQueue,
  approvals: RunBoundaryQueue,
): void {
  generations.cancelAll();
  approvals.cancelAll();
}

export async function transitionRunBoundary(
  generations: RunBoundaryQueue,
  approvals: RunBoundaryQueue,
  transition: () => void,
  cancelRemote: () => Promise<void>,
): Promise<void> {
  cancelRunBoundary(generations, approvals);
  transition();
  await cancelRemote();
}
