from backend.services.chapter_summary import extract_generated_records


def test_generated_records_are_draft_and_owner_nullable():
    summary_payload = {
        "decisions_forming": ["Ship next week"],
        "active_action_items": ["Send release note"],
        "open_questions": ["Who owns launch?"],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["decisions"][0]["record_origin"] == "generated"
    assert records["decisions"][0]["review_status"] == "draft"
    assert records["decisions"][0]["confidence"] == 0
    assert records["decisions"][0]["promotion_reason"] is None
    assert records["decisions"][0]["owner_user_id"] is None
    assert records["action_items"][0]["record_origin"] == "generated"
    assert records["action_items"][0]["confidence"] == 0
    assert records["open_questions"][0]["review_status"] == "draft"


def test_generated_record_ids_are_deterministic_for_same_text():
    summary_payload = {
        "decisions_forming": ["Ship next week"],
        "active_action_items": [],
        "open_questions": [],
    }

    first = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )
    second = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert first["decisions"][0]["id"] == second["decisions"][0]["id"]


def test_generated_records_dedupe_duplicate_items_within_same_chapter():
    summary_payload = {
        "decisions_forming": [
            {"text": "Ship next week", "evidence_refs": ["seg-1"], "confidence": 0.4},
            {"text": "Ship next week", "evidence_refs": ["seg-2"], "signals": {"proposal": True, "agreement": True}, "confidence": 0.9},
        ],
        "active_action_items": [],
        "open_questions": [],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert len(records["decisions"]) == 1
    assert records["decisions"][0]["evidence_refs"] == ["seg-1", "seg-2"]
    assert records["decisions"][0]["review_status"] == "promoted"
    assert records["decisions"][0]["confidence"] == 0.9


def test_generated_records_drop_non_string_or_blank_entries():
    summary_payload = {
        "decisions_forming": ["Ship next week", None, "   ", {"oops": "bad"}],
        "active_action_items": ["Send release note", 42],
        "open_questions": ["Who owns launch?", ""],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert [record["text"] for record in records["decisions"]] == ["Ship next week"]
    assert [record["text"] for record in records["action_items"]] == ["Send release note"]
    assert [record["text"] for record in records["open_questions"]] == ["Who owns launch?"]


def test_decision_stays_draft_when_only_tentative_proposal_exists():
    summary_payload = {
        "decisions_forming": [
            {
                "text": "Maybe we should delay launch by one week.",
                "evidence_refs": ["seg-1"],
                "signals": {"proposal": True, "agreement": False, "restatement": False},
            }
        ],
        "active_action_items": [],
        "open_questions": [],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["decisions"][0]["review_status"] == "draft"
    assert records["decisions"][0]["promotion_reason"] is None
    assert records["decisions"][0]["evidence_refs"] == ["seg-1"]


def test_decision_is_promoted_when_resolution_and_agreement_are_present():
    summary_payload = {
        "decisions_forming": [
            {
                "text": "Delay launch by one week.",
                "evidence_refs": ["seg-4", "seg-5"],
                "signals": {"proposal": True, "agreement": True, "restatement": True},
                "confidence": 0.93,
            }
        ],
        "active_action_items": [],
        "open_questions": [],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["decisions"][0]["review_status"] == "promoted"
    assert records["decisions"][0]["promotion_reason"] == "decision evidence: proposal + agreement/restatement"
    assert records["decisions"][0]["confidence"] == 0.93


def test_action_item_stays_draft_when_work_is_vague_and_unassigned():
    summary_payload = {
        "decisions_forming": [],
        "active_action_items": [
            {
                "text": "We should improve onboarding soon.",
                "evidence_refs": ["seg-10"],
                "signals": {"owner": False, "commitment": False},
            }
        ],
        "open_questions": [],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["action_items"][0]["review_status"] == "draft"
    assert records["action_items"][0]["promotion_reason"] is None


def test_action_item_is_promoted_when_assignment_or_commitment_exists():
    summary_payload = {
        "decisions_forming": [],
        "active_action_items": [
            {
                "text": "Maya will send the release notes by Friday.",
                "evidence_refs": ["seg-12"],
                "signals": {"owner": True, "commitment": True},
                "owner_user_id": "user-maya",
                "confidence": 0.88,
            }
        ],
        "open_questions": [],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["action_items"][0]["review_status"] == "promoted"
    assert records["action_items"][0]["promotion_reason"] == "action item evidence: assigned or committed"
    assert records["action_items"][0]["owner_user_id"] == "user-maya"
    assert records["action_items"][0]["confidence"] == 0.88


def test_open_question_filters_out_rhetorical_prompt():
    summary_payload = {
        "decisions_forming": [],
        "active_action_items": [],
        "open_questions": [
            {
                "text": "Why don’t we just ship it today?",
                "signals": {"rhetorical": True, "resolved": False},
            }
        ],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["open_questions"] == []


def test_open_question_filters_out_question_with_answer_detected():
    summary_payload = {
        "decisions_forming": [],
        "active_action_items": [],
        "open_questions": [
            {
                "text": "Who owns the launch checklist?",
                "evidence_refs": ["seg-21", "seg-22"],
                "signals": {"resolved": True, "answer_detected": True},
            }
        ],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["open_questions"] == []


def test_open_question_keeps_truly_unresolved_question():
    summary_payload = {
        "decisions_forming": [],
        "active_action_items": [],
        "open_questions": [
            {
                "text": "Who will own post-launch support?",
                "evidence_refs": ["seg-30"],
                "signals": {"resolved": False, "answer_detected": False},
                "confidence": 0.61,
            }
        ],
    }

    records = extract_generated_records(
        meeting_id="meeting-1",
        chapter_summary_id="chapter-1",
        tenant_id="tenant-1",
        summary_payload=summary_payload,
    )

    assert records["open_questions"][0]["text"] == "Who will own post-launch support?"
    assert records["open_questions"][0]["review_status"] == "draft"
    assert records["open_questions"][0]["confidence"] == 0.61
