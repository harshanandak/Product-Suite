from __future__ import annotations


def normalize_sqlalchemy_database_url(url: str) -> str:
    candidate = (url or "").strip()
    if not candidate:
        return candidate
    if candidate.startswith("postgres://"):
        return "postgresql+psycopg://" + candidate[len("postgres://") :]
    if candidate.startswith("postgresql://"):
        return "postgresql+psycopg://" + candidate[len("postgresql://") :]
    return candidate
