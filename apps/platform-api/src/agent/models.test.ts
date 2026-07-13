import { describe, expect, it } from 'vitest'

import { agentModel, DEFAULT_AGENT_MODEL, openrouterFrom } from './models'

describe('agent model config', () => {
  it('builds a model for the env-configured AGENT_MODEL without a live provider call', () => {
    // Pure construction: no network, just the provider wiring. Proves the model id
    // is a CONFIG value the caller supplies, never a hard-coded lock-in.
    const model = agentModel({ OPENROUTER_API_KEY: 'k', AGENT_MODEL: 'x/y' })
    expect(model).toBeDefined()
    // AI SDK v6 language models expose a stable string modelId.
    expect((model as { modelId?: string }).modelId).toBe('x/y')
  })

  it('falls back to the documented DEFAULT_AGENT_MODEL when AGENT_MODEL is unset', () => {
    const model = agentModel({ OPENROUTER_API_KEY: 'k' })
    expect((model as { modelId?: string }).modelId).toBe(DEFAULT_AGENT_MODEL)
    expect(DEFAULT_AGENT_MODEL).toContain('/')
  })

  it('openrouterFrom returns a provider factory callable with any model id', () => {
    const provider = openrouterFrom({ OPENROUTER_API_KEY: 'k' })
    expect(typeof provider).toBe('function')
    expect(provider('some/model')).toBeDefined()
  })
})
