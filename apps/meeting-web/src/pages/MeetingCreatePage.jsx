import { MeetingRoutePage } from "@/pages/MeetingRoutePage";

export function MeetingCreatePage() {
  return (
    <MeetingRoutePage
      brand="Meeting Agent"
      variant="create"
      eyebrow="Start a meeting"
      title="Preparing meeting setup..."
      description="Loading meeting setup, transcription providers, and capture controls."
      highlights={["New meeting", "Transcription engine", "Live capture", "Summary-first workspace"]}
    />
  );
}
