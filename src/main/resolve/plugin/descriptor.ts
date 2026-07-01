import { isForbiddenHost } from './net-guard'

const ICON_MAX_LEN = 64 * 1024
const ICON_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/webp;base64,'
]

function fail(msg: string): never {
  throw new Error(`Invalid plugin descriptor: ${msg}`)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertOnlyKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`unexpected field "${k}" in ${where}`)
  }
}

function validateIcon(icon: unknown): void {
  if (icon === undefined) return
  if (typeof icon !== 'string') fail('provider.icon must be a string')
  if (icon.length > ICON_MAX_LEN) fail('provider.icon too large')
  if (!ICON_PREFIXES.some((p) => icon.startsWith(p))) {
    fail('provider.icon must be a small png/jpeg/webp data uri (no svg, no external url)')
  }
}

function assertHttpsUrl(v: unknown, where: string): URL {
  if (typeof v !== 'string') fail(`${where} must be a string`)
  let u: URL
  try {
    u = new URL(v)
  } catch {
    fail(`${where} must be a valid URL`)
  }
  if (u.protocol !== 'https:') fail(`${where} must be https`)
  if (u.username || u.password) fail(`${where} must not contain userinfo`)
  // 拒绝字面私网/环回/保留 IP 与 localhost/*.localhost（无需 DNS，代理模式下同样生效）。
  // 域名解析到私网的拦截走加固客户端的 guarded lookup（直连模式）；代理模式由 spec §11 标注为安全降级。
  if (isForbiddenHost(u.hostname)) fail(`${where} must be a public host`)
  return u
}

export function parseDescriptor(jsonText: string): IPluginDescriptor {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    fail('not valid JSON')
  }
  if (!isObject(raw)) fail('must be an object')
  if (raw.magic !== 'CPXF') fail('magic must be "CPXF"')
  if (raw.v === 1) {
    throw new Error(
      'Plugin file format is outdated (v1); please obtain the new file from your provider'
    )
  }
  if (raw.v !== 2) fail('v must be 2')
  if (raw.spec !== 'cpx-plugin/2') fail('spec must be "cpx-plugin/2"')
  assertOnlyKeys(raw, ['magic', 'v', 'spec', 'loginUrl', 'provider'], 'descriptor')

  const loginUrl = assertHttpsUrl(raw.loginUrl, 'loginUrl')
  if (loginUrl.search || loginUrl.hash) fail('loginUrl must not contain query or fragment')

  if (!isObject(raw.provider)) fail('provider must be an object')
  assertOnlyKeys(raw.provider, ['name', 'icon', 'site'], 'provider')
  if (typeof raw.provider.name !== 'string' || raw.provider.name.length === 0) {
    fail('provider.name required')
  }
  validateIcon(raw.provider.icon)
  if (raw.provider.site !== undefined) assertHttpsUrl(raw.provider.site, 'provider.site')

  return raw as unknown as IPluginDescriptor
}
