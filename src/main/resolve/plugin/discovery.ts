import type { LookupFunction } from 'net'
import { createGuardedLookup } from './net-guard'
import { parseGatewayOrigin, isValidEndpointPath } from './gateway-url'
import { requestOnce } from './http-client'

const MAX_BYTES = 64 * 1024

export interface DiscoverOpts {
  timeout: number
  lookup?: LookupFunction
  proxy?: { host: string; port: number }
}

function fail(msg: string): never {
  throw new Error(`Invalid gateway discovery: ${msg}`)
}

function assertHttpsOrigin(v: unknown, where: string): string {
  const origin = parseGatewayOrigin(v)
  if (!origin) fail(`${where} must be a public https origin with no path/query/fragment/userinfo`)
  return origin
}

function assertRelPath(v: unknown, where: string): string {
  if (!isValidEndpointPath(v)) {
    fail(`${where} must be a relative path starting with "/" (no scheme/host/query/fragment)`)
  }
  return v
}

export async function discoverGateway(
  loginUrl: string,
  opts: DiscoverOpts
): Promise<IGatewayWellKnown> {
  const host = new URL(loginUrl).host
  const url = `https://${host}/.well-known/cpx-gateway`
  const lookup = opts.proxy ? undefined : (opts.lookup ?? createGuardedLookup())
  const res = await requestOnce(url, {
    method: 'GET',
    timeout: opts.timeout,
    maxBytes: MAX_BYTES,
    lookup,
    proxy: opts.proxy
  })
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Discovery failed: status ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  let raw: unknown
  try {
    raw = JSON.parse(res.body)
  } catch {
    fail('not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null) fail('must be an object')
  const obj = raw as Record<string, unknown>
  if (obj.spec !== 'cpx-plugin/2') fail('spec must be "cpx-plugin/2"')
  const gateway = assertHttpsOrigin(obj.gateway, 'gateway')
  if (typeof obj.endpoints !== 'object' || obj.endpoints === null) fail('endpoints required')
  const e = obj.endpoints as Record<string, unknown>
  return {
    spec: 'cpx-plugin/2',
    gateway,
    endpoints: {
      enroll: assertRelPath(e.enroll, 'endpoints.enroll'),
      challenge: assertRelPath(e.challenge, 'endpoints.challenge'),
      config: assertRelPath(e.config, 'endpoints.config'),
      revoke: assertRelPath(e.revoke, 'endpoints.revoke')
    }
  }
}
