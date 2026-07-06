"""Provider-swappable LLM seam for grounded buddy answers.

Buddy answering only needs a callable that takes ``(context, question)`` and
returns a grounded answer string. This keeps the answering logic decoupled from
any specific provider so it can be swapped or mocked in tests. The default
implementation is backed by the OpenAI chat/completions API and reuses the
existing ``AsyncOpenAI`` client and key configured in ``server``/``config``.
"""

from __future__ import annotations

from typing import Awaitable, Callable

# A buddy responder answers a question grounded ONLY in the supplied context.
# Signature: (context, question) -> answer text
BuddyResponder = Callable[[str, str], Awaitable[str]]


BUDDY_SYSTEM_PROMPT = (
    "You are a meeting buddy answering live questions during a meeting. "
    "Answer the user's question using ONLY the meeting context provided. "
    "Be concise and specific, and reference decisions, action items, open "
    "questions, or speakers when relevant. If the provided context does not "
    "contain enough information to answer, say you do not have enough meeting "
    "context to answer that yet."
)


def _extract_completion_text(completion: object) -> str:
    choices = getattr(completion, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", None) if message is not None else None
    return (content or "").strip()


def build_openai_buddy_responder(
    client: object,
    model: str,
    *,
    system_prompt: str = BUDDY_SYSTEM_PROMPT,
) -> BuddyResponder:
    """Build a ``BuddyResponder`` backed by the OpenAI chat/completions API.

    ``client`` is expected to expose an async ``chat.completions.create`` method
    (i.e. the ``AsyncOpenAI`` client already configured in ``server``).
    """

    async def _respond(context: str, question: str) -> str:
        if context.strip():
            user_content = f"Meeting context:\n{context}\n\nQuestion: {question}"
        else:
            user_content = question
        completion = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        return _extract_completion_text(completion)

    return _respond
