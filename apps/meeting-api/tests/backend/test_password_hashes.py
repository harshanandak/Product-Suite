from backend.security import verify_password


def test_verify_password_rejects_malformed_base64_hash() -> None:
    malformed_hash = "pbkdf2_sha256$600000$%%%$%%%"

    assert verify_password("secret-password", malformed_hash) is False
