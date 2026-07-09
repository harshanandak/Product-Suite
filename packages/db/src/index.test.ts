import { describe, expect, it } from 'vitest'

import { createDb } from './index'

describe('createDb', () => {
  it('creates a Drizzle client bound to the schema (no connection made)', () => {
    // The Neon HTTP driver is lazy — no network happens until a query runs.
    const db = createDb('postgresql://user:pass@host/db')
    expect(db).toBeDefined()
    expect(typeof db.select).toBe('function')
    expect(typeof db.insert).toBe('function')
  })
})
