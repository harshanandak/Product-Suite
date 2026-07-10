import { describe, expect, it } from 'vitest'

import * as schema from './schema'

describe('workboard schema', () => {
  it('exports the workboard tables', () => {
    for (const table of [
      'projects',
      'workItems',
      'tasks',
      'workItemDependencies',
      'activityEvents',
    ] as const) {
      expect(schema[table]).toBeDefined()
    }
  })

  it('mirrors the @product-suite/contracts enum values exactly', () => {
    expect(schema.phaseEnum.enumValues).toEqual(['plan', 'execute', 'review', 'done'])
    expect(schema.taskStatusEnum.enumValues).toEqual(['todo', 'in_progress', 'completed'])
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
