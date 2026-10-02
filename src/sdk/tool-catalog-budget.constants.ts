/**
 * The most characters each built-in tool definition may cost, serialized as the
 * run start sends it. The model pays for every definition on EVERY turn, so a
 * definition that grows must say so here, in the same change, and justify it.
 *
 * Set from the measured sizes after the slimming pass (about 25% under
 * the 1.97.0 sizes for the nine newer tools, about 25% for the older four), rounded
 * up to the next 25. `http.request` also lists the allowed hosts, so it has room for a few.
 * `npm run tools:size` prints the current numbers.
 */
export const TOOL_CHAR_BUDGETS: Readonly<Record<string, number>> = {
  'workspace.file': 1950,
  'workspace.command': 1225,
  'workspace.git': 1325,
  'workspace.notes': 925,
  'task.plan': 1000,
  'code.gates': 1100,
  'workspace.shell': 1100,
  'http.request': 1500,
  'process.watch': 1050,
  'knowledge.context': 950,
  'browser.page': 1350,
  'vision.describe': 775,
  'agent.team': 2050,
  'runtime.tool_search': 500,
};

/** The most characters a whole catalog may cost, per scenario label (see `catalogScenarios`). */
export const CATALOG_CHAR_BUDGETS: Readonly<Record<string, number>> = {
  'default (read,git)': 4050,
  'default + command': 7400,
  'every category': 16_000,
  'every category, profile minimal': 4350,
  'every category, profile dev': 7575,
  'every category, deferred stubs': 10_100,
};

/** The 1.97.0 catalog sizes the budgets were cut from, kept so a report can say how far it has come. */
export const CATALOG_CHAR_BASELINE: Readonly<Record<string, number>> = {
  'default (read,git)': 5274,
  'default + command': 9723,
  'every category': 21_396,
};

/** The 1.97.0 size of each tool definition (every category granted), before the slimming pass. */
export const TOOL_CHAR_BASELINE: Readonly<Record<string, number>> = {
  'workspace.file': 2627,
  'workspace.command': 1899,
  'workspace.git': 1549,
  'workspace.notes': 1196,
  'task.plan': 1035,
  'code.gates': 1337,
  'workspace.shell': 1277,
  'http.request': 1652,
  'process.watch': 1210,
  'knowledge.context': 1472,
  'browser.page': 1933,
  'vision.describe': 1076,
  'agent.team': 3119,
};

/** The nine tools added in 1.96.0; the slimming target for them is 25%, for the older four 10%. */
export const NEWER_TOOLS: readonly string[] = [
  'task.plan',
  'code.gates',
  'workspace.shell',
  'http.request',
  'process.watch',
  'knowledge.context',
  'browser.page',
  'vision.describe',
  'agent.team',
];
