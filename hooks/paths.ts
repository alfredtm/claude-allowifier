// The pure half of allowifier: the path logic, no engine. Kept
// separate from register.tsx so claude plugin test can hold it to
// account.

// What a Bash tool.call's permission decision reads: { command } for Bash.
export function bashCommand(input: unknown): string | undefined {
  const command = (input as { command?: unknown } | null)?.command
  return typeof command === 'string' && command !== '' ? command : undefined
}

// What the file tools' permission decision reads: { file_path } for Read,
// Edit and Write, { notebook_path } for NotebookEdit.
export function filePath(input: unknown): string | undefined {
  const tool = input as { file_path?: unknown; notebook_path?: unknown } | null
  const path = tool?.file_path ?? tool?.notebook_path
  return typeof path === 'string' && path !== '' ? path : undefined
}

// Lexical only: '.' and '..' resolved, symlinks not followed. A guardrail,
// not a security boundary — aliases and $(…) indirection get past it.
export function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return `/${out.join('/')}`
}

export function expand(path: string, home: string, tmpdir: string | undefined): string {
  let p = path
  if (p === '~') p = home
  else if (p.startsWith('~/')) p = home + p.slice(1)
  p = p.replaceAll('$HOME', home)
  if (tmpdir !== undefined) p = p.replaceAll('$TMPDIR', tmpdir)
  return p.replaceAll(/\/{2,}/g, '/')
}

export function insideRoots(path: string, roots: readonly string[]): boolean {
  const abs = normalize(path)
  return roots.some(root => abs === normalize(root) || abs.startsWith(`${normalize(root)}/`))
}

// A tool's operand made absolute: ~ and $VARS expanded, a relative path
// resolved against the session's cwd.
export function absolute(path: string, cwd: string, home: string, tmpdir: string | undefined): string {
  const expanded = expand(path, home, tmpdir)
  return expanded.startsWith('/') ? expanded : `${cwd}/${expanded}`
}

// Where the write tools may write: personal code and the machine's
// scratch space.
export function workRoots(home: string, tmpdir: string | undefined): string[] {
  const roots = [`${home}/repos`, '/tmp', '/private/tmp', '/private/var/folders']
  if (tmpdir !== undefined) {
    roots.push(tmpdir)
    if (tmpdir.startsWith('/var/')) roots.push(`/private${tmpdir}`)
  }
  return roots
}

// The config dir the session answers to: CLAUDE_CONFIG_DIR, else
// ~/.claude, with ~ expanded. undefined when there is no home to
// default from.
export function configDir(home: string | undefined, configDirEnv: string | undefined): string | undefined {
  let dir = configDirEnv ?? (home !== undefined ? `${home}/.claude` : undefined)
  if (dir === undefined) return undefined
  if (dir.startsWith('~/') && home !== undefined) dir = home + dir.slice(1)
  return dir
}
