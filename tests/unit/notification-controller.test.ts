import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  window: { state: { focused: false } },
}));

import { ExtensionState } from '../../src/core/extension-state';
import { NotificationController } from '../../src/views/notification-controller';

import type { ExtensionSnapshot } from '../../src/core/extension-state';
import type { UserNotificationInput } from '../../src/core/user-notification';

function fakeNotifications() {
  return { notify: vi.fn<(input: UserNotificationInput) => void>() };
}

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    approvalRequest: undefined,
    questionRequest: undefined,
    busy: false,
    lastError: undefined,
    ...overrides,
  } as ExtensionSnapshot;
}

describe('NotificationController', () => {
  let notifications: ReturnType<typeof fakeNotifications>;

  beforeEach(() => {
    notifications = fakeNotifications();
  });

  it('notifies when an approval is raised while the user is away', () => {
    const state = new ExtensionState(snapshot());
    new NotificationController(state, notifications, () => false);

    state.update({
      approvalRequest: { id: 'approval-1', kind: 'command', title: 'Run', message: 'npm test' },
    });

    expect(notifications.notify).toHaveBeenCalledWith({
      message: 'ClawAI is waiting for your approval.',
      kind: 'warning',
    });
  });

  it('stays quiet while the window has focus', () => {
    const state = new ExtensionState(snapshot());
    new NotificationController(state, notifications, () => true);

    state.update({
      approvalRequest: { id: 'approval-1', kind: 'command', title: 'Run', message: 'npm test' },
    });

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('notifies once for a run that finishes, not for every later change', () => {
    const state = new ExtensionState(snapshot({ busy: true }));
    new NotificationController(state, notifications, () => false);

    state.update({ busy: false });
    state.update({ models: [] });

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith({
      message: 'ClawAI finished the request.',
      kind: 'info',
    });
  });

  it('reports a failure as a warning', () => {
    const state = new ExtensionState(snapshot({ busy: true }));
    new NotificationController(state, notifications, () => false);

    state.update({ busy: false, lastError: 'Provider unavailable' });

    expect(notifications.notify).toHaveBeenCalledWith({
      message: 'The ClawAI request failed.',
      kind: 'warning',
    });
  });

  it('stops observing once disposed', () => {
    const state = new ExtensionState(snapshot({ busy: true }));
    const controller = new NotificationController(state, notifications, () => false);

    controller.dispose();
    state.update({ busy: false });

    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
