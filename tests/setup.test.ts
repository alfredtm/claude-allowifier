import { expect, test } from 'claude-code/testing'

import {
  applyCompose,
  applyDisarm,
  applyRestore,
  applyStandalone,
  COMPOSED_URL,
  FIRST_PARTY_FLAG,
  INFERENCE_URL,
  modeOf,
  PROXY_URL,
} from '../hooks/setup'

// intility-inference's own writing: its URL, spelled its way, with
// the first-party flag beside it.
function inferenceSettings(): { env: Record<string, string> } {
  return { env: { ANTHROPIC_BASE_URL: INFERENCE_URL, [FIRST_PARTY_FLAG]: '1' } }
}

test('modeOf: each line says who wrote it', () => {
  expect(modeOf(inferenceSettings())).toEqual({ kind: 'inference' })
  expect(modeOf({ env: { ANTHROPIC_BASE_URL: COMPOSED_URL } })).toEqual({ kind: 'composed' })
  expect(modeOf({ env: { ANTHROPIC_BASE_URL: PROXY_URL } })).toEqual({ kind: 'standalone' })
  expect(modeOf({ env: { ANTHROPIC_BASE_URL: 'https://elsewhere.example' } })).toEqual({ kind: 'foreign', url: 'https://elsewhere.example' })
  expect(modeOf({ env: {} })).toEqual({ kind: 'unset' })
  expect(modeOf(undefined)).toEqual({ kind: 'unset' })
  // inference's URL without its flag is still its line — only the
  // spelling tells who takes it, and this one is theirs
  expect(modeOf({ env: { ANTHROPIC_BASE_URL: INFERENCE_URL } })).toEqual({ kind: 'inference' })
})

test('applyCompose: the same gateway, our spelling, the flag gone', () => {
  const next = applyCompose(inferenceSettings())
  expect(next.env).toEqual({ ANTHROPIC_BASE_URL: COMPOSED_URL })
})

test('applyRestore: the inference lines back, whole', () => {
  const next = applyRestore({ env: { ANTHROPIC_BASE_URL: COMPOSED_URL } })
  expect(next.env).toEqual({ ANTHROPIC_BASE_URL: INFERENCE_URL, [FIRST_PARTY_FLAG]: '1' })
})

test('applyStandalone: the proxy, the flag gone', () => {
  const next = applyStandalone({ env: { ANTHROPIC_BASE_URL: INFERENCE_URL, [FIRST_PARTY_FLAG]: '1' } })
  expect(next.env).toEqual({ ANTHROPIC_BASE_URL: PROXY_URL })
})

test('applyDisarm: ours off the table entirely', () => {
  const next = applyDisarm({ env: { ANTHROPIC_BASE_URL: COMPOSED_URL } })
  expect(next.env).toBeUndefined()
})

test('the transitions carry the rest of the file whole', () => {
  const settings = {
    env: { ANTHROPIC_BASE_URL: INFERENCE_URL, [FIRST_PARTY_FLAG]: '1', ANTHROPIC_CUSTOM_HEADERS: 'x: y' },
    permissions: { deny: ['Bash(rm:*)'] },
    model: 'glm-5-3',
  }
  const next = applyCompose(settings)
  expect(next.permissions).toEqual({ deny: ['Bash(rm:*)'] })
  expect(next.model).toBe('glm-5-3')
  expect(next.env).toEqual({ ANTHROPIC_BASE_URL: COMPOSED_URL, ANTHROPIC_CUSTOM_HEADERS: 'x: y' })
  // and back again, nothing lost
  const restored = applyRestore(next)
  expect(restored.env).toEqual(settings.env)
  expect(restored.permissions).toEqual(settings.permissions)
})

test('an empty env does not become an empty object', () => {
  const next = applyDisarm({ env: { ANTHROPIC_BASE_URL: PROXY_URL } })
  expect(JSON.stringify(next)).toBe('{}')
})
