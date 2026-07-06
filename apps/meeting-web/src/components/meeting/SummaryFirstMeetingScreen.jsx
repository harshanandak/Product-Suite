import { MeetingSummaryBlock } from "@product-suite/ui-meeting";

import { BuddyControls } from "../buddy/BuddyControls";
import { ChatPanel } from "../chat/ChatPanel";

export function SummaryFirstMeetingScreen({
  meeting,
  summaryState = {},
  buddyResponse = null,
  buddyLoading = false,
  buddyError = null,
  hasMeetingHistory = false,
  onCreateMeeting,
  onAskBuddy,
  onSendChatMessage,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  isRecording = false,
  isPaused = false,
  elapsedSeconds = 0,
}) {
  const hasActiveMeeting = Boolean(meeting);

  return (
    <MeetingSummaryBlock
      meeting={meeting}
      summaryState={summaryState}
      hasMeetingHistory={hasMeetingHistory}
      onCreateMeeting={onCreateMeeting}
      onStartRecording={onStartRecording}
      onPauseRecording={onPauseRecording}
      onResumeRecording={onResumeRecording}
      onStopRecording={onStopRecording}
      isRecording={isRecording}
      isPaused={isPaused}
      elapsedSeconds={elapsedSeconds}
      buddySlot={
        <BuddyControls
          response={buddyResponse}
          loading={buddyLoading}
          error={buddyError}
          onAskBuddy={onAskBuddy}
          disabled={!hasActiveMeeting}
        />
      }
      chatSlot={
        <ChatPanel
          messages={summaryState.chatMessages || []}
          onSendMessage={hasActiveMeeting ? onSendChatMessage : undefined}
          disabled={!hasActiveMeeting}
        />
      }
    />
  );
}
