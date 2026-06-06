from backend.db import build_db_connection_kwargs, build_db_engine_connect_args


def test_supabase_provider_uses_meeting_schema_search_path():
    settings = type("SettingsStub", (), {"database_provider": "supabase"})()

    assert build_db_connection_kwargs(settings)["options"] == "-c search_path=meeting,public"
    assert build_db_engine_connect_args(settings)["options"] == "-c search_path=meeting,public"


def test_neon_provider_keeps_default_search_path():
    settings = type("SettingsStub", (), {"database_provider": "neon"})()

    assert build_db_connection_kwargs(settings) == {}
    assert build_db_engine_connect_args(settings) == {}
