from backend.routes.runtime import build_runtime_config_payload


def test_runtime_config_payload_exposes_hosted_auth_metadata():
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

    assert payload["auth"]["provider"] == "neon"
    assert payload["auth"]["supported_providers"] == ["email", "google"]
    assert payload["auth"]["neon"] == {
        "auth_url": "https://project-123.neon.tech/auth",
    }
    assert payload["tenant_mode"] == "organization"
    assert payload["database"]["provider"] == "neon"
    assert payload["storage"]["backend"] == "r2"
