/**
 * The request that starts a saved agent-graph workflow.
 *
 * The graph itself is loaded by the model through `runtime.workflows`, which
 * re-stamps it with the current epochs and checks it against the schema. The
 * command therefore never hands a graph to the runtime directly: a file in the
 * workspace is editable by anyone, and the tool is the one path that validates it.
 */
export function savedWorkflowRunPrompt(name: string): string {
  return [
    `Run the saved workflow "${name}".`,
    `1. Call runtime.workflows with operation load and name "${name}".`,
    '2. Run the loaded graph with runtime.agents, exactly as loaded.',
    '3. Report what each node produced and anything that failed.',
  ].join('\n');
}
