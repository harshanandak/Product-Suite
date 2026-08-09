import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runRequiredSetup } from './reap-setup'
import {
  finalizeTelemetry,
  initializeTelemetry,
  readTelemetry,
  recordBranchCapacity,
  recordCleanupComplete,
  recordCounts,
  recordPhaseDuration,
} from './telemetry'

const telemetryPath = (): string => join(mkdtempSync(join(tmpdir(), 'db-contract-telemetry-')), 'evidence.json')

describe('db-contract telemetry', () => {
  it('emits one allowlisted ledger with exact-head counts, timings, capacity, and final cleanup proof', () => {
    const path = telemetryPath()
    initializeTelemetry(path, { exactHead: 'a'.repeat(40), concurrency: 1 })
    recordBranchCapacity(path, { configured: 10, available: 8 })
    recordPhaseDuration(path, 'create', 12)
    recordPhaseDuration(path, 'create', 8)
    recordCounts(path, {
      collected: 57,
      passed: 57,
      skipped: 0,
      todo: 0,
      pending: 0,
      filtered: 0,
      unclassified: 0,
    })

    expect(() => finalizeTelemetry(path)).toThrow('DB_CONTRACT_TELEMETRY_CLEANUP_INCOMPLETE')
    recordCleanupComplete(path)

    expect(finalizeTelemetry(path)).toMatchObject({
      schemaVersion: 1,
      exactHead: 'a'.repeat(40),
      topologyVersion: 'db-contract-v1',
      counts: { collected: 57, passed: 57, skipped: 0, zeroSkip: true },
      phases: { create: { count: 2, durationMs: 20 } },
      cleanup: { complete: true, proof: 'current-run-absent' },
      branchCapacity: { configured: 10, available: 8 },
      rateLimit: { result: 'unknown', stableCount: null },
      concurrency: 1,
    })
  })

  it.each(['connectionUri', 'apiToken', 'branchId', 'raw_id', 'error', 'env'])(
    'rejects forbidden or arbitrary field %s without echoing its value',
    (field) => {
      const path = telemetryPath()
      initializeTelemetry(path, { exactHead: 'b'.repeat(40), concurrency: 1 })
      const payload = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      payload[field] = 'postgres://user:token@secret.example/raw-id'
      writeFileSync(path, JSON.stringify(payload))

      let failure: unknown
      try {
        readTelemetry(path)
      } catch (error) {
        failure = error
      }
      expect(String(failure)).toContain('DB_CONTRACT_TELEMETRY_INVALID')
      expect(String(failure)).not.toContain('postgres://')
      expect(String(failure)).not.toContain('secret.example')
    },
  )

  it('allows only final teardown to mark cleanup complete', async () => {
    const path = telemetryPath()
    const env = {
      NEON_API_KEY: 'unit-key',
      NEON_PROJECT_ID: 'unit-project',
      DB_CONTRACT_BRANCH_CAP: '10',
    } as NodeJS.ProcessEnv
    const teardown = await runRequiredSetup({
      env,
      reap: async () => ({ complete: true, scanned: 2, deleted: ['redacted'], failed: [] }),
      // A later env mutation must not alter the normalized runtime/telemetry
      // cap captured before preflight starts.
      preflight: async () => {
        env.DB_CONTRACT_BRANCH_CAP = '99'
      },
      assertCurrentRunAbsent: async () => undefined,
      makeRunToken: () => 'not-serialized',
      telemetry: { path, exactHead: 'c'.repeat(40), concurrency: 1 },
    })

    expect(readTelemetry(path).cleanup.complete).toBe(false)
    expect(readTelemetry(path).branchCapacity).toEqual({ configured: 10, available: 9 })
    await teardown()
    expect(readTelemetry(path).cleanup).toEqual({ complete: true, proof: 'current-run-absent' })
    expect(readFileSync(path, 'utf8')).not.toMatch(/unit-key|unit-project|not-serialized|redacted/)
  })
})
