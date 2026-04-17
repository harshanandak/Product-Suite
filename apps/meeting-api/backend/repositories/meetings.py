"""Meeting repository helpers."""


def meeting_visible_to_actor(meeting: dict, actor_user_id: str, actor_tenant_id: str | None = None) -> bool:
    """Return whether the actor can see the meeting.

    Semantics:
    - ``private``: only the owner can see it
    - ``team``: any actor in the same tenant can see it
    - ``public``: visible to any actor
    Unknown visibility values fall back to owner-only.
    """

    visibility = meeting.get("visibility", "private")
    owner_user_id = meeting.get("owner_user_id")
    meeting_tenant_id = meeting.get("tenant_id")

    if visibility == "private":
        return owner_user_id == actor_user_id

    if visibility == "team":
        return owner_user_id == actor_user_id or (
            actor_tenant_id is not None and meeting_tenant_id is not None and actor_tenant_id == meeting_tenant_id
        )

    if visibility == "public":
        return True

    return owner_user_id == actor_user_id
