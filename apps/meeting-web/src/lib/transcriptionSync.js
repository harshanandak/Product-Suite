export async function syncSummaryStateAfterTranscriptionChunk(
  response,
  { mergeSegments, refreshSummaryState } = {}
) {
  const segments = response?.data?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return {
      didMerge: false,
      didRefresh: false,
    };
  }

  if (typeof mergeSegments === "function") {
    mergeSegments(segments);
  }

  if (typeof refreshSummaryState === "function") {
    await refreshSummaryState();
  }

  return {
    didMerge: true,
    didRefresh: typeof refreshSummaryState === "function",
  };
}
