import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

// `createProposal` is the SHARED proposal write path — spied (not replaced wholesale)
// so the rest of the repository module stays real for the accept-path test below.
const { createProposal } = vi.hoisted(() => ({ createProposal: vi.fn() }))
vi.mock('../proposals/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../proposals/repository')>()),
  createProposal,
}))

// The domain commands are the shared validated write path; mocked so the accept-path
// test can read exactly what `createWorkItem` was handed.
const { createWorkItem, updateWorkItem, resolveDefaultTeamId } = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  resolveDefaultTeamId: vi.fn(),
}))
vi.mock('../domain/work-items', () => ({ createWorkItem, updateWorkItem, resolveDefaultTeamId }))

import { applyProposal } from '../proposals/apply'
import {
  buildProposalPayload,
  buildRationale,
  MEETING_INGEST_PROMPT_VERSION,
  MEETING_INGEST_TRIGGERED_BY,
  runMeetingIngest,
  type MeetingCandidateRow,
} from './ingest'
import { parseMeetingTenantMap } from './tenant-map'

const PLATFORM_TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_PLATFORM_TENANT = '22222222-2222-4222-8222-222222222222'
const TEAM_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '44444444-4444-4444-8444-444444444444'

const TENANT_MAP = parseMeetingTenantMap(
  JSON.stringify({
    tenant_meeting_pilot: PLATFORM_TENANT,
    tenant_meeting_other: OTHER_PLATFORM_TENANT,
  }),
)

function candidate(overrides: Partial<MeetingCandidateRow> = {}): MeetingCandidateRow {
  return {
    id: 'ai_content_hash_1',
    tenant_id: 'tenant_meeting_pilot',
    meeting_id: 'mtg_1',
    text: 'Send the revised quote to Acme by Friday',
    confidence: 0.82,
    promotion_reason: 'Explicit commitment with a named owner and a date',
    evidence_refs: [{ segment_id: 'seg_12' }],
    ...overrides,
  }
}

/**
 * A mock `Sql` whose `query` dispatches by SQL text, mirroring the reflection unit
 * harness. `ledger` models `meeting_promotions` as a live set so a second ingest in
 * the same test sees the rows the first one wrote.
 */
function harness(opts: {
  candidates?: MeetingCandidateRow[]
  ledger?: Set<string>
  /** Record ids whose ledger insert loses the race — a concurrent run got there first. */
  lostRace?: Set<string>
} = {}) {
  const candidates = opts.candidates ?? []
  const ledger = opts.ledger ?? new Set<string>()
  const lostRace = opts.lostRace ?? new Set<string>()
  const ledgerInserts: unknown[][] = []
  const runInserts: unknown[][] = []
  const proposalUpdates: [string, unknown[]][] = []

  const query = vi.fn(async (text: string, params: unknown[]) => {
    if (/from "action_items"/i.test(text)) {
      // No count(*) branch: the ingest must not aggregate over `action_items` at all.
      // A count here was how the summary used to leak other tenants' volume.
      if (/count\(/i.test(text)) throw new Error(`unexpected aggregate over action_items: ${text}`)
      return candidates
    }
    if (/insert into "agent_runs"/i.test(text)) {
      runInserts.push(params)
      return [{ id: RUN_ID }]
    }
    if (/from "meeting_promotions"/i.test(text)) {
      const tenantId = String(params[0])
      const asked = params.slice(1).map(String)
      return asked
        .filter((recordId) => ledger.has(`${tenantId}::${recordId}`))
        .map((recordId) => ({ meeting_record_id: recordId }))
    }
    if (/insert into "meeting_promotions"/i.test(text)) {
      ledgerInserts.push(params)
      const key = `${String(params[0])}::${String(params[1])}`
      // Models `on conflict do nothing returning id`: the winner gets a row back, a
      // conflicting insert gets NOTHING. `lostRace` forces the loser path for a
      // record the ledger read did not yet know about — the concurrent case.
      if (ledger.has(key) || lostRace.has(String(params[1]))) return []
      ledger.add(key)
      return [{ id: `mp_${String(params[1])}` }]
    }
    if (/update "proposals"/i.test(text)) {
      proposalUpdates.push([text, params])
      return []
    }
    if (/update "agent_runs"/i.test(text)) return []
    return []
  })

  const sql = { query } as unknown as Sql
  return { sql, query, ledger, ledgerInserts, runInserts, proposalUpdates }
}

const ctx = () => ({ tenantId: PLATFORM_TENANT, tenantMap: TENANT_MAP })

/** The text of every `sql.query` call, for the predicate-pinning tests. */
function candidateReadSql(query: ReturnType<typeof vi.fn>): string {
  const call = (query.mock.calls as [string, unknown[]][]).find(
    ([text]) => /from "action_items"/i.test(text) && !/count\(/i.test(text),
  )
  expect(call, 'expected a candidate read against public.action_items').toBeDefined()
  return call![0]
}

describe('runMeetingIngest', () => {
  beforeEach(() => {
    createProposal.mockReset().mockImplementation(async (_sql: Sql, input: { context_ref?: string }) =>
      Promise.resolve({ id: `prop_${input.context_ref ?? 'x'}` }),
    )
    createWorkItem.mockReset().mockResolvedValue({ id: 'wi_new' })
    resolveDefaultTeamId.mockReset().mockResolvedValue(TEAM_ID)
  })

  // 4a
  it('reads only record_origin = generated — a hand-authored row is never proposed', async () => {
    const { sql, query } = harness({ candidates: [candidate()] })
    await runMeetingIngest(sql, ctx())
    expect(candidateReadSql(query)).toMatch(/record_origin\s*=\s*'generated'/i)
  })

  // 4b
  it('reads only review_status = promoted — a draft row is never proposed', async () => {
    const { sql, query } = harness({ candidates: [candidate()] })
    await runMeetingIngest(sql, ctx())
    expect(candidateReadSql(query)).toMatch(/review_status\s*=\s*'promoted'/i)
  })

  // 5
  it('reads only the mapped tenant, and skips a foreign row that reaches it anyway', async () => {
    const foreign = candidate({ id: 'ai_foreign', tenant_id: 'tenant_meeting_other' })
    const unmapped = candidate({ id: 'ai_unmapped', tenant_id: 'tenant_meeting_nowhere' })
    const { sql, query } = harness({ candidates: [candidate(), foreign, unmapped] })

    const result = await runMeetingIngest(sql, ctx())

    // (a) the read is scoped in SQL to the meeting tenants mapped to THIS platform tenant
    const [, params] = (query.mock.calls as [string, unknown[]][]).find(
      ([text]) => /from "action_items"/i.test(text) && !/count\(/i.test(text),
    )!
    expect(params).toContain('tenant_meeting_pilot')
    expect(params).not.toContain('tenant_meeting_other')
    expect(params).not.toContain('tenant_meeting_nowhere')

    // (b) belt and braces: a row that arrives anyway is re-checked against the map
    expect(result.proposalsCreated).toBe(1)
    expect(result.skippedUnmappedTenant).toBe(2)
    const proposedRefs = createProposal.mock.calls.map(([, input]) => input.context_ref)
    expect(proposedRefs).toEqual(['ai_content_hash_1'])
  })

  // 6
  it('mints EXACTLY ONE agent_runs row per call, whatever the candidate count', async () => {
    const many = [0, 1, 2, 3].map((i) => candidate({ id: `ai_${i}` }))
    const { sql, query, runInserts } = harness({ candidates: many })

    await runMeetingIngest(sql, ctx())

    const runCalls = (query.mock.calls as [string, unknown[]][]).filter(([text]) =>
      /insert into "agent_runs"/i.test(text),
    )
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]![0]).toMatch(/'meeting-ingest'/)
    expect(runCalls[0]![0]).toMatch(/'agent_run'/)
    expect(MEETING_INGEST_TRIGGERED_BY).toBe('meeting-ingest')
    expect(runInserts[0]).toContain(PLATFORM_TENANT)
  })

  // 7
  it('creates one work_item:create proposal per new candidate, left at the default pending status', async () => {
    const { sql } = harness({ candidates: [candidate({ id: 'a' }), candidate({ id: 'b' })] })

    const result = await runMeetingIngest(sql, ctx())

    expect(result.proposalsCreated).toBe(2)
    expect(createProposal).toHaveBeenCalledTimes(2)
    for (const [, input] of createProposal.mock.calls) {
      expect(input.target_type).toBe('work_item')
      expect(input.operation).toBe('create')
      // `status` is server-managed and defaults to 'pending' — never set by the caller.
      expect(input).not.toHaveProperty('status')
    }
  })

  // 8
  it("sets payload.title to the candidate text and leaves team_id ABSENT", async () => {
    const { sql } = harness({ candidates: [candidate()] })

    await runMeetingIngest(sql, ctx())

    const [, input] = createProposal.mock.calls[0]!
    const payload = input.payload as Record<string, unknown>
    expect(payload.title).toBe('Send the revised quote to Acme by Friday')
    // ABSENT, not null/'' — apply.ts resolves the sole team only when the KEY is missing.
    expect(Object.keys(payload)).not.toContain('team_id')
    expect('team_id' in payload).toBe(false)
  })

  // 9
  it('stamps the provenance a reviewer needs: context_ref, run, agent actor, prompt version, confidence', async () => {
    const { sql } = harness({ candidates: [candidate()] })

    await runMeetingIngest(sql, ctx())

    const [, input] = createProposal.mock.calls[0]!
    expect(input).toMatchObject({
      tenant_id: PLATFORM_TENANT,
      context_ref: 'ai_content_hash_1',
      run_id: RUN_ID,
      actor_type: 'agent',
      actor_id: RUN_ID,
      prompt_version: 'meeting-ingest-v1',
      confidence: 0.82,
    })
    expect(MEETING_INGEST_PROMPT_VERSION).toBe('meeting-ingest-v1')
  })

  // 10
  it('writes a rationale a human can read, derived from the promotion reason and evidence', async () => {
    const { sql } = harness({ candidates: [candidate()] })

    await runMeetingIngest(sql, ctx())

    const [, input] = createProposal.mock.calls[0]!
    const rationale = String(input.rationale)
    expect(rationale.length).toBeGreaterThan(0)
    expect(rationale).toContain('Explicit commitment with a named owner and a date')
    expect(rationale).toContain('mtg_1')
    expect(rationale).toMatch(/0\.82|82%/)
    // Pure function, unit-testable apart from the DB.
    expect(buildRationale(candidate())).toBe(rationale)
  })

  // 10b — UX audit F4: "Confidence 0.91 from 0 transcript reference(s)" is a
  // precise number asserted from nothing. The rationale is rendered verbatim on
  // the memory card, so the figure must not be written when no evidence backs it.
  it('omits the confidence figure entirely when the candidate has no evidence refs', () => {
    for (const evidence_refs of [[], null] as const) {
      const rationale = buildRationale(candidate({ evidence_refs }))
      expect(rationale).not.toMatch(/confidence/i)
      expect(rationale).not.toContain('0.82')
      expect(rationale).not.toMatch(/0 transcript reference/i)
      // The rest of the rationale still explains itself.
      expect(rationale).toContain('mtg_1')
      expect(rationale).toContain('Explicit commitment with a named owner and a date')
    }
  })

  it('states the confidence with its evidence count when evidence exists', () => {
    const rationale = buildRationale(
      candidate({ evidence_refs: [{ segment_id: 'seg_1' }, { segment_id: 'seg_2' }] }),
    )
    expect(rationale).toContain('Confidence 0.82 from 2 transcript reference(s).')
  })

  // 11
  it("sets payload.source='meeting', and accepting such a proposal carries it into the work item", async () => {
    const { sql } = harness({ candidates: [candidate()] })
    await runMeetingIngest(sql, ctx())
    const [, input] = createProposal.mock.calls[0]!
    expect((input.payload as Record<string, unknown>).source).toBe('meeting')
    expect(buildProposalPayload(candidate()).source).toBe('meeting')

    // …and the accept path hands that source straight to the domain create — the
    // validator passes the payload through, so nothing needs widening.
    const proposal = {
      id: 'p_meeting',
      tenant_id: PLATFORM_TENANT,
      run_id: RUN_ID,
      target_type: 'work_item',
      target_id: null,
      operation: 'create',
      payload: buildProposalPayload(candidate()),
      status: 'pending',
    }
    const applySql = vi.fn(async (strings: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join('?') : String(strings)
      if (text.includes('from proposals')) return [proposal]
      return []
    }) as unknown as Sql
    ;(applySql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn(async () => [])

    await applyProposal(applySql, { tenantIds: [PLATFORM_TENANT], approverUserId: 'u_1' }, 'p_meeting')

    expect(createWorkItem).toHaveBeenCalledTimes(1)
    const [, , createInput] = createWorkItem.mock.calls[0]!
    expect(createInput.source).toBe('meeting')
  })

  // 12
  it('skips a candidate already recorded in meeting_promotions for that tenant', async () => {
    const ledger = new Set([`${PLATFORM_TENANT}::ai_seen`])
    const { sql } = harness({
      candidates: [candidate({ id: 'ai_seen' }), candidate({ id: 'ai_new' })],
      ledger,
    })

    const result = await runMeetingIngest(sql, ctx())

    expect(result.proposalsCreated).toBe(1)
    expect(result.skippedDuplicate).toBe(1)
    expect(createProposal.mock.calls.map(([, i]) => i.context_ref)).toEqual(['ai_new'])
  })

  // 13
  it('survives rematerialization — delete + re-insert with the SAME content id proposes nothing new', async () => {
    const ledger = new Set<string>()
    const first = harness({ candidates: [candidate({ id: 'ai_stable' })], ledger })
    const firstResult = await runMeetingIngest(first.sql, ctx())
    expect(firstResult.proposalsCreated).toBe(1)

    // meeting-api's server.py drops and re-inserts the action item; the row is new,
    // its content-derived id is not. The ledger keys on that id, so the second pass
    // must be a no-op.
    createProposal.mockClear()
    const second = harness({ candidates: [candidate({ id: 'ai_stable' })], ledger })
    const secondResult = await runMeetingIngest(second.sql, ctx())

    expect(secondResult.proposalsCreated).toBe(0)
    expect(secondResult.skippedDuplicate).toBe(1)
    expect(createProposal).not.toHaveBeenCalled()
  })

  // 14
  it('writes one ledger row per proposal, linking the meeting record id to the proposal id', async () => {
    const { sql, ledgerInserts } = harness({ candidates: [candidate({ id: 'ai_a' }), candidate({ id: 'ai_b' })] })

    await runMeetingIngest(sql, ctx())

    expect(ledgerInserts).toHaveLength(2)
    expect(ledgerInserts[0]).toEqual([PLATFORM_TENANT, 'ai_a', 'prop_ai_a'])
    expect(ledgerInserts[1]).toEqual([PLATFORM_TENANT, 'ai_b', 'prop_ai_b'])
  })

  // 14b — the CONCURRENT case. Two ingests race: both pass the ledger read, both
  // create a proposal, one loses the ledger's unique index. The loser must not leave
  // its proposal sitting in the reviewer's pending inbox.
  it('latches the losing proposal to superseded when a concurrent run wins the ledger', async () => {
    const { sql, proposalUpdates } = harness({
      candidates: [candidate({ id: 'ai_won' }), candidate({ id: 'ai_lost' })],
      lostRace: new Set(['ai_lost']),
    })

    const result = await runMeetingIngest(sql, ctx())

    // The loser's proposal is latched out of `pending`, so `listPending` cannot show it.
    expect(proposalUpdates).toHaveLength(1)
    const [updateText, updateParams] = proposalUpdates[0]!
    expect(updateText).toMatch(/status\s*=\s*'superseded'/i)
    expect(updateText).toMatch(/status\s*=\s*'pending'/i) // guarded — never re-latch a decided proposal
    expect(updateParams).toEqual(['prop_ai_lost'])

    // And the summary counts it as the duplicate it is, not as work created.
    expect(result.proposalsCreated).toBe(1)
    expect(result.skippedDuplicate).toBe(1)
    expect(result.proposalIds).toEqual(['prop_ai_won'])
  })

  // 15
  it('a run with zero new candidates still mints the run, proposes nothing, and does not throw', async () => {
    const { sql, query } = harness({ candidates: [] })

    const result = await runMeetingIngest(sql, ctx())

    expect(result).toEqual({
      proposalsCreated: 0,
      skippedDuplicate: 0,
      skippedUnmappedTenant: 0,
      tenantAllowlisted: true,
      proposalIds: [],
      runId: RUN_ID,
    })
    // Pinned: the run is minted unconditionally (test 6's "regardless of candidate
    // count"), and completed even on the empty path.
    expect((query.mock.calls as [string, unknown[]][]).filter(([t]) => /insert into "agent_runs"/i.test(t))).toHaveLength(1)
    expect(createProposal).not.toHaveBeenCalled()
    expect((query.mock.calls as [string, unknown[]][]).some(([t]) => /update "agent_runs"/i.test(t))).toBe(true)
  })

  it('refuses everything when the tenant map is empty — fail-closed, nothing proposed', async () => {
    const { sql, query } = harness({ candidates: [candidate()] })

    const result = await runMeetingIngest(sql, {
      tenantId: PLATFORM_TENANT,
      tenantMap: parseMeetingTenantMap(undefined),
    })

    expect(result.proposalsCreated).toBe(0)
    expect(createProposal).not.toHaveBeenCalled()

    // The caller is TOLD its tenant is not allowlisted — that is the "why did nothing
    // appear" signal, and it is a fact about the caller's own configuration.
    expect(result.tenantAllowlisted).toBe(false)

    // Regression pin: with no allowed meeting tenants the old code ran an unfiltered
    // `count(*)` over `action_items` and returned it, so an unallowlisted caller could
    // read the promoted-candidate volume of every other tenant. No `action_items`
    // query may run at all on this path.
    expect(
      (query.mock.calls as [string, unknown[]][]).filter(([t]) => /from "action_items"/i.test(t)),
    ).toHaveLength(0)
    expect(result.skippedUnmappedTenant).toBe(0)
  })
})
