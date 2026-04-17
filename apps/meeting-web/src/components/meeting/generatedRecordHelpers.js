export function formatConfidence(confidence) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null;
  }

  return `Confidence ${Math.round(confidence * 100)}%`;
}

export function resolveStatusLabel(record) {
  if ((record?.review_status || "").toLowerCase() === "promoted") {
    return "System promoted";
  }

  return "Generated draft";
}
