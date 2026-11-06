/**
 * Settings-page drafts and their conversion into settings path operations.
 * Kept free of React so tests can run it directly.
 */
import { type ApprovalMode, type Fallback, type GateScope, type ReviewSettings, type SandboxMode } from '../policy.js';
export interface Draft {
    defaultSandbox: SandboxMode;
    defaultApproval: ApprovalMode;
    /** `''` = the session model, else `JSON.stringify([provider, model])`. */
    reviewer: string;
    reviewerReasoning: string;
    timeoutSeconds: string;
    gateScope: GateScope;
    exemptTools: string;
    onDeny: Fallback;
    onError: Fallback;
    historyMessages: string;
    recentActions: string;
    maxTextChars: string;
    extraPolicy: string;
    logDecisions: boolean;
}
export type PathOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
export type DraftErrors = Partial<Record<keyof Draft, string>>;
export declare function reviewerKey(provider: string, model: string): string;
export declare function parseReviewerKey(key: string): {
    provider: string;
    model: string;
};
/** Resolve a Host section, filling defaults for absent fields. */
export declare function resolveSection(value: unknown): ReviewSettings;
export declare function toDraft(settings: ReviewSettings): Draft;
/** Validate a draft: the settings it describes, or per-field error keys. */
export declare function parseDraft(draft: Draft): {
    settings: ReviewSettings;
    errors?: undefined;
} | {
    settings?: undefined;
    errors: DraftErrors;
};
/** Field writes turning `current` into `next`; a field back at its default is unset. */
export declare function diffOps(current: ReviewSettings, next: ReviewSettings): PathOp[];
/** Unset every field the user layer overrides. */
export declare function resetOps(user: unknown): PathOp[];
