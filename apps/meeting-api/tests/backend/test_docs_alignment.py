from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_readme_describes_current_hosted_baseline():
    content = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "Neon Postgres" in content
    assert "Neon Auth" in content
    assert "/api/auth/session/exchange" in content
    assert "app-owned organizations" in content
    assert "WorkOS" not in content
    assert "Cloudflare R2" in content
    assert "SQLAlchemy Core" in content
    assert "recommended hosted database path is Supabase" not in content


def test_hosted_docs_replace_workos_bootstrap_with_neon_identity_exchange():
    docs = {
        "env": (REPO_ROOT / "backend/.env.example").read_text(encoding="utf-8"),
        "foundation": (REPO_ROOT / "docs/deployment/HOSTED_FOUNDATION.md").read_text(encoding="utf-8"),
        "api": (REPO_ROOT / "docs/reference/API_REFERENCE.md").read_text(encoding="utf-8"),
    }

    assert "NEON_AUTH_URL" in docs["env"]
    assert "WORKOS_" not in docs["env"]

    assert "Neon Auth" in docs["foundation"]
    assert "/api/auth/session/exchange" in docs["foundation"]
    assert "app-owned organizations" in docs["foundation"]
    assert "/auth/callback" in docs["foundation"]
    assert "/auth/signed-out" in docs["foundation"]
    assert "WorkOS" not in docs["foundation"]

    assert "Neon Auth" in docs["api"]
    assert "/api/auth/session/exchange" in docs["api"]
    assert "/api/auth/onboarding/invitations" in docs["api"]
    assert "app-owned organizations" in docs["api"]
    assert "/auth/callback" in docs["api"]
    assert "/api/auth/workos/" not in docs["api"]
    assert "WorkOS" not in docs["api"]


def test_agents_references_existing_workflow_docs():
    content = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")

    required_paths = [
        "docs/forge/TOOLCHAIN.md",
        "docs/forge/VALIDATION.md",
        "docs/deployment/HOSTED_FOUNDATION.md",
        "docs/deployment/PRODUCTION_HOSTED_LAUNCH_CHECKLIST.md",
    ]

    for relative_path in required_paths:
        assert relative_path in content
        assert (REPO_ROOT / relative_path).exists()
