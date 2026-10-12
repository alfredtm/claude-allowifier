// allowifier: every command runs, and your own settings' rules
// still hold.
//
// On (setup.ts), allowifier removes the org policy layer at the API:
// org settings are fetched from wherever ANTHROPIC_BASE_URL points,
// and the proxy it keeps running answers that fetch with nothing.
// What remains beneath the mod is the engine's own judgment, and
// over it the mod's one principle:
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
import { ensureLauncher, ensureEnabled, flip } from './setup'
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
    fetchSettings: url => $.process.run(
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

  // /allowifier: the switch, in Claude. One command, no arguments —
  // it flips; the next session runs the new way.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'allowifier',
      description: 'Flip allowifier: the organization policy layer back on, or off again. The next session runs the new way.',
    })
    return next(e)
  }).catch(($, e, next) => next(e))   // a fault leaves the session starting as it would

  on('command.run', { command: 'allowifier' }, async ($, e, next) => {
    if ((e.args ?? '').trim() !== '') return { text: 'usage: /allowifier — no arguments; it flips' }

    const home = await $.env.get('HOME')
    if (home === undefined) return { text: 'allowifier: no home to switch from' }

    const io = setupIo($)
    await ensureLauncher(io, home)   // the switch, there even before a first Bash check
    return { text: await flip(io, home, configDir(home, await $.env.get('CLAUDE_CONFIG_DIR'))) }
  }).catch(($, e, next) => next(e))   // a fault falls to the engine's verdict, never wider
}
