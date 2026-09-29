import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { textDocuments: [], workspaceFolders: [] },
}));

import { VscodeFileTransactionAdapter } from '../../src/infrastructure/vscode-file-transaction-adapter';

/**
 * `forget` releases what `apply` kept so a later rollback could save the
 * documents it edited. Before it existed only a rollback released that entry,
 * so every transaction that simply succeeded was held for the whole session.
 *
 * Which transaction is forgotten, and when, is the service's decision and is
 * tested there (file-transaction-undo-stack). This file holds the adapter to
 * the one property the service relies on.
 */
describe('VscodeFileTransactionAdapter.forget', () => {
  it('accepts a transaction it never kept', () => {
    // The service forgets every transaction leaving the undo stack, including
    // ones whose apply touched no open document and so kept nothing.
    const adapter = new VscodeFileTransactionAdapter();

    expect(() => {
      adapter.forget('never-applied');
    }).not.toThrow();
  });

  it('can forget the same transaction twice', () => {
    // Clearing the history after a transaction already fell off the stack
    // must not fail on the second release.
    const adapter = new VscodeFileTransactionAdapter();
    adapter.forget('transaction-a');

    expect(() => {
      adapter.forget('transaction-a');
    }).not.toThrow();
  });
});
