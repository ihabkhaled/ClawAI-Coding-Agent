import { catalogBudgetProblems } from './tool-catalog-budget';
import { catalogScenarios } from './tool-catalog-scenarios';
import { formatCatalog, measureCatalog } from './tool-catalog-size';

/** Prints the size tables (or JSON) and returns the exit code: 1 when a budget is broken. */
export function printReport(asJson: boolean): number {
  const sizes = catalogScenarios().map(measureCatalog);
  const problems = sizes.flatMap(catalogBudgetProblems);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(sizes, undefined, 2)}\n`);
  } else {
    process.stdout.write(`${sizes.map(formatCatalog).join('\n\n')}\n`);
    for (const problem of problems) process.stdout.write(`OVER BUDGET: ${problem}\n`);
  }
  return problems.length === 0 ? 0 : 1;
}
