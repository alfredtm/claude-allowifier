import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// node's own timer, which the engine's type libs do not carry
declare function setTimeout(callback: () => void, ms?: number): unknown

const HOME = '/Users/tester'
const TMPDIR = '/var/folders/ab/xyz/T/'

// The engine beneath the mod, as the test harness lets a test stand in
// for it: the session's facts, and tool.check's verdict — what the
// engine would decide on its own, its settings rules included. A
// verdict with a rule is one of the user's own deciding; without one,
// the engine's caution.
function engine(
  on: On,
  verdict: { decision: 'ask' | 'allow' | 'deny'; reason?: string; rule?: string },
): void {
  on('session.cwd', () => ({ value: `${HOME}/repos/mods/allowifier` }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('env.get', { name: 'TMPDIR' }, () => ({ value: TMPDIR }))
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: undefined }))
  on('tool.check', () => verdict)
  on('fs.read', () => ({ value: '' }))
}

// ── Bash: the user's settings rules hold; everything else runs ──────

test('a command the engine would ask about runs', async ($, on) => {
  engine(on, { decision: 'ask', reason: 'This command requires approval' })
  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  expect(answer.reason).toContain('everything runs')
})

test('a command the engine would deny runs', async ($, on) => {
  engine(on, { decision: 'deny', reason: 'unsafe' })
  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force origin main' } })
  expect(answer.decision).toBe('allow')
})

test('a settings ask rule holds', async ($, on) => {
  engine(on, { decision: 'ask', reason: 'Claude requested permissions', rule: 'Bash(rm:*)' })
  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
  expect(answer.decision).toBe('ask')
})

test('a settings deny rule holds', async ($, on) => {
  engine(on, { decision: 'deny', rule: 'Bash(curl http://*)' })
  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'curl http://neverssl.com' } })
  expect(answer.decision).toBe('deny')
})

test('a settings allow rule runs as written', async ($, on) => {
  engine(on, { decision: 'allow', rule: 'Bash(git status)' })
  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })
  expect(answer.decision).toBe('allow')
})

test('a session composes over intility-inference when its gateway answers', async ($, on) => {
  on('session.cwd', () => ({ value: `${HOME}/repos/mods/allowifier` }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: 'http://127.0.0.1:8793' }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('fs.read', { path: `${HOME}/.claude/settings.json` }, () => ({
    value: '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:8793","_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL":"1"}}',
  }))
  on('fs.read', { path: `${HOME}/.claude/intility-inference/session.json` }, () => ({ value: '{}' }))
  on('fs.exists', (_, { path }) => ({ value: path === `${HOME}/.local/bin/allowifier` }))
  // the gateway's healthz, answering through the composed spelling
  on('process.run', (_, { argv }) => ({
    value: { exitCode: 0, stdout: argv.some(a => a.includes('healthz')) ? '{"gateway":"intility-inference","version":"0.6.0"}' : '', stderr: '' },
  }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, { path, text }) => { writes.push({ path, text }); return { value: undefined } })

  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  const settings = writes.find(w => w.path === `${HOME}/.claude/settings.json`)
  expect(settings).toBeDefined()
  const env = JSON.parse(settings!.text).env
  expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:8793')
  expect(env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL).toBeUndefined()
})

test('a session does not compose when the gateway does not answer as intility-inference', async ($, on) => {
  on('session.cwd', () => ({ value: `${HOME}/repos/mods/allowifier` }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: 'http://127.0.0.1:8793' }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('fs.read', { path: `${HOME}/.claude/settings.json` }, () => ({
    value: '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:8793","_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL":"1"}}',
  }))
  on('fs.exists', (_, { path }) => ({ value: path === `${HOME}/.local/bin/allowifier` }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))   // nothing answers
  const writes: string[] = []
  on('fs.write', (_, { path }) => { writes.push(path); return { value: undefined } })

  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  expect(writes).toEqual([])
})

test('a session never composes over the marker', async ($, on) => {
  on('session.cwd', () => ({ value: `${HOME}/repos/mods/allowifier` }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: 'http://127.0.0.1:8793' }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('fs.read', { path: `${HOME}/.claude/settings.json` }, () => ({
    value: '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:8793","_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL":"1"}}',
  }))
  on('fs.exists', (_, { path }) => ({ value: path === `${HOME}/.claude/allowifier.off` }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"gateway":"intility-inference"}', stderr: '' } }))
  const writes: string[] = []
  on('fs.write', (_, { path }) => { writes.push(path); return { value: undefined } })

  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  expect(writes).toEqual([])
})

test('a composed line is taken back when intility-inference went out', async ($, on) => {
  on('session.cwd', () => ({ value: `${HOME}/repos/mods/allowifier` }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: 'http://localhost:8793' }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('fs.read', { path: `${HOME}/.claude/settings.json` }, () => ({
    value: '{"env":{"ANTHROPIC_BASE_URL":"http://localhost:8793"},"model":"glm-5-3"}',
  }))
  // the off marker: inference is out from under the line
  on('fs.exists', (_, { path }) => ({ value: path === `${HOME}/.claude/intility-inference/off` }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, { path, text }) => { writes.push({ path, text }); return { value: undefined } })

  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  const settings = writes.find(w => w.path === `${HOME}/.claude/settings.json`)
  expect(settings).toBeDefined()
  const written = JSON.parse(settings!.text)
  expect(written.env).toBeUndefined()
  expect(written.model).toBe('glm-5-3')   // the rest of the file carried whole
})

test('a session already behind a custom API is left alone', async ($, on) => {
  engine(on, { decision: 'ask' })
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: 'https://elsewhere.example' }))
  const writes: string[] = []
  on('fs.write', (_, { path }) => { writes.push(path); return { value: undefined } })

  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  expect(writes).toEqual([])
})

test('a session turns allowifier on when the proxy answers', async ($, on) => {
  on('session.cwd', () => ({ value: `${HOME}/repos/mods/allowifier` }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: undefined }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('fs.read', { path: `${HOME}/.claude/settings.json` }, () => ({ value: '{"env":{}}' }))
  on('fs.read', { path: `${HOME}/Library/LaunchAgents/com.alfredtm.allowifier.proxy.plist` }, () => ({ value: `<string>${HOME}/.local/bin/allowifier</string>` }))
  on('fs.exists', { path: `${HOME}/.claude/allowifier.off` }, () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{}', stderr: '' } }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, { path, text }) => { writes.push({ path, text }); return { value: undefined } })

  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  const settings = writes.find(w => w.path === `${HOME}/.claude/settings.json`)
  expect(settings).toBeDefined()
  expect(JSON.parse(settings!.text).env.ANTHROPIC_BASE_URL).toBe('http://localhost:8791')
})

test('a session never re-enables what allowifier off turned off', async ($, on) => {
  on('session.cwd', () => ({ value: `${HOME}/repos/mods/allowifier` }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('env.get', { name: 'ANTHROPIC_BASE_URL' }, () => ({ value: undefined }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('fs.read', { path: `${HOME}/.claude/settings.json` }, () => ({ value: '{"env":{}}' }))
  on('fs.read', { path: `${HOME}/Library/LaunchAgents/com.alfredtm.allowifier.proxy.plist` }, () => ({ value: `<string>${HOME}/.local/bin/allowifier</string>` }))
  on('fs.exists', { path: `${HOME}/.claude/allowifier.off` }, () => ({ value: true }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{}', stderr: '' } }))
  const writes: string[] = []
  on('fs.write', (_, { path }) => { writes.push(path); return { value: undefined } })

  const answer = await $.tool.check({ tool: 'Bash', input: { command: 'npm install left-pad' } })
  expect(answer.decision).toBe('allow')
  expect(writes).toEqual([])
})

// ── the file tools: allowed by where they act ────────────────────────

test('Edit inside ~/repos runs', async ($, on) => {
  engine(on, { decision: 'ask' })
  const answer = await $.tool.check({
    tool: 'Edit',
    input: { file_path: `${HOME}/repos/mods/README.md`, old_string: 'a', new_string: 'b' },
  })
  expect(answer.decision).toBe('allow')
})

test('Edit inside ~/repos runs over a deny beneath', async ($, on) => {
  engine(on, { decision: 'deny' })
  const answer = await $.tool.check({
    tool: 'Edit',
    input: { file_path: `${HOME}/repos/mods/a.ts`, old_string: 'a', new_string: 'b' },
  })
  expect(answer.decision).toBe('allow')
})

test('a settings ask rule holds inside the roots', async ($, on) => {
  engine(on, { decision: 'ask', rule: 'Edit(~/repos/**)' })
  const answer = await $.tool.check({
    tool: 'Edit',
    input: { file_path: `${HOME}/repos/mods/a.ts`, old_string: 'a', new_string: 'b' },
  })
  expect(answer.decision).toBe('ask')
})

test('Write outside the roots is left to the engine', async ($, on) => {
  engine(on, { decision: 'ask' })
  const answer = await $.tool.check({ tool: 'Write', input: { file_path: `${HOME}/.zshrc`, content: 'export A=b' } })
  expect(answer.decision).toBe('ask')
})

test('a deny beneath stands outside the roots', async ($, on) => {
  engine(on, { decision: 'deny' })
  const answer = await $.tool.check({ tool: 'Write', input: { file_path: `${HOME}/.zshrc`, content: 'export A=b' } })
  expect(answer.decision).toBe('deny')
})

test('NotebookEdit in scratch space runs', async ($, on) => {
  engine(on, { decision: 'ask' })
  const answer = await $.tool.check({
    tool: 'NotebookEdit',
    input: { notebook_path: '/tmp/analysis.ipynb', new_source: 'print(1)' },
  })
  expect(answer.decision).toBe('allow')
})

test('Read inside the home runs', async ($, on) => {
  engine(on, { decision: 'ask' })
  const answer = await $.tool.check({ tool: 'Read', input: { file_path: `${HOME}/.zshrc` } })
  expect(answer.decision).toBe('allow')
})

test('Read outside the home is left to the engine', async ($, on) => {
  engine(on, { decision: 'ask' })
  const answer = await $.tool.check({ tool: 'Read', input: { file_path: '/etc/hosts' } })
  expect(answer.decision).toBe('ask')
})

// ── the web tools ─────────────────────────────────────────────────────

test('the web tools run, over a deny beneath', async ($, on) => {
  engine(on, { decision: 'deny' })
  const fetch = await $.tool.check({ tool: 'WebFetch', input: { url: 'https://example.com', prompt: 'summarize' } })
  expect(fetch.decision).toBe('allow')
  const search = await $.tool.check({ tool: 'WebSearch', input: { query: 'claude code mods', mode: 'standard' } })
  expect(search.decision).toBe('allow')
})

test('a settings ask rule holds for the web tools', async ($, on) => {
  engine(on, { decision: 'ask', rule: 'WebFetch(domain:example.com)' })
  const answer = await $.tool.check({ tool: 'WebFetch', input: { url: 'https://example.com', prompt: 'summarize' } })
  expect(answer.decision).toBe('ask')
})

// ── /allowifier: the switch, flipped ─────────────────────────────────

// The engine beneath, for a /allowifier run: the session's facts, the
// switch installed (the same bytes both places, so nothing is written),
// the marker saying which way it stands, and the switch's own words for
// the way it was asked to flip. The runs record what ran.
function switchEngine(on: On, marker: boolean, words: string): (readonly string[])[] {
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('session.start', () => ({ cwd: HOME }))
  on('command.register', () => ({ value: { command: 'allowifier' } }))
  on('fs.read', (_, { path }) => ({ value: path.endsWith('bin/allowifier') ? 'the switch' : '' }))
  on('fs.exists', (_, { path }) => ({
    value: path === `${HOME}/.local/bin/allowifier` || (marker && path === `${HOME}/.claude/allowifier.off`),
  }))
  const runs: (readonly string[])[] = []
  on('process.run', (_, { argv }) => { runs.push(argv); return { value: { exitCode: 0, stdout: words, stderr: '' } } })
  return runs
}

test('/allowifier flips it off when it is on', async ($, on) => {
  const runs = switchEngine(on, false, 'allowifier off; the next claude loads the org settings')
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'allowifier' })
  expect(answer.text).toContain('allowifier off')
  expect(runs).toEqual([[`${HOME}/.local/bin/allowifier`, 'off']])
})

test('/allowifier flips it back on when the marker says off', async ($, on) => {
  const runs = switchEngine(on, true, 'allowifier on; plain claude runs without the org layer')
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'allowifier' })
  expect(answer.text).toContain('allowifier on')
  expect(runs).toEqual([[`${HOME}/.local/bin/allowifier`, 'on']])
})

test('/allowifier on says which way', async ($, on) => {
  const runs = switchEngine(on, true, 'allowifier on; on top of intility-inference — the org layer does not load')
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'allowifier', args: 'on' })
  expect(answer.text).toContain('allowifier on')
  expect(runs).toEqual([[`${HOME}/.local/bin/allowifier`, 'on']])
})

test('/allowifier off says which way', async ($, on) => {
  const runs = switchEngine(on, false, "allowifier off; intility-inference's line is back whole")
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'allowifier', args: 'off' })
  expect(answer.text).toContain('allowifier off')
  expect(runs).toEqual([[`${HOME}/.local/bin/allowifier`, 'off']])
})

test('/allowifier status asks where things stand', async ($, on) => {
  const runs = switchEngine(on, false, 'allowifier: on — on top of intility-inference')
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'allowifier', args: 'status' })
  expect(answer.text).toContain('allowifier: on')
  expect(runs).toEqual([[`${HOME}/.local/bin/allowifier`, 'status']])
})

test('/allowifier takes no other argument', async ($, on) => {
  const runs = switchEngine(on, false, 'allowifier off; the next claude loads the org settings')
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'allowifier', args: 'bogus' })
  expect(answer.text).toContain('usage')
  expect(runs).toEqual([])
})

// ── /inference: the dance, cooperated ────────────────────────────────

const CANONICAL_SETTINGS = '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:8793","_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL":"1"},"model":"glm-5-3"}'
const COMPOSED_SETTINGS = '{"env":{"ANTHROPIC_BASE_URL":"http://localhost:8793"},"model":"glm-5-3"}'

// The engine beneath, for an /inference command over a composed
// line: the settings file as state (each write moves it, as the real
// file would move), the gateway answering as intility-inference, and
// a stand-in for intility-inference's own command handler beneath
// the plugins — the daemon it would spawn is its half, not the
// test's. simulate stands in for what that daemon did.
function danceEngine(
  on: On,
  startSettings: string,
  simulate?: (args: string, setSettings: (text: string) => void) => void,
): { writes: { path: string; text: string }[] } {
  let settingsText = startSettings
  const setSettings = (text: string): void => {
    settingsText = text
  }
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('session.start', () => ({ cwd: HOME }))
  on('command.register', () => ({ value: { command: 'allowifier' } }))
  on('fs.read', (_, { path }) => ({
    value: path === `${HOME}/.claude/settings.json` ? settingsText
      : path.endsWith('bin/allowifier') ? 'the switch'
        : '',
  }))
  on('fs.exists', (_, { path }) => ({ value: path === `${HOME}/.claude/intility-inference/session.json` }))
  on('process.run', (_, { argv }) => ({
    value: { exitCode: 0, stdout: argv.some(a => a.includes('healthz')) ? '{"gateway":"intility-inference"}' : '', stderr: '' },
  }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, { path, text }) => {
    if (path === `${HOME}/.claude/settings.json`) settingsText = text
    writes.push({ path, text })
    return { value: undefined }
  })
  on('command.run', (_, e) => {
    simulate?.((e.args ?? '').trim(), setSettings)
    return { value: { text: 'intility-inference: the daemon did its part' } }
  })
  return { writes }
}

test('/inference on over a composed line: aside, then back on top', async ($, on) => {
  // the daemon arms: its canonical line lands in the settings file
  const { writes } = danceEngine(on, COMPOSED_SETTINGS, (args, setSettings) => {
    if (args === 'on') setSettings(CANONICAL_SETTINGS)
  })
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inference', args: 'on' })

  const settingsWrites = writes.filter(w => w.path === `${HOME}/.claude/settings.json`)
  expect(settingsWrites.length).toBe(2)
  // aside: intility-inference's lines back, whole
  const aside = JSON.parse(settingsWrites[0]!.text)
  expect(aside.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8793')
  expect(aside.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL).toBe('1')
  expect(aside.model).toBe('glm-5-3')
  // and back: composed again, over what it armed
  const composed = JSON.parse(settingsWrites[1]!.text)
  expect(composed.env.ANTHROPIC_BASE_URL).toBe('http://localhost:8793')
  expect(composed.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL).toBeUndefined()
  expect(composed.model).toBe('glm-5-3')
})

test('/inference off over a composed line: aside, and it stays out', async ($, on) => {
  const { writes } = danceEngine(on, COMPOSED_SETTINGS)
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inference', args: 'off' })

  const settingsWrites = writes.filter(w => w.path === `${HOME}/.claude/settings.json`)
  expect(settingsWrites.length).toBe(1)
  const aside = JSON.parse(settingsWrites[0]!.text)
  expect(aside.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8793')
  expect(aside.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL).toBe('1')
})

test('/inference status passes through untouched', async ($, on) => {
  const { writes } = danceEngine(on, COMPOSED_SETTINGS)
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'inference', args: 'status' })
  expect(writes).toEqual([])
})

test('a composed line with inference out is taken back at session start', async ($, on) => {
  on('session.start', () => ({ cwd: HOME }))
  on('env.get', { name: 'HOME' }, () => ({ value: HOME }))
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'allowifier' } }))
  on('fs.read', { path: `${HOME}/.claude/settings.json` }, () => ({ value: COMPOSED_SETTINGS }))
  // inference is out: its off marker is there
  on('fs.exists', (_, { path }) => ({ value: path === `${HOME}/.claude/intility-inference/off` }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, { path, text }) => { writes.push({ path, text }); return { value: undefined } })

  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  // the repair is not waited on — give it a moment to land
  await new Promise(r => setTimeout(r, 25))

  const settings = writes.find(w => w.path === `${HOME}/.claude/settings.json`)
  expect(settings).toBeDefined()
  const written = JSON.parse(settings!.text)
  expect(written.env).toBeUndefined()
  expect(written.model).toBe('glm-5-3')
})
