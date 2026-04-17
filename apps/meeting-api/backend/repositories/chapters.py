"""Chapter summary repository helpers."""


def _chapter_sort_key(record: dict[str, object]) -> tuple[int, float, float]:
    return (
        int(record.get("chapter_index") or 0),
        float(record.get("window_start") or 0),
        float(record.get("window_end") or 0),
    )


def ordered_chapter_summaries(records: list[dict[str, object]]) -> list[dict[str, object]]:
    return sorted(records, key=_chapter_sort_key)


def upsert_chapter_summary(
    existing_records: list[dict[str, object]],
    next_record: dict[str, object],
) -> list[dict[str, object]]:
    remaining_records = [
        record
        for record in existing_records
        if not (
            record.get("meeting_id") == next_record.get("meeting_id")
            and record.get("chapter_index") == next_record.get("chapter_index")
        )
    ]
    remaining_records.append(dict(next_record))
    return ordered_chapter_summaries(remaining_records)
