import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeVault, readVault, removeVault, isVaultPersistent } from './vault'

let TMP = ''
let encryptionAvailable = true

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf-8'),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf-8').replace(/^enc:/, '')
  }
}))

vi.mock('../../utils/dirs', () => ({
  pluginVaultDir: () => TMP,
  pluginVaultPath: (id: string) => join(TMP, `${id}.bin`)
}))

function sampleVault(): IPluginVault {
  return {
    devicePrivKey: Buffer.alloc(32, 1).toString('base64'),
    deviceId: '11111111-1111-4111-8111-111111111111',
    gateway: {
      gateway: 'https://gw.front.com',
      endpoints: {
        enroll: '/enroll',
        challenge: '/challenge',
        config: '/config',
        revoke: '/revoke'
      }
    }
  }
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cpxvault-'))
  encryptionAvailable = true
})
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

describe('vault with safeStorage available', () => {
  it('round-trips through an encrypted file', async () => {
    await writeVault('p1', sampleVault())
    expect(existsSync(join(TMP, 'p1.bin'))).toBe(true)
    const out = await readVault('p1')
    expect(out?.deviceId).toBe('11111111-1111-4111-8111-111111111111')
    expect(out?.gateway.gateway).toBe('https://gw.front.com')
  })
  it('removeVault deletes the file', async () => {
    await writeVault('p1', sampleVault())
    await removeVault('p1')
    expect(existsSync(join(TMP, 'p1.bin'))).toBe(false)
    expect(await readVault('p1')).toBeUndefined()
  })
  it('isVaultPersistent is true', () => {
    expect(isVaultPersistent()).toBe(true)
  })
  it('decrypts from disk when the in-memory cache is cold', async () => {
    await writeVault('p3', sampleVault())
    // Simulate a fresh process/launch: empty in-memory cache, file still on disk.
    vi.resetModules()
    const fresh = await import('./vault')
    const out = await fresh.readVault('p3')
    expect(out?.deviceId).toBe('11111111-1111-4111-8111-111111111111')
    expect(out?.gateway.gateway).toBe('https://gw.front.com')
  })
  it('treats a structurally-invalid decrypted vault as missing', async () => {
    const { writeFileSync } = await import('fs')
    // mock safeStorage 仅在明文前加 'enc:'；落一个缺字段/坏私钥的结构到磁盘
    const bad = Buffer.from('enc:' + JSON.stringify({ devicePrivKey: 'short', deviceId: 'x' }))
    writeFileSync(join(TMP, 'pbad.bin'), bad)
    vi.resetModules()
    const fresh = await import('./vault')
    expect(await fresh.readVault('pbad')).toBeUndefined()
  })

  it('rejects a vault with a forbidden gateway origin or malformed endpoint', async () => {
    const { writeFileSync } = await import('fs')
    const base = {
      devicePrivKey: Buffer.alloc(32, 1).toString('base64'),
      deviceId: '11111111-1111-4111-8111-111111111111'
    }
    const eps = { enroll: '/e', challenge: '/c', config: '/cfg', revoke: '/r' }
    const cases: Array<[string, unknown]> = [
      ['vlocal', { ...base, gateway: { gateway: 'https://localhost', endpoints: eps } }],
      [
        'vproto',
        {
          ...base,
          gateway: { gateway: 'https://gw.front.com', endpoints: { ...eps, config: '//evil/cfg' } }
        }
      ],
      [
        'vquery',
        {
          ...base,
          gateway: { gateway: 'https://gw.front.com', endpoints: { ...eps, config: '/cfg?x=1' } }
        }
      ]
    ]
    for (const [id, payload] of cases) {
      writeFileSync(join(TMP, `${id}.bin`), Buffer.from('enc:' + JSON.stringify(payload)))
    }
    vi.resetModules()
    const fresh = await import('./vault')
    for (const [id] of cases) {
      expect(await fresh.readVault(id)).toBeUndefined()
    }
  })
})

describe('vault without safeStorage (Linux fallback)', () => {
  beforeEach(() => {
    encryptionAvailable = false
  })
  it('does not write plaintext to disk but keeps in memory for the session', async () => {
    await writeVault('p2', sampleVault())
    expect(existsSync(join(TMP, 'p2.bin'))).toBe(false)
    const out = await readVault('p2')
    expect(out?.deviceId).toBe('11111111-1111-4111-8111-111111111111') // in-memory hit
    expect(isVaultPersistent()).toBe(false)
  })
})
