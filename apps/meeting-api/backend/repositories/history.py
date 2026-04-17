"""SQLAlchemy Core repository for hosted historical meeting retrieval."""

from __future__ import annotations

from sqlalchemy import and_, or_, select
from sqlalchemy.engine import Engine

from backend.services.corpus import normalize_allowed_history_corpora

try:
    from db import chapter_summaries_table, meetings_table, summaries_table
except ModuleNotFoundError:  # pragma: no cover - compatibility for package-style imports
    from backend.db import chapter_summaries_table, meetings_table, summaries_table


def _visibility_clause(actor_user_id: str):
    return or_(
        meetings_table.c.owner_user_id == actor_user_id,
        meetings_table.c.visibility.in_(("team", "public")),
    )


def fetch_history_records(
    engine: Engine,
    *,
    tenant_id: str,
    excluded_meeting_id: str,
    actor_user_id: str,
    allowed_corpora: list[str] | tuple[str, ...] | None,
) -> list[dict[str, object]]:
    normalized_corpora = normalize_allowed_history_corpora(allowed_corpora)
    if not normalized_corpora:
        return []
    records: list[dict[str, object]] = []

    with engine.connect() as conn:
        if "chapter_summary" in normalized_corpora:
            chapter_stmt = (
                select(
                    chapter_summaries_table,
                    meetings_table.c.title.label("meeting_title"),
                    meetings_table.c.project_name,
                    meetings_table.c.tags,
                    meetings_table.c.participant_labels.label("participants"),
                )
                .join(meetings_table, meetings_table.c.id == chapter_summaries_table.c.meeting_id)
                .where(
                    and_(
                        meetings_table.c.tenant_id == tenant_id,
                        meetings_table.c.id != excluded_meeting_id,
                        _visibility_clause(actor_user_id),
                    )
                )
                .order_by(chapter_summaries_table.c.created_at.desc())
                .limit(500)
            )
            chapter_rows = [dict(row) for row in conn.execute(chapter_stmt).mappings().all()]
            for row in chapter_rows:
                row["corpus"] = "chapter_summary"
            records.extend(chapter_rows)

        if "final_summary" in normalized_corpora:
            summary_stmt = (
                select(
                    summaries_table,
                    meetings_table.c.title.label("meeting_title"),
                    meetings_table.c.project_name,
                    meetings_table.c.tags,
                    meetings_table.c.participant_labels.label("participants"),
                )
                .join(meetings_table, meetings_table.c.id == summaries_table.c.meeting_id)
                .where(
                    and_(
                        meetings_table.c.tenant_id == tenant_id,
                        meetings_table.c.id != excluded_meeting_id,
                        _visibility_clause(actor_user_id),
                    )
                )
                .order_by(summaries_table.c.created_at.desc())
                .limit(500)
            )
            summary_rows = [dict(row) for row in conn.execute(summary_stmt).mappings().all()]
            for row in summary_rows:
                row["corpus"] = "final_summary"
            records.extend(summary_rows)

    return records
