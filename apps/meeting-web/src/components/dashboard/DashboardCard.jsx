import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

const toneAccents = {
  blue: { border: "border-t-blue-600", text: "text-blue-600" },
  amber: { border: "border-t-amber-600", text: "text-amber-600" },
  emerald: { border: "border-t-emerald-600", text: "text-emerald-600" },
  slate: { border: "border-t-slate-400", text: "text-slate-500" },
};

/**
 * A single metric card for the dashboard stats row.
 *
 * @param {object}  props
 * @param {string}  props.title  - Label above the metric (e.g. "Total meetings").
 * @param {string}  props.value  - The primary metric value.
 * @param {string}  props.detail - Supporting text below the value.
 * @param {"blue"|"amber"|"emerald"|"slate"} [props.tone="slate"] - Accent color.
 */
export function DashboardCard({ title, value, detail, tone = "slate" }) {
  const accent = toneAccents[tone] || toneAccents.slate;

  return (
    <Card className={`border-t-2 ${accent.border}`}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className={`text-2xl font-semibold tabular-nums ${accent.text}`}>
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
