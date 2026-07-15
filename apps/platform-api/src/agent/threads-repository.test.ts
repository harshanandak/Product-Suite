import { describe, expect, it } from 'vitest'

import type { UIMessage } from 'ai'

import { concatDeltas, titleFromFirstMessage } from './threads-repository'

// Real UIMessages carry unique ids; parameterize so reconstruction (which dedups
// by id) is exercised with realistic distinct ids — and a deliberate collision.
const user = (text: string, id = 'u'): UIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }] }) as unknown as UIMessage
const assistant = (text: string, id = 'a'): UIMessage =>
  ({ id, role: 'assistant', parts: [{ type: 'text', text }] }) as unknown as UIMessage

describe('titleFromFirstMessage', () => {
  it('uses the first ~60 chars of the FIRST user message (not an LLM call)', () => {
    const long = 'a'.repeat(100)
    expect(titleFromFirstMessage([user(long)])).toBe('a'.repeat(60))
  })

  it('trims and joins the first user message text parts', () => {
    expect(titleFromFirstMessage([user('  Ship the auth flow  ')])).toBe('Ship the auth flow')
  })

  it('ignores assistant messages and returns "" when there is no user text', () => {
    expect(titleFromFirstMessage([assistant('hi there')])).toBe('')
    expect(titleFromFirstMessage([])).toBe('')
  })
})

describe('concatDeltas (thread reconstruction)', () => {
  it('concatenates v1 deltas in order into the full UIMessage[]', () => {
    const messages = concatDeltas([
      { version: 1, messages: [user('q1', 'u1'), assistant('a1', 'am1')] },
      { version: 1, messages: [user('q2', 'u2'), assistant('a2', 'am2')] },
    ])
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages.map((m) => m.id)).toEqual(['u1', 'am1', 'u2', 'am2'])
  })

  it('dedups a message id repeated across runs (mid-stream drop + client Retry)', () => {
    // A dropped stream completes the run server-side; the Retry resends the SAME
    // user message (same id) into a second run. The user turn must appear once
    // (both distinct assistant answers remain) — never a duplicate id / React key.
    const messages = concatDeltas([
      { version: 1, messages: [user('same q', 'u1'), assistant('first (dropped)', 'am1')] },
      { version: 1, messages: [user('same q', 'u1'), assistant('retry answer', 'am2')] },
    ])
    expect(messages.map((m) => m.id)).toEqual(['u1', 'am1', 'am2'])
  })

  it('SKIPS legacy/unversioned rows (v0), nulls, and non-arrays', () => {
    const messages = concatDeltas([
      { messages: [{ role: 'assistant', content: 'legacy' }] }, // v0: no version
      null,
      { version: 1, messages: [user('q1'), assistant('a1')] },
      { version: 2, messages: [user('future')] }, // unknown version
      { version: 1, messages: 'not-an-array' },
    ])
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('user')
    expect(messages[1]?.role).toBe('assistant')
  })
})
