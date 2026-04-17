"use client";

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

function getTrendIcon(trend = "up") {
  return trend === "down" ? TrendingDownIcon : TrendingUpIcon;
}

export function SectionCards({ cards = [] }) {
  return (
    <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-[calc(var(--radius)*2.8)] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.92),rgba(20,16,26,0.94))] sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const TrendIcon = getTrendIcon(card.trend);

        return (
          <section
            key={card.title}
            className="border-b border-white/8 px-5 py-5 sm:border-r sm:[&:nth-child(2n)]:border-r-0 xl:border-b-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(4n)]:border-r-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{card.title}</div>
                <div className="text-2xl font-semibold tabular-nums sm:text-3xl">{card.value}</div>
              </div>
              {card.change ? (
                <div className="shrink-0">
                  <Badge variant="outline" className="rounded-full border-white/10 bg-transparent text-foreground/85">
                    <TrendIcon className="size-3.5" />
                    {card.change}
                  </Badge>
                </div>
              ) : null}
            </div>
            <div className="mt-6 flex-col items-start gap-1.5 border-t border-white/8 pt-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <span>{card.footerTitle}</span>
                <TrendIcon className="size-4" />
              </div>
              <div className="mt-1.5 text-muted-foreground">{card.footerDescription}</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
