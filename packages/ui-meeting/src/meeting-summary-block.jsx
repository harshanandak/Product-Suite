import React from "react";

export function formatConfidence(confidence) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null;
  }

  return `Confidence ${Math.round(confidence * 100)}%`;
}

export function resolveStatusLabel(record) {
  if ((record?.review_status || "").toLowerCase() === "promoted") {
    return "System promoted";
  }

  return "Generated draft";
}

function resolveBoundaryLabel(chapter) {
  if (chapter?.boundary_source === "semantic_adjustment") {
    return "Semantic boundary adjustment";
  }

  if (chapter?.boundary_source === "fixed_window") {
    return "Fixed window boundary";
  }

  return null;
}

function LiveSummaryPanel({ meetingState = {} }) {
  const bullets = meetingState.summary_bullets || [];

  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Live Summary</div>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {meetingState.current_topic || "Now"}
      </h2>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">
        {meetingState.current_goal || "No active goal yet."}
      </p>

      {bullets.length > 0 ? (
        <ul className="mt-5 space-y-0 border-t border-white/8">
          {bullets.map((bullet, index) => (
            <li
              key={`${bullet}-${index}`}
              className="border-b border-white/8 py-3 text-sm leading-7 text-foreground/90"
            >
              <span className="mr-3 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function GeneratedRecordPanel({ title, items = [] }) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">{title}</div>
      <div className="mt-4 space-y-0 border-t border-white/8">
        {items.map((item, index) => {
          const record = typeof item === "string" ? { text: item } : item;

          return (
            <div key={record.id || index} className="border-b border-white/8 py-4 text-sm text-foreground/90">
              <div className="leading-7">{record.text || record.summary || item}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-foreground/60">
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  {resolveStatusLabel(record)}
                </span>
                {formatConfidence(record.confidence) ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    {formatConfidence(record.confidence)}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-[11px] text-foreground/55">
                Origin: {record.record_origin || "generated"}
              </div>
              {record.promotion_reason ? (
                <div className="mt-2 text-xs leading-6 text-muted-foreground">{record.promotion_reason}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RecentLinesStrip({ recentLines = [] }) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Recent Lines</div>
      <div className="mt-4 space-y-0 border-t border-white/8">
        {recentLines.map((line, index) => (
          <div
            key={line.id || `${line.timestamp_start || 0}-${index}`}
            className="border-b border-white/8 py-3 text-sm leading-7 text-foreground/90"
          >
            <div>
              <span className="font-semibold text-foreground">{line.speaker_label}: </span>
              <span>{line.text}</span>
            </div>
            {line.translated_text ? (
              <div className="mt-1 pl-4 text-xs leading-6 text-muted-foreground">
                English: {line.translated_text}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function ChapterTimeline({ chapters = [] }) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Chapter Timeline</div>
      <div className="mt-4 space-y-0 border-t border-white/8">
        {chapters.map((chapter, index) => (
          <article key={chapter.id || index} className="border-b border-white/8 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">
                {chapter.title || `Chapter ${index + 1}`}
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/50">
                {chapter.window_label || ""}
              </div>
            </div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              {chapter.summary_text || chapter.summary || ""}
            </p>
            {resolveBoundaryLabel(chapter) ? (
              <div className="mt-2 text-[11px] text-foreground/55">{resolveBoundaryLabel(chapter)}</div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function getSectionItems(sections, key) {
  return sections.find((section) => section.key === key)?.items || [];
}

export function MeetingSummaryBlock({
  meeting,
  summaryState = {},
  hasMeetingHistory = false,
  onCreateMeeting,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  isRecording = false,
  isPaused = false,
  elapsedSeconds = 0,
  buddySlot = null,
  chatSlot = null,
}) {
  const hasActiveMeeting = Boolean(meeting);
  const sections = summaryState.sections || [];
  const recentLines = summaryState.recentLines || [];
  const meetingState = summaryState.meetingState || {};
  const canStartRecording = hasActiveMeeting && typeof onStartRecording === "function" && !isRecording && !isPaused;
  const canPauseRecording = hasActiveMeeting && typeof onPauseRecording === "function" && isRecording && !isPaused;
  const canResumeRecording = hasActiveMeeting && typeof onResumeRecording === "function" && isPaused;
  const canStopRecording = hasActiveMeeting && typeof onStopRecording === "function" && (isRecording || isPaused);

  const decisions = getSectionItems(sections, "decisions");
  const openQuestions = getSectionItems(sections, "openQuestions");
  const actionItems = getSectionItems(sections, "actionItems");
  const chapters = getSectionItems(sections, "chapters");

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
          <GeneratedRecordPanel title="Decisions" items={decisions} />
          <GeneratedRecordPanel title="Action Items" items={actionItems} />
          <GeneratedRecordPanel title="Open Questions" items={openQuestions} />
          {buddySlot}
          {chatSlot}
        </div>
      </div>
    </div>
  );
}
