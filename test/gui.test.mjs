// The shipped lib/client.js on the real rc.5 slot renderer in jsdom, next to
// stand-ins for the built-in permission chip and General row, and — when the
// sibling project is built — the real dsh-appearance client and its tray.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, cordis, dom, loaded, loadBrowserModule, React, renderer } from './harness.mjs'

const h = React.createElement
const w = dom.window
const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const click = node => act(async () => { node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    set: next => { value = next; for (const listener of [...listeners]) listener() },
  }
}

// --- a miniature rc.5 shell -------------------------------------------------
const ctx = new cordis.Context()
await ctx.plugin(renderer)

const dictionaries = {}
const localeRevision = observable({ revision: 0 })
const bind = ns => (key, params) => {
  const template = dictionaries[ns]?.[key] ?? `${ns}:${key}`
  return params ? template.replace(/\{(\w+)\}/g, (_, name) => String(params[name])) : template
}
ctx.provide('locale'); ctx.set('locale', { register: (ns, lang, dict) => { if (lang === 'zh') dictionaries[ns] = dict; return () => {} }, bind })
ctx.slots.installLocale({ ...localeRevision, bind })
ctx.provide('layout'); ctx.set('layout', { toggleSidebar() {}, panelInfo: observable({ activePanelId: null }) })

// The Host projection, per session; `/access` commands update it like the Host would.
const projections = new Map()
const projectionOf = id => {
  if (!projections.has(id)) projections.set(id, observable({ sandbox: 'workspace-write', approval: 'ask', builtinAuto: false }))
  return projections.get(id)
}
const binding = id => ({ key: id, ctx, hooks: {}, keyedHooks: { projection: key => key === 'dshAccessReview' ? projectionOf(id) : undefined }, props: { sessionId: id } })
const currentBinding = observable(binding('s1'))
ctx.slots.installScope('session', { current: currentBinding, bindingSource: () => currentBinding,
  renderArea: (value, { empty, children }) => value.key === undefined ? (empty?.() ?? null) : h(React.Fragment, null, children) })
ctx.slots.provideRoot({ hooks: {} })

const commands = []
let commandFailure
ctx.provide('sessions'); ctx.set('sessions', { binding: id => ({ session: { command: async line => {
  commands.push([id, line])
  if (commandFailure) return { ok: false, error: { code: 'x', message: commandFailure } }
  const [, sandbox, approval] = line.split(' ')
  projectionOf(id).set({ sandbox, approval, builtinAuto: false })
  return { ok: true, value: { matched: true, result: { kind: 'success' } } }
} } }) })

const form = observable({ status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true })
const writes = []
form.mutate = async (ops, revision) => { writes.push({ ops, revision }); return true }
let served = false
ctx.provide('configForms'); ctx.set('configForms', {
  get: entry => { assert.equal(entry, 'access-review'); return form },
  whileServed: (namespaces, register) => { assert.deepEqual(namespaces, ['access-review']); served = true; const dispose = register(new Set(namespaces)); return () => { served = false; dispose() } },
})
ctx.provide('remote'); ctx.set('remote', { $mount: async info => { assert.ok(info.methods['accessReview/models']); return () => {} } })

function Shell({ renderSlot }) {
  return h('div', null,
    h('div', { id: 'composer' },
      h('div', { id: 'left' }, renderSlot('conversation.input.left', {})),
      h('div', { id: 'permission' }, renderSlot('conversation.input.permission', { locked: false })),
      h('div', { id: 'right' }, renderSlot('conversation.input.right', {}))),
    h('div', { id: 'general' }, renderSlot('settings.general.item', {})),
    h('div', { id: 'settings' }, renderSlot('settings.section', { close() {} })),
    h('div', { 'data-shell-overlay': true }, renderSlot('shell.overlay', {})))
}
ctx.slots.register({ name: 'root', children: {
  'conversation.input.left': { kind: 'list', scope: 'session' },
  'conversation.input.right': { kind: 'list', scope: 'session' },
  'conversation.input.permission': { kind: 'single', scope: 'session' },
  'conversation.header.leading': { kind: 'single', scope: 'root' },
  'settings.general.item': { kind: 'list', scope: 'root' },
  'settings.section': { kind: 'list', scope: 'root' },
  'shell.overlay': { kind: 'list', scope: 'root' },
} }, Shell)

// Built-in stand-ins at their default priority.
await ctx.plugin({ name: 'builtin', inject: ['slots'], apply(child) {
  child.slots.inject('conversation.input.permission', () => child.slots.register({ name: 'conversation.input.permission' }, () => h('button', { className: 'builtin-permission' }, 'builtin')))
  child.slots.inject('settings.general.item', () => child.slots.register({ name: 'settings.general.item', id: 'permission', order: -20 }, () => h('div', { className: 'builtin-row' }, 'default preset')))
  child.slots.inject('settings.general.item', () => child.slots.register({ name: 'settings.general.item', id: 'language', order: 0 }, () => h('div', { className: 'language-row' }, 'language')))
  child.slots.inject('conversation.input.left', () => child.slots.register({ name: 'conversation.input.left', id: 'other-plugin', order: 10 }, () => h('button', { className: 'other-pill' }, 'other')))
} })

// --- plugins under test -----------------------------------------------------
const appearancePath = fileURLToPath(new URL('../../dsh-appearance/lib/client.js', import.meta.url))
const withAppearance = existsSync(appearancePath)
if (withAppearance) {
  loadBrowserModule(appearancePath)
  await ctx.plugin(loaded['@forever-lwy/dsh-appearance'])
}
loadBrowserModule(fileURLToPath(new URL('../lib/client.js', import.meta.url)))
const client = loaded['@forever-lwy/dsh-auto-review']
assert.deepEqual(client.inject, ['slots', 'locale', 'configForms', 'remote', 'sessions'])
const fiber = ctx.plugin(client)
await fiber

const container = document.getElementById('app')
await act(async () => { ctx.uiRenderer.mount(container) })
await tick(); await tick()

const trigger = () => document.querySelector('#permission .dar2-trigger')
const item = id => document.querySelector(`[data-id="${id}"]`)

test('our control takes the permission seat and the built-in chip is shadowed', () => {
  assert.ok(served)
  assert.ok(trigger(), 'rendered in the permission seat')
  assert.equal(document.querySelector('.builtin-permission'), null)
  assert.equal(trigger().textContent.replace(/\s+/g, ' ').trim(), '工作区内修改 · 问我')
  assert.equal(trigger().getAttribute('aria-label'), '访问权限，当前：工作区内修改 · 问我')
  assert.match(trigger().title, /可修改工作区/)
})

test('the appearance tray does not collect it', { skip: !withAppearance && 'dsh-appearance is not built next to this project' }, async () => {
  assert.equal(document.querySelector('#left .other-pill'), null, 'the tray collected a list-slot button…')
  assert.ok(document.querySelector('.dsha-tray-panel .other-pill'), '…into its panel')
  assert.equal(document.querySelector('.dsha-tray-panel .dar2-trigger'), null, 'but not ours')
  assert.ok(trigger())
})

test('the menu offers two independent groups and keeps both checks', async () => {
  await click(trigger())
  const labels = [...document.querySelectorAll('[data-label]')].map(node => node.textContent)
  assert.deepEqual(labels, ['权限', '审批方式'])
  assert.deepEqual([...document.querySelectorAll('[role=menuitem]')].map(node => node.dataset.id), [
    'sandbox:read-only', 'sandbox:workspace-write', 'sandbox:danger-full-access', 'approval:ask', 'approval:model', 'approval:never'])
  assert.equal(item('sandbox:workspace-write').getAttribute('aria-checked'), 'true')
  assert.equal(item('approval:ask').getAttribute('aria-checked'), 'true')
  await click(item('approval:model'))
  await tick()
  assert.deepEqual(commands.at(-1), ['s1', '/access workspace-write model'])
  assert.ok(item('approval:model'), 'the menu stays open for the other group')
  assert.equal(item('approval:model').getAttribute('aria-checked'), 'true')
  await click(item('sandbox:read-only'))
  await tick()
  assert.deepEqual(commands.at(-1), ['s1', '/access read-only model'])
  assert.equal(trigger().textContent.replace(/\s+/g, ' ').trim(), '仅可查看 · 模型审批')
  await click(document.querySelector('[data-close]'))
})

test('unattended full access needs an explicit risk confirmation; full + ask does not', async () => {
  const before = commands.length
  await click(trigger())
  await click(item('sandbox:danger-full-access'))
  const dialog = document.querySelector('[data-risk]')
  assert.ok(dialog, 'full + model asks for confirmation')
  assert.match(dialog.textContent, /审批模型而不是你/)
  assert.equal(commands.length, before)
  await click(dialog.querySelector('[data-cancel]'))
  assert.equal(document.querySelector('[data-risk]'), null)
  assert.equal(commands.length, before, 'cancel switches nothing')

  await click(trigger())
  await click(item('approval:ask'))
  await tick()
  await click(item('sandbox:danger-full-access'))
  await tick()
  assert.equal(document.querySelector('[data-risk]'), null, 'full + ask: you still approve every call')
  assert.deepEqual(commands.at(-1), ['s1', '/access danger-full-access ask'])

  await click(item('approval:never'))
  const never = document.querySelector('[data-risk]')
  assert.match(never.textContent, /不做任何审批/)
  await act(async () => { const box = never.querySelector('input'); box.click() })
  await click(never.querySelector('[data-confirm]'))
  await tick()
  assert.deepEqual(commands.at(-1), ['s1', '/access danger-full-access never'])
  assert.ok(trigger().hasAttribute('data-unguarded'))
})

test('a failed switch shows the error and keeps the Host value', async () => {
  commandFailure = 'nope'
  await click(trigger())
  await click(item('sandbox:workspace-write'))
  await tick()
  assert.match(document.querySelector('.dar2-error').textContent, /切换失败：x: nope/)
  assert.equal(trigger().textContent.replace(/\s+/g, ' ').trim(), '完全权限 · 不审批')
  commandFailure = undefined
})

test('built-in auto review is shown as such; each session has its own value', async () => {
  projectionOf('s1').set({ sandbox: 'danger-full-access', approval: 'ask', builtinAuto: true })
  await tick()
  assert.equal(trigger().textContent.replace(/\s+/g, ' ').trim(), '完全权限 · 内置审查')
  await act(async () => currentBinding.set(binding('s2')))
  await tick()
  assert.equal(trigger().textContent.replace(/\s+/g, ' ').trim(), '工作区内修改 · 问我')
})

test('General settings lose only the built-in default row; Settings gains 自动审查', () => {
  assert.equal(document.querySelector('.builtin-row'), null)
  assert.ok(document.querySelector('.language-row'))
  const page = document.querySelector('#settings .dar2-settings')
  assert.ok(page)
  assert.match(page.textContent, /新会话默认值/)
  assert.match(page.textContent, /与会话当前模型相同/)
})

test('saving the settings writes only changed fields with the read revision', async () => {
  const page = document.querySelector('#settings .dar2-settings')
  const selects = page.querySelectorAll('select')
  const defaultApproval = selects[1]
  const setter = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set
  await act(async () => { setter.call(defaultApproval, 'model'); defaultApproval.dispatchEvent(new w.Event('change', { bubbles: true })) })
  await click(page.querySelector('[data-action=save]'))
  await tick()
  assert.deepEqual(writes.at(-1), { ops: [{ op: 'set', path: ['defaultApproval'], value: 'model' }], revision: 1 })
})

test('when the Host row stops serving, the built-in controls come back', async () => {
  await fiber.dispose()
  await tick(); await tick()
  assert.equal(served, false)
  assert.ok(document.querySelector('.builtin-permission'))
  assert.ok(document.querySelector('.builtin-row'))
  assert.equal(document.querySelector('.dar2-trigger'), null)
})

test('the reviewer picker lists provider models and their reasoning efforts', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const remote = {
    models: async () => ({ providers: [
      { provider: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
      { provider: 'claude-native', name: 'Claude', models: [{ id: 'claude-haiku-5-5', name: 'Haiku 5.5' }] },
      { provider: 'broken', name: 'Broken', models: [], error: 'offline' },
    ] }),
    modelInfo: async ({ model }) => model === 'claude-haiku-5-5'
      ? { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' } : { efforts: [], defaultEffort: null },
  }
  const localForm = observable({ status: 'ready', value: { reviewerProvider: 'gone', reviewerModel: 'old-model' }, base: {}, user: { reviewerProvider: 'gone', reviewerModel: 'old-model' }, revision: 7, writable: true })
  const localWrites = []
  localForm.mutate = async (ops, revision) => { localWrites.push({ ops, revision }); return true }
  await act(async () => root.render(h(client.AccessReviewSettings, { form: localForm, remote: () => remote })))
  await tick(); await tick()
  const model = host.querySelector('select[id$="-reviewer"]')
  const groups = [...model.querySelectorAll('optgroup')].map(group => group.label)
  assert.deepEqual(groups, ['DeepSeek', 'Claude'], 'providers without models are left out')
  assert.match(model.selectedOptions[0].textContent, /gone \/ old-model （当前设置，未在列表中）/)
  const setter = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set
  await act(async () => { setter.call(model, JSON.stringify(['claude-native', 'claude-haiku-5-5'])); model.dispatchEvent(new w.Event('change', { bubbles: true })) })
  await tick(); await tick()
  const effort = host.querySelector('select[id$="-reviewerReasoning"]')
  assert.deepEqual([...effort.options].map(option => option.value), ['', 'low', 'high'])
  await act(async () => { setter.call(effort, 'high'); effort.dispatchEvent(new w.Event('change', { bubbles: true })) })
  await click(host.querySelector('[data-action=save]'))
  await tick()
  assert.deepEqual(localWrites.at(-1), { revision: 7, ops: [
    { op: 'set', path: ['reviewerProvider'], value: 'claude-native' },
    { op: 'set', path: ['reviewerModel'], value: 'claude-haiku-5-5' },
    { op: 'set', path: ['reviewerReasoning'], value: 'high' },
  ] })
  await act(async () => root.unmount())
  host.remove()
})
