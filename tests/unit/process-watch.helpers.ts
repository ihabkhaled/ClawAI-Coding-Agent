import type { ProcessWatchTool } from '../../src/sdk/process-watch-tool.types';

export type Report = Record<string, unknown>;

export {
  cleanUpWorkspaces,
  eventually,
  isAlive,
  limits,
  workspace,
} from './sdk-command-tool.helpers';

/** Prints `tick N` every 150 ms five times, then exits 0. */
export const SLOW_EMITTER =
  "let i=0;const t=setInterval(()=>{i+=1;console.log('tick '+i);if(i===5){clearInterval(t)}},150)";

/** Says it is booting, then (after 400 ms) that it is listening; never exits. */
export const LISTENER =
  "console.log('booting');setTimeout(()=>console.log('Server Listening on 3000'),400);setInterval(()=>{},1000)";

/** Prints its pid and ignores SIGTERM. */
export const IGNORES_SIGTERM =
  "process.on('SIGTERM',()=>{});console.log('pid='+process.pid);setInterval(()=>{},1000)";

/** A parent that starts a grandchild, prints both pids, and never exits. */
export const PARENT_AND_CHILD =
  "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('parent='+process.pid+' child='+c.pid);setInterval(()=>{},1000)";

export const FOREVER = "console.log('up');setInterval(()=>{},1000)";

export function nodeStart(name: string, script: string): Report {
  return { name, executable: 'node', arguments: ['-e', script] };
}

/** One call against a tool, awaited, as a plain record. */
export async function watchCall(
  tool: ProcessWatchTool,
  root: string,
  operation: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Report> {
  const limitsFor = { workspace: root, allowedExecutables: ['node'] };
  return (await tool.execute(operation, args, limitsFor, signal)) as Report;
}

export function pidsIn(text: unknown): { parent: number; child: number } {
  const match = /parent=(\d+) child=(\d+)/u.exec(String(text));
  return { parent: Number(match?.[1] ?? 0), child: Number(match?.[2] ?? 0) };
}
