// Crypto primitives for the gateway. Native node:crypto only — no dependencies.
// buildSignInput + verifySignature are byte-identical to the client's device.ts so
// signatures produced by the app verify here (see check-vectors.mjs for the proof).
import {
  createHash,
  createPublicKey,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  verify
} from 'node:crypto'

export const OP_CONFIG = 1
export const OP_REVOKE = 2

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 32

// "scrypt$N$r$p$saltB64$hashB64" — self-describing so params can change without breaking old hashes.
export function hashPassword(plain) {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(plain, stored) {
  try {
    const parts = String(stored).split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, n, r, p, saltB64, hashB64] = parts
    const expected = Buffer.from(hashB64, 'base64')
    const actual = scryptSync(plain, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p)
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// PKCE S256: BASE64URL(SHA256(verifier)) === code_challenge (constant-time compare).
export function verifyPkce(verifier, challenge) {
  try {
    const computed = Buffer.from(createHash('sha256').update(String(verifier)).digest('base64url'))
    const given = Buffer.from(String(challenge))
    return computed.length === given.length && timingSafeEqual(computed, given)
  } catch {
    return false
  }
}

// Canonical sign-input (client v2 design §7): "CPX2" | u8 op | u8 len+deviceId | u8 len+nonceId | 32B nonce | u64be ts
export function buildSignInput(op, deviceId, nonceId, nonce, ts) {
  const did = Buffer.from(deviceId, 'utf-8')
  const nid = Buffer.from(nonceId, 'utf-8')
  if (did.length > 255 || nid.length > 255) throw new Error('deviceId/nonceId too long')
  const tsB = Buffer.alloc(8)
  tsB.writeBigUInt64BE(BigInt(ts))
  return Buffer.concat([
    Buffer.from('CPX2', 'ascii'),
    Buffer.from([op & 0xff]),
    Buffer.from([did.length]),
    did,
    Buffer.from([nid.length]),
    nid,
    nonce,
    tsB
  ])
}

// Ed25519 verify. pubKey is the raw 32-byte point (standard base64), sig is raw 64 bytes (standard base64).
export function verifySignature(pubKeyB64, input, sigB64) {
  try {
    const raw = Buffer.from(pubKeyB64, 'base64')
    if (raw.length !== 32) return false
    const sig = Buffer.from(sigB64, 'base64')
    if (sig.length !== 64) return false
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
      format: 'jwk'
    })
    return verify(null, input, key, sig)
  } catch {
    return false
  }
}
