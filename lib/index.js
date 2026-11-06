var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import z from '@deepseek-ai/schemastery';
import { z as zod } from 'zod';
import { APPROVAL_MODES, DEFAULT_SETTINGS, EMPTY_STATE, FALLBACKS, GATE_SCOPES, LIMITS, SANDBOX_MODES, applyAccessEvent, deriveAccess, gateApplies, isFresh, markerOf, policyFor, readSettings, } from './policy.js';
import { askReviewer, buildInput, routeFor } from './reviewer.js';
import { modelInfoRequestSchema, remoteInfo, SERVICE } from './remote.js';
export * from './policy.js';
export { collectFacts, buildInput, routeFor, askReviewer } from './reviewer.js';
export const name = 'dsh-auto-review';
export const inject = ['sessions', 'sessionProjections', 'approval', 'llm', 'shell', 'permissionPresets', 'typert'];
/** Session projection published to the browser (`useProjection`). */
export const PROJECTION_KEY = 'dshAccessReview';
/** Structured error for a final reviewer denial. */
export const DENIED_CODE = 'ACCESS_REVIEW_DENIED';
const d = DEFAULT_SETTINGS;
const sandboxSchema = z.union(SANDBOX_MODES);
/** Every field is volatile: settings edits apply to the next request without a remount. */
export const Config = z.object({
    defaultSandbox: sandboxSchema.default(d.defaultSandbox).volatile().description('新会话的沙箱：read-only / workspace-write / danger-full-access'),
    defaultApproval: z.union(APPROVAL_MODES).default(d.defaultApproval).volatile().description('新会话的审批方式：ask（每次问我）/ model（模型审批）/ never（从不审批）'),
    reviewerProvider: z.string().default(d.reviewerProvider).volatile().description('审批模型的提供方；留空则使用会话当前模型'),
    reviewerModel: z.string().default(d.reviewerModel).volatile().description('审批模型 ID；与提供方一起设置'),
    reviewerReasoning: z.string().default(d.reviewerReasoning).volatile().description('审批模型的推理强度 ID；留空用模型默认值'),
    gateScope: z.union(GATE_SCOPES).default(d.gateScope).volatile().description('逐次把关：off（只审批沙箱提权）/ full-access（完全权限下每次工具调用）/ always（任何沙箱下每次工具调用）'),
    exemptTools: z.array(z.string()).default([...d.exemptTools]).volatile().description('不做逐次把关的只读工具'),
    onDeny: z.union(FALLBACKS).default(d.onDeny).volatile().description('模型拒绝时：ask-user（转给我决定）/ reject（直接拒绝）'),
    onError: z.union(FALLBACKS).default(d.onError).volatile().description('模型出错或超时时：ask-user / reject'),
    timeoutSeconds: z.natural().min(LIMITS.timeoutSeconds[0]).max(LIMITS.timeoutSeconds[1]).default(d.timeoutSeconds).volatile().description('单次审查超时（秒）'),
    historyMessages: z.natural().max(LIMITS.historyMessages[1]).default(d.historyMessages).volatile().description('提供给审批模型的最近用户消息条数'),
    recentActions: z.natural().max(LIMITS.recentActions[1]).default(d.recentActions).volatile().description('提供给审批模型的最近工具调用条数'),
    maxTextChars: z.natural().min(LIMITS.maxTextChars[0]).max(LIMITS.maxTextChars[1]).default(d.maxTextChars).volatile().description('单段文本（参数、消息）的最大字符数'),
    extraPolicy: z.string().default(d.extraPolicy).volatile().description('附加审查规则（追加到审批模型的系统提示）'),
    logDecisions: z.boolean().default(d.logDecisions).volatile().description('在宿主日志中记录每次审查结论'),
});
const stateSchema = zod.object({
    preset: zod.string().nullable(),
    marker: zod.enum(['ask', 'model', 'never']).nullable(),
    sandbox: zod.enum(['read-only', 'workspace-write', 'danger-full-access']).nullable(),
    policy: zod.enum(['ask', 'never']).nullable(),
    seeded: zod.boolean(),
    started: zod.boolean(),
}).strict();
const viewSchema = zod.object({
    sandbox: zod.enum(['read-only', 'workspace-write', 'danger-full-access']),
    approval: zod.enum(['ask', 'model', 'never']),
    builtinAuto: zod.boolean(),
});
const SANDBOX_ALIASES = {
    'read-only': 'read-only', readonly: 'read-only', ro: 'read-only', read: 'read-only', 只读: 'read-only',
    'workspace-write': 'workspace-write', workspace: 'workspace-write', ws: 'workspace-write', write: 'workspace-write', 工作区: 'workspace-write',
    'danger-full-access': 'danger-full-access', full: 'danger-full-access', 'full-access': 'danger-full-access', 完全: 'danger-full-access',
};
const APPROVAL_ALIASES = {
    ask: 'ask', user: 'ask', 询问: 'ask',
    model: 'model', auto: 'model', review: 'model', 模型: 'model',
    never: 'never', none: 'never', off: 'never', 不审批: 'never',
};
/** Parse `/access` arguments: any order, any subset. */
/**
 * The two knob write paths, inlined (their rc.5 implementations are exactly
 * one append each) so the Host half only imports packages other installed
 * plugins already load from the running DSH.
 */
function setSandboxMode(session, mode) {
    session.append('sandbox/mode', { mode });
}
function setApprovalPolicy(session, policy) {
    session.append('approval/policy', { policy });
}
export function parseAccessArgs(raw) {
    const result = { unknown: [] };
    for (const token of raw.trim().toLowerCase().split(/[\s,，/+·]+/).filter(Boolean)) {
        if (SANDBOX_ALIASES[token])
            result.sandbox = SANDBOX_ALIASES[token];
        else if (APPROVAL_ALIASES[token])
            result.approval = APPROVAL_ALIASES[token];
        else
            result.unknown.push(token);
    }
    return result;
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Remote used by the settings page to offer reviewer models. */
let AccessReviewService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _models_decorators;
    let _modelInfo_decorators;
    return class AccessReviewService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _models_decorators = [Remote];
            _modelInfo_decorators = [Remote];
            __esDecorate(this, null, _models_decorators, { kind: "method", name: "models", static: false, private: false, access: { has: obj => "models" in obj, get: obj => obj.models }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _modelInfo_decorators, { kind: "method", name: "modelInfo", static: false, private: false, access: { has: obj => "modelInfo" in obj, get: obj => obj.modelInfo }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, SERVICE);
            __runInitializers(this, _instanceExtraInitializers);
        }
        async models(request, signal) {
            void request; // the gateway matches wire fields to these parameter names; keep it "request"
            const llm = this.ctx.llm;
            const providers = (llm.listProviders?.() ?? []);
            return {
                providers: await Promise.all(providers.map(async (provider) => {
                    try {
                        signal.throwIfAborted();
                        const models = await llm.listModels(provider.id);
                        return { provider: provider.id, name: provider.name || provider.id, models: models.map(model => ({ id: model.id, name: model.name || model.id })) };
                    }
                    catch (error) {
                        return { provider: provider.id, name: provider.name || provider.id, models: [], error: errorText(error) };
                    }
                })),
            };
        }
        async modelInfo(request, signal) {
            const parsed = modelInfoRequestSchema.safeParse(request);
            if (!parsed.success)
                throw new RemoteError('gateway/bad-request', '参数无效。', {});
            try {
                const info = await this.ctx.llm.resolveModelInfo(parsed.data.provider, parsed.data.model, signal);
                const efforts = (info?.reasoning?.efforts ?? []);
                return { efforts: efforts.map(effort => ({ id: String(effort.id), name: effort.name || String(effort.id) })), defaultEffort: info?.reasoning?.defaultEffort ?? null };
            }
            catch {
                return { efforts: [], defaultEffort: null };
            }
        }
    };
})();
export { AccessReviewService };
export async function apply(ctx, config = {}, internals = {}) {
    const c = ctx;
    const settings = () => readSettings(config);
    const defaults = () => ({
        sandbox: c.shell?.sandboxMode ?? 'workspace-write',
        policy: c.approval?.config?.policy === 'never' ? 'never' : 'ask',
    });
    // 0.2.2 registration is asynchronous; its handle is the supported reader
    // (the registry-level stateOf(session, key) is deprecated and untyped).
    const accessProjection = await c.sessionProjections.register({
        key: PROJECTION_KEY,
        stateVersion: 1,
        stateSchema,
        init: () => EMPTY_STATE,
        apply: applyAccessEvent,
        wire: { viewSchema, view: (state) => deriveAccess(state, defaults()) },
    });
    const stateOf = (session) => accessProjection.stateOf(session) ?? EMPTY_STATE;
    /** Effective access; a delegated child without its own choice follows its parent's model review. */
    const accessOf = (session) => {
        const state = stateOf(session);
        const view = deriveAccess(state, defaults());
        if (view.approval === 'ask' && state.marker === null && session.header.origin === 'subagent' && session.header.parentSession) {
            const parent = c.sessions.get?.(session.header.parentSession);
            if (parent !== undefined && deriveAccess(stateOf(parent), defaults()).approval === 'model')
                return { ...view, approval: 'model' };
        }
        return view;
    };
    /** Switch one live session. Returns what is in effect afterwards. */
    const switchAccess = (agent, sandbox, approval) => {
        const session = agent.session;
        const state = stateOf(session);
        const view = deriveAccess(state, defaults());
        if (sandbox !== view.sandbox)
            setSandboxMode(session, sandbox);
        if (approval !== view.approval || view.builtinAuto)
            session.append('permission/preset', { preset: markerOf(approval) });
        const policy = policyFor(approval);
        if (policy !== (state.policy ?? defaults().policy))
            c.approval.setPolicy(agent, policy);
        return deriveAccess(stateOf(session), defaults());
    };
    // New top-level sessions start with the configured defaults. 0.2.2 rejects
    // appends during session/created; the built-in preset service pins its
    // default on agent/created (prepended), and this listener runs after it.
    ctx.on('agent/created', (({ agent }) => {
        const session = agent.session;
        if (session.header.origin === 'subagent')
            return;
        const state = stateOf(session);
        if (!isFresh(state))
            return;
        const wanted = settings();
        try {
            if (wanted.defaultSandbox !== (state.sandbox ?? defaults().sandbox))
                setSandboxMode(session, wanted.defaultSandbox);
            const policy = policyFor(wanted.defaultApproval);
            if (policy !== (state.policy ?? defaults().policy))
                setApprovalPolicy(session, policy);
            session.append('permission/preset', { preset: markerOf(wanted.defaultApproval) });
        }
        catch (error) {
            ctx.logger.warn('access-review: could not apply new-session defaults: %s', errorText(error));
        }
    }));
    // ---------------------------------------------------------------------
    // Review plumbing
    const lifecycle = new AbortController();
    let closing = false;
    const active = new Set();
    /** Arguments of recent calls, for approval questions that only carry a call id. */
    const recentCalls = new Map();
    const remember = (exec) => {
        recentCalls.delete(exec.callId);
        recentCalls.set(exec.callId, { name: exec.name, arguments: exec.arguments });
        while (recentCalls.size > 256)
            recentCalls.delete(recentCalls.keys().next().value);
    };
    /** Calls the reviewer already judged; their approval question goes straight to the user. */
    const handoff = new Set();
    const handOff = (callId) => {
        handoff.add(callId);
        if (handoff.size > 256)
            handoff.delete(handoff.values().next().value);
    };
    async function review(kind, agent, access, detail) {
        const current = settings();
        const timeout = AbortSignal.timeout(current.timeoutSeconds * 1000);
        const signal = AbortSignal.any([lifecycle.signal, timeout, ...(detail.signal ? [detail.signal] : [])]);
        const run = (async () => {
            let cwd = agent.session.header.cwd;
            const workingDirectory = c.get?.('workingDirectory');
            if (workingDirectory?.ensure) {
                try {
                    cwd = await workingDirectory.ensure(agent, signal);
                }
                catch { /* keep the header cwd */ }
            }
            const input = buildInput({
                kind, session: agent.session, sandbox: access.sandbox, cwd,
                reason: detail.reason, tool: detail.tool, callId: detail.callId,
            }, current);
            if (internals.review)
                return internals.review(input, current, signal);
            return askReviewer(c.llm, routeFor(agent.session, current), current, input, signal);
        })();
        const tracked = run.finally(() => active.delete(tracked));
        active.add(tracked);
        try {
            const verdict = await tracked;
            if (current.logDecisions || verdict.decision === 'deny') {
                ctx.logger.info('access-review: %s %s %s (%s)%s', verdict.decision, kind, detail.tool?.name ?? detail.callId ?? '', verdict.risk, verdict.reason ? `: ${verdict.reason}` : '');
            }
            return verdict;
        }
        catch (error) {
            if (timeout.aborted && !lifecycle.signal.aborted && !detail.signal?.aborted)
                throw new Error(`reviewer timed out after ${current.timeoutSeconds}s`);
            throw error;
        }
    }
    const display = (zh, en) => ({ en, zh });
    // Per-call gate. Prepended so it sees each call before other policies; it
    // still lets them veto first, and only gates calls they would allow.
    const disposeGate = ctx.on('tools/pre-execute', (async (exec, next) => {
        const agent = exec.agent;
        if (agent === undefined || closing)
            return next();
        remember(exec);
        const current = settings();
        const access = accessOf(agent.session);
        if (!gateApplies(access, current, { name: exec.name, inner: exec.parent !== undefined }))
            return next();
        const downstream = await next();
        if (downstream.kind !== 'allow')
            return downstream;
        if (access.approval === 'ask') {
            return {
                kind: 'ask',
                reason: `access-review: tool "${exec.name}" requires approval under ${access.sandbox}`,
                displayReason: display(`调用 ${exec.name} 需要你的批准。`, `Calling ${exec.name} needs your approval.`),
            };
        }
        let verdict;
        try {
            verdict = await review('tool-call', agent, access, { tool: { name: exec.name, arguments: exec.arguments }, callId: exec.callId, signal: exec.signal });
        }
        catch (error) {
            if (lifecycle.signal.aborted || exec.signal.aborted)
                return { kind: 'cancel' };
            const message = errorText(error);
            if (current.onError === 'ask-user') {
                handOff(exec.callId);
                return {
                    kind: 'ask',
                    reason: `access-review: reviewer failed for tool "${exec.name}": ${message}`,
                    displayReason: display(`审批模型未能完成审查（${message}），请你决定。`, `The reviewer could not decide (${message}); please decide.`),
                };
            }
            return { kind: 'deny', reason: `Auto review of tool "${exec.name}" failed; it was not executed: ${message}` };
        }
        if (lifecycle.signal.aborted)
            return { kind: 'cancel' };
        if (verdict.decision === 'allow')
            return downstream;
        if (current.onDeny === 'ask-user') {
            handOff(exec.callId);
            return {
                kind: 'ask',
                reason: `access-review: reviewer denied tool "${exec.name}"${verdict.reason ? `: ${verdict.reason}` : ''}`,
                displayReason: display(`审批模型拒绝了此调用${verdict.reason ? `：${verdict.reason}` : '。'}`, `The reviewer denied this call${verdict.reason ? `: ${verdict.reason}` : '.'}`),
            };
        }
        return {
            kind: 'deny',
            reason: `Auto review rejected tool "${exec.name}"; it was not executed${verdict.reason ? `. Reviewer: ${verdict.reason}` : ''}`,
            info: { name: 'AccessReviewDeniedError', code: DENIED_CODE, ...(verdict.reason ? { reason: verdict.reason } : {}) },
        };
    }), { prepend: true });
    // Model answerer for every approval question (sandbox escalations, other
    // plugins' asks). Prepended ahead of the user's own answerer.
    const disposeAnswerer = ctx.on('approval/request', (async (req, next) => {
        const agent = req.agent;
        if (agent === undefined || closing)
            return next();
        if (req.callId !== undefined && handoff.delete(req.callId))
            return next();
        const access = accessOf(agent.session);
        if (access.builtinAuto || access.approval !== 'model')
            return next();
        const current = settings();
        const kind = /^escalate sandbox to /.test(req.reason ?? '') ? 'sandbox-escalation' : 'approval-request';
        const known = req.callId === undefined ? undefined : recentCalls.get(req.callId);
        let verdict;
        try {
            verdict = await review(kind, agent, access, {
                ...(req.reason ? { reason: req.reason } : {}),
                tool: known ?? { name: req.toolName, arguments: undefined },
                ...(req.callId ? { callId: req.callId } : {}),
                ...(req.signal ? { signal: req.signal } : {}),
            });
        }
        catch (error) {
            if (lifecycle.signal.aborted || req.signal?.aborted)
                return 'cancelled';
            ctx.logger.warn('access-review: reviewer failed for %s: %s', req.toolName, errorText(error));
            return current.onError === 'ask-user' ? next() : 'rejected';
        }
        if (lifecycle.signal.aborted)
            return 'cancelled';
        if (verdict.decision === 'allow')
            return 'allowed-once';
        return current.onDeny === 'ask-user' ? next() : 'rejected';
    }), { prepend: true });
    // `/access [sandbox] [approval]`: the composer control's write path, also typed by hand.
    ctx.inject(['commands'], (scoped) => {
        scoped.effect(() => scoped.commands.register({
            definitionId: 'dsh-auto-review',
            name: 'access',
            description: 'Switch the sandbox (read-only / workspace-write / full) and the approval mode (ask / model / never) independently',
            input: { hint: '<read-only|workspace-write|full> <ask|model|never>' },
            handler: ({ agent, rawInput }) => {
                const view = accessOf(agent.session);
                const args = parseAccessArgs(rawInput);
                if (args.unknown.length > 0)
                    return { kind: 'error', text: `unknown option "${args.unknown.join(' ')}" (sandbox: read-only, workspace-write, full; approval: ask, model, never)` };
                if (args.sandbox === undefined && args.approval === undefined) {
                    return { kind: 'success', text: `sandbox ${view.sandbox}, approval ${view.builtinAuto ? 'built-in auto review' : view.approval}` };
                }
                const next = switchAccess(agent, args.sandbox ?? view.sandbox, args.approval ?? (view.builtinAuto ? 'model' : view.approval));
                return { kind: 'success', text: `sandbox ${next.sandbox}, approval ${next.approval}` };
            },
        }), 'access-review: /access command');
    });
    ctx.typert.remotes.register(remoteInfo);
    new AccessReviewService(ctx);
    ctx.effect(() => async () => {
        closing = true;
        disposeGate();
        disposeAnswerer();
        lifecycle.abort(new Error('dsh-auto-review disposed'));
        await Promise.allSettled([...active]);
    }, 'access-review: stop reviews');
}
