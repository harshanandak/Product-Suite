import { useEffect, useRef, useState } from "react";
import { Search, Plus, Trash2, Clock } from "lucide-react";

import { ScrollArea } from "../components/ui/scroll-area";

const ENGINE_LABELS = {
  whisper: { name: "OpenAI Transcribe", color: "#002FA7" },
  sarvam: { name: "Sarvam", color: "#16A34A" },
};

export function MeetingHistory({
  meetings,
  activeMeetingId,
  onSelectMeeting,
  onNewMeeting,
  onDeleteMeeting,
  onSearch,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!onSearch) return undefined;

    if (!didMountRef.current) {
      didMountRef.current = true;
      return undefined;
    }

    const handle = window.setTimeout(() => {
      onSearch(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(handle);
  }, [onSearch, searchQuery]);

  const formatDuration = (seconds) => {
    if (!seconds) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const formatDate = (isoStr) => {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(27,21,32,0.9),rgba(17,14,22,0.98))]"
      data-testid="meeting-history-panel"
    >
      <div className="border-b border-white/8 px-6 py-6">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.24em] text-foreground/55">
          Meetings
        </p>
        <button
          type="button"
          data-testid="new-meeting-btn"
          onClick={() => onNewMeeting?.()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-[linear-gradient(180deg,hsl(229,68%,52%),hsl(231,76%,34%))] px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.18em] text-primary-foreground shadow-[0_18px_36px_rgba(37,69,213,0.28)] transition hover:brightness-110"
        >
          <Plus size={16} strokeWidth={1.5} />
          NEW MEETING
        </button>
      </div>

      <div className="border-b border-white/8 px-6 py-4">
        <div className="relative rounded-2xl border border-white/8 bg-white/4 px-4 py-3 backdrop-blur-sm">
          <label htmlFor="meeting-search" className="sr-only">
            Search meetings
          </label>
          <Search
            size={16}
            strokeWidth={1.5}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="meeting-search"
            data-testid="search-meetings-input"
            type="text"
            name="search"
            placeholder="Search transcripts..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            autoComplete="off"
            className="w-full bg-transparent py-1 pl-7 pr-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-5 py-4" data-testid="meeting-list">
          {meetings.length === 0 ? (
            <div className="border-t border-dashed border-white/12 px-2 py-10 text-center">
              <p className="text-sm font-medium text-foreground/92">No meetings yet.</p>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Start a recording to build your recent meeting list, transcript search, and summary history.
              </p>
            </div>
          ) : null}

          {meetings.map((meeting) => {
            const eng = ENGINE_LABELS[meeting.engine] || ENGINE_LABELS.whisper;

            return (
              <div
                key={meeting.id}
                data-testid={`meeting-item-${meeting.id}`}
                className={`border-b px-2 py-4 transition-colors ${
                  activeMeetingId === meeting.id
                    ? "border-primary/35 bg-primary/[0.08]"
                    : "border-white/8 hover:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    data-testid={`select-meeting-${meeting.id}`}
                    onClick={() => onSelectMeeting(meeting.id)}
                    className="min-w-0 flex-1 pr-2 text-left focus:outline-none"
                  >
                    <p className="truncate text-sm font-semibold text-foreground">{meeting.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatDate(meeting.created_at)}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                        <Clock size={10} strokeWidth={1.5} />
                        {formatDuration(meeting.duration_seconds)}
                      </span>
                      <span
                        className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                        style={{ borderColor: eng.color, color: eng.color, backgroundColor: `${eng.color}18` }}
                      >
                        {eng.name}
                      </span>
                    </div>
                    <div className="mt-2">
                      {meeting.status === "recording" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-destructive-foreground">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                          LIVE
                        </span>
                      ) : null}
                      {meeting.status === "paused" ? (
                        <span className="rounded-full bg-amber-400 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-950">
                          PAUSED
                        </span>
                      ) : null}
                      {meeting.status === "completed" ? (
                        <span className="rounded-full border border-white/8 bg-white/6 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground/75">
                          DONE
                        </span>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    data-testid={`delete-meeting-${meeting.id}`}
                    aria-label={`Delete meeting ${meeting.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteMeeting(meeting.id);
                    }}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/8 hover:text-destructive"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
