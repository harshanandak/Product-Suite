import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";

const stats = [
  { value: 10000, label: "Meetings captured" },
  { value: 98, label: "Accuracy rate %", suffix: "%" },
  { value: 50, label: "Time saved %", suffix: "%" },
  { value: 24, label: "/7 Available", suffix: "/7" },
];

/**
 * Dark stats bar with animated NumberTicker values.
 * Displays key metrics in a responsive grid.
 */
export default function StatsBar() {
  return (
    <section
      data-testid="stats-bar-section"
      className="text-white"
      style={{ background: 'linear-gradient(135deg, hsl(280, 5%, 8%) 0%, hsl(231, 60%, 25%) 50%, hsl(280, 5%, 8%) 100%)' }}
    >
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map(({ value, label, suffix }, index) => (
            <div
              key={label}
              className={cn(
                "flex flex-col items-center gap-1 text-center",
                index < stats.length - 1 &&
                  "md:border-r md:border-background/10"
              )}
            >
              <div className="flex items-baseline gap-0.5">
                <NumberTicker
                  value={value}
                  className="text-3xl font-bold text-white md:text-4xl"
                  data-testid={`stat-value-${index}`}
                />
                {suffix && (
                  <span className="text-lg font-semibold text-white/70">
                    {suffix}
                  </span>
                )}
              </div>
              <span className="text-sm text-white/60">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
