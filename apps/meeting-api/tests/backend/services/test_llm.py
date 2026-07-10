"""Per-file behavior tests for ``backend.services.llm``.

The OpenAI client is always mocked here: these tests must never reach a real
provider. They assert that ``build_openai_buddy_responder`` produces a callable
that sends the grounding system prompt plus the meeting context and question to
the (mocked) ``chat.completions.create`` and returns ``choices[0].message.content``.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = APP_ROOT / "backend"
for candidate in (str(APP_ROOT), str(BACKEND_DIR)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

import backend.services.llm as llm_module
from backend.services.llm import BUDDY_SYSTEM_PROMPT, build_openai_buddy_responder

try:  # The service always ships the openai SDK; guard so the test module still loads.
    from openai import OpenAIError
except Exception:  # pragma: no cover
    OpenAIError = None


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMessage(content)


class _FakeCompletion:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, content):
        self._content = content
        self.calls = []

    async def create(self, **kwargs):
        # Record how the responder called the OpenAI API so the test can assert
        # the model, system prompt, and grounded user content.
        self.calls.append(kwargs)
        return _FakeCompletion(self._content)


class _FakeChat:
    def __init__(self, content):
        self.completions = _FakeCompletions(content)


class _FakeAsyncOpenAI:
    """Stand-in for ``AsyncOpenAI`` exposing ``chat.completions.create``."""

    def __init__(self, content="Grounded model answer."):
        self.chat = _FakeChat(content)


def test_responder_sends_grounding_prompt_context_and_question_then_returns_content():
    client = _FakeAsyncOpenAI(content="  Grounded model answer.  ")
    responder = build_openai_buddy_responder(client, "gpt-buddy-test")

    answer = asyncio.run(responder("Decision: launch next Friday.", "When do we launch?"))

    # Returns choices[0].message.content, trimmed.
    assert answer == "Grounded model answer."

    assert len(client.chat.completions.calls) == 1
    call = client.chat.completions.calls[0]
    assert call["model"] == "gpt-buddy-test"

    messages = call["messages"]
    # System message is the grounding prompt.
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == BUDDY_SYSTEM_PROMPT
    # User message carries BOTH the meeting context and the raw question.
    assert messages[1]["role"] == "user"
    assert "Decision: launch next Friday." in messages[1]["content"]
    assert "When do we launch?" in messages[1]["content"]


def test_responder_sends_only_the_question_when_context_is_blank():
    client = _FakeAsyncOpenAI(content="answer")
    responder = build_openai_buddy_responder(client, "gpt-buddy-test")

    asyncio.run(responder("   ", "What is the status?"))

    assert len(client.chat.completions.calls) == 1
    user_content = client.chat.completions.calls[0]["messages"][1]["content"]
    assert user_content == "What is the status?"
    assert "Meeting context" not in user_content


def test_responder_uses_a_custom_system_prompt_when_provided():
    client = _FakeAsyncOpenAI(content="x")
    responder = build_openai_buddy_responder(client, "gpt-buddy-test", system_prompt="CUSTOM GROUNDING")

    asyncio.run(responder("ctx", "q"))

    assert len(client.chat.completions.calls) == 1
    assert client.chat.completions.calls[0]["messages"][0]["content"] == "CUSTOM GROUNDING"


def test_responder_returns_empty_string_when_completion_has_no_choices():
    class _EmptyCompletions:
        async def create(self, **kwargs):
            return type("_Empty", (), {"choices": []})()

    client = type(
        "_Client",
        (),
        {"chat": type("_Chat", (), {"completions": _EmptyCompletions()})()},
    )()
    responder = build_openai_buddy_responder(client, "model")

    assert asyncio.run(responder("ctx", "q")) == ""


@pytest.mark.skipif(OpenAIError is None, reason="openai SDK not importable")
def test_responder_returns_empty_fallback_when_provider_raises():
    # A provider error (any OpenAIError subclass) must degrade to an empty answer
    # so the caller falls back to its deterministic preview instead of 500ing.
    class _FailingCompletions:
        async def create(self, **kwargs):
            raise OpenAIError("provider is down")

    client = type(
        "_Client",
        (),
        {"chat": type("_Chat", (), {"completions": _FailingCompletions()})()},
    )()
    responder = build_openai_buddy_responder(client, "model")

    assert asyncio.run(responder("ctx", "q")) == ""


def test_responder_returns_empty_fallback_when_request_times_out(monkeypatch):
    # Bound the request: a provider slower than the timeout yields the safe empty
    # fallback rather than hanging the buddy path.
    monkeypatch.setattr(llm_module, "BUDDY_REQUEST_TIMEOUT_SECONDS", 0.01)

    class _SlowCompletions:
        async def create(self, **kwargs):
            await asyncio.sleep(1)
            return _FakeCompletion("late answer")

    client = type(
        "_Client",
        (),
        {"chat": type("_Chat", (), {"completions": _SlowCompletions()})()},
    )()
    responder = build_openai_buddy_responder(client, "model")

    assert asyncio.run(responder("ctx", "q")) == ""


def test_responder_never_reaches_a_real_provider():
    # A responder built for a client whose create() explodes proves we only ever
    # touch the injected client, never a network call.
    class _ExplodingCompletions:
        async def create(self, **kwargs):
            raise AssertionError("real provider must never be contacted")

    client = type(
        "_Client",
        (),
        {"chat": type("_Chat", (), {"completions": _ExplodingCompletions()})()},
    )()
    responder = build_openai_buddy_responder(client, "model")

    with pytest.raises(AssertionError):
        asyncio.run(responder("ctx", "q"))
