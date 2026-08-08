import { describe, expect, it } from 'vitest'

import { meetingTables } from './meeting-schema'

describe('canonical Meeting schema module', () => {
  it('keeps all Meeting and identity relations in the Drizzle model', () => {
    expect(Object.keys(meetingTables)).toEqual([
      'users',
      'tenants',
      'meetings',
      'transcriptSegments',
      'summaries',
      'chatMessages',
      'jobs',
      'meetingState',
      'chapterSummaries',
      'decisions',
      'actionItems',
      'openQuestions',
      'audioAssets',
      'agentInvocations',
      'agentResponses',
      'meetingLinks',
      'userAuthIdentities',
      'organizationMemberships',
      'organizationInvitations',
    ])
  })
})
