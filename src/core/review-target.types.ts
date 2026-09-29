/** A GitHub pull request the ClawAI GitHub connector can comment on. */
export interface GitHubReviewTarget {
  readonly provider: 'GITHUB';
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
}

/** A GitLab merge request, on gitlab.com or a self-managed host. */
export interface GitLabReviewTarget {
  readonly provider: 'GITLAB';
  readonly host: string;
  readonly projectPath: string;
  readonly iid: number;
}

export type ReviewTarget = GitHubReviewTarget | GitLabReviewTarget;

export type ReviewTargetRefusal = 'invalid-url' | 'not-https' | 'unsupported';

export type ReviewTargetParse =
  | { readonly ok: true; readonly target: ReviewTarget }
  | { readonly ok: false; readonly refusal: ReviewTargetRefusal };

/** A workspace-service write action, drafted and then approved by the person. */
export interface ReviewActionDraft {
  readonly actionType: 'COMMENT_PR' | 'CREATE_MR_COMMENT';
  readonly payload: Readonly<Record<string, string | number>>;
}

export type ReviewDraftPlan =
  | { readonly ok: true; readonly draft: ReviewActionDraft }
  | { readonly ok: false; readonly refusal: 'empty' | 'too-long' };
