import { describe, it, expect } from 'vitest'
import { challenge } from './gateway'

// No http-client mock here: the real hardened client + guarded lookup must refuse a private gateway.
describe('gateway network hardening (real client)', () => {
  it('refuses a loopback gateway via guarded lookup', async () => {
    const target = {
      gateway: 'https://localhost',
      endpoints: { enroll: '/e', challenge: '/c', config: '/cfg', revoke: '/r' }
    }
    await expect(challenge(target, 'DID', { timeout: 2000 })).rejects.toMatchObject({
      kind: 'transient'
    })
  })
})
