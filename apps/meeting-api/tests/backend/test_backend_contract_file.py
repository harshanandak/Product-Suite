import backend_test


def test_backend_contract_script_matches_deferred_audio_policy():
    assert backend_test.SUMMARY_FIRST_RUNTIME_POLICY["raw_audio_retention_days"] == 0
