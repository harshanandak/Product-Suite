import type { ReactNode } from "react";

export interface GeneratedMeetingRecord {
  id?: string;
  text?: string;
  summary?: string;
  record_origin?: string;
  review_status?: string;
  confidence?: number;
  promotion_reason?: string;
}

export interface MeetingChapter {
  id?: string;
  title?: string;
  summary?: string;
  summary_text?: string;
  boundary_source?: string;
  window_label?: string;
}

export interface TranscriptLine {
  id?: string;
  speaker_label?: string;
  text?: string;
  translated_text?: string;
  timestamp_start?: number;
}

export interface MeetingSummaryState {
  meetingState?: {
    current_topic?: string;
    current_goal?: string;
    summary_bullets?: string[];
  };
  recentLines?: TranscriptLine[];
  sections?: Array<{
    key: string;
    items?: Array<GeneratedMeetingRecord | MeetingChapter | string>;
  }>;
}

export interface MeetingSummaryBlockProps {
  meeting?: { title?: string } | null;
  summaryState?: MeetingSummaryState;
  hasMeetingHistory?: boolean;
  onCreateMeeting?: () => void;
  onStartRecording?: () => void;
  onPauseRecording?: () => void;
  onResumeRecording?: () => void;
  onStopRecording?: () => void;
  isRecording?: boolean;
  isPaused?: boolean;
  elapsedSeconds?: number;
  buddySlot?: ReactNode;
  chatSlot?: ReactNode;
}

export function MeetingSummaryBlock(props: MeetingSummaryBlockProps): ReactNode;
export function formatConfidence(confidence?: number | null): string | null;
export function resolveStatusLabel(record?: GeneratedMeetingRecord | null): string;
