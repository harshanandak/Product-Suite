"""Provider-swappable LLM seam for grounded buddy answers.

Buddy answering only needs a callable that takes ``(context, question)`` and
returns a grounded answer string. This keeps the answering logic decoupled from
any specific provider so it can be swapped or mocked in tests. The default
implementation is backed by the OpenAI chat/completions API and reuses the
existing ``AsyncOpenAI`` client and key configured in ``server``/``config``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)

# A buddy responder answers a question grounded ONLY in the supplied context.
# Signature: (context, question) -> answer text
BuddyResponder = Callable[[str, str], Awaitable[str]]

# Bound the provider request so a slow/hung provider cannot stall the buddy path.
BUDDY_REQUEST_TIMEOUT_SECONDS = 30.0

# Provider errors we degrade on. ``OpenAIError`` is the base of every OpenAI SDK
# error (timeouts, rate limits, connection/API errors); combined with
# ``asyncio.TimeoutError`` this covers slow-or-failing providers. Imported
# defensively so this provider-decoupled module still loads if the SDK is absent.
try:  # pragma: no cover - exercised indirectly
    from openai import OpenAIError as _OpenAIError

    _PROVIDER_ERRORS: tuple[type[BaseException], ...] = (asyncio.TimeoutError, _OpenAIError)
except Exception:  # pragma: no cover - openai always present in this service
    _PROVIDER_ERRORS = (asyncio.TimeoutError,)


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
        try:
            completion = await asyncio.wait_for(
                client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                ),
                timeout=BUDDY_REQUEST_TIMEOUT_SECONDS,
            )
        except _PROVIDER_ERRORS as exc:
            # Timeout or provider error (including non-transient ones like a bad
            # API key or invalid model, not just timeouts). Log it so production
            # degradation is visible in logs/metrics, then return an empty answer
            # so the caller degrades to its deterministic preview fallback.
            logger.warning(
                "Buddy responder degraded to fallback (%s): %s",
                type(exc).__name__,
                exc,
            )
            return ""
        return _extract_completion_text(completion)

    return _respond
