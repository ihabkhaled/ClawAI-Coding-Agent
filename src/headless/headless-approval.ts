import { redactText } from '../core/redaction';

import type { HeadlessIo } from './headless-args.types';
import type { AgentApprovalRequest } from '../sdk/workspace-toolkit.types';

const ARGUMENT_PREVIEW_CHARS = 200;

/**
 * The SDK approval callback, backed by a person at a terminal.
 *
 * With nobody to ask (`io.confirm` absent: stdin is not a terminal) every call
 * that needs approval is denied. A pipeline that has not said what it allows
 * must not be assumed to allow everything.
 */
export function approvalFrom(io: HeadlessIo): (request: AgentApprovalRequest) => Promise<boolean> {
  return async (request) => {
    if (io.confirm === undefined) return false;
    const preview = redactText(JSON.stringify(request.arguments)).slice(0, ARGUMENT_PREVIEW_CHARS);
    return io.confirm(`Allow ${request.toolName}.${request.operation} ${preview}? [y/N] `);
  };
}
