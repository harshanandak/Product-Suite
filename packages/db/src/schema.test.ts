import { describe, expect, it } from 'vitest'

import * as schema from './schema'

describe('workboard schema', () => {
  it('exports the workboard tables', () => {
    for (const table of [
      'projects',
      'workItems',
      'checks',
      'workItemDependencies',
      'activityEvents',
    ] as const) {
      expect(schema[table]).toBeDefined()
    }
  })

  it('proposals table exposes the decision-corpus + apply columns', () => {
    const cols = Object.keys(schema.proposals)
    for (const c of [
      'id',
      'tenantId',
      'runId',
      'targetType',
      'targetId',
      'operation',
      'payload',
      'riskLevel',
      'status',
      'decidedBy',
      'editedPayload',
      'rejectionReason',
      'targetVersion',
      'modelId',
      'promptVersion',
      'contextRef',
      'actorType',
    ]) {
      expect(cols).toContain(c)
    }
    expect(schema.proposalStatusEnum.enumValues).toEqual([
      'pending',
      'accepted',
      'accepted_with_edits',
      'rejected',
      'superseded',
      'expired',
      'applied',
    ])
  })

  it('mirrors the @product-suite/contracts enum values exactly', () => {
    expect(schema.phaseEnum.enumValues).toEqual(['plan', 'execute', 'review', 'done'])
    expect(schema.checkStatusEnum.enumValues).toEqual(['todo', 'in_progress', 'completed'])
    expect(schema.priorityEnum.enumValues).toEqual(['critical', 'high', 'medium', 'low'])
    expect(schema.workItemTypeEnum.enumValues).toEqual(['feature', 'bug', 'chore', 'research'])
    expect(schema.workItemSourceEnum.enumValues).toEqual(['manual', 'meeting', 'agent', 'feedback'])
    expect(schema.dependencyRelationshipEnum.enumValues).toEqual(['depends_on', 'blocks', 'complements'])
    expect(schema.activityEventKindEnum.enumValues).toEqual([
      'created',
      'updated',
      'dependency_added',
      'dependency_removed',
    ])
  })
})
