import type {
  PullRequestBlocker,
  PullRequestFacts,
  PullRequestReadiness,
} from './pull-request-readiness.types';

/**
 * Whether this branch could open a pull request, and what stops it.
 *
 * Twenty-five git operations ship and none of them is about a pull request, so
 * an agent asked to open one finds out what is wrong by trying: it pushes,
 * fails, tries again, and spends model turns discovering that the branch has no
 * remote or that it is sitting on the base branch. Every one of those facts is
 * available from git before anything is attempted.
 *
 * Blockers come back ordered rather than as a set, because they are not
 * independent. Adding a remote is pointless while you are on the base branch,
 * and pushing is pointless while there is nothing to push. A caller handed five
 * problems at once fixes them in the wrong order; a caller handed the first one
 * fixes the thing that unblocks the rest.
 */
export function assessPullRequestReadiness(facts: PullRequestFacts): PullRequestReadiness {
  const blockers: PullRequestBlocker[] = [];
  if (facts.remotes.length === 0) blockers.push('no-remote');
  if (facts.currentBranch === facts.baseBranch) blockers.push('on-base-branch');
  if (facts.aheadBy <= 0) blockers.push('nothing-to-propose');
  if (facts.dirtyPaths.length > 0) blockers.push('uncommitted-changes');
  // Last, because it is the only blocker that is fixed by an action rather than
  // by a decision: everything above has to be true before a push is worth doing.
  if (!facts.hasUpstream) blockers.push('not-pushed');
  return {
    ready: blockers.length === 0,
    blockers,
    warnings: warningsFor(facts),
  };
}

/**
 * Things worth saying that do not stop a pull request.
 *
 * A branch that has fallen behind its base still merges, and treating that as a
 * blocker would refuse most real pull requests. It is worth mentioning because
 * it explains a diff that looks larger than the work, and because rebasing
 * first is usually cheaper than resolving conflicts in review.
 */
function warningsFor(facts: PullRequestFacts): string[] {
  if (facts.behindBy <= 0) return [];
  return [
    `This branch is ${String(facts.behindBy)} commit(s) behind ${facts.baseBranch}. Merging or rebasing first keeps the review about your change.`,
  ];
}

/**
 * What each blocker means, in the words the caller needs to act.
 *
 * Kept beside the assessment rather than in the tool, because a blocker whose
 * explanation lives somewhere else drifts from what the check actually tests.
 */
export function describeBlocker(blocker: PullRequestBlocker, facts: PullRequestFacts): string {
  const messages: Record<PullRequestBlocker, string> = {
    'no-remote': 'This repository has no remote, so there is nowhere to open a pull request.',
    'on-base-branch': `You are on ${facts.baseBranch}, which is the base. Create a branch first.`,
    'nothing-to-propose': `This branch has no commits that ${facts.baseBranch} does not already have.`,
    'uncommitted-changes': `${String(facts.dirtyPaths.length)} file(s) have uncommitted changes. Commit or stash them so the pull request matches the branch.`,
    'not-pushed': 'This branch has never been pushed, so the remote has nothing to compare.',
  };
  return messages[blocker];
}

/**
 * The readiness assessment as the sentences a caller acts on.
 *
 * A branch with nothing wrong still has to say so. Returning an empty string
 * for the healthy case would make the one answer the caller most wants
 * indistinguishable from a check that did not run.
 */
export function describeReadiness(
  readiness: PullRequestReadiness,
  facts: PullRequestFacts,
): string {
  const lines = readiness.ready
    ? [`${facts.currentBranch} is ready to open a pull request against ${facts.baseBranch}.`]
    : readiness.blockers.map((blocker) => describeBlocker(blocker, facts));
  return [...lines, ...readiness.warnings].join('\n');
}
