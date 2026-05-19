import type { ReactNode } from "react";

export type TrendDirection = "up" | "down" | "neutral";

export interface TrendRecord {
  value: number;
  direction: TrendDirection;
}

export interface ChartDataRecord {
  name?: string;
  value?: number | string;
  [key: string]: unknown;
}

export interface NormalizedChartDatum {
  name: string;
  value: number;
}

export interface NormalizeChartDataOptions {
  nameKey?: string;
  valueKey?: string;
}

export interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  trend?: TrendRecord;
}

export function formatTrendValue(trend?: TrendRecord): string;
export function normalizeChartData(
  rows?: unknown,
  options?: NormalizeChartDataOptions,
): NormalizedChartDatum[];
export function sortChartDataByValue<T extends ChartDataRecord>(rows?: readonly T[] | null): T[];
export function MetricCard(props: MetricCardProps): ReactNode;
