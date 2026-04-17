import { MeetingRoutePage } from "@/pages/MeetingRoutePage";

export function MeetingWorkspacePage() {
  return (
    <MeetingRoutePage
      brand="Meeting Agent"
      variant="workspace"
      eyebrow="Focused workspace"
      title="Opening meeting workspace..."
      description="Restoring the selected meeting, transcript, summary, and action panels."
      highlights={["Transcript", "Live summary", "Decisions", "Action items"]}
    />
  );
}
