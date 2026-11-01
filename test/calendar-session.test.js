import test from 'node:test'
import assert from 'node:assert/strict'

const values = new Map()
globalThis.sessionStorage = {
  getItem(key) { return values.get(key) ?? null },
  setItem(key, value) { values.set(key, String(value)) },
  removeItem(key) { values.delete(key) },
}

test('restores a valid Google token for automatic calendar sync after reload', async () => {
  values.set('chronos.google.access-token', 'test-token')
  values.set('chronos.google.access-token.expiresAt', String(Date.now() + 60_000))
  const { isGoogleConnected } = await import('../calendar.js?valid-session')

  assert.equal(isGoogleConnected(), true)
})

test('clears an expired Google session token', async () => {
  values.set('chronos.google.access-token', 'expired-token')
  values.set('chronos.google.access-token.expiresAt', String(Date.now() - 1))
  const { isGoogleConnected } = await import('../calendar.js?expired-session')

  assert.equal(isGoogleConnected(), false)
  assert.equal(values.has('chronos.google.access-token'), false)
  assert.equal(values.has('chronos.google.access-token.expiresAt'), false)
})
