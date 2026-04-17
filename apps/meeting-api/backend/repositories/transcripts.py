"""Transcript repository helpers."""


def recent_display_lines(rows: list[dict], limit: int = 3) -> list[dict]:
    sorted_rows = sorted(rows, key=lambda row: row.get("timestamp_start", 0))
    selected_rows = sorted_rows[-limit:]

    lines = []
    for row in selected_rows:
        text = row.get("translated_text") or row.get("text") or ""
        lines.append(
            {
                "speaker_label": row.get("speaker_label", "Speaker"),
                "text": text,
                "timestamp_start": row.get("timestamp_start", 0),
            }
        )

    return lines
