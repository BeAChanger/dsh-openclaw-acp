import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as plugin from '../index.js'

test('exports a Cordis plugin with a configuration schema', () => {
  assert.equal(plugin.name, 'openclaw-acp')
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(plugin.Config)
  assert.deepEqual(plugin.inject, ['agents'])
})

test('declares a DSH bundle that mounts this package', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  assert.equal(manifest.name, 'dsh-openclaw-acp')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-acp'], '0.2.1-rc.5')
  assert.match(patch, /name: dsh-openclaw-acp/)
  assert.match(patch, /deepseek-flash/)
  assert.match(patch, /reasoningEffort: max/)
  assert.match(patch, /defaultContextWindow: 1000000/)
  assert.match(patch, /maxTokens: 384000/)
})