#!/usr/bin/env node
// Interop proof: the gateway's crypto reproduces the client's recorded sign vectors
// byte-for-byte and verifies the recorded signatures. If this passes, signatures the
// app produces with device.ts will verify here. Dev-only — reads the repo fixture by
// relative path and is NOT shipped in the container image.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { buildSignInput, verifySignature } from './src/crypto.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, '../../src/main/resolve/plugin/__fixtures__/sign-vectors.json')

const vectors = JSON.parse(readFileSync(fixture, 'utf-8'))
assert.ok(Array.isArray(vectors) && vectors.length > 0, 'no vectors found')

for (const v of vectors) {
  const nonce = Buffer.from(v.nonceB64, 'base64')
  const input = buildSignInput(v.op, v.deviceId, v.nonceId, nonce, v.ts)
  assert.equal(input.toString('hex'), v.inputHex, `canonical input mismatch (${v.deviceId})`)
  assert.equal(
    verifySignature(v.pubKeyB64, input, v.sigB64),
    true,
    `signature did not verify (${v.deviceId})`
  )
}

console.log(`check-vectors: OK — ${vectors.length} client vectors verified against gateway crypto`)
