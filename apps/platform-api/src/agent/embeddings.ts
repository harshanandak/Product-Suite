/**
 * OpenRouter embedding client (Memory Brain P3a). ONE batched POST per call to the
 * OpenAI-compatible `/embeddings` endpoint — OpenAI-format embeddings carry no
 * `input_type` (unlike some native embedding APIs), so ingest and query share the
 * exact same call shape and can never drift into asymmetric embeddings.
 *
 * A failed embed (bad status, network error, or a malformed body) always THROWS a
 * typed {@link EmbeddingError} — it never returns a partial or zero-vector result.
 * Whether a failed embed should skip/degrade the caller's write or query is the
 * caller's decision (Tasks 4/5), not this client's.
 */

/**
 * Minimal env this client needs. Mirrors the `OPENROUTER_API_KEY` shape declared on
 * `AgentModelEnv` (see `./models.ts`) rather than importing it directly, so the
 * embedding client stays a standalone seam with no dependency on the agent-loop env.
 */
export interface EmbeddingEnv {
  /** OpenRouter API key (Workers secret / process env). Undefined in tests. */
  OPENROUTER_API_KEY?: string
  /** Overrides the default embedding model id — a runtime CONFIG value, same discipline as `AGENT_MODEL`. */
  KB_EMBED_MODEL?: string
}

/** The documented default embedding model, overridable per deployment via `env.KB_EMBED_MODEL`. */
export const DEFAULT_EMBED_MODEL = 'openai/text-embedding-3-large'

/** Fixed output dimensionality for the KB vector index — requested explicitly on every call. */
const EMBED_DIMS = 1024

const EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

/** The batched embed result: vectors in input order, plus provenance for storage. */
export interface EmbedResult {
  vectors: number[][]
  model: string
  dims: number
}

/**
 * Typed failure for any embed call that didn't produce usable vectors — a non-2xx
 * response, a network/fetch failure, or a response body that doesn't match the
 * expected OpenAI shape. Exported so callers can `catch`/`instanceof` it specifically
 * rather than swallowing arbitrary errors.
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[] }[]
}

/** Defensive parse guard — never trust the response shape blindly. */
function isOpenAIEmbeddingResponse(body: unknown): body is OpenAIEmbeddingResponse {
  if (typeof body !== 'object' || body === null) return false
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return false
  return data.every(
    (d) => typeof d === 'object' && d !== null && Array.isArray((d as { embedding?: unknown }).embedding),
  )
}

/**
 * Embed a batch of texts through OpenRouter's OpenAI-compatible embeddings endpoint.
 * ONE POST for the whole batch (never one call per text). Same call for ingest and
 * query — there is no `input_type` to get out of sync.
 */
export async function embed(texts: string[], env: EmbeddingEnv): Promise<EmbedResult> {
  const model = env.KB_EMBED_MODEL ?? DEFAULT_EMBED_MODEL

  let response: Response
  try {
    response = await fetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: texts, dimensions: EMBED_DIMS }),
    })
  } catch (cause) {
    throw new EmbeddingError('Embedding request failed (network error)', cause)
  }

  if (!response.ok) {
    throw new EmbeddingError(`Embedding request failed: ${response.status} ${response.statusText}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    throw new EmbeddingError('Embedding response was not valid JSON', cause)
  }

  if (!isOpenAIEmbeddingResponse(body)) {
    throw new EmbeddingError('Embedding response was malformed (missing data[].embedding)')
  }

  return {
    vectors: body.data.map((d) => d.embedding),
    model,
    dims: EMBED_DIMS,
  }
}
