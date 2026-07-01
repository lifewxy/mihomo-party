import { mkdir, writeFile, readFile, rm, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { safeStorage } from 'electron'
import { pluginVaultDir, pluginVaultPath } from '../../utils/dirs'
import { parseGatewayOrigin, isValidEndpointPath } from './gateway-url'

// safeStorage 不可用时的会话内内存兜底（重启即丢）
const memoryVaults = new Map<string, IPluginVault>()

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// 校验从磁盘解密出来的 vault 结构（私钥 32 字节、deviceId 为 UUIDv4、网关为 https origin、
// 四个端点为相对 path）。坏/被篡改的数据按“缺失”处理，由编排层走 needs-reauth，
// 避免畸形私钥/网关进入签名或网络路径。
function isValidVault(v: unknown): v is IPluginVault {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.devicePrivKey !== 'string' || Buffer.from(o.devicePrivKey, 'base64').length !== 32) {
    return false
  }
  if (typeof o.deviceId !== 'string' || !UUID_V4.test(o.deviceId)) return false
  const g = o.gateway as Record<string, unknown> | undefined
  if (!g || parseGatewayOrigin(g.gateway) === null) return false
  const e = g.endpoints as Record<string, unknown> | undefined
  if (!e) return false
  for (const k of ['enroll', 'challenge', 'config', 'revoke']) {
    if (!isValidEndpointPath(e[k])) return false
  }
  return true
}

export function isVaultPersistent(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export async function writeVault(id: string, vault: IPluginVault): Promise<void> {
  if (!isVaultPersistent()) {
    memoryVaults.set(id, vault)
    return
  }
  await mkdir(pluginVaultDir(), { recursive: true })
  const enc = safeStorage.encryptString(JSON.stringify(vault))
  const finalPath = pluginVaultPath(id)
  const tmpPath = `${finalPath}.tmp`
  await writeFile(tmpPath, enc, { mode: 0o600 })
  await rename(tmpPath, finalPath) // 原子替换
  memoryVaults.set(id, vault)
}

export async function readVault(id: string): Promise<IPluginVault | undefined> {
  const cached = memoryVaults.get(id)
  if (cached) return cached
  if (!isVaultPersistent()) return undefined
  const p = pluginVaultPath(id)
  if (!existsSync(p)) return undefined
  try {
    const enc = await readFile(p)
    const json = safeStorage.decryptString(enc)
    const parsed = JSON.parse(json) as unknown
    if (!isValidVault(parsed)) return undefined // 结构非法 → 视为缺失
    memoryVaults.set(id, parsed)
    return parsed
  } catch {
    return undefined // 损坏/不可解密 → 视为缺失，由编排层走 needs-reauth
  }
}

export async function removeVault(id: string): Promise<void> {
  memoryVaults.delete(id)
  await rm(pluginVaultPath(id), { force: true })
}
