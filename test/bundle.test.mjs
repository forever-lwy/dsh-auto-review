import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Plugin from '../lib/index.js'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patchFile = new URL('../cordis.patch.yml', import.meta.url).pathname

test('package declares an installable ungated bundle with a browser build', async () => {
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.engines.dsh, '*', 'never gate on the dsh version')
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.ok(packageJson.files.includes('lib') && packageJson.files.includes('cordis.patch.yml'))
  assert.equal(packageJson.scripts.prepare, 'npm run build')
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /^window\.__ModuleLoader__\.load\(\{id:"dsh-auto-review"/)
  // Only modules the Web client provides may be required by the browser half.
  assert.deepEqual([...new Set(client.match(/require\("[^"]+"\)/g))].sort(),
    ['require("@deepseek-ai/dsh-client-ui-primitives")', 'require("react")', 'require("react/jsx-runtime")', 'require("zod")'])
})

test('one root row whose id is not the built-in auto-review row', () => {
  const rows = composeEntries([loadOverlayPatches('access-review-test', patchFile)])
  assert.deepEqual(rows.map(row => [row.id, row.name]), [['access-review', 'dsh-auto-review']])
  assert.notEqual(rows[0].id, 'auto-review')
})

test('every Config field is volatile and defaults match the policy defaults', () => {
  const fields = Object.entries(Plugin.Config.dict)
  assert.deepEqual(fields.map(([key]) => key).sort(), [...Plugin.SETTING_KEYS].sort())
  for (const [key, node] of fields) assert.equal(node.meta.volatile, true, key)
  const resolved = Plugin.Config({})
  for (const key of Plugin.SETTING_KEYS) assert.deepEqual(resolved[key].get(), Plugin.DEFAULT_SETTINGS[key], key)
  assert.deepEqual(Plugin.readSettings(resolved), Plugin.readSettings({}))
  assert.throws(() => Plugin.Config({ defaultSandbox: 'everything' }))
})

test('the Host half imports only packages installed plugins already load from the running DSH', async () => {
  const files = ['index.js', 'policy.js', 'reviewer.js', 'remote.js']
  const specifiers = new Set()
  for (const file of files) {
    const text = await readFile(new URL(`../lib/${file}`, import.meta.url), 'utf8')
    for (const match of text.matchAll(/^import (?!type)[^;]*?from ['"]([^'"]+)['"]/gm)) if (!match[1].startsWith('.')) specifiers.add(match[1])
  }
  assert.deepEqual([...specifiers].sort(), ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-typert-protocol/remote-info', '@deepseek-ai/schemastery', 'zod'])
  assert.deepEqual(Object.keys(packageJson.peerDependencies).sort(), ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/schemastery'])
})

test('every Remote method declares the parameter names the browser sends', async () => {
  // rc.5's gateway reads parameter names from the method source and requires
  // the wire fields to match them exactly (a "_request" here broke 0.1.0).
  const { remoteInfo } = await import('../lib/remote.js')
  const sourceParameters = fn => {
    const source = Function.prototype.toString.call(fn)
    return source.slice(source.indexOf('(') + 1, source.indexOf(')')).split(',').map(part => part.trim()).filter(Boolean)
  }
  const methods = Object.entries(remoteInfo.methods)
  assert.ok(methods.length >= 2)
  for (const [key, method] of methods) {
    const name = key.split('/')[1]
    const implementation = Plugin.AccessReviewService.prototype[name]
    assert.equal(typeof implementation, 'function', key)
    const wire = [...method.parameters.map(parameter => parameter.wire), method.cancellation.parameter]
    assert.deepEqual(sourceParameters(implementation), wire, key)
  }
})
