import json
from pathlib import Path

from backend.routes.runtime import build_runtime_config_payload
from backend.routes.state import build_state_payload


def load_contract_artifact(name: str) -> dict:
    root = Path(__file__).resolve().parents[4]
    return json.loads(
        (root / "packages" / "contracts" / "contracts" / f"{name}.json").read_text(
            encoding="utf-8"
        )
    )


def test_runtime_config_payload_exposes_neon_auth_metadata():
    contract = load_contract_artifact("meeting-runtime-config")
    payload = build_runtime_config_payload(
        deployment_mode="hosted",
        auth_required=True,
        auth_provider="neon",
        supported_auth_providers=["email", "google"],
        tenant_mode="organization",
        organization_required=True,
        onboarding_required=True,
        backend_url="http://localhost:8000",
        hosted_auth_url="https://project-123.neon.tech/auth",
        database_provider="neon",
        storage_backend="r2",
        raw_audio_retention_days=30,
        transcript_retention_days=-1,
        derived_retention_days=-1,
        state_window_seconds=120,
        chapter_window_seconds=300,
        inactivity_timeout_seconds=180,
        retrieval_corpus=["chapter_summary", "final_summary"],
        retrieval_ranking_profile="hybrid_summary_first",
        capabilities={"whisper": {"transcription": True}},
        engines=[{"id": "whisper", "name": "Whisper", "available": True}],
    )

    runtime_config = contract["runtimeConfig"]
    auth = runtime_config["auth"]
    database = runtime_config["database"]
    storage = runtime_config["storage"]
    summary_policy = runtime_config["summaryPolicy"]
    retrieval_policy = runtime_config["retrievalPolicy"]

    assert payload["auth"][auth["providerKey"]] == "neon"
    assert payload["auth"]["neon"] == {
        auth["neonAuthUrlKey"]: "https://project-123.neon.tech/auth",
    }
    assert payload["database"][database["providerKey"]] == "neon"
    assert payload["storage"][storage["backendKey"]] == "r2"
    assert payload["storage"][storage["audioArchivalEnabledKey"]] is True
    assert payload["summary_policy"][summary_policy["rawAudioRetentionDaysKey"]] == 30
    assert payload["summary_policy"][summary_policy["transcriptRetentionDaysKey"]] == -1
    assert payload["summary_policy"][summary_policy["derivedRetentionDaysKey"]] == -1
    assert payload["summary_policy"][summary_policy["stateWindowSecondsKey"]] == 120
    assert payload["summary_policy"][summary_policy["chapterWindowSecondsKey"]] == 300
    assert payload["summary_policy"][summary_policy["inactivityTimeoutSecondsKey"]] == 180
    assert payload["retrieval_policy"] == {
        retrieval_policy["historyCorpusKey"]: ["chapter_summary", "final_summary"],
        retrieval_policy["rankingProfileKey"]: "hybrid_summary_first",
    }


def test_build_state_payload_normalizes_missing_list_fields_and_confidence():
    payload = build_state_payload(
        {
            "current_topic": "Billing",
            "current_goal": "Stabilize retries",
            "summary_bullets": None,
            "decisions_forming": None,
            "blockers": None,
            "open_questions": None,
            "active_action_items": None,
            "confidence": None,
        }
    )

    assert payload == {
        "current_topic": "Billing",
        "current_goal": "Stabilize retries",
        "summary_bullets": [],
        "decisions_forming": [],
        "blockers": [],
        "open_questions": [],
        "active_action_items": [],
        "confidence": 0,
    }
