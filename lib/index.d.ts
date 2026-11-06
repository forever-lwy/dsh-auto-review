/**
 * Codex-style access control: the sandbox and the approval mechanism are two
 * independent choices.
 *
 * - Sandbox (the native `sandbox/mode` knob): read-only, workspace-write or
 *   full access. It decides which operations need approval at all — a
 *   confined command the sandbox denies may be retried once with wider
 *   access, which asks for approval.
 * - Approval: who answers such a request.
 *   - ask:   the user, as before (native policy `ask`).
 *   - model: a reviewer model answers first; it sits at the front of the
 *            `approval/request` answerer chain, so it decides sandbox
 *            escalations and every other approval question. A denial or a
 *            reviewer failure goes to the user or is final, as configured.
 *   - never: nothing is asked; requests are rejected (native policy `never`).
 *
 * Full access has nothing to escalate, so by default every tool call that is
 * not on the exempt list goes through the approval mode there (`gateScope`):
 * full access + ask = you approve each call, full access + model = the model
 * reviews each call, full access + never = no checks.
 *
 * The approval mode is recorded as a `permission/preset` selection named
 * `dsh-auto-review:<mode>`; the native policy carries ask/never. Removing the
 * plugin leaves model-mode sessions on `ask`, so they fall back to the user.
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import z from '@deepseek-ai/schemastery';
import { type AccessState, type ApprovalMode, type ReviewSettings, type SandboxMode, type Verdict } from './policy.js';
import { buildInput } from './reviewer.js';
import { type ReviewerModelInfo, type ReviewerModels } from './remote.js';
export * from './policy.js';
export { collectFacts, buildInput, routeFor, askReviewer } from './reviewer.js';
export declare const name = "dsh-auto-review";
export declare const inject: string[];
/** Session projection published to the browser (`useProjection`). */
export declare const PROJECTION_KEY = "dshAccessReview";
/** Structured error for a final reviewer denial. */
export declare const DENIED_CODE = "ACCESS_REVIEW_DENIED";
declare module '@deepseek-ai/dsh-session-projection' {
    interface SessionProjectionStateMap {
        dshAccessReview: AccessState;
    }
}
/** Every field is volatile: settings edits apply to the next request without a remount. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    defaultSandbox: z<"read-only" | "workspace-write" | "danger-full-access", "read-only" | "workspace-write" | "danger-full-access", "volatile-defined">;
    defaultApproval: z<"ask" | "model" | "never", "ask" | "model" | "never", "volatile-defined">;
    reviewerProvider: z<string, string, "volatile-defined">;
    reviewerModel: z<string, string, "volatile-defined">;
    reviewerReasoning: z<string, string, "volatile-defined">;
    gateScope: z<string, string, "volatile-defined">;
    exemptTools: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    onDeny: z<string, string, "volatile-defined">;
    onError: z<string, string, "volatile-defined">;
    timeoutSeconds: z<number, number, "volatile-defined">;
    historyMessages: z<number, number, "volatile-defined">;
    recentActions: z<number, number, "volatile-defined">;
    maxTextChars: z<number, number, "volatile-defined">;
    extraPolicy: z<string, string, "volatile-defined">;
    logDecisions: z<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    defaultSandbox: z<"read-only" | "workspace-write" | "danger-full-access", "read-only" | "workspace-write" | "danger-full-access", "volatile-defined">;
    defaultApproval: z<"ask" | "model" | "never", "ask" | "model" | "never", "volatile-defined">;
    reviewerProvider: z<string, string, "volatile-defined">;
    reviewerModel: z<string, string, "volatile-defined">;
    reviewerReasoning: z<string, string, "volatile-defined">;
    gateScope: z<string, string, "volatile-defined">;
    exemptTools: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    onDeny: z<string, string, "volatile-defined">;
    onError: z<string, string, "volatile-defined">;
    timeoutSeconds: z<number, number, "volatile-defined">;
    historyMessages: z<number, number, "volatile-defined">;
    recentActions: z<number, number, "volatile-defined">;
    maxTextChars: z<number, number, "volatile-defined">;
    extraPolicy: z<string, string, "volatile-defined">;
    logDecisions: z<boolean, boolean, "volatile-defined">;
}>>, "plain">;
export declare function parseAccessArgs(raw: string): {
    sandbox?: SandboxMode;
    approval?: ApprovalMode;
    unknown: string[];
};
/** Remote used by the settings page to offer reviewer models. */
export declare class AccessReviewService extends TypertRemoteService {
    constructor(ctx: Context);
    models(request: unknown, signal: AbortSignal): Promise<ReviewerModels>;
    modelInfo(request: unknown, signal: AbortSignal): Promise<ReviewerModelInfo>;
}
export interface Internals {
    /** Replace the reviewer call (tests). */
    review?: (input: ReturnType<typeof buildInput>, settings: ReviewSettings, signal: AbortSignal) => Promise<Verdict>;
}
export declare function apply(ctx: Context, config?: Record<string, unknown>, internals?: Internals): Promise<void>;
