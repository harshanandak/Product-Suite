"""Runtime policy helpers for summary-first Sprint 1."""


def build_runtime_config_payload(
    *,
    deployment_mode: str,
    auth_required: bool,
    auth_provider: str,
    supported_auth_providers: list[str],
    tenant_mode: str,
    organization_required: bool,
    onboarding_required: bool,
    backend_url: str,
    database_provider: str,
    storage_backend: str,
    raw_audio_retention_days: int,
    transcript_retention_days: int,
    derived_retention_days: int,
    state_window_seconds: int,
    chapter_window_seconds: int,
    inactivity_timeout_seconds: int,
    retrieval_corpus: list[str],
    retrieval_ranking_profile: str,
    capabilities: dict[str, dict[str, bool]],
    engines: list[dict[str, object]],
    hosted_auth_url: str | None = None,
) -> dict[str, object]:
    audio_archival_enabled = storage_backend != "local" and raw_audio_retention_days != 0
    hosted_auth = {"auth_url": hosted_auth_url or ""}
    return {
        "deployment_mode": deployment_mode,
        "tenant_mode": tenant_mode,
        "database": {
            "provider": database_provider,
        },
        "auth": {
            "required": auth_required,
            "mode": "bearer",
            "provider": auth_provider,
            "supported_providers": supported_auth_providers,
            "organization_required": organization_required,
            "onboarding_required": onboarding_required,
            "neon": hosted_auth,
        },
        "backend_url": backend_url,
        "storage_backend": storage_backend,
        "storage": {
            "backend": storage_backend,
            "audio_archival_enabled": audio_archival_enabled,
        },
        "capabilities": capabilities,
        "engines": engines,
        "summary_policy": {
            "raw_audio_retention_days": raw_audio_retention_days,
            "transcript_retention_days": transcript_retention_days,
            "derived_retention_days": derived_retention_days,
            "state_window_seconds": state_window_seconds,
            "chapter_window_seconds": chapter_window_seconds,
            "inactivity_timeout_seconds": inactivity_timeout_seconds,
            "full_transcript_retained": transcript_retention_days != 0,
        },
        "retrieval_policy": {
            "history_corpus": retrieval_corpus,
            "ranking_profile": retrieval_ranking_profile,
        },
    }
