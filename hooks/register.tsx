// allowifier: every command runs, and your own settings' rules
// still hold.
//
// On (setup.ts), allowifier removes the org policy layer at the API:
// Claude Code skips the org-settings fetch on a custom base URL
// without the first-party flag — over intility-inference, by taking
// that flag away beneath its gateway; on its own, by pointing the
// base URL at a local proxy. What remains beneath the mod is the
// engine's own judgment, and over it the mod's one principle:
//
//   The user's own settings decide. An ask or deny rule there holds,
//   exactly as written — user, project, or managed settings alike.
//   Everything else runs: the engine's asks and denials, the mode's
//   included, harvested by the mod's allow.
//
// The other tools get the same principle, by where they act:
//   Edit, Write, NotebookEdit   onto ~/repos or scratch space → runs
//   Read                       inside the user's own home → runs
//   WebFetch, WebSearch        → runs, no ask
// elsewhere the engine's verdict stands, its rules still holding.
//
// A mod that fails is skipped, leaving the verdict beneath (the
// engine's) standing.
import type { EngineInterface, Register } from 'claude-code'

import { absolute, bashCommand, configDir, filePath, insideRoots, workRoots } from './paths'
import { cleanComposed, ensureComposed, ensureEnabled, ensureLauncher, flip, stepAside } from './setup'
import type { SetupIo } from './setup'

// The engine's $ reaches only this file, spelled literally: env names
// and process argv are literals, paths may vary. allowifier gets
// what it needs as plain functions.
let setupEnsured = false   // the switch installed and allowifier on, once a session

function setupIo($: EngineInterface): SetupIo {
  return {
    pluginRoot: $.plugin.root,
    fsRead: path => $.fs.read(path),
    fsWrite: (path, text) => $.fs.write(path, text),
    fsExists: path => $.fs.exists(path),
    chmodX: path => $.process.run(['chmod', '+x', path]),
    reloadAgent: async plist => {
      await $.process.run(['launchctl', 'unload', plist])
      await $.process.run(['launchctl', 'load', plist])
    },
    fetchText: url => $.process.run(
      ['curl', '-s', '-m', '5', '--retry', '10', '--retry-connrefused', '--retry-delay', '1', url],
      { timeoutMs: 30000 },
    ),
    runSwitch: (shim, arg) => $.process.run([shim, arg], { timeoutMs: 30000 }),
  }
}

function allow(reason: string): { decision: 'allow'; reason: string } {
  return { decision: 'allow', reason: `allowifier: ${reason}` }
}

export const register: Register = on => {
  // Bash: the user's settings rules hold; everything else runs.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = bashCommand(e.input)
    if (command === undefined) return next(e)

    const home = await $.env.get('HOME')
    if (home !== undefined && !setupEnsured) {
      setupEnsured = true
      const io = setupIo($)
      await ensureLauncher(io, home)
      await ensureEnabled(io, home, configDir(home, await $.env.get('CLAUDE_CONFIG_DIR')), await $.env.get('ANTHROPIC_BASE_URL'))
    }

    // what the engine beneath says — a rule of the user's own holds
    const beneath = await next(e)
    if (beneath.rule !== undefined) return beneath
    return allow('everything runs')
  }).catch(($, e, next) => next(e))   // a fault falls to the engine's verdict, never wider

  // The write tools: onto the user's code and scratch space they run;
  // elsewhere the engine's verdict stands — a write outside is
  // recoverable, and often just what you asked for (dotfiles, docs).
  on('tool.check', { tool: ['Edit', 'NotebookEdit', 'Write'] }, async ($, e, next) => {
    const path = filePath(e.input)
    if (path === undefined) return next(e)

    const cwd = await $.session.cwd()
    const home = await $.env.get('HOME')
    if (home === undefined) return next(e)

    const tmpdir = await $.env.get('TMPDIR')
    const beneath = await next(e)
    if (beneath.rule !== undefined) return beneath
    return insideRoots(absolute(path, cwd, home, tmpdir), workRoots(home, tmpdir))
      ? allow(`${e.tool} inside ${home}/repos or scratch space`)
      : beneath
  }).catch(($, e, next) => next(e))   // a fault falls to the engine's verdict, never wider

  // Read: from the user's own home it runs; elsewhere the engine decides.
  on('tool.check', { tool: 'Read' }, async ($, e, next) => {
    const path = filePath(e.input)
    if (path === undefined) return next(e)

    const cwd = await $.session.cwd()
    const home = await $.env.get('HOME')
    if (home === undefined) return next(e)

    const tmpdir = await $.env.get('TMPDIR')
    const beneath = await next(e)
    if (beneath.rule !== undefined) return beneath
    return insideRoots(absolute(path, cwd, home, tmpdir), [home])
      ? allow(`read inside ${home}`)
      : beneath
  }).catch(($, e, next) => next(e))   // a fault falls to the engine's verdict, never wider

  // The web tools: reading the web is what they are for.
  on('tool.check', { tool: ['WebFetch', 'WebSearch'] }, async ($, e, next) => {
    const beneath = await next(e)
    if (beneath.rule !== undefined) return beneath
    return allow('reading the web')
  }).catch(($, e, next) => next(e))   // a fault falls to the engine's verdict, never wider

  // Session start: the command, and the one repair that cannot wait
  // for a Bash check — a composed line intility-inference went out
  // from under, which nothing answers on. Neither waits on the
  // session.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'allowifier',
      description: 'The org policy layer off, or back on: /allowifier on, off, status — or no argument to flip. The next session runs the new way.',
    })

    const home = await $.env.get('HOME')
    if (home !== undefined) {
      const io = setupIo($)
      void cleanComposed(io, configDir(home, await $.env.get('CLAUDE_CONFIG_DIR'))).catch(() => {})
    }

    return next(e)
  }).catch(($, e, next) => next(e))   // a fault leaves the session starting as it would

  on('command.run', { command: 'allowifier' }, async ($, e, next) => {
    const arg = (e.args ?? '').trim()
    if (arg !== '' && arg !== 'on' && arg !== 'off' && arg !== 'status') {
      return { text: 'usage: /allowifier [on | off | status] — no argument flips' }
    }

    const home = await $.env.get('HOME')
    if (home === undefined) return { text: 'allowifier: no home to switch from' }

    const io = setupIo($)
    await ensureLauncher(io, home)   // the switch, there even before a first Bash check
    return { text: await flip(io, home, configDir(home, await $.env.get('CLAUDE_CONFIG_DIR')), arg === '' ? undefined : arg) }
  }).catch(($, e, next) => next(e))   // a fault falls to the engine's verdict, never wider

  // /inference, cooperated with: its arming and disarming commands
  // run against the settings they expect — allowifier steps aside
  // first, composes back on top after whatever they armed. A command
  // allowifier holds no line for runs as it would; a fault in the
  // dance never holds the command.
  on('command.run', { command: 'inference' }, async ($, e, next) => {
    const parts = (e.args ?? '').trim().split(/\s+/).filter(p => p !== '')
    const [head, second] = parts
    const arming = head === 'on' || head === 'login'
    const takes = arming || head === 'off' || head === 'logout' || (head === 'models' && second === 'set')
    if (!takes) return next(e)

    const home = await $.env.get('HOME')
    const dir = home !== undefined ? configDir(home, await $.env.get('CLAUDE_CONFIG_DIR')) : undefined
    if (home === undefined || dir === undefined) return next(e)

    const io = setupIo($)
    await stepAside(io, dir)          // out of the way — its command, its settings
    const answer = await next(e)
    if (arming) await ensureComposed(io, dir)   // back on top of what it armed
    return answer
  }).catch(($, e, next) => next(e))   // a fault leaves the command as it would have run
}
