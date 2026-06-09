import test from 'node:test'
import assert from 'node:assert/strict'

import { getSessionStatusDuringRefresh } from './sessionRefresh.ts'

test('keeps authenticated pages mounted during background refresh', () => {
  assert.equal(getSessionStatusDuringRefresh('authenticated'), 'authenticated')
})

test('shows loading before the initial session has resolved', () => {
  assert.equal(getSessionStatusDuringRefresh('loading'), 'loading')
  assert.equal(getSessionStatusDuringRefresh('unauthenticated'), 'loading')
})
