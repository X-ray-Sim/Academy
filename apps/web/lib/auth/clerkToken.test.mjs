import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getClerkTokenRefreshDelay,
  getJwtExpirationTime,
  shouldRefreshClerkToken,
  TOKEN_REFRESH_SKEW_MS,
} from './clerkToken.ts'

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64url')
}

function makeToken(payload) {
  return [
    base64UrlEncode({ alg: 'RS256', typ: 'JWT' }),
    base64UrlEncode(payload),
    'signature',
  ].join('.')
}

test('reads JWT expiration as milliseconds', () => {
  const token = makeToken({ exp: 1_800 })

  assert.equal(getJwtExpirationTime(token), 1_800_000)
})

test('refreshes tokens that expire within the safety window', () => {
  const now = 2_000_000
  const token = makeToken({ exp: Math.floor((now + TOKEN_REFRESH_SKEW_MS - 1_000) / 1000) })

  assert.equal(shouldRefreshClerkToken(token, now), true)
})

test('keeps tokens that are outside the safety window', () => {
  const now = 2_000_000
  const token = makeToken({ exp: Math.floor((now + TOKEN_REFRESH_SKEW_MS + 120_000) / 1000) })

  assert.equal(shouldRefreshClerkToken(token, now), false)
})

test('refreshes malformed or missing tokens', () => {
  assert.equal(shouldRefreshClerkToken(null), true)
  assert.equal(shouldRefreshClerkToken('not-a-jwt'), true)
})

test('does not schedule automatic refresh loops inside the safety window', () => {
  const now = 2_000_000
  const token = makeToken({ exp: Math.floor((now + TOKEN_REFRESH_SKEW_MS - 1_000) / 1000) })

  assert.equal(getClerkTokenRefreshDelay(token, now), null)
})

test('schedules automatic refresh before a token reaches the safety window', () => {
  const now = 2_000_000
  const token = makeToken({ exp: Math.floor((now + TOKEN_REFRESH_SKEW_MS + 120_000) / 1000) })

  assert.equal(getClerkTokenRefreshDelay(token, now), 120_000)
})
