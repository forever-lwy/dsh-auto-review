import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Plugin from '../lib/index.js'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patchFile = new URL('../cordis.patch.yml', import.meta.url).pathname

test('package declares an installable rc.5 bundle with a browser build', async () => {
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.engines.dsh, '0.2.1-rc.5')
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
