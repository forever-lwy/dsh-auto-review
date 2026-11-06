import { type RequestKind, type ReviewInput, type ReviewSettings, type SandboxMode, type Verdict } from './policy.js';
/** The Session members the reviewer reads. */
export interface SessionLike {
    readonly id: string;
    readonly header: {
        readonly origin?: string;
        readonly parentSession?: string;
        readonly cwd?: string;
    };
    readonly surface: {
        readonly nodes: readonly number[];
    };
    eventAt(seq: number): {
        type: string;
        data?: any;
    } | undefined;
    requestHeader(): {
        config: {
            provider: string;
            model: string;
        };
    } | undefined;
}
export interface LlmLike {
    stream(options: Record<string, unknown>): AsyncIterable<any>;
}
export interface Route {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
export interface SessionFacts {
    projectInstructions: string[];
    userMessages: string[];
    recentActions: {
        name: string;
        arguments: string;
    }[];
    /** Arguments of `callId` as the model wrote them, when it is on the surface. */
    pending?: {
        name: string;
        arguments: unknown;
    };
}
/**
 * Walk the model-visible surface once. Only human messages (and, in a
 * delegated child, its parent's task) are labelled as instructions; tool
 * calls are facts; assistant prose and tool results are left out.
 */
export declare function collectFacts(session: SessionLike, settings: Pick<ReviewSettings, 'historyMessages' | 'recentActions'>, callId?: string): SessionFacts;
/** The reviewer route: configured, or the session's own latest model. */
export declare function routeFor(session: SessionLike, settings: Pick<ReviewSettings, 'reviewerProvider' | 'reviewerModel' | 'reviewerReasoning'>): Route;
export interface ReviewRequest {
    kind: RequestKind;
    session: SessionLike;
    sandbox: SandboxMode;
    cwd: string | undefined;
    reason: string | undefined;
    tool: {
        name: string;
        arguments: unknown;
    } | undefined;
    callId: string | undefined;
}
/** Assemble the reviewer input for one pending action. */
export declare function buildInput(request: ReviewRequest, settings: ReviewSettings): ReviewInput;
/** Stream one reviewer call and parse its verdict. */
export declare function askReviewer(llm: LlmLike, route: Route, settings: ReviewSettings, input: ReviewInput, signal: AbortSignal): Promise<Verdict>;
