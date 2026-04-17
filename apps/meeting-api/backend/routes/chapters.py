"""Chapter summary payload helpers for summary-first Sprint 1."""

def _format_elapsed_label(seconds: int | float) -> str:
    total_seconds = max(int(float(seconds)), 0)
    minutes, remainder = divmod(total_seconds, 60)
    return f"{minutes}:{remainder:02d}"


def _default_window_label(chapter: dict[str, object]) -> str:
    return f"{_format_elapsed_label(chapter.get('window_start') or 0)}-{_format_elapsed_label(chapter.get('window_end') or 0)}"


def build_chapter_list_payload(chapters: list[dict[str, object]]) -> dict[str, object]:
    normalized = []
    for chapter in chapters:
        next_chapter = dict(chapter)
        next_chapter["window_label"] = next_chapter.get("window_label") or _default_window_label(next_chapter)
        normalized.append(next_chapter)
    return {"chapters": normalized}
