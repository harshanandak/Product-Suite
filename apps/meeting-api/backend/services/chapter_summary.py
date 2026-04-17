"""Chapter-summary helpers for generated draft record extraction."""

import hashlib

try:
    from workflows.chapter_summary_create import BOUNDARY_ADJUSTMENT_SECONDS, resolve_chapter_boundary
except ModuleNotFoundError:  # pragma: no cover - import path depends on startup mode
    from backend.workflows.chapter_summary_create import BOUNDARY_ADJUSTMENT_SECONDS, resolve_chapter_boundary


def _stable_text_suffix(text: str) -> str:
    normalized = " ".join(text.split()).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _meaningful_draft_texts(items: object) -> list[str]:
    if not isinstance(items, list):
        return []

    normalized_items: list[str] = []
    for item in items:
        if not isinstance(item, str):
            continue

        text = " ".join(item.split()).strip()
        if not text:
            continue

        normalized_items.append(text)

    return normalized_items


def _normalized_generated_items(items: object) -> list[dict[str, object]]:
    if not isinstance(items, list):
        return []

    normalized_items: list[dict[str, object]] = []
    for item in items:
        if isinstance(item, str):
            text = " ".join(item.split()).strip()
            if text:
                normalized_items.append({"text": text})
            continue

        if not isinstance(item, dict):
            continue

        raw_text = item.get("text")
        if not isinstance(raw_text, str):
            continue

        text = " ".join(raw_text.split()).strip()
        if not text:
            continue

        normalized_item = dict(item)
        normalized_item["text"] = text
        normalized_items.append(normalized_item)

    return normalized_items


def _confidence_value(item: dict[str, object]) -> float:
    confidence = item.get("confidence")
    if isinstance(confidence, (int, float)):
        return float(confidence)
    return 0


def _should_promote_decision(item: dict[str, object]) -> tuple[str, str | None]:
    signals = item.get("signals") if isinstance(item.get("signals"), dict) else {}
    has_resolution_signal = bool(signals.get("proposal") or signals.get("restatement"))
    has_agreement_signal = bool(signals.get("agreement") or signals.get("restatement"))
    if has_resolution_signal and has_agreement_signal:
        return "promoted", "decision evidence: proposal + agreement/restatement"
    return "draft", None


def _should_promote_action_item(item: dict[str, object]) -> tuple[str, str | None]:
    signals = item.get("signals") if isinstance(item.get("signals"), dict) else {}
    if bool(signals.get("owner") or signals.get("commitment")):
        return "promoted", "action item evidence: assigned or committed"
    return "draft", None


def _record_review_status(kind: str, item: dict[str, object]) -> tuple[str, str | None]:
    if kind == "decision":
        return _should_promote_decision(item)
    if kind == "action_item":
        return _should_promote_action_item(item)
    return "draft", None


def _is_unresolved_open_question(item: dict[str, object]) -> bool:
    signals = item.get("signals") if isinstance(item.get("signals"), dict) else {}
    if bool(signals.get("rhetorical")):
        return False
    if bool(signals.get("resolved") or signals.get("answer_detected")):
        return False
    return True


def _draft_record(kind: str, meeting_id: str, chapter_summary_id: str, tenant_id: str, item: dict[str, object]) -> dict[str, object]:
    review_status, promotion_reason = _record_review_status(kind, item)
    text = str(item["text"])
    return {
        "id": f"{chapter_summary_id}:{kind}:{_stable_text_suffix(text)}",
        "tenant_id": tenant_id,
        "meeting_id": meeting_id,
        "chapter_summary_id": chapter_summary_id,
        "text": text,
        "owner_user_id": item.get("owner_user_id"),
        "evidence_refs": item.get("evidence_refs") if isinstance(item.get("evidence_refs"), list) else [],
        "record_origin": "generated",
        "review_status": review_status,
        "confidence": _confidence_value(item),
        "promotion_reason": promotion_reason,
        "source_window_start": item.get("source_window_start"),
        "source_window_end": item.get("source_window_end"),
    }


def _dedupe_records(records: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}
    for record in records:
        existing = deduped.get(str(record["id"]))
        if existing is None:
            deduped[str(record["id"])] = dict(record)
            continue

        combined_refs = list(dict.fromkeys([*(existing.get("evidence_refs") or []), *(record.get("evidence_refs") or [])]))
        existing["evidence_refs"] = combined_refs
        existing["confidence"] = max(float(existing.get("confidence") or 0), float(record.get("confidence") or 0))
        existing["owner_user_id"] = existing.get("owner_user_id") or record.get("owner_user_id")
        existing["source_window_start"] = min(
            value for value in (existing.get("source_window_start"), record.get("source_window_start")) if value is not None
        ) if existing.get("source_window_start") is not None or record.get("source_window_start") is not None else None
        existing["source_window_end"] = max(
            value for value in (existing.get("source_window_end"), record.get("source_window_end")) if value is not None
        ) if existing.get("source_window_end") is not None or record.get("source_window_end") is not None else None
        if existing.get("review_status") != "promoted" and record.get("review_status") == "promoted":
            existing["review_status"] = "promoted"
            existing["promotion_reason"] = record.get("promotion_reason")

    return list(deduped.values())


def _source_windows_overlap(existing: dict[str, object], record: dict[str, object]) -> bool:
    existing_start = existing.get("source_window_start")
    existing_end = existing.get("source_window_end")
    record_start = record.get("source_window_start")
    record_end = record.get("source_window_end")
    if None in (existing_start, existing_end, record_start, record_end):
        return False
    return float(existing_start) <= float(record_end) and float(record_start) <= float(existing_end)


def dedupe_generated_records_across_chapters(records: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: list[dict[str, object]] = []
    for record in records:
        text_key = _stable_text_suffix(str(record.get("text") or ""))
        existing = next(
            (
                candidate
                for candidate in deduped
                if _stable_text_suffix(str(candidate.get("text") or "")) == text_key
                and (
                    set(candidate.get("evidence_refs") or []).intersection(record.get("evidence_refs") or [])
                    or _source_windows_overlap(candidate, record)
                )
            ),
            None,
        )
        if existing is None:
            deduped.append(dict(record))
            continue

        combined_refs = list(dict.fromkeys([*(existing.get("evidence_refs") or []), *(record.get("evidence_refs") or [])]))
        existing["evidence_refs"] = combined_refs
        existing["confidence"] = max(float(existing.get("confidence") or 0), float(record.get("confidence") or 0))
        existing["owner_user_id"] = existing.get("owner_user_id") or record.get("owner_user_id")
        existing["source_window_start"] = min(
            value for value in (existing.get("source_window_start"), record.get("source_window_start")) if value is not None
        ) if existing.get("source_window_start") is not None or record.get("source_window_start") is not None else None
        existing["source_window_end"] = max(
            value for value in (existing.get("source_window_end"), record.get("source_window_end")) if value is not None
        ) if existing.get("source_window_end") is not None or record.get("source_window_end") is not None else None
        if existing.get("review_status") != "promoted" and record.get("review_status") == "promoted":
            existing["review_status"] = "promoted"
            existing["promotion_reason"] = record.get("promotion_reason")
        if existing.get("chapter_summary_id") != record.get("chapter_summary_id"):
            existing_start = existing.get("source_window_start")
            record_start = record.get("source_window_start")
            if existing_start is None or (record_start is not None and float(record_start) < float(existing_start)):
                existing["chapter_summary_id"] = record.get("chapter_summary_id")
                existing["id"] = record.get("id")

    return deduped


def _format_elapsed_label(seconds: int | float) -> str:
    total_seconds = max(int(seconds), 0)
    minutes, remainder = divmod(total_seconds, 60)
    return f"{minutes}:{remainder:02d}"


def build_chapter_window_payload(
    *,
    window_start: int | float,
    nominal_end: int | float,
    candidate_boundaries: list[int | float],
    meeting_ended: bool,
) -> dict[str, object]:
    valid_candidates = [
        float(candidate)
        for candidate in candidate_boundaries
        if abs(float(candidate) - float(nominal_end)) <= BOUNDARY_ADJUSTMENT_SECONDS
    ]
    resolved_end = resolve_chapter_boundary(
        window_start=window_start,
        nominal_end=nominal_end,
        candidate_boundaries=candidate_boundaries,
        meeting_ended=meeting_ended,
    )
    return {
        "window_start": float(window_start),
        "window_end": resolved_end,
        "window_label": f"{_format_elapsed_label(window_start)}-{_format_elapsed_label(resolved_end)}",
        "boundary_source": "semantic_adjustment" if valid_candidates else "fixed_window",
    }


def extract_generated_records(
    *,
    meeting_id: str,
    chapter_summary_id: str,
    tenant_id: str,
    summary_payload: dict[str, object],
) -> dict[str, list[dict[str, object]]]:
    decisions_forming = _normalized_generated_items(summary_payload.get("decisions_forming"))
    action_items = _normalized_generated_items(summary_payload.get("active_action_items"))
    open_questions = [
        item for item in _normalized_generated_items(summary_payload.get("open_questions")) if _is_unresolved_open_question(item)
    ]

    return {
        "decisions": _dedupe_records([_draft_record("decision", meeting_id, chapter_summary_id, tenant_id, item) for item in decisions_forming]),
        "action_items": _dedupe_records([_draft_record("action_item", meeting_id, chapter_summary_id, tenant_id, item) for item in action_items]),
        "open_questions": _dedupe_records([_draft_record("open_question", meeting_id, chapter_summary_id, tenant_id, item) for item in open_questions]),
    }
