import { describe, it, expect, beforeEach, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auditPluginVault: vi.fn(),
  updatePluginProfile: vi.fn()
}))

vi.mock('../config', () => ({
  getProfileConfig: vi.fn(async () => ({
    current: 'default',
    items: [
      {
        id: 'profile-plugin',
        type: 'plugin',
        name: 'Demo',
        pluginId: 'plugin-id',
        autoUpdate: false,
        interval: 0
      }
    ]
  })),
  getCurrentProfileItem: vi.fn(async () => ({
    id: 'default',
    type: 'local',
    name: 'Empty'
  })),
  getProfileItem: vi.fn(),
  addProfileItem: vi.fn()
}))

vi.mock('../resolve/plugin', () => ({
  auditPluginVault: mocks.auditPluginVault,
  updatePluginProfile: mocks.updatePluginProfile
}))

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn() }
}))

describe('initProfileUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('audits plugin vault availability on startup even when auto update is disabled', async () => {
    const { initProfileUpdater } = await import('./profileUpdater')
    await initProfileUpdater()

    expect(mocks.auditPluginVault).toHaveBeenCalledWith('plugin-id')
    expect(mocks.updatePluginProfile).not.toHaveBeenCalled()
  })
})
