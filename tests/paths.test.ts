import { expect, test } from 'claude-code/testing'

import { absolute, expand, filePath, insideRoots, normalize, workRoots } from '../hooks/paths'

const HOME = '/Users/tester'
const TMP = '/var/folders/ab/xyz/T/'

test('normalize resolves . and .. lexically', () => {
  expect(normalize('/Users/x/repos/../Library')).toBe('/Users/x/Library')
  expect(normalize('/a/./b//c/')).toBe('/a/b/c')
  expect(normalize('/../../etc')).toBe('/etc')
  expect(normalize('/')).toBe('/')
})

test('expand: ~, $HOME, $TMPDIR', () => {
  expect(expand('~', HOME, TMP)).toBe(HOME)
  expect(expand('~/repos/x', HOME, TMP)).toBe(`${HOME}/repos/x`)
  expect(expand('$HOME/repos', HOME, TMP)).toBe(`${HOME}/repos`)
  expect(expand('$TMPDIR/scratch', HOME, TMP)).toBe(`${TMP}scratch`)
  expect(expand('/abs/path', HOME, TMP)).toBe('/abs/path')
})

test('insideRoots: root and child in; .. escapes and prefixes out', () => {
  const roots = workRoots(HOME, TMP)
  expect(insideRoots(`${HOME}/repos`, roots)).toBe(true)
  expect(insideRoots(`${HOME}/repos/mods/x`, roots)).toBe(true)
  expect(insideRoots(`${HOME}/repos/../Library`, roots)).toBe(false)
  expect(insideRoots(`${HOME}/reposister`, roots)).toBe(false)
  expect(insideRoots('/tmp/scratch', roots)).toBe(true)
  expect(insideRoots('/private/tmp/x', roots)).toBe(true)
  expect(insideRoots(`${TMP}claude-123`, roots)).toBe(true)
  expect(insideRoots('/Users/other/repos', roots)).toBe(false)
})

test('filePath: file_path for the file tools, notebook_path for NotebookEdit', () => {
  expect(filePath({ file_path: '/a/b.ts' })).toBe('/a/b.ts')
  expect(filePath({ notebook_path: '/a/nb.ipynb' })).toBe('/a/nb.ipynb')
  expect(filePath({ url: 'https://example.com' })).toBe(undefined)
  expect(filePath({ file_path: 42 })).toBe(undefined)
  expect(filePath({ file_path: '' })).toBe(undefined)
  expect(filePath(null)).toBe(undefined)
})

test('absolute: relative against the cwd, ~ and $VARS expanded', () => {
  expect(absolute('src/x.ts', `${HOME}/repos/p`, HOME, TMP)).toBe(`${HOME}/repos/p/src/x.ts`)
  expect(absolute('~/repos/x', '/any/cwd', HOME, TMP)).toBe(`${HOME}/repos/x`)
  expect(absolute('$HOME/repos/y', '/any/cwd', HOME, TMP)).toBe(`${HOME}/repos/y`)
  expect(absolute('/tmp/a', '/any/cwd', HOME, TMP)).toBe('/tmp/a')
})
