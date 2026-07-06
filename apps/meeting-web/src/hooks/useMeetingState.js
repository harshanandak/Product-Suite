import { useCallback, useEffect, useRef, useState } from "react";

import {
  getActionItems,
  getChapters,
  getDecisions,
  getMeetingStateCurrent,
  getOpenQuestions,
  getRecentLines,
  getStoredAuthToken,
} from "../lib/api";
import { getRuntimeConfig, resolveRuntimeApiBaseUrl } from "../lib/runtimeConfig";
import { normalizeRecentTranscriptLines } from "./useRealtimeTranscript";

export function resolveMeetingApiBaseUrl(runtimeConfig = getRuntimeConfig()) {
  return resolveRuntimeApiBaseUrl(runtimeConfig);
}

export function buildMeetingRequestHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };
  const token = getStoredAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function extractGeneratedItems(payload = {}) {
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.decisions)) {
    return payload.decisions;
  }
  return [];
}

function toDraftRecords(records = []) {
  return records.map((record) => ({
    ...record,
    record_origin: record?.record_origin || "generated",
    review_status: record?.review_status || "draft",
  }));
}

export function buildMeetingSummarySections({
  meetingState = null,
  chapters = [],
  decisions = [],
  actionItems = [],
  openQuestions = [],
  recentLines = [],
} = {}) {
  const state = meetingState || {};

  return [
    {
      key: "now",
      title: "Now",
      items: [
        { label: "Current topic", value: state.current_topic || "" },
        { label: "Current goal", value: state.current_goal || "" },
      ],
    },
    {
      key: "liveSummary",
      title: "Live Summary",
      items: state.summary_bullets || [],
    },
    {
      key: "decisions",
      title: "Decisions",
      items: toDraftRecords(decisions),
    },
    {
      key: "openQuestions",
      title: "Open Questions",
      items: toDraftRecords(openQuestions),
    },
    {
      key: "actionItems",
      title: "Action Items",
      items: toDraftRecords(actionItems),
    },
    {
      key: "recentLines",
      title: "Recent Lines",
      items: normalizeRecentTranscriptLines(recentLines),
    },
    {
      key: "chapters",
      title: "Chapter Timeline",
      items: chapters,
    },
  ];
}

export function createRequestVersionTracker() {
  let currentVersion = 0;
  return {
    next() {
      currentVersion += 1;
      return currentVersion;
    },
    isCurrent(version) {
      return version === currentVersion;
    },
  };
}

export function swallowMeetingRefreshError(refreshPromise) {
  return refreshPromise.catch(() => null);
}

export function useMeetingState(meetingId, options = {}) {
  const [meetingState, setMeetingState] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [openQuestions, setOpenQuestions] = useState([]);
  const [recentLines, setRecentLines] = useState([]);
  const [loading, setLoading] = useState(Boolean(meetingId));
  const [error, setError] = useState(null);
  const requestVersionRef = useRef(createRequestVersionTracker());

  const refresh = useCallback(async () => {
    if (!meetingId) {
      requestVersionRef.current.next();
      setMeetingState(null);
      setChapters([]);
      setDecisions([]);
      setActionItems([]);
      setOpenQuestions([]);
      setRecentLines([]);
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    const requestVersion = requestVersionRef.current.next();

    try {
      const [statePayload, chaptersPayload, decisionsPayload, actionItemsPayload, openQuestionsPayload, recentLinesPayload] = (
        await Promise.all([
          getMeetingStateCurrent(meetingId),
          getChapters(meetingId),
          getDecisions(meetingId),
          getActionItems(meetingId),
          getOpenQuestions(meetingId),
          getRecentLines(meetingId),
        ])
      ).map((response) => response?.data);
      if (!requestVersionRef.current.isCurrent(requestVersion)) {
        return null;
      }

      setMeetingState(statePayload || null);
      setChapters(chaptersPayload?.chapters || []);
      setDecisions(extractGeneratedItems(decisionsPayload));
      setActionItems(extractGeneratedItems(actionItemsPayload));
      setOpenQuestions(extractGeneratedItems(openQuestionsPayload));
      setRecentLines(normalizeRecentTranscriptLines(recentLinesPayload?.recent_lines || []));

      return statePayload || null;
    } catch (nextError) {
      if (!requestVersionRef.current.isCurrent(requestVersion)) {
        return null;
      }
      setError(nextError);
      throw nextError;
    } finally {
      if (requestVersionRef.current.isCurrent(requestVersion)) {
        setLoading(false);
      }
    }
  }, [meetingId]);

  useEffect(() => {
    if (options.enabled === false) {
      return;
    }

    void swallowMeetingRefreshError(refresh());
  }, [options.enabled, refresh]);

  return {
    meetingState,
    chapters,
    decisions,
    actionItems,
    openQuestions,
    recentLines,
    loading,
    error,
    refresh,
    sections: buildMeetingSummarySections({
      meetingState,
      chapters,
      decisions,
      actionItems,
      openQuestions,
      recentLines,
    }),
  };
}
