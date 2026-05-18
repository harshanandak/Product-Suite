// src/meeting-summary-block.jsx
import React from "react";
import { jsxDEV } from "react/jsx-dev-runtime";
function formatConfidence(confidence) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null;
  }
  return `Confidence ${Math.round(confidence * 100)}%`;
}
function resolveStatusLabel(record) {
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
  return /* @__PURE__ */ jsxDEV("section", {
    className: "rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5",
    children: [
      /* @__PURE__ */ jsxDEV("div", {
        className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
        children: "Live Summary"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("h2", {
        className: "mt-3 text-2xl font-semibold tracking-tight text-foreground",
        children: meetingState.current_topic || "Now"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("p", {
        className: "mt-2 text-sm leading-7 text-muted-foreground",
        children: meetingState.current_goal || "No active goal yet."
      }, undefined, false, undefined, this),
      bullets.length > 0 ? /* @__PURE__ */ jsxDEV("ul", {
        className: "mt-5 space-y-0 border-t border-white/8",
        children: bullets.map((bullet, index) => /* @__PURE__ */ jsxDEV("li", {
          className: "border-b border-white/8 py-3 text-sm leading-7 text-foreground/90",
          children: [
            /* @__PURE__ */ jsxDEV("span", {
              className: "mr-3 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("span", {
              children: bullet
            }, undefined, false, undefined, this)
          ]
        }, `${bullet}-${index}`, true, undefined, this))
      }, undefined, false, undefined, this) : null
    ]
  }, undefined, true, undefined, this);
}
function GeneratedRecordPanel({ title, items = [] }) {
  return /* @__PURE__ */ jsxDEV("section", {
    className: "rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5",
    children: [
      /* @__PURE__ */ jsxDEV("div", {
        className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
        children: title
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("div", {
        className: "mt-4 space-y-0 border-t border-white/8",
        children: items.map((item, index) => {
          const record = typeof item === "string" ? { text: item } : item;
          return /* @__PURE__ */ jsxDEV("div", {
            className: "border-b border-white/8 py-4 text-sm text-foreground/90",
            children: [
              /* @__PURE__ */ jsxDEV("div", {
                className: "leading-7",
                children: record.text || record.summary || item
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("div", {
                className: "mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-foreground/60",
                children: [
                  /* @__PURE__ */ jsxDEV("span", {
                    className: "rounded-full border border-white/10 bg-white/5 px-2.5 py-1",
                    children: resolveStatusLabel(record)
                  }, undefined, false, undefined, this),
                  formatConfidence(record.confidence) ? /* @__PURE__ */ jsxDEV("span", {
                    className: "rounded-full border border-white/10 bg-white/5 px-2.5 py-1",
                    children: formatConfidence(record.confidence)
                  }, undefined, false, undefined, this) : null
                ]
              }, undefined, true, undefined, this),
              /* @__PURE__ */ jsxDEV("div", {
                className: "mt-2 text-[11px] text-foreground/55",
                children: [
                  "Origin: ",
                  record.record_origin || "generated"
                ]
              }, undefined, true, undefined, this),
              record.promotion_reason ? /* @__PURE__ */ jsxDEV("div", {
                className: "mt-2 text-xs leading-6 text-muted-foreground",
                children: record.promotion_reason
              }, undefined, false, undefined, this) : null
            ]
          }, record.id || index, true, undefined, this);
        })
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function RecentLinesStrip({ recentLines = [] }) {
  return /* @__PURE__ */ jsxDEV("section", {
    className: "rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5",
    children: [
      /* @__PURE__ */ jsxDEV("div", {
        className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
        children: "Recent Lines"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("div", {
        className: "mt-4 space-y-0 border-t border-white/8",
        children: recentLines.map((line, index) => /* @__PURE__ */ jsxDEV("div", {
          className: "border-b border-white/8 py-3 text-sm leading-7 text-foreground/90",
          children: [
            /* @__PURE__ */ jsxDEV("div", {
              children: [
                /* @__PURE__ */ jsxDEV("span", {
                  className: "font-semibold text-foreground",
                  children: [
                    line.speaker_label,
                    ": "
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV("span", {
                  children: line.text
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this),
            line.translated_text ? /* @__PURE__ */ jsxDEV("div", {
              className: "mt-1 pl-4 text-xs leading-6 text-muted-foreground",
              children: [
                "English: ",
                line.translated_text
              ]
            }, undefined, true, undefined, this) : null
          ]
        }, line.id || `${line.timestamp_start || 0}-${index}`, true, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function ChapterTimeline({ chapters = [] }) {
  return /* @__PURE__ */ jsxDEV("section", {
    className: "rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5",
    children: [
      /* @__PURE__ */ jsxDEV("div", {
        className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
        children: "Chapter Timeline"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("div", {
        className: "mt-4 space-y-0 border-t border-white/8",
        children: chapters.map((chapter, index) => /* @__PURE__ */ jsxDEV("article", {
          className: "border-b border-white/8 py-4",
          children: [
            /* @__PURE__ */ jsxDEV("div", {
              className: "flex flex-wrap items-baseline justify-between gap-2",
              children: [
                /* @__PURE__ */ jsxDEV("div", {
                  className: "text-sm font-semibold text-foreground",
                  children: chapter.title || `Chapter ${index + 1}`
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV("div", {
                  className: "text-[10px] uppercase tracking-[0.16em] text-foreground/50",
                  children: chapter.window_label || ""
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ jsxDEV("p", {
              className: "mt-2 text-sm leading-7 text-muted-foreground",
              children: chapter.summary_text || chapter.summary || ""
            }, undefined, false, undefined, this),
            resolveBoundaryLabel(chapter) ? /* @__PURE__ */ jsxDEV("div", {
              className: "mt-2 text-[11px] text-foreground/55",
              children: resolveBoundaryLabel(chapter)
            }, undefined, false, undefined, this) : null
          ]
        }, chapter.id || index, true, undefined, this))
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function getSectionItems(sections, key) {
  return sections.find((section) => section.key === key)?.items || [];
}
function MeetingSummaryBlock({
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
  chatSlot = null
}) {
  const hasActiveMeeting = Boolean(meeting);
  const sections = summaryState.sections || [];
  const recentLines = summaryState.recentLines || [];
  const meetingState = summaryState.meetingState || {};
  const canCreateMeeting = typeof onCreateMeeting === "function";
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
    const description = hasMeetingHistory ? "Open a recent meeting from the left column or create a new one to start recording, review summaries, and search the live workspace memory." : "There are no saved meetings yet. Create a meeting to start recording, capture summaries, and build your workspace memory in one place.";
    if (!hasMeetingHistory) {
      return /* @__PURE__ */ jsxDEV("div", {
        className: "flex h-full min-h-0 flex-col bg-transparent p-5",
        children: /* @__PURE__ */ jsxDEV("div", {
          className: "flex flex-1 items-center justify-center",
          children: /* @__PURE__ */ jsxDEV("div", {
            className: "w-full max-w-3xl text-center",
            children: [
              /* @__PURE__ */ jsxDEV("div", {
                className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
                children: "Meetings workspace"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("h2", {
                className: "mt-4 text-4xl font-semibold tracking-tight text-foreground",
                children: "Create your first meeting."
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("p", {
                className: "mx-auto mt-5 max-w-2xl text-base leading-8 text-muted-foreground",
                children: description
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("button", {
                type: "button",
                onClick: canCreateMeeting ? onCreateMeeting : undefined,
                disabled: !canCreateMeeting,
                className: "mt-8 inline-flex rounded-full border border-primary/35 bg-[linear-gradient(180deg,hsl(229,68%,52%),hsl(231,76%,34%))] px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
                children: "Create a meeting"
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    }
    return /* @__PURE__ */ jsxDEV("div", {
      className: "flex h-full min-h-0 flex-col bg-transparent p-5",
      children: /* @__PURE__ */ jsxDEV("div", {
        className: "flex flex-1 items-center justify-center",
        children: /* @__PURE__ */ jsxDEV("div", {
          className: "w-full max-w-4xl px-3 text-foreground",
          children: [
            /* @__PURE__ */ jsxDEV("div", {
              className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
              children: "Meetings workspace"
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("h2", {
              className: "mt-4 text-4xl font-semibold tracking-tight text-foreground",
              children: title
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("p", {
              className: "mt-5 max-w-3xl text-base leading-8 text-muted-foreground",
              children: description
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("div", {
              className: "mt-8 grid gap-0 border-t border-white/8 md:grid-cols-3",
              children: [
                /* @__PURE__ */ jsxDEV("div", {
                  className: "border-b border-white/8 py-5 md:border-b-0 md:border-r md:pr-6",
                  children: [
                    /* @__PURE__ */ jsxDEV("div", {
                      className: "text-[10px] uppercase tracking-[0.18em] text-foreground/55",
                      children: "Capture"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV("p", {
                      className: "mt-3 text-sm leading-7 text-foreground/88",
                      children: "Start a fresh meeting and record transcript context in real time."
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV("div", {
                  className: "border-b border-white/8 py-5 md:border-b-0 md:border-r md:px-6",
                  children: [
                    /* @__PURE__ */ jsxDEV("div", {
                      className: "text-[10px] uppercase tracking-[0.18em] text-foreground/55",
                      children: "Review"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV("p", {
                      className: "mt-3 text-sm leading-7 text-foreground/88",
                      children: "Reopen summaries, decisions, action items, and chapter history."
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV("div", {
                  className: "py-5 md:pl-6",
                  children: [
                    /* @__PURE__ */ jsxDEV("div", {
                      className: "text-[10px] uppercase tracking-[0.18em] text-foreground/55",
                      children: "Search"
                    }, undefined, false, undefined, this),
                    /* @__PURE__ */ jsxDEV("p", {
                      className: "mt-3 text-sm leading-7 text-foreground/88",
                      children: "Use transcript retrieval and buddy chat after you pick the right meeting."
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this);
  }
  return /* @__PURE__ */ jsxDEV("div", {
    className: "flex h-full min-h-0 flex-col gap-4 bg-transparent p-5",
    children: [
      /* @__PURE__ */ jsxDEV("div", {
        className: "flex flex-wrap items-center justify-between gap-3 rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(36,28,42,0.96),rgba(23,19,29,0.96))] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.24)]",
        children: [
          /* @__PURE__ */ jsxDEV("div", {
            children: [
              /* @__PURE__ */ jsxDEV("div", {
                className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
                children: "Now"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("h2", {
                className: "mt-1 text-xl font-semibold text-foreground",
                children: meeting?.title || "Untitled meeting"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("p", {
                className: "mt-1 text-sm text-muted-foreground",
                children: meetingState.current_goal || "Live meeting intelligence updates will appear here."
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV("div", {
            className: "flex flex-wrap gap-2 text-xs",
            children: [
              /* @__PURE__ */ jsxDEV("button", {
                type: "button",
                onClick: onStartRecording,
                disabled: !canStartRecording,
                className: "rounded-full border border-primary/35 bg-[linear-gradient(180deg,hsl(229,68%,52%),hsl(231,76%,34%))] px-3.5 py-2 text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50",
                children: isRecording ? "Recording" : "Start"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("button", {
                type: "button",
                onClick: onPauseRecording,
                disabled: !canPauseRecording,
                className: "rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                children: isPaused ? "Paused" : "Pause"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("button", {
                type: "button",
                onClick: onResumeRecording,
                disabled: !canResumeRecording,
                className: "rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                children: "Resume"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("button", {
                type: "button",
                onClick: onStopRecording,
                disabled: !canStopRecording,
                className: "rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                children: "Stop"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("span", {
                className: "self-center text-[10px] uppercase tracking-[0.18em] text-foreground/55",
                children: [
                  elapsedSeconds,
                  "s"
                ]
              }, undefined, true, undefined, this)
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV("div", {
        className: "grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.3fr_1fr]",
        children: [
          /* @__PURE__ */ jsxDEV("div", {
            className: "grid min-h-0 gap-4",
            children: [
              /* @__PURE__ */ jsxDEV(LiveSummaryPanel, {
                meetingState
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(RecentLinesStrip, {
                recentLines
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(ChapterTimeline, {
                chapters
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          /* @__PURE__ */ jsxDEV("div", {
            className: "grid min-h-0 gap-4",
            children: [
              /* @__PURE__ */ jsxDEV(GeneratedRecordPanel, {
                title: "Decisions",
                items: decisions
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(GeneratedRecordPanel, {
                title: "Action Items",
                items: actionItems
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(GeneratedRecordPanel, {
                title: "Open Questions",
                items: openQuestions
              }, undefined, false, undefined, this),
              buddySlot,
              chatSlot
            ]
          }, undefined, true, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
export {
  resolveStatusLabel,
  formatConfidence,
  MeetingSummaryBlock
};
