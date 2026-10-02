import { describeRules } from './http-tool-target';
import {
  HTTP_TOOL_DESCRIPTION,
  HTTP_TOOL_INPUT_SCHEMA,
  HTTP_TOOL_NAME,
  HTTP_TOOL_OPERATIONS,
} from './http-tool.constants';

import type { HttpHostRule } from './http-tool.types';

/** The definition the model is shown; it names the hosts, so the model never guesses one. */
export function httpToolDefinition(rules: readonly HttpHostRule[]): {
  readonly name: string;
  readonly operations: readonly string[];
  readonly [key: string]: unknown;
} {
  return {
    schemaVersion: '2.0',
    name: HTTP_TOOL_NAME,
    version: '1.0.0',
    description: `${HTTP_TOOL_DESCRIPTION} Allowed hosts: ${describeRules(rules)}.`,
    operations: Object.keys(HTTP_TOOL_OPERATIONS),
    riskClasses: ['network'],
    targetIds: ['target:workspace'],
    inputSchema: HTTP_TOOL_INPUT_SCHEMA,
  };
}
