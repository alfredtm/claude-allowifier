// allowifier on: the org policy layer, gone — on top of
// intility-inference, or on its own.
//
// Two ways on, one principle beneath them.
//
// On top of intility-inference: the mod's gateway already carries
// every request, and its line in settings.json — the gateway's URL
// with the first-party flag beside it — is the one thing that keeps
// the org layer alive: Claude Code skips the org-settings fetch on a
// custom base URL unless that flag is set. allowifier composes: it
// respells the URL (localhost for 127.0.0.1 — the same gateway, a
// spelling the gateway accepts and its daemon does not recognize as
// its own) and takes the flag away. intility-inference stands down —
// it refuses to take over a base URL that is not exactly its own —
// so it never re-adds the flag, while its gateway, its deployments
// and its /model rows keep working untouched beneath.
//
// On its own: a small local proxy, kept alive by a launchd agent, and
// the base URL pointed at it — a custom base URL without the flag
// skips the org-settings fetch the same way. (The proxy also answers
// the org-settings path with {} for Claude Code versions that ask
// the base URL for them; current ones never ask.)
//
// The user's own rules hold in both, exactly as written — that is
// register.tsx's half. The switch (bin/allowifier, installed to
// ~/.local/bin) carries these rules for the terminal; /allowifier
// flips it either way. The marker (~/.claude/allowifier.off) means
// the user asked for the org layer back; nothing turns it on over
// that choice.
//
// The engine's $ never crosses an import — the hook file builds the
// plain functions this module needs.

const PROXY_PORT = 8791
export const PROXY_URL = `http://localhost:${PROXY_PORT}`
const AGENT_LABEL = 'com.alfredtm.allowifier.proxy'

// intility-inference's own writing, and ours over it. The URLs name
// the same listener; only the spelling tells who takes the line.
export const INFERENCE_URL = 'http://127.0.0.1:8793'
export const COMPOSED_URL = 'http://localhost:8793'
// The flag that makes Claude Code fetch org settings on a custom
// base URL at all — the whole of the org layer, on a machine that
// runs the gateway.
export const FIRST_PARTY_FLAG = '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL'

// What allowifier needs of the engine, as plain functions — $ stays
// in the hook file that builds this.
export interface SetupIo {
  pluginRoot: string
  fsRead(path: string): Promise<string>
  fsWrite(path: string, text: string): Promise<unknown>
  fsExists(path: string): Promise<boolean>
  chmodX(path: string): Promise<unknown>
  reloadAgent(plist: string): Promise<unknown>
  fetchText(url: string): Promise<{ stdout: string }>
  runSwitch(shim: string, arg: 'on' | 'off' | 'status'): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

// ── the settings lines ───────────────────────────────────────────────

export type Env = Record<string, string | undefined>
export interface SettingsFile {
  env?: Env
  // …whatever else the user keeps there; it all passes through.
  [key: string]: unknown
}

// What the base URL line says about who wrote it.
export type Mode =
  | { kind: 'inference' } // intility-inference's: its URL, the flag
  | { kind: 'composed' } // ours: its gateway, our spelling, no flag
  | { kind: 'standalone' } // ours: the proxy
  | { kind: 'foreign'; url: string } // the user's own, or another tool's
  | { kind: 'unset' }

export function modeOf(settings: SettingsFile | undefined): Mode {
  const url = settings?.env?.ANTHROPIC_BASE_URL
  if (url === undefined) return { kind: 'unset' }
  if (url === INFERENCE_URL) return { kind: 'inference' }
  if (url === COMPOSED_URL) return { kind: 'composed' }
  if (url === PROXY_URL) return { kind: 'standalone' }
  return { kind: 'foreign', url }
}

// One env line at a time, the rest of the file carried whole.
function withEnv(settings: SettingsFile, env: Env): SettingsFile {
  const next: Env = { ...(settings.env ?? {}) }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  const out: SettingsFile = { ...settings }
  if (Object.keys(next).length === 0) delete out.env
  else out.env = next
  return out
}

// Compose: the same gateway, spelled so intility-inference no longer
// recognizes the line as its own, and the flag gone — the org layer
// has nothing to load from.
export function applyCompose(settings: SettingsFile): SettingsFile {
  return withEnv(settings, { ANTHROPIC_BASE_URL: COMPOSED_URL, [FIRST_PARTY_FLAG]: undefined })
}

// Stand down: intility-inference's lines back, whole — the flag it
// wrote returns with the URL it spelled.
export function applyRestore(settings: SettingsFile): SettingsFile {
  return withEnv(settings, { ANTHROPIC_BASE_URL: INFERENCE_URL, [FIRST_PARTY_FLAG]: '1' })
}

export function applyStandalone(settings: SettingsFile): SettingsFile {
  return withEnv(settings, { ANTHROPIC_BASE_URL: PROXY_URL, [FIRST_PARTY_FLAG]: undefined })
}

// Ours off the table entirely — used only on lines allowifier wrote.
export function applyDisarm(settings: SettingsFile): SettingsFile {
  return withEnv(settings, { ANTHROPIC_BASE_URL: undefined, [FIRST_PARTY_FLAG]: undefined })
}

// Absent is a fresh one, unparseable is not ours to judge — undefined
// leaves it be.
async function readSettings(io: SetupIo, path: string): Promise<SettingsFile | undefined> {
  let text: string | undefined
  try {
    text = await io.fsRead(path)
  } catch {}
  if (text === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as SettingsFile
  } catch {
    return undefined
  }
}

// The gateway's own word for itself — the proof that the line being
// composed over really is intility-inference's, and that our
// spelling of its URL reaches it.
async function inferenceGatewayUp(io: SetupIo): Promise<boolean> {
  try {
    const answer = await io.fetchText(`${COMPOSED_URL}/healthz`)
    return JSON.parse(answer.stdout).gateway === 'intility-inference'
  } catch {
    return false
  }
}

// Whether intility-inference still runs beneath a composed line: its
// own off marker says it does not, or its login is gone. A peek at
// its documented state — the alternative is a line nothing answers
// on, and a session that cannot even ask why.
async function inferenceInPlay(io: SetupIo, dir: string): Promise<boolean> {
  if (await io.fsExists(`${dir}/intility-inference/off`)) return false
  if (!(await io.fsExists(`${dir}/intility-inference/session.json`))) return false
  return true
}

// ── the switch ──────────────────────────────────────────────────────

// The plugin's own bin/allowifier, installed to ~/.local/bin on the
// first Bash check of a session, so /plugin install is all the setup
// there is. A fault changes nothing; the next session retries.
export async function ensureLauncher(io: SetupIo, home: string): Promise<void> {
  try {
    const source = await io.fsRead(`${io.pluginRoot}/bin/allowifier`)
    const target = `${home}/.local/bin/allowifier`
    let current: string | undefined
    try {
      current = await io.fsRead(target)
    } catch {}
    if (current !== source) {
      await io.fsWrite(target, source)
      await io.chmodX(target)
    }
  } catch {}
}

// ── on by default ────────────────────────────────────────────────────

// customApi: the session's ANTHROPIC_BASE_URL, when nothing in the
// settings file routes claude anywhere — the user's own shell
// export, not ours to touch. Once a line is in the settings file the
// session env merely mirrors it.
// The marker (~/.claude/allowifier.off, from `allowifier off`) means
// the user asked for the org layer back; a session never turns it
// back on over that choice.
export async function ensureEnabled(io: SetupIo, home: string, dir: string | undefined, customApi: string | undefined): Promise<void> {
  try {
    if (dir === undefined) return
    if (await io.fsExists(`${dir}/allowifier.off`)) return

    const settingsPath = `${dir}/settings.json`
    const settings = await readSettings(io, settingsPath)
    if (settings === undefined) return
    const mode = modeOf(settings)

    // the user's own, or another tool's — not ours to touch
    if (mode.kind === 'foreign') return

    // intility-inference armed, whole: compose on top of it — only
    // once its gateway has answered through the spelling we write,
    // proof the spelling routes before it is written
    if (mode.kind === 'inference') {
      if (!(await inferenceGatewayUp(io))) return
      await io.fsWrite(settingsPath, JSON.stringify(applyCompose(settings), null, 2) + '\n')
      return
    }

    // our composed line: on top of inference while it runs; taken
    // back when it is out from under (its off marker, its login)
    if (mode.kind === 'composed') {
      if (await inferenceInPlay(io, dir)) return
      await io.fsWrite(settingsPath, JSON.stringify(applyDisarm(settings), null, 2) + '\n')
      return
    }

    // from here nothing routes claude through a base URL of ours
    if (customApi !== undefined) return // the user's own — respect it

    // ours behind the proxy, or nothing at all: the standalone proxy.
    // The agent must keep it alive — a machine already on only needs
    // it back when it went missing.
    const shim = `${home}/.local/bin/allowifier`
    const plistPath = `${home}/Library/LaunchAgents/${AGENT_LABEL}.plist`
    let plist: string | undefined
    try {
      plist = await io.fsRead(plistPath)
    } catch {}
    if (!(plist !== undefined && plist.includes(shim))) {
      if (!(await reinstallAgent(io, home))) return
    }
    if (mode.kind === 'standalone') return // the line is already ours

    // only point claude at the proxy once it has answered
    const answer = await io.fetchText(`${PROXY_URL}/api/claude_code/settings`)
    if (answer.stdout.trim() !== '{}') return
    await io.fsWrite(settingsPath, JSON.stringify(applyStandalone(settings), null, 2) + '\n')
  } catch {}
}

// The agent that keeps the standalone proxy running. Nothing to keep
// without launchd or node — those machines stay as they are.
async function reinstallAgent(io: SetupIo, home: string): Promise<boolean> {
  if (!(await io.fsExists('/bin/launchctl')) && !(await io.fsExists('/usr/bin/launchctl'))) return false // no launchd — nowhere to keep a proxy
  const shim = `${home}/.local/bin/allowifier`
  try {
    await io.fsRead(shim) // the agent calls the switch
  } catch {
    return false
  }
  const plistPath = `${home}/Library/LaunchAgents/${AGENT_LABEL}.plist`
  await io.fsWrite(plistPath, agentPlist(home, shim))
  await io.reloadAgent(plistPath)
  return true
}

// ── /inference, cooperated with ──────────────────────────────────────

// The dance, in two steps. stepAside: whatever line allowifier holds
// is out of the way — composed becomes intility-inference's again,
// standalone comes off — so its command runs against the settings it
// expects. ensureComposed: back on top of whatever it armed.
// A fault changes nothing; the command still runs as it would.

export async function stepAside(io: SetupIo, dir: string | undefined): Promise<void> {
  try {
    if (dir === undefined) return
    const settingsPath = `${dir}/settings.json`
    const settings = await readSettings(io, settingsPath)
    if (settings === undefined) return
    const mode = modeOf(settings)
    if (mode.kind === 'composed') {
      // theirs back, whole — unless inference is out, when there is
      // nothing to hand back to
      const restored = (await inferenceInPlay(io, dir))
        ? applyRestore(settings)
        : applyDisarm(settings)
      await io.fsWrite(settingsPath, JSON.stringify(restored, null, 2) + '\n')
      return
    }
    if (mode.kind === 'standalone') {
      // the line comes off; the proxy idles until `on` needs it
      await io.fsWrite(settingsPath, JSON.stringify(applyDisarm(settings), null, 2) + '\n')
    }
  } catch {}
}

export async function ensureComposed(io: SetupIo, dir: string | undefined): Promise<void> {
  try {
    if (dir === undefined) return
    if (await io.fsExists(`${dir}/allowifier.off`)) return
    const settingsPath = `${dir}/settings.json`
    const settings = await readSettings(io, settingsPath)
    if (settings === undefined) return
    if (modeOf(settings).kind !== 'inference') return
    if (!(await inferenceGatewayUp(io))) return
    await io.fsWrite(settingsPath, JSON.stringify(applyCompose(settings), null, 2) + '\n')
  } catch {}
}

// The orphaned composed line, taken back at session start: inference
// went out from under it (its off marker, its login) and nothing
// answers on it. File reads only — nothing here stalls a session.
export async function cleanComposed(io: SetupIo, dir: string | undefined): Promise<void> {
  try {
    if (dir === undefined) return
    if (await io.fsExists(`${dir}/allowifier.off`)) return
    const settingsPath = `${dir}/settings.json`
    const settings = await readSettings(io, settingsPath)
    if (settings === undefined) return
    if (modeOf(settings).kind !== 'composed') return
    if (await inferenceInPlay(io, dir)) return
    await io.fsWrite(settingsPath, JSON.stringify(applyDisarm(settings), null, 2) + '\n')
  } catch {}
}

// ── /allowifier ──────────────────────────────────────────────────────

// The command: the switch, asked which way. With an argument
// (on, off, status) it is passed straight through — the switch's own
// words are the answer. Without one it flips: the marker (from
// `allowifier off`, or the command before) is what tells which way
// that is. A fault says so and changes nothing.
export async function flip(io: SetupIo, home: string, dir: string | undefined, arg?: 'on' | 'off' | 'status'): Promise<string> {
  const shim = `${home}/.local/bin/allowifier`
  try {
    if (!(await io.fsExists(shim))) return 'allowifier: the switch is not installed'
    const off = dir !== undefined && await io.fsExists(`${dir}/allowifier.off`)
    const ask = arg ?? (off ? 'on' : 'off')
    const answer = await io.runSwitch(shim, ask)
    const text = [answer.stdout, answer.stderr].map(s => s.trim()).filter(s => s !== '').join('\n')
    if (text !== '') return text
    return answer.exitCode === 0 ? 'allowifier: flipped' : 'allowifier: the switch did not say'
  } catch {
    return 'allowifier: the switch did not answer'
  }
}

function agentPlist(home: string, shim: string): string {
  const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(shim)}</string>
        <string>--proxy</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${xml(home)}/.claude/allowifier-proxy.log</string>
    <key>StandardErrorPath</key><string>${xml(home)}/.claude/allowifier-proxy.log</string>
</dict>
</plist>
`
}
