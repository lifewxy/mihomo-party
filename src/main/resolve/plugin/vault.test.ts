import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  writeVault,
  readVault,
  removeVault,
  isVaultPersistent,
  VaultUnavailableError
} from './vault'

let TMP = ''
let encryptionAvailable = true
let asyncApiSupported = true
let decryptError: Error | undefined
let encryptError: Error | undefined
let shouldReEncrypt = false
let encryptionPrefix = 'enc:'
let encryptCalls = 0
let decryptCalls = 0
let syncEncryptCalls = 0
let syncDecryptCalls = 0

vi.mock('electron', () => ({
  safeStorage: {
    get isAsyncEncryptionAvailable() {
      return asyncApiSupported ? async () => encryptionAvailable : undefined
    },
    get encryptStringAsync() {
      return asyncApiSupported
        ? async (value: string) => {
            encryptCalls++
            if (encryptError) throw encryptError
            return Buffer.from(encryptionPrefix + value, 'utf-8')
          }
        : undefined
    },
    get decryptStringAsync() {
      return asyncApiSupported
        ? async (encrypted: Buffer) => {
            decryptCalls++
            if (decryptError) throw decryptError
            const result = Buffer.from(encrypted)
              .toString('utf-8')
              .replace(/^(enc:|rot:)/, '')
            return { result, shouldReEncrypt }
          }
        : undefined
    },
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => {
      syncEncryptCalls++
      if (encryptError) throw encryptError
      return Buffer.from(encryptionPrefix + value, 'utf-8')
    },
    decryptString: (encrypted: Buffer) => {
      syncDecryptCalls++
      if (decryptError) throw decryptError
      return Buffer.from(encrypted)
        .toString('utf-8')
        .replace(/^(enc:|rot:)/, '')
    }
  }
}))

vi.mock('../../utils/dirs', () => ({
  pluginVaultDir: () => TMP,
  pluginVaultPath: (id: string) => join(TMP, `${id}.bin`),
  logPath: () => join(TMP, 'app.log')
}))

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(async () => undefined) }
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

function encryptedVault(vault: unknown = sampleVault()): Buffer {
  return Buffer.from('enc:' + JSON.stringify(vault), 'utf-8')
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cpxvault-'))
  encryptionAvailable = true
  asyncApiSupported = true
  decryptError = undefined
  encryptError = undefined
  shouldReEncrypt = false
  encryptionPrefix = 'enc:'
  encryptCalls = 0
  decryptCalls = 0
  syncEncryptCalls = 0
  syncDecryptCalls = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(TMP, { recursive: true, force: true })
})

describe('persistent async vault', () => {
  it('round-trips through an encrypted file', async () => {
    await writeVault('p1', sampleVault())
    expect(existsSync(join(TMP, 'p1.bin'))).toBe(true)

    const out = await readVault('p1')
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') {
      expect(out.vault.deviceId).toBe('11111111-1111-4111-8111-111111111111')
      expect(out.vault.gateway.gateway).toBe('https://gw.front.com')
    }
  })

  it('removes the file and reports it missing', async () => {
    await writeVault('p1', sampleVault())
    await removeVault('p1')
    expect(existsSync(join(TMP, 'p1.bin'))).toBe(false)
    expect(await readVault('p1')).toEqual({ kind: 'missing' })
  })

  it('reports persistent async encryption availability', async () => {
    expect(await isVaultPersistent()).toBe(true)
  })

  it('decrypts a legacy sync ciphertext after a cold launch', async () => {
    writeFileSync(join(TMP, 'legacy.bin'), encryptedVault())
    vi.resetModules()
    const fresh = await import('./vault')

    const out = await fresh.readVault('legacy')
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') expect(out.vault.gateway.gateway).toBe('https://gw.front.com')
  })

  it('checks material presence without touching safeStorage', async () => {
    writeFileSync(join(TMP, 'present.bin'), encryptedVault())
    vi.resetModules()
    const fresh = await import('./vault')

    expect(fresh.hasVaultMaterial('present')).toBe(true)
    expect(decryptCalls).toBe(0)
  })

  it('re-encrypts valid rotated data atomically', async () => {
    writeFileSync(join(TMP, 'rotate.bin'), encryptedVault())
    shouldReEncrypt = true
    encryptionPrefix = 'rot:'
    vi.resetModules()
    const fresh = await import('./vault')

    expect((await fresh.readVault('rotate')).kind).toBe('ok')
    expect(encryptCalls).toBe(1)
    expect(readFileSync(join(TMP, 'rotate.bin'), 'utf-8')).toMatch(/^rot:/)
  })

  it('keeps a successfully decrypted vault usable when best-effort rotation fails', async () => {
    const original = encryptedVault()
    writeFileSync(join(TMP, 'rotate-failure.bin'), original)
    shouldReEncrypt = true
    encryptError = new Error('key rotation failed')
    vi.resetModules()
    const fresh = await import('./vault')

    expect((await fresh.readVault('rotate-failure')).kind).toBe('ok')
    expect(readFileSync(join(TMP, 'rotate-failure.bin'))).toEqual(original)
  })

  it('classifies structurally invalid plaintext as invalid', async () => {
    writeFileSync(
      join(TMP, 'bad.bin'),
      encryptedVault({ devicePrivKey: 'short', deviceId: 'not-a-uuid' })
    )
    vi.resetModules()
    const fresh = await import('./vault')

    expect(await fresh.readVault('bad')).toEqual({ kind: 'invalid' })
  })

  it('rejects forbidden gateway origins and malformed endpoints', async () => {
    const base = {
      devicePrivKey: Buffer.alloc(32, 1).toString('base64'),
      deviceId: '11111111-1111-4111-8111-111111111111'
    }
    const endpoints = { enroll: '/e', challenge: '/c', config: '/cfg', revoke: '/r' }
    const cases: Array<[string, unknown]> = [
      ['local', { ...base, gateway: { gateway: 'https://localhost', endpoints } }],
      [
        'protocol-relative',
        {
          ...base,
          gateway: {
            gateway: 'https://gw.front.com',
            endpoints: { ...endpoints, config: '//evil/cfg' }
          }
        }
      ]
    ]
    for (const [id, value] of cases) writeFileSync(join(TMP, `${id}.bin`), encryptedVault(value))
    vi.resetModules()
    const fresh = await import('./vault')

    for (const [id] of cases) expect(await fresh.readVault(id)).toEqual({ kind: 'invalid' })
  })

  it('distinguishes temporary keychain unavailability from invalid ciphertext', async () => {
    writeFileSync(join(TMP, 'temporary.bin'), encryptedVault())
    decryptError = new Error(
      'safeStorage.decryptStringAsync is temporarily unavailable. Please try again.'
    )
    vi.resetModules()
    const fresh = await import('./vault')
    expect(await fresh.readVault('temporary')).toEqual({ kind: 'unavailable' })

    decryptError = new Error('Error while decrypting ciphertext')
    expect(await fresh.readVault('temporary')).toEqual({ kind: 'invalid' })
  })
})

describe('storage backend unavailable', () => {
  it('treats unavailable macOS/Windows storage as transient', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    encryptionAvailable = false
    writeFileSync(join(TMP, 'existing.bin'), encryptedVault())
    vi.resetModules()
    const fresh = await import('./vault')

    expect(await fresh.readVault('existing')).toEqual({ kind: 'unavailable' })
    await expect(fresh.writeVault('new', sampleVault())).rejects.toMatchObject({
      name: VaultUnavailableError.name
    })
  })

  it('keeps Linux vaults in memory when no async backend exists', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    encryptionAvailable = false
    vi.resetModules()
    const fresh = await import('./vault')

    await fresh.writeVault('linux', sampleVault())
    expect(existsSync(join(TMP, 'linux.bin'))).toBe(false)
    expect(fresh.hasVaultMaterial('linux')).toBe(true)
    expect((await fresh.readVault('linux')).kind).toBe('ok')
    expect(await fresh.isVaultPersistent()).toBe(false)
  })
})

describe('legacy Electron compatibility', () => {
  it('falls back to synchronous safeStorage when async APIs do not exist', async () => {
    asyncApiSupported = false
    vi.resetModules()
    const legacy = await import('./vault')

    await legacy.ensureVaultWritable()
    await legacy.writeVault('legacy-electron', sampleVault())
    expect(syncEncryptCalls).toBe(2)
    expect(encryptCalls).toBe(0)

    vi.resetModules()
    const fresh = await import('./vault')
    const result = await fresh.readVault('legacy-electron')
    expect(result.kind).toBe('ok')
    expect(syncDecryptCalls).toBe(1)
    expect(decryptCalls).toBe(0)
  })
})
