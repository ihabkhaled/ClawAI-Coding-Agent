import { audited } from './write-scope-audit';
import { dirtyEntries } from './write-scope-git';
import { captureWriteGuard, enforceGuard } from './write-scope-guard';

import type { GatesTool } from './code-gates-tool';
import type { WriteScope } from './write-scope.types';

/**
 * The gates tool held to a write scope, the way the command tool is: tests and
 * builds can write files, so what a `run` changed outside the scope is
 * reverted and reported afterwards.
 */
export function scopeGatesTool(inner: GatesTool, scope: WriteScope): GatesTool {
  return {
    execute: (operation, args, limits, signal) => {
      if (operation !== 'run') return inner.execute(operation, args, limits, signal);
      const baseline = dirtyEntries(limits.workspace);
      const guard = captureWriteGuard(limits.workspace);
      return Promise.resolve(inner.execute(operation, args, limits, signal)).then((result) => {
        enforceGuard(guard, scope, 'code.gates');
        return audited(result, scope, limits.workspace, baseline);
      });
    },
  };
}
