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
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import {
  APPROVAL_MODES, DEFAULT_SETTINGS, EMPTY_STATE, FALLBACKS, GATE_SCOPES, LIMITS, SANDBOX_MODES,
  applyAccessEvent, deriveAccess, gateApplies, isFresh, markerOf, policyFor, readSettings,
  type AccessState, type AccessView, type ApprovalMode, type KnobDefaults, type RequestKind,
  type ReviewSettings, type SandboxMode, type Verdict,
} from './policy.js'
import { askReviewer, buildInput, routeFor, type SessionLike } from './reviewer.js'
import { modelInfoRequestSchema, remoteInfo, SERVICE, type ReviewerModelInfo, type ReviewerModels } from './remote.js'

export * from './policy.js'
export { collectFacts, buildInput, routeFor, askReviewer } from './reviewer.js'

export const name = 'dsh-auto-review'
export const inject = ['sessions', 'sessionProjections', 'approval', 'llm', 'shell', 'permissionPresets', 'typert']

/** Session projection published to the browser (`useProjection`). */
export const PROJECTION_KEY = 'dshAccessReview'
/** Structured error for a final reviewer denial. */
export const DENIED_CODE = 'ACCESS_REVIEW_DENIED'

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    dshAccessReview: AccessState
  }
}

const d = DEFAULT_SETTINGS
const sandboxSchema = z.union(SANDBOX_MODES as SandboxMode[])
/** Every field is volatile: settings edits apply to the next request without a remount. */
export const Config = z.object({
  defaultSandbox: sandboxSchema.default(d.defaultSandbox).volatile().description('新会话的沙箱：read-only / workspace-write / danger-full-access'),
  defaultApproval: z.union(APPROVAL_MODES as ApprovalMode[]).default(d.defaultApproval).volatile().description('新会话的审批方式：ask（每次问我）/ model（模型审批）/ never（从不审批）'),
  reviewerProvider: z.string().default(d.reviewerProvider).volatile().description('审批模型的提供方；留空则使用会话当前模型'),
  reviewerModel: z.string().default(d.reviewerModel).volatile().description('审批模型 ID；与提供方一起设置'),
  reviewerReasoning: z.string().default(d.reviewerReasoning).volatile().description('审批模型的推理强度 ID；留空用模型默认值'),
  gateScope: z.union(GATE_SCOPES as string[]).default(d.gateScope).volatile().description('逐次把关：off（只审批沙箱提权）/ full-access（完全权限下每次工具调用）/ always（任何沙箱下每次工具调用）'),
  exemptTools: z.array(z.string()).default([...d.exemptTools]).volatile().description('不做逐次把关的只读工具'),
  onDeny: z.union(FALLBACKS as string[]).default(d.onDeny).volatile().description('模型拒绝时：ask-user（转给我决定）/ reject（直接拒绝）'),
  onError: z.union(FALLBACKS as string[]).default(d.onError).volatile().description('模型出错或超时时：ask-user / reject'),
  timeoutSeconds: z.natural().min(LIMITS.timeoutSeconds[0]).max(LIMITS.timeoutSeconds[1]).default(d.timeoutSeconds).volatile().description('单次审查超时（秒）'),
  historyMessages: z.natural().max(LIMITS.historyMessages[1]).default(d.historyMessages).volatile().description('提供给审批模型的最近用户消息条数'),
  recentActions: z.natural().max(LIMITS.recentActions[1]).default(d.recentActions).volatile().description('提供给审批模型的最近工具调用条数'),
  maxTextChars: z.natural().min(LIMITS.maxTextChars[0]).max(LIMITS.maxTextChars[1]).default(d.maxTextChars).volatile().description('单段文本（参数、消息）的最大字符数'),
  extraPolicy: z.string().default(d.extraPolicy).volatile().description('附加审查规则（追加到审批模型的系统提示）'),
  logDecisions: z.boolean().default(d.logDecisions).volatile().description('在宿主日志中记录每次审查结论'),
})

const stateSchema = zod.object({
  preset: zod.string().nullable(),
  marker: zod.enum(['ask', 'model', 'never']).nullable(),
  sandbox: zod.enum(['read-only', 'workspace-write', 'danger-full-access']).nullable(),
  policy: zod.enum(['ask', 'never']).nullable(),
  seeded: zod.boolean(),
  started: zod.boolean(),
}).strict()
const viewSchema = zod.object({
  sandbox: zod.enum(['read-only', 'workspace-write', 'danger-full-access']),
  approval: zod.enum(['ask', 'model', 'never']),
  builtinAuto: zod.boolean(),
})

interface AgentLike {
  id?: string
  session: SessionLike & { append(type: string, data: unknown): unknown }
}
interface ExecLike {
  callId: string
  name: string
  arguments: unknown
  agent?: AgentLike
  parent?: unknown
  signal: AbortSignal
}
type PreDecision = { kind: 'allow' } | { kind: 'cancel' } | { kind: 'deny'; reason: string; info?: unknown }
  | { kind: 'ask'; reason?: string; displayReason?: { en: string; [locale: string]: string } }
interface ApprovalRequestLike {
  agent?: AgentLike
  toolName: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}
type Outcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

const SANDBOX_ALIASES: Record<string, SandboxMode> = {
  'read-only': 'read-only', readonly: 'read-only', ro: 'read-only', read: 'read-only', 只读: 'read-only',
  'workspace-write': 'workspace-write', workspace: 'workspace-write', ws: 'workspace-write', write: 'workspace-write', 工作区: 'workspace-write',
  'danger-full-access': 'danger-full-access', full: 'danger-full-access', 'full-access': 'danger-full-access', 完全: 'danger-full-access',
}
const APPROVAL_ALIASES: Record<string, ApprovalMode> = {
  ask: 'ask', user: 'ask', 询问: 'ask',
  model: 'model', auto: 'model', review: 'model', 模型: 'model',
  never: 'never', none: 'never', off: 'never', 不审批: 'never',
}

/** Parse `/access` arguments: any order, any subset. */
/**
 * The two knob write paths, inlined (their rc.5 implementations are exactly
 * one append each) so the Host half only imports packages other installed
 * plugins already load from the running DSH.
 */
function setSandboxMode(session: { append(type: string, data: unknown): unknown }, mode: SandboxMode): void {
  session.append('sandbox/mode', { mode })
}
function setApprovalPolicy(session: { append(type: string, data: unknown): unknown }, policy: 'ask' | 'never'): void {
  session.append('approval/policy', { policy })
}

export function parseAccessArgs(raw: string): { sandbox?: SandboxMode; approval?: ApprovalMode; unknown: string[] } {
  const result: { sandbox?: SandboxMode; approval?: ApprovalMode; unknown: string[] } = { unknown: [] }
  for (const token of raw.trim().toLowerCase().split(/[\s,，/+·]+/).filter(Boolean)) {
    if (SANDBOX_ALIASES[token]) result.sandbox = SANDBOX_ALIASES[token]
    else if (APPROVAL_ALIASES[token]) result.approval = APPROVAL_ALIASES[token]
    else result.unknown.push(token)
  }
  return result
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Remote used by the settings page to offer reviewer models. */
export class AccessReviewService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, SERVICE)
  }

  @Remote
  async models(request: unknown, signal: AbortSignal): Promise<ReviewerModels> {
    void request // the gateway matches wire fields to these parameter names; keep it "request"
    const llm = (this.ctx as any).llm
    const providers = (llm.listProviders?.() ?? []) as { id: string; name: string }[]
    return {
      providers: await Promise.all(providers.map(async provider => {
        try {
          signal.throwIfAborted()
          const models = await llm.listModels(provider.id) as { id: string; name?: string }[]
          return { provider: provider.id, name: provider.name || provider.id, models: models.map(model => ({ id: model.id, name: model.name || model.id })) }
        } catch (error) {
          return { provider: provider.id, name: provider.name || provider.id, models: [], error: errorText(error) }
        }
      })),
    }
  }

  @Remote
  async modelInfo(request: unknown, signal: AbortSignal): Promise<ReviewerModelInfo> {
    const parsed = modelInfoRequestSchema.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', '参数无效。', {})
    try {
      const info = await (this.ctx as any).llm.resolveModelInfo(parsed.data.provider, parsed.data.model, signal)
      const efforts = (info?.reasoning?.efforts ?? []) as { id: string; name: string }[]
      return { efforts: efforts.map(effort => ({ id: String(effort.id), name: effort.name || String(effort.id) })), defaultEffort: info?.reasoning?.defaultEffort ?? null }
    } catch {
      return { efforts: [], defaultEffort: null }
    }
  }
}

export interface Internals {
  /** Replace the reviewer call (tests). */
  review?: (input: ReturnType<typeof buildInput>, settings: ReviewSettings, signal: AbortSignal) => Promise<Verdict>
}

export function apply(ctx: Context, config: Record<string, unknown> = {}, internals: Internals = {}): void {
  const c = ctx as any
  const settings = () => readSettings(config)
  const defaults = (): KnobDefaults => ({
    sandbox: (c.shell?.sandboxMode as SandboxMode | undefined) ?? 'workspace-write',
    policy: c.approval?.config?.policy === 'never' ? 'never' : 'ask',
  })

  c.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema,
    init: () => EMPTY_STATE,
    apply: applyAccessEvent,
    wire: { viewSchema, view: (state: AccessState) => deriveAccess(state, defaults()) },
  })

  const stateOf = (session: SessionLike): AccessState =>
    (c.sessionProjections.stateOf(session, PROJECTION_KEY) as AccessState | undefined) ?? EMPTY_STATE

  /** Effective access; a delegated child without its own choice follows its parent's model review. */
  const accessOf = (session: SessionLike): AccessView => {
    const state = stateOf(session)
    const view = deriveAccess(state, defaults())
    if (view.approval === 'ask' && state.marker === null && session.header.origin === 'subagent' && session.header.parentSession) {
      const parent = c.sessions.get?.(session.header.parentSession) as SessionLike | undefined
      if (parent !== undefined && deriveAccess(stateOf(parent), defaults()).approval === 'model') return { ...view, approval: 'model' }
    }
    return view
  }

  /** Switch one live session. Returns what is in effect afterwards. */
  const switchAccess = (agent: AgentLike, sandbox: SandboxMode, approval: ApprovalMode): AccessView => {
    const session = agent.session
    const state = stateOf(session)
    const view = deriveAccess(state, defaults())
    if (sandbox !== view.sandbox) setSandboxMode(session, sandbox)
    if (approval !== view.approval || view.builtinAuto) session.append('permission/preset', { preset: markerOf(approval) })
    const policy = policyFor(approval)
    if (policy !== (state.policy ?? defaults().policy)) c.approval.setPolicy(agent, policy)
    return deriveAccess(stateOf(session), defaults())
  }

  // New top-level sessions start with the configured defaults. Runs after the
  // built-in preset service pinned its own default (it is injected first).
  ctx.on('session/created' as never, ((session: AgentLike['session']) => {
    if (session.header.origin === 'subagent') return
    const state = stateOf(session)
    if (!isFresh(state)) return
    const wanted = settings()
    try {
      if (wanted.defaultSandbox !== (state.sandbox ?? defaults().sandbox)) setSandboxMode(session, wanted.defaultSandbox)
      const policy = policyFor(wanted.defaultApproval)
      if (policy !== (state.policy ?? defaults().policy)) setApprovalPolicy(session, policy)
      session.append('permission/preset', { preset: markerOf(wanted.defaultApproval) })
    } catch (error) {
      ctx.logger.warn('access-review: could not apply new-session defaults: %s', errorText(error))
    }
  }) as never)

  // ---------------------------------------------------------------------
  // Review plumbing

  const lifecycle = new AbortController()
  let closing = false
  const active = new Set<Promise<unknown>>()
  /** Arguments of recent calls, for approval questions that only carry a call id. */
  const recentCalls = new Map<string, { name: string; arguments: unknown }>()
  const remember = (exec: ExecLike) => {
    recentCalls.delete(exec.callId)
    recentCalls.set(exec.callId, { name: exec.name, arguments: exec.arguments })
    while (recentCalls.size > 256) recentCalls.delete(recentCalls.keys().next().value as string)
  }
  /** Calls the reviewer already judged; their approval question goes straight to the user. */
  const handoff = new Set<string>()
  const handOff = (callId: string) => {
    handoff.add(callId)
    if (handoff.size > 256) handoff.delete(handoff.values().next().value as string)
  }

  async function review(kind: RequestKind, agent: AgentLike, access: AccessView, detail: {
    reason?: string; tool?: { name: string; arguments: unknown }; callId?: string; signal?: AbortSignal
  }): Promise<Verdict> {
    const current = settings()
    const timeout = AbortSignal.timeout(current.timeoutSeconds * 1000)
    const signal = AbortSignal.any([lifecycle.signal, timeout, ...(detail.signal ? [detail.signal] : [])])
    const run = (async () => {
      let cwd = agent.session.header.cwd
      const workingDirectory = c.get?.('workingDirectory')
      if (workingDirectory?.ensure) {
        try { cwd = await workingDirectory.ensure(agent, signal) } catch { /* keep the header cwd */ }
      }
      const input = buildInput({
        kind, session: agent.session, sandbox: access.sandbox, cwd,
        reason: detail.reason, tool: detail.tool, callId: detail.callId,
      }, current)
      if (internals.review) return internals.review(input, current, signal)
      return askReviewer(c.llm, routeFor(agent.session, current), current, input, signal)
    })()
    const tracked = run.finally(() => active.delete(tracked))
    active.add(tracked)
    try {
      const verdict = await tracked
      if (current.logDecisions || verdict.decision === 'deny') {
        ctx.logger.info('access-review: %s %s %s (%s)%s', verdict.decision, kind, detail.tool?.name ?? detail.callId ?? '', verdict.risk, verdict.reason ? `: ${verdict.reason}` : '')
      }
      return verdict
    } catch (error) {
      if (timeout.aborted && !lifecycle.signal.aborted && !detail.signal?.aborted) throw new Error(`reviewer timed out after ${current.timeoutSeconds}s`)
      throw error
    }
  }

  const display = (zh: string, en: string) => ({ en, zh })

  // Per-call gate. Prepended so it sees each call before other policies; it
  // still lets them veto first, and only gates calls they would allow.
  const disposeGate = ctx.on('tools/pre-execute' as never, (async (exec: ExecLike, next: () => Promise<PreDecision>): Promise<PreDecision> => {
    const agent = exec.agent
    if (agent === undefined || closing) return next()
    remember(exec)
    const current = settings()
    const access = accessOf(agent.session)
    if (!gateApplies(access, current, { name: exec.name, inner: exec.parent !== undefined })) return next()
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    if (access.approval === 'ask') {
      return {
        kind: 'ask',
        reason: `access-review: tool "${exec.name}" requires approval under ${access.sandbox}`,
        displayReason: display(`调用 ${exec.name} 需要你的批准。`, `Calling ${exec.name} needs your approval.`),
      }
    }
    let verdict: Verdict
    try {
      verdict = await review('tool-call', agent, access, { tool: { name: exec.name, arguments: exec.arguments }, callId: exec.callId, signal: exec.signal })
    } catch (error) {
      if (lifecycle.signal.aborted || exec.signal.aborted) return { kind: 'cancel' }
      const message = errorText(error)
      if (current.onError === 'ask-user') {
        handOff(exec.callId)
        return {
          kind: 'ask',
          reason: `access-review: reviewer failed for tool "${exec.name}": ${message}`,
          displayReason: display(`审批模型未能完成审查（${message}），请你决定。`, `The reviewer could not decide (${message}); please decide.`),
        }
      }
      return { kind: 'deny', reason: `Auto review of tool "${exec.name}" failed; it was not executed: ${message}` }
    }
    if (lifecycle.signal.aborted) return { kind: 'cancel' }
    if (verdict.decision === 'allow') return downstream
    if (current.onDeny === 'ask-user') {
      handOff(exec.callId)
      return {
        kind: 'ask',
        reason: `access-review: reviewer denied tool "${exec.name}"${verdict.reason ? `: ${verdict.reason}` : ''}`,
        displayReason: display(
          `审批模型拒绝了此调用${verdict.reason ? `：${verdict.reason}` : '。'}`,
          `The reviewer denied this call${verdict.reason ? `: ${verdict.reason}` : '.'}`,
        ),
      }
    }
    return {
      kind: 'deny',
      reason: `Auto review rejected tool "${exec.name}"; it was not executed${verdict.reason ? `. Reviewer: ${verdict.reason}` : ''}`,
      info: { name: 'AccessReviewDeniedError', code: DENIED_CODE, ...(verdict.reason ? { reason: verdict.reason } : {}) },
    }
  }) as never, { prepend: true } as never)

  // Model answerer for every approval question (sandbox escalations, other
  // plugins' asks). Prepended ahead of the user's own answerer.
  const disposeAnswerer = ctx.on('approval/request' as never, (async (req: ApprovalRequestLike, next: () => Promise<Outcome>): Promise<Outcome> => {
    const agent = req.agent
    if (agent === undefined || closing) return next()
    if (req.callId !== undefined && handoff.delete(req.callId)) return next()
    const access = accessOf(agent.session)
    if (access.builtinAuto || access.approval !== 'model') return next()
    const current = settings()
    const kind: RequestKind = /^escalate sandbox to /.test(req.reason ?? '') ? 'sandbox-escalation' : 'approval-request'
    const known = req.callId === undefined ? undefined : recentCalls.get(req.callId)
    let verdict: Verdict
    try {
      verdict = await review(kind, agent, access, {
        ...(req.reason ? { reason: req.reason } : {}),
        tool: known ?? { name: req.toolName, arguments: undefined },
        ...(req.callId ? { callId: req.callId } : {}),
        ...(req.signal ? { signal: req.signal } : {}),
      })
    } catch (error) {
      if (lifecycle.signal.aborted || req.signal?.aborted) return 'cancelled'
      ctx.logger.warn('access-review: reviewer failed for %s: %s', req.toolName, errorText(error))
      return current.onError === 'ask-user' ? next() : 'rejected'
    }
    if (lifecycle.signal.aborted) return 'cancelled'
    if (verdict.decision === 'allow') return 'allowed-once'
    return current.onDeny === 'ask-user' ? next() : 'rejected'
  }) as never, { prepend: true } as never)

  // `/access [sandbox] [approval]`: the composer control's write path, also typed by hand.
  ctx.inject(['commands'], (scoped: Context) => {
    scoped.effect(() => (scoped as any).commands.register({
      definitionId: 'dsh-auto-review',
      name: 'access',
      description: 'Switch the sandbox (read-only / workspace-write / full) and the approval mode (ask / model / never) independently',
      input: { hint: '<read-only|workspace-write|full> <ask|model|never>' },
      handler: ({ agent, rawInput }: { agent: AgentLike; rawInput: string }) => {
        const view = accessOf(agent.session)
        const args = parseAccessArgs(rawInput)
        if (args.unknown.length > 0) return { kind: 'error', text: `unknown option "${args.unknown.join(' ')}" (sandbox: read-only, workspace-write, full; approval: ask, model, never)` }
        if (args.sandbox === undefined && args.approval === undefined) {
          return { kind: 'success', text: `sandbox ${view.sandbox}, approval ${view.builtinAuto ? 'built-in auto review' : view.approval}` }
        }
        const next = switchAccess(agent, args.sandbox ?? view.sandbox, args.approval ?? (view.builtinAuto ? 'model' : view.approval))
        return { kind: 'success', text: `sandbox ${next.sandbox}, approval ${next.approval}` }
      },
    }), 'access-review: /access command')
  })

  ctx.typert.remotes.register(remoteInfo)
  new AccessReviewService(ctx)

  ctx.effect(() => async () => {
    closing = true
    disposeGate()
    disposeAnswerer()
    lifecycle.abort(new Error('dsh-auto-review disposed'))
    await Promise.allSettled([...active])
  }, 'access-review: stop reviews')
}
