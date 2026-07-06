import { useCallback, useEffect, useRef, useState } from "react";

import { getStoredAuthToken, queryBuddy } from "../lib/api";
import { getRuntimeConfig, resolveRuntimeApiBaseUrl } from "../lib/runtimeConfig";

export function resolveBuddyApiBaseUrl(runtimeConfig = getRuntimeConfig()) {
  return resolveRuntimeApiBaseUrl(runtimeConfig);
}

export function buildBuddyRequestHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };
  const token = getStoredAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function unwrapBuddyPayload(payload = {}) {
  return payload?.response || payload;
}

function formatContextList(label, items = []) {
  const cleanItems = items.filter(Boolean);
  if (!cleanItems.length) {
    return "";
  }
  return `${label}: ${cleanItems.join("; ")}`;
}

export function buildBuddyRequestBody(message, summaryState = {}) {
  const meetingState = summaryState?.meetingState || {};
  const decisions = (summaryState?.decisions || []).map((item) => item?.text || item?.title || "").filter(Boolean);
  const actionItems = (summaryState?.actionItems || []).map((item) => item?.text || item?.title || "").filter(Boolean);
  const openQuestions = (summaryState?.openQuestions || []).map((item) => item?.text || item?.title || "").filter(Boolean);
  const recentLines = (summaryState?.recentLines || [])
    .map((item) => {
      const speaker = item?.speaker_label ? `${item.speaker_label}: ` : "";
      const text = item?.text || item?.translated_text || "";
      return text ? `${speaker}${text}` : "";
    })
    .filter(Boolean);
  const chapters = (summaryState?.chapters || [])
    .map((item) => [item?.title, item?.summary_text].filter(Boolean).join(" - "))
    .filter(Boolean);
  const summaryBullets = Array.isArray(meetingState?.summary_bullets) ? meetingState.summary_bullets.filter(Boolean) : [];

  const currentContext = [
    meetingState?.current_topic ? `Current topic: ${meetingState.current_topic}` : "",
    meetingState?.current_goal ? `Current goal: ${meetingState.current_goal}` : "",
    formatContextList("Live summary", summaryBullets),
    formatContextList("Decisions", decisions),
    formatContextList("Action items", actionItems),
    formatContextList("Open questions", openQuestions),
    formatContextList("Recent lines", recentLines),
    formatContextList("Chapter timeline", chapters),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    message,
    current_context: currentContext,
    history_context: "",
  };
}

export function mapBuddyResponse(response = {}) {
  const provenance = Array.isArray(response.provenance)
    ? response.provenance.map((item) => ({
        source: item?.source || item?.kind || "meeting",
        detail: item?.detail || item?.label || "",
        url: item?.url || null,
      }))
    : [];

  const toolRefs = Array.isArray(response.tool_refs) ? response.tool_refs : Array.isArray(response.toolRefs) ? response.toolRefs : [];

  return {
    answer: response.answer || response.response_text || "",
    sourceKind: response.source_kind || response.sourceKind || "meeting",
    toolRefs,
    provenance,
    isStub: Boolean(response.stub),
  };
}

export function useBuddyAgent(meetingId, options = {}) {
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    requestVersionRef.current += 1;
    setLoading(false);
    setResponse(null);
    setError(null);
  }, [meetingId]);

  const askBuddy = useCallback(
    async (message, summaryState = {}) => {
      if (!meetingId) {
        throw new Error("meetingId is required");
      }

      const requestVersion = ++requestVersionRef.current;
      setLoading(true);
      setError(null);

      try {
        const requestBody = buildBuddyRequestBody(message, summaryState);
        const { data } = await queryBuddy(meetingId, {
          message: requestBody.message,
          currentContext: requestBody.current_context,
          historyContext: requestBody.history_context,
        });
        const nextResponse = mapBuddyResponse(unwrapBuddyPayload(data));
        if (requestVersion !== requestVersionRef.current) {
          return nextResponse;
        }
        setResponse(nextResponse);
        return nextResponse;
      } catch (nextError) {
        if (requestVersion !== requestVersionRef.current) {
          throw nextError;
        }
        setError(nextError);
        throw nextError;
      } finally {
        if (requestVersion === requestVersionRef.current) {
          setLoading(false);
        }
      }
    },
    [meetingId]
  );

  const clear = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return {
    response,
    loading,
    error,
    askBuddy,
    clear,
    automaticWebSearchEnabled: options.automaticWebSearchEnabled !== false,
  };
}
