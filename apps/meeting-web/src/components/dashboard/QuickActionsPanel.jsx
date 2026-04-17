import { QuickActionCard } from "./QuickActionCard";

/**
 * A vertical stack of quick-action cards for the dashboard sidebar.
 */
export function QuickActionsPanel() {
  return (
    <div className="flex flex-col gap-4">
      <QuickActionCard
        title="Start a new meeting"
        body="Capture transcript, summary, and follow-up in one workspace."
        href="/meetings"
      />
      <QuickActionCard
        title="Review team memory"
        body="Search recent decisions, action items, and open questions."
        href="/meetings"
      />
    </div>
  );
}
