import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

/**
 * The agent runtime is model-AGNOSTIC by construction. Every model is reached
 * through OpenRouter (300+ models behind one endpoint), and *which* model the
 * agent uses is a runtime CONFIG value (`env.AGENT_MODEL`), never hard-coded into
 * the loop. This mirrors `apps/roadmap-web/src/lib/ai/ai-sdk-client.ts` — swap the
 * env var and the whole agent retargets, with no code change and no provider lock.
 */
export interface AgentModelEnv {
  /** OpenRouter API key (Workers secret / process env). Undefined in tests. */
  OPENROUTER_API_KEY?: string
  /** The OpenRouter model id to run the agent on. Falls back to the default. */
  AGENT_MODEL?: string
}

/**
 * The documented default agent model — a founder configuration choice (design §17
 * open question), not a placeholder. GLM 4.7 is a strong tool-calling / agentic
 * model (top tool-use benchmarks); it is overridable per deployment via
 * `env.AGENT_MODEL` so the choice is never locked in.
 */
export const DEFAULT_AGENT_MODEL = 'z-ai/glm-4.7'

/**
 * Build an OpenRouter provider factory from the request environment. Construction
 * is pure — no network call happens until a model is actually invoked — so this is
 * safe to call per request and trivial to exercise in tests without a live model.
 */
export function openrouterFrom(env: AgentModelEnv): OpenRouterProvider {
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })
}

/**
 * Resolve the concrete `LanguageModel` the agent loop runs on: the env-configured
 * `AGENT_MODEL`, or the documented default. The returned model carries the id as
 * config; nothing here binds the runtime to a specific provider or model.
 */
export function agentModel(env: AgentModelEnv): LanguageModel {
  return openrouterFrom(env)(env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL)
}
