// The Host half against the real rc.5 services it composes with: Session
// store and projections, ToolRuntime's pre-execute → ask → approval chain,
// ApprovalService, the built-in permission preset service, and LlmRuntime
// with a scripted reviewer adapter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmAdapter, LlmRuntime, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'
import * as Plugin from '../lib/index.js'

/** Reviewer adapter: answers each call with the next scripted text (or throws). */
class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.calls = [] }
  async *stream(options) {
    this.calls.push(options)
    const next = this.script.shift() ?? '{"decision":"deny","risk":"high","reason":"script exhausted"}'
    if (next instanceof Error) throw next
    if (typeof next === 'function') { await next(options); return }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: next }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function setup({ config = {}, script = [], sandboxDefault = 'workspace-write', userAnswer = 'allowed-once' } = {}) {
  const ctx = new Context()
  ctx.provide('typert', {
    lookups: { register: () => () => {} },
    contexts: { registerHost: () => () => {} },
    remotes: { register: () => () => {} },
  })
  ctx.provide('shell')
  ctx.set('shell', { sandboxMode: sandboxDefault })
  for (const service of [SessionStore, SessionProjectionRegistry, AgentRegistry, LlmRuntime, SystemPrompt, ToolRuntime, NativeToolExecutor, CommandRuntime]) await ctx.plugin(service)
  // The real command registry, read through the same lookup the executor uses.
  const probe = { id: 'probe', session: undefined }
  const commands = {
    get: name => ({ handler: input => ctx.commands.find(input.agent, name).handler(input) }),
    has: name => ctx.commands.find(probe, name) !== undefined,
  }
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(PermissionPresetService, {})
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['reviewer'], adapter)

  // The user's own answerer: last in the chain.
  const asked = []
  const user = { answer: userAnswer }
  ctx.on('approval/request', async req => { asked.push(req); return user.answer })

  const ran = []
  const tool = name => defineTool({
    name, description: `${name} tool`,
    parameters: { command: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { ran.push(`${name}:${args.command}`); return 'ok' },
  })
  ctx.tools.register(tool('bash'))
  ctx.tools.register(tool('read'))
  // A sandboxed tool whose body asks for a one-shot wider sandbox.
  ctx.tools.register(defineTool({
    name: 'escalating', description: 'asks for wider access',
    parameters: { command: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const mode = await approveEscalation(
        { requestedMode: 'danger-full-access', effectiveMode: 'workspace-write', justification: 'need /etc', subject: 'command' },
        { approver: ctx.approval, agent: exec.agent, toolName: 'escalating', callId: exec.callId, signal: exec.signal },
      )
      ran.push(`escalating:${args.command}:${mode}`)
      return mode
    },
  }))

  // 0.2.2: apply awaits its projection registration; wait until the plugin is active.
  const fiber = await ctx.plugin(Plugin, { reviewerProvider: 'reviewer', reviewerModel: 'judge', ...config })
  await fiber.await()
  return { ctx, adapter, asked, user, ran, commands, fiber }
}

let sessionCounter = 0
/** A fresh top-level session with one open turn, a human request and a pending tool call. */
function liveSession(ctx, { request = 'please clean the build folder' } = {}) {
  const id = `s${++sessionCounter}`
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd: '/work' } })
  const injected = []
  const agent = { id, session, inject: message => injected.push(message) }
  // 0.2.2 pins permissions when the Agent is created (appends are rejected during session/created).
  ctx.emit('agent/created', { agent, source: 'new' })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: request }], source: { kind: 'user', rpcId: 'rpc-1' } }), { surfaceOp: 'append' })
  return { session, agent, injected }
}

function callTool(ctx, agent, name, command, callId = `call-${name}-${Math.random().toString(36).slice(2)}`) {
  agent.session.append('assistant/message', {
    turn: 1, step: 1, stream: [],
    message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify({ command }) }], provider: 'p', model: 'm', stopReason: 'tool-calls' }),
  }, { surfaceOp: 'append' })
  // 0.2.2 executes batches through the selected executor; unconditional tools need no step set.
  return ctx.tools.execute({ calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify({ command }) }], agent, signal: new AbortController().signal })
    .then(batch => batch.results[0].result)
}

const view = (ctx, session) => ctx.sessionProjections.stateOf(session, Plugin.PROJECTION_KEY)
const access = (ctx, session) => Plugin.deriveAccess(view(ctx, session), { sandbox: 'workspace-write', policy: 'ask' })

test('new sessions get the configured defaults after the built-in preset pin', async () => {
  const { ctx } = await setup({ config: { defaultSandbox: 'read-only', defaultApproval: 'model' } })
  try {
    const { session } = liveSession(ctx)
    assert.deepEqual(access(ctx, session), { sandbox: 'read-only', approval: 'model', builtinAuto: false })
    // The built-in service still derives a value (custom: read-only+ask is not one of its presets).
    assert.equal(ctx.permissionPresets.current(session), 'custom')
  } finally { await ctx.fiber.dispose() }
})

test('/access switches sandbox and approval independently and notifies the model of policy changes', async () => {
  const { ctx, commands } = await setup()
  try {
    const { session, agent, injected } = liveSession(ctx)
    const run = raw => commands.get('access').handler({ agent, rawInput: raw })
    assert.match(run('').text, /workspace-write, approval ask/)
    assert.equal(run('full model').kind, 'success')
    assert.deepEqual(access(ctx, session), { sandbox: 'danger-full-access', approval: 'model', builtinAuto: false })
    assert.equal(injected.length, 0, 'ask → model keeps the native ask policy')
    run('never')
    assert.deepEqual(access(ctx, session), { sandbox: 'danger-full-access', approval: 'never', builtinAuto: false })
    assert.equal(injected.length, 1)
    assert.match(injected[0].content[0].text, /"ask[^"]*" to "never[^"]*"/)
    assert.equal(ctx.permissionPresets.current(session), 'danger-full-access', 'matches the built-in preset again')
    run('ro ask')
    assert.deepEqual(access(ctx, session), { sandbox: 'read-only', approval: 'ask', builtinAuto: false })
    assert.equal(run('bogus').kind, 'error')
    // A built-in /permission switch replaces our marker.
    ctx.permissionPresets.set(session, 'workspace-write')
    run('model')
    ctx.permissionPresets.set(session, 'danger-full-access')
    assert.equal(access(ctx, session).approval, 'never')
  } finally { await ctx.fiber.dispose() }
})

test('workspace sandbox: ordinary calls run unreviewed; escalations go to the reviewer model', async () => {
  const { ctx, adapter, asked, ran } = await setup({
    config: { defaultApproval: 'model' },
    script: ['{"decision":"allow","risk":"low"}', '{"decision":"deny","risk":"medium","reason":"不需要 /etc"}'],
  })
  try {
    const { agent } = liveSession(ctx, { request: '读取 /etc/hosts' })
    let result = await callTool(ctx, agent, 'bash', 'ls')
    assert.equal(result.kind ?? 'success', 'success')
    assert.equal(adapter.calls.length, 0, 'no review inside the sandbox')

    result = await callTool(ctx, agent, 'escalating', 'cat /etc/hosts')
    assert.deepEqual(ran.slice(-1), ['escalating:cat /etc/hosts:danger-full-access'])
    assert.equal(asked.length, 0, 'the reviewer answered; the user was not asked')
    const prompt = adapter.calls[0].messages[0].content[0].text
    assert.match(prompt, /sandbox-escalation/)
    assert.match(prompt, /escalate sandbox to danger-full-access: need \/etc/)
    assert.match(prompt, /读取 \/etc\/hosts/, 'human request is included')
    assert.match(prompt, /cat \/etc\/hosts/, 'pending arguments are included')
    assert.equal(adapter.calls[0].provider, 'reviewer')
    assert.equal(adapter.calls[0].model, 'judge')

    // Denied → handed to the user (onDeny: ask-user), who allows it.
    await callTool(ctx, agent, 'escalating', 'cat /etc/shadow')
    assert.equal(asked.length, 1)
    assert.match(asked[0].reason, /escalate sandbox/)
    assert.deepEqual(ran.slice(-1), ['escalating:cat /etc/shadow:danger-full-access'])
  } finally { await ctx.fiber.dispose() }
})

test('ask mode leaves escalations to the user and never calls the reviewer', async () => {
  const { ctx, adapter, asked } = await setup()
  try {
    const { agent } = liveSession(ctx)
    await callTool(ctx, agent, 'escalating', 'x')
    assert.equal(asked.length, 1)
    assert.equal(adapter.calls.length, 0)
  } finally { await ctx.fiber.dispose() }
})

test('full access + model reviews each non-exempt call; deny can be final', async () => {
  const { ctx, adapter, asked, ran, commands } = await setup({
    config: { onDeny: 'reject' },
    script: ['{"decision":"allow","risk":"low"}', '```json\n{"decision":"deny","risk":"medium","reason":"会删除已有数据"}\n```'],
  })
  try {
    const { agent } = liveSession(ctx)
    commands.get('access').handler({ agent, rawInput: 'full model' })
    await callTool(ctx, agent, 'read', 'README')
    assert.equal(adapter.calls.length, 0, 'read is exempt')
    await callTool(ctx, agent, 'bash', 'npm test')
    assert.equal(adapter.calls.length, 1)
    assert.match(adapter.calls[0].messages[0].content[0].text, /"kind": "tool-call"/)
    const denied = await callTool(ctx, agent, 'bash', 'rm -rf data')
    assert.deepEqual(ran, ['read:README', 'bash:npm test'])
    assert.equal(asked.length, 0)
    assert.match(JSON.stringify(denied), /Auto review rejected tool \\"bash\\".*会删除已有数据/)
    assert.match(JSON.stringify(denied), /ACCESS_REVIEW_DENIED/)
  } finally { await ctx.fiber.dispose() }
})

test('full access + model: a denial with onDeny ask-user prompts the user once, with the reviewer reason', async () => {
  const { ctx, adapter, asked, ran, commands, user } = await setup({ script: ['{"decision":"deny","risk":"medium","reason":"范围过大"}'] })
  try {
    const { agent } = liveSession(ctx)
    commands.get('access').handler({ agent, rawInput: 'full model' })
    user.answer = 'rejected'
    await callTool(ctx, agent, 'bash', 'rm -rf build')
    assert.equal(adapter.calls.length, 1, 'the handed-off question is not reviewed twice')
    assert.equal(asked.length, 1)
    assert.match(asked[0].displayReason.zh, /审批模型拒绝了此调用：范围过大/)
    assert.deepEqual(ran, [])
  } finally { await ctx.fiber.dispose() }
})

test('full access + ask asks the user for each non-exempt call; full + never runs everything', async () => {
  const { ctx, adapter, asked, ran, commands } = await setup()
  try {
    const { agent } = liveSession(ctx)
    commands.get('access').handler({ agent, rawInput: 'full ask' })
    await callTool(ctx, agent, 'bash', 'make')
    await callTool(ctx, agent, 'read', 'a')
    assert.equal(asked.length, 1)
    assert.match(asked[0].displayReason.zh, /调用 bash 需要你的批准/)
    commands.get('access').handler({ agent, rawInput: 'never' })
    await callTool(ctx, agent, 'bash', 'make install')
    assert.equal(asked.length, 1)
    assert.deepEqual(ran, ['bash:make', 'read:a', 'bash:make install'])
    assert.equal(adapter.calls.length, 0)
  } finally { await ctx.fiber.dispose() }
})

test('gateScope off: full access + model behaves like the built-in full access', async () => {
  const { ctx, adapter, asked, commands } = await setup({ config: { gateScope: 'off' } })
  try {
    const { agent } = liveSession(ctx)
    commands.get('access').handler({ agent, rawInput: 'full model' })
    await callTool(ctx, agent, 'bash', 'make')
    assert.equal(adapter.calls.length + asked.length, 0)
  } finally { await ctx.fiber.dispose() }
})

test('reviewer failures follow onError', async () => {
  const { ctx, asked, ran, commands } = await setup({ script: [new Error('boom'), 'not json at all'] })
  try {
    const { agent } = liveSession(ctx)
    commands.get('access').handler({ agent, rawInput: 'full model' })
    await callTool(ctx, agent, 'bash', 'one')
    assert.equal(asked.length, 1, 'adapter failure → the user decides')
    assert.match(asked[0].displayReason.zh, /审批模型未能完成审查/)
    await callTool(ctx, agent, 'bash', 'two')
    assert.equal(asked.length, 2, 'unparsable answer → the user decides')
    assert.deepEqual(ran, ['bash:one', 'bash:two'])
  } finally { await ctx.fiber.dispose() }
  const strict = await setup({ config: { onError: 'reject' }, script: ['garbage'] })
  try {
    const { agent } = liveSession(strict.ctx)
    strict.commands.get('access').handler({ agent, rawInput: 'full model' })
    const result = await callTool(strict.ctx, agent, 'bash', 'three')
    assert.match(JSON.stringify(result), /Auto review of tool \\"bash\\" failed/)
    assert.equal(strict.asked.length, 0)
  } finally { await strict.ctx.fiber.dispose() }
})

test('reviewer timeouts fail over to the user', async () => {
  const hang = options => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)))
  const { ctx, asked, commands } = await setup({ config: { timeoutSeconds: 5 }, script: [hang] })
  try {
    const { agent } = liveSession(ctx)
    commands.get('access').handler({ agent, rawInput: 'full model' })
    const realTimeout = AbortSignal.timeout
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 20)
    try { await callTool(ctx, agent, 'bash', 'slow') } finally { AbortSignal.timeout = realTimeout }
    assert.equal(asked.length, 1)
    assert.match(asked[0].reason, /timed out after 5s/)
  } finally { await ctx.fiber.dispose() }
})

test('the built-in experimental auto preset stands us down and is replaced by an /access switch', async () => {
  const { ctx, adapter, asked, commands } = await setup()
  try {
    const { session, agent } = liveSession(ctx)
    session.append('permission/preset', { preset: 'auto' })
    session.append('sandbox/mode', { mode: 'danger-full-access' })
    assert.equal(access(ctx, session).builtinAuto, true)
    await callTool(ctx, agent, 'bash', 'x')
    assert.equal(adapter.calls.length + asked.length, 0, 'the built-in integration owns this session')
    assert.match(commands.get('access').handler({ agent, rawInput: '' }).text, /built-in auto review/)
    commands.get('access').handler({ agent, rawInput: 'full' })
    assert.deepEqual(access(ctx, session), { sandbox: 'danger-full-access', approval: 'model', builtinAuto: false })
  } finally { await ctx.fiber.dispose() }
})

test('a delegated child without its own choice follows the parent model review', async () => {
  const { ctx, adapter, commands } = await setup({ script: ['{"decision":"allow","risk":"low"}'] })
  try {
    const parent = liveSession(ctx)
    commands.get('access').handler({ agent: parent.agent, rawInput: 'full model' })
    const child = ctx.sessions.create(SessionId('child-1'), { meta: { cwd: '/work', parentSession: parent.session.id, origin: 'subagent' } })
    child.append('sandbox/mode', { mode: 'danger-full-access', source: 'delegation' })
    child.append('turn/start', { turn: 1 })
    child.append('step/start', { turn: 1, step: 1 })
    const agent = { id: 'child-1', session: child, inject() {} }
    await callTool(ctx, agent, 'bash', 'child work')
    assert.equal(adapter.calls.length, 1)
    assert.match(adapter.calls[0].messages[0].content[0].text, /delegated sub-agent/)
  } finally { await ctx.fiber.dispose() }
})

test('disposal stops gating and leaves model sessions on the native ask policy', async () => {
  const { ctx, adapter, asked, commands, fiber } = await setup({ script: ['{"decision":"allow","risk":"low"}'] })
  try {
    const { session, agent } = liveSession(ctx)
    commands.get('access').handler({ agent, rawInput: 'workspace model' })
    await fiber.dispose()
    assert.equal(commands.has('access'), false)
    assert.notEqual(ctx.approval.overrideOf(session), 'never')
    await callTool(ctx, agent, 'escalating', 'after removal')
    assert.equal(adapter.calls.length, 0, 'no reviewer after disposal')
    assert.equal(asked.length, 1, 'the escalation falls back to the user')
  } finally { await ctx.fiber.dispose() }
})
