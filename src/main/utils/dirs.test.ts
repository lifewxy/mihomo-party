import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let packaged = false
let portable = false
let appName = 'mihomo-party'
const paths: Record<string, string> = {}
const setPath = vi.fn((name: string, value: string) => {
  paths[name] = value
})
const setName = vi.fn((value: string) => {
  appName = value
})

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return packaged
    },
    getPath: (name: string) => paths[name],
    setPath,
    setName,
    getName: () => appName
  }
}))

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>()
  return {
    ...original,
    existsSync: (value: string) => portable && value.endsWith('/PORTABLE')
  }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

beforeEach(() => {
  packaged = false
  portable = false
  appName = 'mihomo-party'
  Object.assign(paths, {
    appData: '/tmp/app-data',
    userData: '/tmp/app-data/mihomo-party',
    home: '/tmp/home',
    exe: '/tmp/runtime/Electron.app/Contents/MacOS/Electron'
  })
  setPath.mockClear()
  setName.mockClear()
  vi.resetModules()
})

afterEach(() => vi.restoreAllMocks())

describe('configureAppPaths', () => {
  it('isolates an unpackaged local development app', async () => {
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).toHaveBeenCalledWith('mihomo-party-dev')
    expect(paths.userData).toBe('/tmp/app-data/mihomo-party-dev')
  })

  it('leaves packaged stable and dev-release builds on production paths', async () => {
    packaged = true
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).not.toHaveBeenCalled()
    expect(setPath).not.toHaveBeenCalled()
    expect(paths.userData).toBe('/tmp/app-data/mihomo-party')
  })

  it('keeps portable userData precedence over local development isolation', async () => {
    portable = true
    const { configureAppPaths } = await import('./dirs')
    configureAppPaths()

    expect(setName).toHaveBeenCalledWith('mihomo-party-dev')
    expect(paths.userData).toBe('/tmp/runtime/Electron.app/Contents/MacOS/data')
    expect(setPath).toHaveBeenLastCalledWith(
      'userData',
      '/tmp/runtime/Electron.app/Contents/MacOS/data'
    )
  })
})
