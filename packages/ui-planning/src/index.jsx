import React from "react";

const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TIMELINE_PHASES = ["MVP", "SHORT", "LONG"];

export function getPlanningItemTitle(item = {}) {
  const title = typeof item.title === "string" && item.title.trim() ? item.title : item.name;
  return typeof title === "string" && title.trim() ? title : "Untitled planning item";
}

export function normalizeTimelinePhase(phase) {
  const normalized = String(phase ?? "").trim().toUpperCase();
  return TIMELINE_PHASES.includes(normalized) ? normalized : "UNASSIGNED";
}

function getTimelinePhaseCandidate(item) {
  return item?.timeline_phase ?? item?.phase ?? item?.timelinePhase ?? item?.timeline;
}

export function groupTimelineItemsByPhase(items = []) {
  return items.reduce(
    (groups, item) => {
      const phase = normalizeTimelinePhase(getTimelinePhaseCandidate(item));
      groups[phase].push(item);
      return groups;
    },
    { MVP: [], SHORT: [], LONG: [], UNASSIGNED: [] },
  );
}

export function sortPlanningItemsByPriority(items = []) {
  return [...items].sort((left, right) => {
    const leftRank = PRIORITY_ORDER[String(left?.priority ?? "").toLowerCase()] ?? 99;
    const rightRank = PRIORITY_ORDER[String(right?.priority ?? "").toLowerCase()] ?? 99;
    return leftRank - rightRank;
  });
}

function formatToken(value) {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function PlanningSummaryBlock({
  title = "Planning",
  items = [],
  emptyLabel = "No planning items yet.",
  children,
}) {
  return (
    <section className="ps-planning-summary" aria-label={title}>
      <header className="ps-planning-summary__header">
        <h2>{title}</h2>
        <span>{items.length} items</span>
      </header>
      {items.length === 0 ? (
        <p>{emptyLabel}</p>
      ) : (
        <ul>
          {sortPlanningItemsByPriority(items).map((item) => (
            <li key={item.id ?? getPlanningItemTitle(item)}>
              <strong>{getPlanningItemTitle(item)}</strong>
              <span>{formatToken(item.status)}</span>
              <span>{formatToken(item.priority)}</span>
              <span>{normalizeTimelinePhase(getTimelinePhaseCandidate(item))}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}
