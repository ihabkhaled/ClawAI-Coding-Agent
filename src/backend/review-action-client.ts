import {
  reviewConnectorPageSchema,
  workspaceActionSchema,
  type IntegrationRequester,
  type ReviewConnector,
  type WorkspaceAction,
} from './integration-contracts';

import type { ReviewActionDraft } from '../core/review-target.types';

const WRITABLE_LEVELS: readonly string[] = ['WRITE', 'ADMIN'];

/**
 * GitHub and GitLab review comments through workspace-service write actions.
 *
 * The extension never holds a GitHub or GitLab token: it drafts an action on
 * the person's own connector and approves it, and workspace-service spends the
 * stored token. Draft and approve are two calls so the server keeps the same
 * audit trail and approval record the web approval center writes.
 */
export const reviewActionClient = {
  async writableConnectors(
    request: IntegrationRequester,
    provider: 'GITHUB' | 'GITLAB',
  ): Promise<ReviewConnector[]> {
    const page = await request(
      `/workspace/connectors?provider=${provider}&pageSize=100`,
      reviewConnectorPageSchema,
    );
    return page.data.filter(
      (connector) =>
        connector.provider === provider && WRITABLE_LEVELS.includes(connector.permissionLevel),
    );
  },

  draft(
    request: IntegrationRequester,
    connectorId: string,
    draft: ReviewActionDraft,
  ): Promise<WorkspaceAction> {
    return request('/workspace/actions', workspaceActionSchema, {
      method: 'POST',
      body: { connectorId, actionType: draft.actionType, payload: draft.payload },
    });
  },

  approve(request: IntegrationRequester, actionId: string): Promise<WorkspaceAction> {
    return request(
      `/workspace/actions/${encodeURIComponent(actionId)}/approve`,
      workspaceActionSchema,
      { method: 'POST', body: {} },
    );
  },
};
