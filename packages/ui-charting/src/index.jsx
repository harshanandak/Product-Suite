import React from "react";

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatTrendValue(trend) {
  if (!trend) return "";

  const value = Math.abs(toFiniteNumber(trend.value));
  if (trend.direction === "up") return `+${value}%`;
  if (trend.direction === "down") return `-${value}%`;
  return `${value}%`;
}

export function normalizeChartData(rows = [], options = {}) {
  const nameKey = options.nameKey ?? "name";
  const valueKey = options.valueKey ?? "value";

  return rows.map((row) => {
    const nameCandidate = row?.[nameKey] ?? row?.name;
    const name = typeof nameCandidate === "string" && nameCandidate.trim() ? nameCandidate : "Untitled";
    return {
      name,
      value: toFiniteNumber(row?.[valueKey] ?? row?.value),
    };
  });
}

export function sortChartDataByValue(rows = []) {
  return [...rows].sort((left, right) => toFiniteNumber(right?.value) - toFiniteNumber(left?.value));
}

export function MetricCard({
  title,
  value,
  description,
  trend,
}) {
  const trendClass = trend ? `trend-${trend.direction ?? "neutral"}` : "";
  const trendLabel = formatTrendValue(trend);

  return (
    <section className="ps-metric-card" aria-label={title}>
      <header>
        <span>{title}</span>
        {trendLabel && <span className={trendClass}>{trendLabel}</span>}
      </header>
      <strong>{value}</strong>
      {description && <p>{description}</p>}
    </section>
  );
}
