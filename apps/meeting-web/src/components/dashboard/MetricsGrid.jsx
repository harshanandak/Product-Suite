import { DashboardCard } from "./DashboardCard";

/**
 * A responsive grid of four metric cards.
 *
 * @param {object}        props
 * @param {number|string} props.total     - Total meetings count.
 * @param {number|string} props.recording - Currently recording count.
 * @param {number|string} props.completed - Completed meetings count.
 * @param {number|string} props.open      - Open workspaces count.
 */
export function MetricsGrid({ total, recording, completed, open }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DashboardCard
        title="Total meetings"
        value={total}
        detail="All time"
        tone="blue"
      />
      <DashboardCard
        title="Recording"
        value={recording}
        detail="In progress"
        tone="amber"
      />
      <DashboardCard
        title="Completed"
        value={completed}
        detail="Finished meetings"
        tone="emerald"
      />
      <DashboardCard
        title="Open workspaces"
        value={open}
        detail="Awaiting review"
        tone="slate"
      />
    </div>
  );
}
