import { ArrowRightIcon } from "lucide-react";

/**
 * A quick-action link card for the dashboard sidebar.
 *
 * @param {object} props
 * @param {string} props.title - Action title.
 * @param {string} props.body  - Supporting description.
 * @param {string} props.href  - Link target.
 */
export function QuickActionCard({ title, body, href }) {
  return (
    <a
      href={href}
      className="group relative flex flex-col gap-2 rounded-xl border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:bg-accent"
    >
      <div className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full border bg-background text-primary transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
        <ArrowRightIcon className="size-4" />
      </div>

      <span className="text-xs uppercase tracking-widest text-primary">
        Quick action
      </span>

      <h3 className="font-heading text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h3>

      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </a>
  );
}
