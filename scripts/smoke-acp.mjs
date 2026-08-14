import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import {
  createAcpRuntime,
  createAgentRegistry,
  createRuntimeStore,
} from 'acpx/runtime'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dshBin = fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url))
const sandbox = await mkdtemp(join(tmpdir(), 'dsh-openclaw-acp-'))
const dshHome = join(sandbox, 'home')
const workspace = join(sandbox, 'workspace')
const packageManager = process.platform === 'win32'
  ? {
      command: process.execPath,
      args: [join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js')],
    }
  : { command: 'pnpm', args: [] }

const env = {
  ...process.env,
  DSH_HOME: dshHome,
  DSH_PERMISSION_MODE: 'danger-full-access',
  DSH_TELEMETRY_DISABLED: '1',
  // The DeepSeek adapter validates presence during boot. No model call occurs.
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'sk-dummy-for-protocol-smoke',
}

let child
let acpxRuntime
let acpxHandle
try {
  await mkdir(workspace, { recursive: true })
  // Install the packed artifact rather than a workspace link. This catches
  // missing files, manifest dependencies, and peer resolution exactly where a
  // GitHub release or npm consumer would encounter them.
  const pack = spawnSync(
    packageManager.command,
    [...packageManager.args, 'pack', '--pack-destination', sandbox],
    { cwd: root, env, encoding: 'utf8' },
  )
  assert.equal(
    pack.status,
    0,
    `package creation failed: ${pack.error ?? ''}\nstdout:\n${pack.stdout}\nstderr:\n${pack.stderr}`,
  )
  const tarballName = pack.stdout.trim().split(/\r?\n/).at(-1)
  assert.ok(tarballName?.endsWith('.tgz'), `unexpected pack output: ${pack.stdout}`)
  const tarball = isAbsolute(tarballName) ? tarballName : join(sandbox, tarballName)

  const install = spawnSync(
    process.execPath,
    [dshBin, 'plugin', '--profile', 'openclaw', 'add', tarball],
    { cwd: root, env, encoding: 'utf8' },
  )
  assert.equal(
    install.status,
    0,
    `profile install failed\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`,
  )

  const dump = spawnSync(
    process.execPath,
    [dshBin, '--profile', 'openclaw', '--dump-config'],
    { cwd: workspace, env, encoding: 'utf8' },
  )
  assert.equal(
    dump.status,
    0,
    `config dump failed\nstdout:\n${dump.stdout}\nstderr:\n${dump.stderr}`,
  )
  assert.match(dump.stdout, /dsh-openclaw-acp/)
  assert.match(dump.stdout, /id: openclaw-acp/)
  assert.match(dump.stdout, /reasoningEffort: max/)
  assert.match(dump.stdout, /defaultContextWindow: 1000000/)
  assert.match(dump.stdout, /maxTokens: 384000/)

  child = spawn(process.execPath, [dshBin, '--profile', 'openclaw'], {
    cwd: workspace,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stderr = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => stderr.push(chunk))

  const stdout = []
  const passthrough = new Readable({ read() {} })
  child.stdout.on('data', chunk => {
    stdout.push(chunk)
    passthrough.push(chunk)
  })
  child.stdout.on('end', () => passthrough.push(null))

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(passthrough),
  )
  const client = new ClientSideConnection(() => ({
    sessionUpdate: () => Promise.resolve(),
    requestPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
  }), stream)

  await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  const session = await client.newSession({ cwd: workspace, mcpServers: [] })
  assert.equal(typeof session.sessionId, 'string')
  assert.ok(session.sessionId.length > 0)

  const frames = Buffer.concat(stdout).toString('utf8').split('\n').filter(Boolean)
  assert.ok(frames.length >= 2)
  for (const frame of frames) assert.doesNotThrow(() => JSON.parse(frame))

  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolve => child.once('close', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('ACP process did not exit after SIGTERM')), 10_000)),
  ])

  assert.ok(
    child.exitCode === 0 || child.signalCode === 'SIGTERM',
    `ACP process failed\n${stderr.join('')}`,
  )

  // Exercise the same published ACPX runtime used by OpenClaw's official
  // @openclaw/acpx plugin. This proves that a custom agent registration can
  // spawn the installed Harness profile and complete ACP initialize plus
  // session/new without relying on acpx CLI's built-in Codex session label.
  Object.assign(process.env, {
    DSH_HOME: dshHome,
    DSH_PERMISSION_MODE: env.DSH_PERMISSION_MODE,
    DSH_TELEMETRY_DISABLED: env.DSH_TELEMETRY_DISABLED,
    DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
  })
  const acpxState = join(sandbox, 'acpx-state')
  const acpxStore = createRuntimeStore({ stateDir: acpxState })
  const commandNode = process.execPath.replaceAll('\\', '/')
  const commandDsh = dshBin.replaceAll('\\', '/')
  const dshCommand = `"${commandNode}" "${commandDsh}" --profile openclaw`
  acpxRuntime = createAcpRuntime({
    cwd: workspace,
    sessionStore: acpxStore,
    agentRegistry: createAgentRegistry({
      overrides: { 'deepseek-harness': dshCommand },
    }),
    permissionMode: 'deny-all',
    nonInteractivePermissions: 'deny',
    timeoutMs: 30_000,
  })
  acpxHandle = await acpxRuntime.ensureSession({
    sessionKey: 'agent:deepseek-harness:acp:smoke',
    agent: 'deepseek-harness',
    mode: 'oneshot',
    cwd: workspace,
  })
  assert.equal(acpxHandle.backend, 'acpx')
  assert.ok(acpxHandle.acpxRecordId)
  assert.ok(acpxHandle.backendSessionId)
  const acpxRecord = await acpxStore.load(acpxHandle.acpxRecordId)
  assert.equal(acpxRecord?.agentCommand, dshCommand)

  console.log(`ACP_SMOKE_OK session=${session.sessionId} frames=${frames.length}`)
  console.log(`ACPX_DSH_SMOKE_OK record=${acpxHandle.acpxRecordId} session=${acpxHandle.backendSessionId}`)
} finally {
  if (acpxRuntime && acpxHandle) {
    await acpxRuntime.close({
      handle: acpxHandle,
      reason: 'smoke complete',
      discardPersistentState: true,
    }).catch(() => {})
  }
  if (child && child.exitCode === null) child.kill('SIGTERM')
  await rm(sandbox, { recursive: true, force: true })
}
