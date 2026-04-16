import assert from 'node:assert/strict'
import test from 'node:test'
import { __testing as authTesting } from '@/lib/api-auth'

test('session tokens round-trip an authenticated user', () => {
  const user = {
    id: 'github:123',
    login: 'harshit',
    name: 'Harshit',
    email: '[email protected]',
    avatarUrl: 'https://example.com/avatar.png',
    authMode: 'github' as const,
  }

  const token = authTesting.createSessionToken(user)
  const parsed = authTesting.parseSessionToken(token)

  assert.deepEqual(parsed, user)
})

test('session token verification rejects tampering', () => {
  const token = authTesting.createSessionToken({
    id: 'local-operator',
    login: 'local',
    name: 'Local Operator',
    email: null,
    avatarUrl: null,
    authMode: 'local',
  })
  const tampered = `${token.slice(0, -1)}x`

  assert.equal(authTesting.parseSessionToken(tampered), null)
})
