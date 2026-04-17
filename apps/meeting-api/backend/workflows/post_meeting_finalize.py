"""Post-meeting finalization helpers."""


def should_finalize_meeting(has_transcript: bool, ended_explicitly: bool, halted_due_to_inactivity: bool = False) -> bool:
    return ended_explicitly or halted_due_to_inactivity
