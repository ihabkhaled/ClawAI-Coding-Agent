/** What the one-time migration can see about an install before it decides. */
export interface ConnectionDefaultFacts {
  /** The globalState flag: the migration already ran on this machine. */
  migrationDone: boolean;
  /** The user set `clawAI.backendEnvironment` themselves (any scope). */
  backendEnvironmentExplicit: boolean;
  /** The user set `clawAI.frontendEnvironment` themselves (any scope). */
  frontendEnvironmentExplicit: boolean;
  /** A session is stored for the local backend: the install has used LOCAL. */
  hasLocalSession: boolean;
  /** The explicitly set legacy `clawAI.backendUrl`, or undefined when never set. */
  legacyBackendUrl: string | undefined;
}

/** What to do. Never writes an environment the user already chose. */
export interface ConnectionDefaultDecision {
  /** Write `LOCAL` explicitly to `clawAI.backendEnvironment`. */
  writeBackendLocal: boolean;
  /** Write `LOCAL` explicitly to `clawAI.frontendEnvironment`. */
  writeFrontendLocal: boolean;
  /** Record that the migration ran, so it never runs again. */
  markDone: boolean;
}
