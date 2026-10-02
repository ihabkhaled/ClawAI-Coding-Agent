import { CATALOG_CHAR_BUDGETS, TOOL_CHAR_BUDGETS } from './tool-catalog-budget.constants';

import type { CatalogSize } from './tool-catalog-size.types';

/**
 * Every way a catalog breaks its budget: a tool over its own character budget,
 * a tool with no budget at all (a new tool must state what it costs), or a
 * catalog over its total.
 */
export function catalogBudgetProblems(size: CatalogSize): readonly string[] {
  const problems = size.tools.flatMap((tool) => {
    const budget = TOOL_CHAR_BUDGETS[tool.name];
    if (budget === undefined) return [`${tool.name} has no budget in TOOL_CHAR_BUDGETS`];
    return tool.chars > budget
      ? [`${tool.name} is ${String(tool.chars)} chars, budget ${String(budget)} (${size.label})`]
      : [];
  });
  const total = CATALOG_CHAR_BUDGETS[size.label];
  if (total !== undefined && size.chars > total) {
    problems.push(
      `catalog "${size.label}" is ${String(size.chars)} chars, budget ${String(total)}`,
    );
  }
  return problems;
}
