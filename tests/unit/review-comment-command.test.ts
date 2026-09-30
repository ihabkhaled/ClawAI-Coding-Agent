import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  openExternal: vi.fn(),
  activeTextEditor: undefined as
    { document: { getText: () => string }; selection: object } | undefined,
  writableConnectors: vi.fn(),
  draft: vi.fn(),
  approve: vi.fn(),
}));

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: string[]) =>
      message.replace(/\{(\d)\}/gu, (_m, index: string) => args[Number(index)] ?? ''),
  },
  window: {
    showInputBox: host.showInputBox,
    showQuickPick: host.showQuickPick,
    showErrorMessage: host.showErrorMessage,
    showInformationMessage: host.showInformationMessage,
    showWarningMessage: host.showWarningMessage,
    get activeTextEditor() {
      return host.activeTextEditor;
    },
  },
  env: { openExternal: host.openExternal },
  Uri: { parse: (value: string) => ({ parsed: value }) },
}));
vi.mock('../../src/backend/review-action-client', () => ({
  reviewActionClient: {
    writableConnectors: host.writableConnectors,
    draft: host.draft,
    approve: host.approve,
  },
}));

const { postReviewComment } = await import('../../src/services/review-comment-command');

const PR = 'https://github.com/acme/app/pull/7';
const deps = { request: () => vi.fn(), connected: () => true };
const connector = { id: 'c1', name: 'Work GitHub' };

function happyPath(): void {
  host.showInputBox.mockResolvedValueOnce(PR).mockResolvedValueOnce('Looks good');
  host.writableConnectors.mockResolvedValue([connector]);
  host.showWarningMessage.mockResolvedValue('Post comment');
  host.draft.mockResolvedValue({ id: 'a1' });
}

beforeEach(() => {
  vi.resetAllMocks();
  host.activeTextEditor = undefined;
});

describe('postReviewComment', () => {
  it('asks the person to connect and does nothing else when offline', async () => {
    await postReviewComment({ ...deps, connected: () => false });
    expect(host.showInformationMessage).toHaveBeenCalledWith(
      'Connect to ClawAI to post review comments.',
    );
    expect(host.showInputBox).not.toHaveBeenCalled();
  });

  it('stops quietly when the link prompt is dismissed', async () => {
    host.showInputBox.mockResolvedValueOnce(undefined);
    await postReviewComment(deps);
    expect(host.writableConnectors).not.toHaveBeenCalled();
    expect(host.showErrorMessage).not.toHaveBeenCalled();
  });

  it('refuses http and non-review links before any backend call', async () => {
    host.showInputBox.mockResolvedValueOnce('http://github.com/acme/app/pull/7');
    await postReviewComment(deps);
    expect(host.showErrorMessage).toHaveBeenLastCalledWith(
      'Only https:// review links are accepted.',
    );
    host.showInputBox.mockResolvedValueOnce('https://example.com/nothing');
    await postReviewComment(deps);
    expect(host.showErrorMessage).toHaveBeenLastCalledWith(
      'Paste a GitHub pull request or GitLab merge request link.',
    );
    expect(host.writableConnectors).not.toHaveBeenCalled();
  });

  it('explains when no connector can write', async () => {
    host.showInputBox.mockResolvedValueOnce(PR);
    host.writableConnectors.mockResolvedValue([]);
    await postReviewComment(deps);
    expect(host.showErrorMessage).toHaveBeenCalledWith(
      'No GITHUB connector with write access. Connect one in ClawAI Workspace.',
    );
    expect(host.draft).not.toHaveBeenCalled();
  });

  it('drafts and approves only after the modal confirmation, then offers the link', async () => {
    happyPath();
    host.approve.mockResolvedValue({ status: 'EXECUTED', result: { url: 'https://gh/c/1' } });
    host.showInformationMessage.mockResolvedValue('Open');
    await postReviewComment(deps);
    expect(host.showWarningMessage).toHaveBeenCalledWith(
      'Post this comment on acme/app#7 as Work GitHub?',
      { modal: true, detail: 'Looks good' },
      'Post comment',
    );
    expect(host.draft.mock.calls[0]?.[1]).toBe('c1');
    expect(host.draft.mock.calls[0]?.[2]).toMatchObject({ actionType: 'COMMENT_PR' });
    expect(host.approve.mock.calls[0]?.[1]).toBe('a1');
    expect(host.openExternal).toHaveBeenCalledWith({ parsed: 'https://gh/c/1' });
  });

  it('posts nothing when the confirmation is declined', async () => {
    happyPath();
    host.showWarningMessage.mockResolvedValue(undefined);
    await postReviewComment(deps);
    expect(host.draft).not.toHaveBeenCalled();
    expect(host.approve).not.toHaveBeenCalled();
  });

  it('rejects an empty comment without drafting', async () => {
    host.showInputBox.mockResolvedValueOnce(PR).mockResolvedValueOnce('   ');
    host.writableConnectors.mockResolvedValue([connector]);
    await postReviewComment(deps);
    expect(host.showErrorMessage).toHaveBeenCalledWith(
      'The comment must be 1 to 10000 characters.',
    );
    expect(host.showWarningMessage).not.toHaveBeenCalled();
  });

  it('stops when the comment prompt is dismissed', async () => {
    host.showInputBox.mockResolvedValueOnce(PR).mockResolvedValueOnce(undefined);
    host.writableConnectors.mockResolvedValue([connector]);
    await postReviewComment(deps);
    expect(host.showWarningMessage).not.toHaveBeenCalled();
  });

  it('lets the person choose among several connectors, and stops if they cancel', async () => {
    host.showInputBox.mockResolvedValueOnce(PR);
    host.writableConnectors.mockResolvedValue([connector, { id: 'c2', name: 'Other' }]);
    host.showQuickPick.mockResolvedValueOnce(undefined);
    await postReviewComment(deps);
    expect(host.showQuickPick.mock.calls[0]?.[0]).toHaveLength(2);
    expect(host.showErrorMessage).toHaveBeenCalledOnce();
    expect(host.draft).not.toHaveBeenCalled();
  });

  it('prefills the comment with the current selection', async () => {
    host.activeTextEditor = { document: { getText: () => 'picked code' }, selection: {} };
    host.showInputBox.mockResolvedValueOnce(PR).mockResolvedValueOnce(undefined);
    host.writableConnectors.mockResolvedValue([connector]);
    await postReviewComment(deps);
    expect(host.showInputBox.mock.calls[1]?.[0]).toMatchObject({ value: 'picked code' });
  });

  it('reports why a comment was not executed', async () => {
    happyPath();
    host.approve.mockResolvedValue({ status: 'FAILED', errorMessage: 'token revoked' });
    await postReviewComment(deps);
    expect(host.showErrorMessage).toHaveBeenCalledWith('The comment was not posted: token revoked');
    expect(host.openExternal).not.toHaveBeenCalled();
  });

  it('treats an executed action with no url as not posted', async () => {
    happyPath();
    host.approve.mockResolvedValue({ status: 'EXECUTED', result: {} });
    await postReviewComment(deps);
    expect(host.showErrorMessage).toHaveBeenCalledWith('The comment was not posted: EXECUTED');
  });

  it('turns a backend failure into a message instead of a rejection', async () => {
    host.showInputBox.mockResolvedValueOnce(PR);
    host.writableConnectors.mockRejectedValue(new Error('503 from workspace'));
    await expect(postReviewComment(deps)).resolves.toBeUndefined();
    expect(host.showErrorMessage).toHaveBeenCalledWith(
      'The comment was not posted: 503 from workspace',
    );
  });
});
