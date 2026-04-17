"""Meeting-state helpers used by summary-first responses."""


def compose_buddy_context(current_context: str, history_context: str) -> str:
    parts = [current_context.strip(), history_context.strip()]
    return "\n".join(part for part in parts if part)
