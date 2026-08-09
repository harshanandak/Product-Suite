from backend.db import build_db_connection_kwargs, build_db_engine_connect_args


def test_provider_does_not_install_a_provider_specific_search_path():
    settings = type("SettingsStub", (), {"database_provider": "supabase"})()

    assert build_db_connection_kwargs(settings) == {}
    assert build_db_engine_connect_args(settings) == {}


def test_neon_provider_keeps_default_search_path():
    settings = type("SettingsStub", (), {"database_provider": "neon"})()

    assert build_db_connection_kwargs(settings) == {}
    assert build_db_engine_connect_args(settings) == {}


def test_unknown_provider_also_keeps_driver_default_search_path():
    settings = type("SettingsStub", (), {"database_provider": "postgres"})()

    assert build_db_connection_kwargs(settings) == {}
    assert build_db_engine_connect_args(settings) == {}
