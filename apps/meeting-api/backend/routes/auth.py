"""Auth route helpers for Sprint 1."""

HOSTED_AUTH_PROVIDERS = ("email", "google")
LOCAL_AUTH_PROVIDERS = ("email",)


def auth_provider_names(auth_provider: str | None = None) -> tuple[str, ...]:
    if (auth_provider or "").strip().lower() == "neon":
        return HOSTED_AUTH_PROVIDERS
    return LOCAL_AUTH_PROVIDERS
