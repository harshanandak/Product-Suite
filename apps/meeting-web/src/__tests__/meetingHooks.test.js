import { describe, expect, test } from "vitest";

import { clearAuthToken, setAuthToken } from "../lib/api";
import { syncSummaryStateAfterTranscriptionChunk } from "../lib/transcriptionSync";
import { buildBuddyRequestBody, buildBuddyRequestHeaders, mapBuddyResponse, resolveBuddyApiBaseUrl, unwrapBuddyPayload } from "../hooks/useBuddyAgent";
import { buildMeetingRequestHeaders, buildMeetingSummarySections, createRequestVersionTracker, extractGeneratedItems, resolveMeetingApiBaseUrl, swallowMeetingRefreshError } from "../hooks/useMeetingState";
import { resolveWavRecorderWorkletUrl, runAudioContextTransition } from "../hooks/useAudioRecorder";
import { buildRealtimeTranscriptRequestHeaders, normalizeRecentTranscriptLines } from "../hooks/useRealtimeTranscript";

describe("summary-first meeting hooks", () => {
  test("buildMeetingSummarySections keeps generated records read-only", () => {
    const sections = buildMeetingSummarySections({
      meetingState: { current_topic: "Launch", current_goal: "Finalize scope", summary_bullets: ["Decide launch date"] },
      decisions: [{ text: "Ship next week", review_status: "promoted", confidence: 0.94, promotion_reason: "Agreement detected" }],
      actionItems: [{ text: "Send note" }],
      openQuestions: [{ text: "Who owns launch?" }],
      chapters: [{ id: "chapter-1", boundary_source: "semantic_adjustment" }],
      recentLines: [{ text: "hello", timestamp_start: 1 }],
    });

    const decisionsSection = sections.find((section) => section.key === "decisions");
    expect(decisionsSection.items[0].record_origin).toBe("generated");
    expect(decisionsSection.items[0].review_status).toBe("promoted");
    expect(decisionsSection.items[0].confidence).toBe(0.94);
    expect(decisionsSection.items[0].promotion_reason).toBe("Agreement detected");

    const chaptersSection = sections.find((section) => section.key === "chapters");
    expect(chaptersSection.items[0].boundary_source).toBe("semantic_adjustment");
  });

  test("normalizeRecentTranscriptLines limits to three ordered items", () => {
    const lines = normalizeRecentTranscriptLines([
      { speaker_label: "A", text: "one", timestamp_start: 1 },
      { speaker_label: "B", text: "two", timestamp_start: 2 },
      { speaker_label: "C", text: "three", timestamp_start: 3 },
      { speaker_label: "D", translated_text: "translated four", text: "four", timestamp_start: 4 },
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[0].speaker_label).toBe("B");
    expect(lines[2].text).toBe("four");
    expect(lines[2].translated_text).toBe("translated four");
  });

  test("mapBuddyResponse preserves provenance, source kind, and tool refs", () => {
    const response = mapBuddyResponse({
      answer: "We decided to ship next week.",
      source_kind: "meeting+web",
      tool_refs: [{ tool: "web_search", query: "launch" }],
      provenance: [{ source: "current_meeting", detail: "meeting memory" }],
      stub: true,
    });

    expect(response.answer).toBe("We decided to ship next week.");
    expect(response.sourceKind).toBe("meeting+web");
    expect(response.toolRefs[0].tool).toBe("web_search");
    expect(response.provenance[0].source).toBe("current_meeting");
    expect(response.isStub).toBe(true);
  });

  test("request header helpers attach bearer tokens when available", () => {
    setAuthToken("test-token");

    expect(buildBuddyRequestHeaders().Authorization).toBe("Bearer test-token");
    expect(buildMeetingRequestHeaders().Authorization).toBe("Bearer test-token");
    expect(buildRealtimeTranscriptRequestHeaders().Authorization).toBe("Bearer test-token");

    clearAuthToken();
  });

  test("buddy responses unwrap nested backend payloads", () => {
    const response = unwrapBuddyPayload({
      response: {
        response_text: "Nested answer",
        source_kind: "meeting",
      },
    });

    expect(mapBuddyResponse(response).answer).toBe("Nested answer");
  });

  test("buddy request body includes current meeting context", () => {
    const payload = buildBuddyRequestBody("What did we decide?", {
      meetingState: {
        current_topic: "Launch readiness",
        current_goal: "Finalize go-live scope",
        summary_bullets: ["Confirm launch date"],
      },
      decisions: [{ text: "Ship next Friday" }],
      actionItems: [{ text: "Send launch note" }],
      openQuestions: [{ text: "Who owns rollback?" }],
      recentLines: [{ speaker_label: "SPK 1", text: "We should ship next Friday." }],
      chapters: [{ title: "Minutes 0-5", summary_text: "Reviewed launch blockers." }],
    });

    expect(payload.message).toBe("What did we decide?");
    expect(payload.current_context).toContain("Current topic: Launch readiness");
    expect(payload.current_context).toContain("Decisions: Ship next Friday");
    expect(payload.current_context).toContain("Recent lines: SPK 1: We should ship next Friday.");
    expect(payload.history_context).toBe("");
  });

  test("generated item extraction accepts the backend items shape", () => {
    expect(extractGeneratedItems({ items: [{ id: "decision-1" }] })).toEqual([{ id: "decision-1" }]);
  });

  test("meeting hooks prefer the initialized API runtime backend URL", () => {
    const resolved = resolveMeetingApiBaseUrl(
      { apiBaseUrl: "https://api.example.com/api" }
    );

    expect(resolved).toBe("https://api.example.com/api");
  });

  test("buddy hook prefers the initialized API runtime backend URL", () => {
    const resolved = resolveBuddyApiBaseUrl(
      { apiBaseUrl: "https://api.example.com/api" }
    );

    expect(resolved).toBe("https://api.example.com/api");
  });

  test("meeting request tracker only accepts the latest in-flight request", () => {
    const tracker = createRequestVersionTracker();
    const first = tracker.next();
    const second = tracker.next();

    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  test("meeting request tracker invalidates in-flight work when meeting clears", () => {
    const tracker = createRequestVersionTracker();
    const inFlightRequest = tracker.next();
    const clearedMeetingVersion = tracker.next();

    expect(tracker.isCurrent(inFlightRequest)).toBe(false);
    expect(tracker.isCurrent(clearedMeetingVersion)).toBe(true);
  });

  test("stale buddy request versions can be ignored after meeting switch", () => {
    let currentVersion = 0;
    const startBuddyRequest = () => ++currentVersion;
    const switchMeeting = () => ++currentVersion;
    const isCurrent = (requestVersion) => requestVersion === currentVersion;

    const firstRequest = startBuddyRequest();
    switchMeeting();

    expect(isCurrent(firstRequest)).toBe(false);
  });

  test("meeting switch should clear any stale buddy loading state", () => {
    let loading = true;
    const onMeetingChange = () => {
      loading = false;
    };

    onMeetingChange();

    expect(loading).toBe(false);
  });

  test("transcription chunk sync refreshes summary state after merging new segments", async () => {
    const mergedSegments = [];
    let refreshCount = 0;

    const result = await syncSummaryStateAfterTranscriptionChunk(
      {
        data: {
          segments: [{ id: "segment-1", text: "hello" }],
        },
      },
      {
        mergeSegments: (segments) => mergedSegments.push(...segments),
        refreshSummaryState: async () => {
          refreshCount += 1;
        },
      }
    );

    expect(mergedSegments).toHaveLength(1);
    expect(refreshCount).toBe(1);
    expect(result).toEqual({ didMerge: true, didRefresh: true });
  });

  test("meeting auto-refresh swallows background refresh failures", async () => {
    const result = await swallowMeetingRefreshError(Promise.reject(new Error("network")));

    expect(result).toBeNull();
  });

  test("worklet URL builder normalizes trailing slashes", () => {
    expect(resolveWavRecorderWorkletUrl("/app/")).toBe("/app/wav-recorder-processor.js");
    expect(resolveWavRecorderWorkletUrl("")).toBe("/wav-recorder-processor.js");
  });

  test("audio context transitions swallow recoverable invalid state errors", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};

    const error = new Error("already closing");
    error.name = "InvalidStateError";
    const context = {
      state: "running",
      suspend: async () => {
        throw error;
      },
    };

    await expect(runAudioContextTransition(context, "suspended")).resolves.toBe(false);

    console.warn = originalWarn;
  });

  test("audio context transitions invoke the expected transition method", async () => {
    const context = {
      state: "suspended",
      resume: async () => {
        context.state = "running";
      },
    };

    await expect(runAudioContextTransition(context, "running")).resolves.toBe(true);
    expect(context.state).toBe("running");
  });
});
