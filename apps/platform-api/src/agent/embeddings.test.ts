import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_EMBED_MODEL, embed, EmbeddingError } from './embeddings'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('embed', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs one batched request to the OpenRouter embeddings endpoint with the bearer key + OpenAI-format body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
    )

    const result = await embed(['first', 'second'], { OPENROUTER_API_KEY: 'sk-test' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      model: DEFAULT_EMBED_MODEL,
      input: ['first', 'second'],
      dimensions: 1024,
    })
    // No input_type on the payload — OpenAI-format embeddings share one call shape
    // for both ingest and query, unlike native-format embedding APIs.
    expect(body.input_type).toBeUndefined()

    expect(result).toEqual({
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      model: DEFAULT_EMBED_MODEL,
      dims: 1024,
    })
  })

  it('overrides the model id via env.KB_EMBED_MODEL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ embedding: [1, 2, 3] }] }))

    const result = await embed(['x'], { OPENROUTER_API_KEY: 'sk-test', KB_EMBED_MODEL: 'custom/embed-model' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('custom/embed-model')
    expect(result.model).toBe('custom/embed-model')
  })

  it('throws EmbeddingError on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }))

    await expect(embed(['x'], { OPENROUTER_API_KEY: 'sk-test' })).rejects.toBeInstanceOf(EmbeddingError)
  })

  it('throws EmbeddingError on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    await expect(embed(['x'], { OPENROUTER_API_KEY: 'sk-test' })).rejects.toBeInstanceOf(EmbeddingError)
  })

  it('throws EmbeddingError on a malformed (non-OpenAI-shaped) response body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { unexpected: true }))

    await expect(embed(['x'], { OPENROUTER_API_KEY: 'sk-test' })).rejects.toBeInstanceOf(EmbeddingError)
  })

  it('throws EmbeddingError when the response body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))

    await expect(embed(['x'], { OPENROUTER_API_KEY: 'sk-test' })).rejects.toBeInstanceOf(EmbeddingError)
  })
})
