import { useCallback, useEffect, useState } from "react";

import { getStoredAuthToken } from "../lib/api";
import { getRuntimeConfig } from "../lib/runtimeConfig";

function resolveApiBaseUrl() {
  const runtimeConfig = getRuntimeConfig();
  return runtimeConfig.apiBaseUrl || "http://localhost:8000/api";
}

export function buildRealtimeTranscriptRequestHeaders(additionalHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...additionalHeaders,
  };
  const token = getStoredAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    ...options,
    headers: buildRealtimeTranscriptRequestHeaders(options.headers || {}),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

export function normalizeRecentTranscriptLines(rows = [], limit = 3) {
  return [...rows]
    .sort((left, right) => (left?.timestamp_start || 0) - (right?.timestamp_start || 0))
    .slice(-limit)
    .map((row) => ({
      id: row?.id || null,
      speaker_label: row?.speaker_label || "Speaker",
      text: row?.text || "",
      translated_text:
        row?.translated_text && row?.translated_text !== row?.text ? row.translated_text : null,
      timestamp_start: row?.timestamp_start || 0,
    }));
}

export function useRealtimeTranscript(meetingId, options = {}) {
  const [recentLines, setRecentLines] = useState([]);
  const [loading, setLoading] = useState(Boolean(meetingId));
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!meetingId) {
      setRecentLines([]);
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await fetchJson(`/meetings/${meetingId}/recent-lines`);
      const nextLines = normalizeRecentTranscriptLines(payload?.recent_lines || []);
      setRecentLines(nextLines);
      return nextLines;
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (options.enabled === false) {
      return;
    }

    void refresh().catch(() => null);
  }, [options.enabled, refresh]);

  return {
    recentLines,
    loading,
    error,
    refresh,
  };
}
