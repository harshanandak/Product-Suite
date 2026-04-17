import { ActionItemsPanel } from "./ActionItemsPanel";
import { ChapterTimeline } from "./ChapterTimeline";
import { DecisionPanel } from "./DecisionPanel";
import { LiveSummaryPanel } from "./LiveSummaryPanel";
import { OpenQuestionsPanel } from "./OpenQuestionsPanel";
import { RecentLinesStrip } from "./RecentLinesStrip";
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
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  isRecording = false,
  isPaused = false,
  elapsedSeconds = 0,
}) {
  const hasActiveMeeting = Boolean(meeting);
  const sections = summaryState.sections || [];
  const recentLines = summaryState.recentLines || [];
  const meetingState = summaryState.meetingState || {};
  const canStartRecording = hasActiveMeeting && !isRecording && !isPaused;
  const canPauseRecording = hasActiveMeeting && isRecording && !isPaused;
  const canResumeRecording = hasActiveMeeting && isPaused;
  const canStopRecording = hasActiveMeeting && (isRecording || isPaused);

  const decisions = sections.find((section) => section.key === "decisions")?.items || [];
  const openQuestions = sections.find((section) => section.key === "openQuestions")?.items || [];
  const actionItems = sections.find((section) => section.key === "actionItems")?.items || [];
  const chapters = sections.find((section) => section.key === "chapters")?.items || [];

  if (!hasActiveMeeting) {
    const title = hasMeetingHistory ? "Choose a meeting to continue." : "Create your first meeting.";
    const description = hasMeetingHistory
      ? "Open a recent meeting from the left column or create a new one to start recording, review summaries, and search the live workspace memory."
      : "There are no saved meetings yet. Create a meeting to start recording, capture summaries, and build your workspace memory in one place.";

    if (!hasMeetingHistory) {
      return (
        <div className="flex h-full min-h-0 flex-col bg-transparent p-5">
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-3xl text-center">
              <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Meetings workspace</div>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-foreground">Create your first meeting.</h2>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-muted-foreground">
                {description}
              </p>
              <button
                type="button"
                onClick={onCreateMeeting}
                className="mt-8 inline-flex rounded-full border border-primary/35 bg-[linear-gradient(180deg,hsl(229,68%,52%),hsl(231,76%,34%))] px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create a meeting
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col bg-transparent p-5">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-4xl px-3 text-foreground">
            <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Meetings workspace</div>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
              {description}
            </p>
            <div className="mt-8 grid gap-0 border-t border-white/8 md:grid-cols-3">
              <div className="border-b border-white/8 py-5 md:border-b-0 md:border-r md:pr-6">
                <div className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">Capture</div>
                <p className="mt-3 text-sm leading-7 text-foreground/88">
                  Start a fresh meeting and record transcript context in real time.
                </p>
              </div>
              <div className="border-b border-white/8 py-5 md:border-b-0 md:border-r md:px-6">
                <div className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">Review</div>
                <p className="mt-3 text-sm leading-7 text-foreground/88">
                  Reopen summaries, decisions, action items, and chapter history.
                </p>
              </div>
              <div className="py-5 md:pl-6">
                <div className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">Search</div>
                <p className="mt-3 text-sm leading-7 text-foreground/88">
                  Use transcript retrieval and buddy chat after you pick the right meeting.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-transparent p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(36,28,42,0.96),rgba(23,19,29,0.96))] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.24)]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Now</div>
          <h2 className="mt-1 text-xl font-semibold text-foreground">{meeting?.title || "Untitled meeting"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {meetingState.current_goal || "Live meeting intelligence updates will appear here."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={onStartRecording}
            disabled={!canStartRecording}
            className="rounded-full border border-primary/35 bg-[linear-gradient(180deg,hsl(229,68%,52%),hsl(231,76%,34%))] px-3.5 py-2 text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRecording ? "Recording" : "Start"}
          </button>
          <button
            type="button"
            onClick={onPauseRecording}
            disabled={!canPauseRecording}
            className="rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPaused ? "Paused" : "Pause"}
          </button>
          <button
            type="button"
            onClick={onResumeRecording}
            disabled={!canResumeRecording}
            className="rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={onStopRecording}
            disabled={!canStopRecording}
            className="rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop
          </button>
          <span className="self-center text-[10px] uppercase tracking-[0.18em] text-foreground/55">
            {elapsedSeconds}s
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="grid min-h-0 gap-4">
          <LiveSummaryPanel meetingState={meetingState} />
          <RecentLinesStrip recentLines={recentLines} />
          <ChapterTimeline chapters={chapters} />
        </div>

        <div className="grid min-h-0 gap-4">
          <DecisionPanel decisions={decisions} />
          <ActionItemsPanel actionItems={actionItems} />
          <OpenQuestionsPanel openQuestions={openQuestions} />
          <BuddyControls
            response={buddyResponse}
            loading={buddyLoading}
            error={buddyError}
            onAskBuddy={onAskBuddy}
            disabled={!hasActiveMeeting}
          />
          <ChatPanel messages={summaryState.chatMessages || []} />
        </div>
      </div>
    </div>
  );
}
