"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { useIsMobile } from "@/hooks/use-mobile";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function getValidDate(meeting) {
  const value = meeting?.updated_at || meeting?.created_at;
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatBucketLabel(dateKey) {
  return parseLocalDateKey(dateKey).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function buildSeries(meetings, timeRange) {
  const daysToSubtract = timeRange === "30d" ? 30 : timeRange === "7d" ? 7 : 90;
  const datedMeetings = meetings
    .map((meeting) => ({ meeting, date: getValidDate(meeting) }))
    .filter((entry) => entry.date);

  const now = new Date();
  const latestMeetingDate = datedMeetings.reduce((latest, entry) => (entry.date > latest ? entry.date : latest), now);
  const referenceDate = latestMeetingDate > now ? latestMeetingDate : now;
  const startDate = new Date(referenceDate);
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - daysToSubtract + 1);

  const buckets = new Map();
  for (let index = 0; index < daysToSubtract; index += 1) {
    const nextDate = new Date(startDate);
    nextDate.setDate(startDate.getDate() + index);
    const key = formatLocalDateKey(nextDate);
    buckets.set(key, {
      date: key,
      total: 0,
      completed: 0,
    });
  }

  datedMeetings.forEach(({ meeting, date }) => {
    const key = formatLocalDateKey(date);
    if (!buckets.has(key)) {
      return;
    }

    const bucket = buckets.get(key);
    bucket.total += 1;
    if (meeting.status === "completed") {
      bucket.completed += 1;
    }
  });

  return [...buckets.values()];
}

const chartConfig = {
  total: {
    label: "Captured",
    color: "hsl(var(--primary))",
  },
  completed: {
    label: "Completed",
    color: "hsl(215 25% 27%)",
  },
};

export function ChartAreaInteractive({ meetings = [] }) {
  const isMobile = useIsMobile();
  const [timeRange, setTimeRange] = React.useState("90d");

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("30d");
    }
  }, [isMobile]);

  const filteredData = buildSeries(meetings, timeRange);

  return (
    <section className="overflow-hidden rounded-[calc(var(--radius)*2.8)] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.92),rgba(20,16,26,0.94))] px-5 py-6">
      <div className="gap-4 md:flex md:items-start md:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Meeting activity</h2>
          <p className="text-sm leading-7 text-muted-foreground">Created and completed meetings across the most recent working window.</p>
        </div>
        <div className="mt-4 w-full md:mt-0 md:w-auto">
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "90d");
            }}
            variant="outline"
            className="hidden md:flex"
          >
            <ToggleGroupItem value="90d">Last 90 days</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-full md:hidden" size="sm" aria-label="Select a time range">
              <SelectValue placeholder="Last 90 days" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-6 border-y border-white/8 py-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
          <AreaChart accessibilityLayer data={filteredData} margin={{ left: 0, right: 8 }}>
            <defs>
              <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="fillCompleted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-completed)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-completed)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              tickFormatter={(value) => formatBucketLabel(value)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(value) => formatBucketLabel(value)}
                />
              }
            />
            <Area dataKey="completed" type="natural" fill="url(#fillCompleted)" stroke="var(--color-completed)" strokeWidth={2} />
            <Area dataKey="total" type="natural" fill="url(#fillTotal)" stroke="var(--color-total)" strokeWidth={2} />
          </AreaChart>
        </ChartContainer>
      </div>
    </section>
  );
}
