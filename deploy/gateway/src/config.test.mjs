import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config.mjs'

test('applies sane defaults for an empty environment', () => {
  const c = loadConfig({})
  assert.equal(c.port, 8080)
  assert.equal(c.dbPath, '/data/gateway.db')
  assert.equal(c.deviceLimitDefault, 3)
  assert.equal(c.codeTtlMs, 60000)
  assert.equal(c.nonceTtlMs, 60000)
  assert.equal(c.noncePoolMax, 8)
  assert.equal(c.clockSkewMs, 300000)
  assert.equal(c.subMaxBytes, 10485760)
  assert.equal(c.retired, false)
})

test('parses numeric overrides as numbers', () => {
  const c = loadConfig({ PORT: '9000', CLOCK_SKEW_MS: '120000', NONCE_POOL_MAX: '4' })
  assert.strictEqual(c.port, 9000)
  assert.strictEqual(c.clockSkewMs, 120000)
  assert.strictEqual(c.noncePoolMax, 4)
})

test('RETIRED is true only for the literal "true"', () => {
  assert.equal(loadConfig({ RETIRED: 'true' }).retired, true)
  assert.equal(loadConfig({ RETIRED: 'false' }).retired, false)
  assert.equal(loadConfig({ RETIRED: '1' }).retired, false)
})

test('derives publicOrigin from DOMAIN when PUBLIC_ORIGIN is unset', () => {
  assert.equal(loadConfig({ DOMAIN: 'gw.example.com' }).publicOrigin, 'https://gw.example.com')
  assert.equal(
    loadConfig({ DOMAIN: 'gw.example.com', PUBLIC_ORIGIN: 'https://other.example' }).publicOrigin,
    'https://other.example'
  )
})

test('the returned config object is frozen', () => {
  const c = loadConfig({})
  assert.throws(() => {
    c.port = 1
  })
})
