import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as plugin from '../index.js'

const root = fileURLToPath(new URL('../', import.meta.url))

test('exports a Cordis plugin with a configuration schema', () => {
  assert.equal(plugin.name, 'openclaw-acp')
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(plugin.Config)
  assert.deepEqual(plugin.inject, ['agents'])
})

test('declares a DSH bundle that mounts this package', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-acp'], '0.1.0-rc.6')
  assert.match(patch, /name: dsh-openclaw-acp/)
  assert.match(patch, /deepseek-v4-flash/)
  assert.ok(root.endsWith('dsh-openclaw-acp\\') || root.endsWith('dsh-openclaw-acp/'))
})
