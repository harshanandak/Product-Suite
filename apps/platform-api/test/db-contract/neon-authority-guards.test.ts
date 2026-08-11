import { describe, expect, it } from 'vitest'

import { createNeonControlPlane, resolveDeclaredMigrationTags } from './harness'

describe('Neon authority local guards', () => {
  it('derives the source organization before creating a disposable project', async () => {
    const calls: Array<{ method: string; path: string }> = []
    let createBody: unknown
    const plane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        const method = init?.method ?? 'GET'
        const path = String(input)
        calls.push({ method, path })
        if (method === 'GET' && path.endsWith('/projects/production-project')) {
          return new Response(JSON.stringify({ project: { id: 'production-project', org_id: 'org-123' } }))
        }
        if (method === 'POST' && path.endsWith('/projects')) {
          createBody = JSON.parse(String(init?.body))
          return new Response(JSON.stringify({ project: { id: 'production-project' } }))
        }
        return new Response('{}', { status: 404 })
      },
    )

    await expect(plane.createDisposableProject()).rejects.toThrow('NEON_PROJECT_RESPONSE_INVALID')
    expect(calls).toEqual([
      { method: 'GET', path: 'https://console.neon.tech/api/v2/projects/production-project' },
      { method: 'POST', path: 'https://console.neon.tech/api/v2/projects' },
    ])
    expect(createBody).toEqual({ project: { name: expect.any(String), pg_version: 17, org_id: 'org-123' } })
  })

  it('resolves numeric conformance declarations to the unique canonical migration tags', () => {
    expect(resolveDeclaredMigrationTags([
      { tag: '0018_collaboration_fabric' },
      { tag: '0019_neon_authority_reconciliation' },
      { tag: '0020' },
    ], ['0018', '0019', '0020'])).toEqual([
      '0018_collaboration_fabric',
      '0019_neon_authority_reconciliation',
      '0020',
    ])

    expect(() => resolveDeclaredMigrationTags([{ tag: '0018_one' }, { tag: '0018_two' }], ['0018']))
      .toThrow('CANONICAL_FILE_LOAD_UNPROVEN')
  })

  it.each([
    ['multiple default roots', [
      { id: 'production-root-a', default: true, parent_id: null },
      { id: 'production-root-b', default: true, parent_id: null },
    ]],
    ['malformed branch metadata', [
      { id: 'production-root', default: true, parent_id: null },
      { id: 'child-with-invalid-parent', default: false, parent_id: 42 },
    ]],
  ])('fails closed for %s instead of selecting the first branch', async (_label, branches) => {
    const calls: string[] = []
    const plane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        const path = String(input)
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path.endsWith('/projects/production-project')) {
          return new Response(JSON.stringify({ project: { id: 'production-project' } }))
        }
        if (path.includes('/branches?')) return new Response(JSON.stringify({ branches }))
        return new Response('{}', { status: 404 })
      },
    )
    await expect(plane.createProductionDerivedBranch()).rejects.toThrow('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
    expect(calls.some((call) => call.startsWith('POST '))).toBe(false)
  })

  it('accepts a schema-realistic root with omitted parent_id', async () => {
    const calls: string[] = []
    const plane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        const path = String(input)
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path.endsWith('/projects/production-project')) {
          return new Response(JSON.stringify({ project: { id: 'production-project' } }))
        }
        if (path.includes('/branches?')) {
          return new Response(JSON.stringify({ branches: [{ id: 'production-root', default: true }] }))
        }
        if (init?.method === 'POST') {
          const request = JSON.parse(String(init.body)) as { branch: { name: string } }
          return new Response(JSON.stringify({
            branch: { id: 'safe-derived', name: request.branch.name, parent_id: 'wrong-root', default: false },
          }))
        }
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        return new Response('{}', { status: 404 })
      },
    )
    await expect(plane.createProductionDerivedBranch()).rejects.toThrow('PRODUCTION_DERIVED_PARENT_MISMATCH')
    expect(calls.some((call) => call.startsWith('POST '))).toBe(true)
    await plane.cleanupRetainedResources()
  })

  it('scans every branch page before proving a unique root', async () => {
    const calls: string[] = []
    const plane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        const path = String(input)
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path.endsWith('/projects/production-project')) {
          return new Response(JSON.stringify({ project: { id: 'production-project' } }))
        }
        if (path.includes('/branches?')) {
          const cursor = new URL(path).searchParams.get('cursor')
          return cursor
            ? new Response(JSON.stringify({ branches: [{ id: 'production-root-later', default: true, parent_id: null }] }))
            : new Response(JSON.stringify({
              branches: [{ id: 'production-root', default: true, parent_id: null }],
              pagination: { next: 'page-2' },
            }))
        }
        return new Response('{}', { status: 404 })
      },
    )
    await expect(plane.createProductionDerivedBranch()).rejects.toThrow('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
    expect(calls.some((call) => call.includes('cursor=page-2'))).toBe(true)
    expect(calls.some((call) => call.startsWith('POST '))).toBe(false)
  })

  it.each([
    ['repeated cursor', { next: 'page-2' }],
    ['malformed cursor', { next: 42 }],
  ])('fails closed on %s pagination', async (_label, next) => {
    const calls: string[] = []
    const plane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        const path = String(input)
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path.endsWith('/projects/production-project')) {
          return new Response(JSON.stringify({ project: { id: 'production-project' } }))
        }
        if (path.includes('/branches?')) {
          return path.includes('cursor=page-2')
            ? new Response(JSON.stringify({ branches: [{ id: 'production-child', default: false, parent_id: 'production-root' }], pagination: next }))
            : new Response(JSON.stringify({
              branches: [{ id: 'production-root', default: true, parent_id: null }],
              pagination: { next: 'page-2' },
            }))
        }
        return new Response('{}', { status: 404 })
      },
    )
    await expect(plane.createProductionDerivedBranch()).rejects.toThrow('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
    expect(calls.some((call) => call.startsWith('POST '))).toBe(false)
  })
})
