import { MeetingRoutePage } from "@/pages/MeetingRoutePage";

export function MeetingsIndexPage() {
  return (
    <MeetingRoutePage
      brand="Meeting Agent"
      variant="index"
      eyebrow="Meeting history"
      title="Loading meetings..."
      description="Preparing recent meetings, search, and open threads."
      highlights={["Recent meetings", "Search", "Open threads", "Action items"]}
    />
  );
}
