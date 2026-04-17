import { Badge } from "@/components/ui/badge";
import { ArrowRightIcon } from "lucide-react";

/**
 * A card linking to a single recent meeting.
 *
 * @param {object} props
 * @param {string} props.title   - Meeting title.
 * @param {string} props.summary - Supporting detail text (duration, etc.).
 * @param {string} props.href    - Link target for the meeting.
 * @param {string} [props.status] - Meeting status badge label.
 */
export function RecentMeetingCard({ title, summary, href, status }) {
  return (
    <a
      href={href}
      className="group flex flex-col gap-2 rounded-xl border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          Meeting
        </span>
        {status && (
          <Badge variant="outline">{status}</Badge>
        )}
      </div>

      <h3 className="font-heading text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h3>

      <p className="text-sm text-muted-foreground">{summary}</p>

      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-primary">
        Open workspace
        <ArrowRightIcon className="size-3" />
      </div>
    </a>
  );
}
