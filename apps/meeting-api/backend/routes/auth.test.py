from backend.routes.auth import auth_provider_names


def test_auth_provider_names_for_neon():
    assert auth_provider_names("neon") == ("email", "google")


def test_auth_provider_names_for_local_auth():
    assert auth_provider_names("local") == ("email",)
