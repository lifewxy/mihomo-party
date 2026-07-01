import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  OP_CONFIG,
  OP_REVOKE,
  hashPassword,
  verifyPassword,
  verifyPkce,
  buildSignInput,
  verifySignature
} from './crypto.mjs'

// One recorded cross-language vector (mirrors the client's sign-vectors.json fixture).
const VEC = {
  op: 1,
  deviceId: '11111111-1111-4111-8111-111111111111',
  nonceId: 'nonce-1',
  pubKeyB64: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=',
  nonceB64: 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=',
  ts: 1700000000000,
  inputHex:
    '43505832012431313131313131312d313131312d343131312d383131312d313131313131313131313131076e6f6e63652d31aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000018bcfe56800',
  sigB64: 'to+fTc12+7n2enMcfUXeZRT4ro7KUQfvWe5GXQ+BzvLY1Baoo+9RFCMGVkkv0JH9pLMjKCb5ViBRzQ9pFe12Cg=='
}

test('op constants match the wire protocol', () => {
  assert.equal(OP_CONFIG, 1)
  assert.equal(OP_REVOKE, 2)
})

test('hashPassword/verifyPassword round-trips and rejects wrong password', () => {
  const stored = hashPassword('s3cret-pw')
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  assert.equal(verifyPassword('s3cret-pw', stored), true)
  assert.equal(verifyPassword('wrong', stored), false)
})

test('verifyPassword returns false on a malformed stored hash', () => {
  assert.equal(verifyPassword('x', 'not-a-hash'), false)
  assert.equal(verifyPassword('x', ''), false)
})

test('verifyPkce accepts BASE64URL(SHA256(verifier)) and rejects mismatch', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  assert.equal(verifyPkce(verifier, challenge), true)
  assert.equal(verifyPkce(verifier, challenge + 'x'), false)
  assert.equal(verifyPkce('different', challenge), false)
})

test('buildSignInput reproduces the recorded canonical byte string', () => {
  const nonce = Buffer.from(VEC.nonceB64, 'base64')
  const input = buildSignInput(VEC.op, VEC.deviceId, VEC.nonceId, nonce, VEC.ts)
  assert.equal(input.toString('hex'), VEC.inputHex)
})

test('verifySignature accepts the recorded signature and rejects tampering', () => {
  const nonce = Buffer.from(VEC.nonceB64, 'base64')
  const input = buildSignInput(VEC.op, VEC.deviceId, VEC.nonceId, nonce, VEC.ts)
  assert.equal(verifySignature(VEC.pubKeyB64, input, VEC.sigB64), true)

  const tampered = buildSignInput(OP_REVOKE, VEC.deviceId, VEC.nonceId, nonce, VEC.ts)
  assert.equal(verifySignature(VEC.pubKeyB64, tampered, VEC.sigB64), false)
})

test('verifySignature returns false on a garbage signature instead of throwing', () => {
  const nonce = Buffer.from(VEC.nonceB64, 'base64')
  const input = buildSignInput(VEC.op, VEC.deviceId, VEC.nonceId, nonce, VEC.ts)
  assert.equal(verifySignature(VEC.pubKeyB64, input, 'not-base64-!!!'), false)
  assert.equal(verifySignature('bad-pubkey', input, VEC.sigB64), false)
})
