import { useEffect, useRef } from "react";
import { Mic, Square, Pause, Play, Download, FileText, Cpu, AlertTriangle } from "lucide-react";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SPEAKER_COLORS = [
  "#002FA7",
  "#16A34A",
  "#9333EA",
  "#EA580C",
  "#0891B2",
  "#DC2626",
  "#4F46E5",
  "#059669",
];

function getSpeakerColor(label) {
  const num = parseInt(label.replace(/\D/g, ""), 10) || 1;
  return SPEAKER_COLORS[(num - 1) % SPEAKER_COLORS.length];
}

const ENGINE_META = {
  whisper: { name: "OpenAI GPT-4o Transcribe", color: "#002FA7" },
  sarvam: { name: "Sarvam Saaras v3", color: "#16A34A" },
};

export function TranscriptionPanel({
  meeting,
  segments,
  isRecording,
  isPaused,
  elapsedSeconds,
  isTranscribing,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  onExport,
  engineAvailability,
}) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-slot='scroll-area-viewport'], [data-radix-scroll-area-viewport]");
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [segments]);

  const hasMeeting = !!meeting;
  const hasSegments = segments && segments.length > 0;
  const eng = meeting ? ENGINE_META[meeting.engine] || ENGINE_META.whisper : null;
  const engineStatus = meeting ? engineAvailability?.[meeting.engine]?.state || "loading" : "available";

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-white to-[#FCFCFD]" data-testid="transcription-panel">
      <div className="border-b border-[#E5E7EB] px-8 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {hasMeeting ? (
              <>
                <h2
                  className="text-lg font-semibold text-[#0A0A0A] tracking-tight truncate"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {meeting.title}
                </h2>
                <div className="mt-2 flex items-center flex-wrap gap-2">
                  {eng && (
                    <span
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider px-2 py-1 border"
                      style={{ borderColor: eng.color, color: eng.color }}
                      data-testid="meeting-engine-badge"
                    >
                      <Cpu size={10} strokeWidth={1.5} />
                      {eng.name}
                    </span>
                  )}
                  {isRecording && (
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#FF2A2A]">
                      <span className="w-1.5 h-1.5 bg-[#FF2A2A] rounded-full animate-pulse" />
                      {isPaused ? "Paused" : "Recording"} {formatTime(elapsedSeconds)}
                    </span>
                  )}
                  {isTranscribing && (
                    <span className="font-mono text-[10px] uppercase tracking-widest text-[#002FA7] animate-pulse">
                      Processing...
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <h2
                  className="text-lg font-semibold text-[#0A0A0A] tracking-tight"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Live Transcription
                </h2>
                <p className="text-sm text-[#6B7280] mt-1">
                  Create or select a meeting to start capturing audio.
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasMeeting && !isRecording && (
              <button
                type="button"
                aria-label="Start recording"
                data-testid="start-recording-btn"
                onClick={onStartRecording}
                className="inline-flex items-center justify-center gap-2 bg-[#FF2A2A] text-white rounded-none px-5 py-3 font-semibold uppercase tracking-[0.18em] hover:bg-[#D91F1F] text-[11px] shadow-sm shadow-red-100"
              >
                <Mic size={16} strokeWidth={1.5} />
                Record
              </button>
            )}
            {isRecording && !isPaused && (
              <>
                <button
                  type="button"
                  aria-label="Pause recording"
                  data-testid="pause-recording-btn"
                  onClick={onPauseRecording}
                  className="inline-flex items-center justify-center gap-2 border border-[#0A0A0A] text-[#0A0A0A] bg-white rounded-none px-4 py-3 font-medium hover:bg-[#F9FAFB] transition-colors text-xs tracking-wide"
                >
                  <Pause size={16} strokeWidth={1.5} />
                  Pause
                </button>
                <button
                  type="button"
                  aria-label="Stop recording"
                  data-testid="stop-recording-btn"
                  onClick={onStopRecording}
                  className="inline-flex items-center justify-center gap-2 border-2 border-[#FF2A2A] bg-transparent text-[#FF2A2A] rounded-none px-4 py-3 font-bold uppercase tracking-widest text-xs"
                >
                  <Square size={14} strokeWidth={1.5} />
                  Stop
                </button>
              </>
            )}
            {isRecording && isPaused && (
              <>
                <button
                  type="button"
                  aria-label="Resume recording"
                  data-testid="resume-recording-btn"
                  onClick={onResumeRecording}
                  className="inline-flex items-center justify-center gap-2 bg-[#FF2A2A] text-white rounded-none px-4 py-3 font-bold uppercase tracking-widest hover:bg-[#D91F1F] text-xs"
                >
                  <Play size={16} strokeWidth={1.5} />
                  Resume
                </button>
                <button
                  type="button"
                  aria-label="Stop recording"
                  data-testid="stop-recording-btn-paused"
                  onClick={onStopRecording}
                  className="inline-flex items-center justify-center gap-2 border-2 border-[#FF2A2A] bg-transparent text-[#FF2A2A] rounded-none px-4 py-3 font-bold uppercase tracking-widest text-xs"
                >
                  <Square size={14} strokeWidth={1.5} />
                  Stop
                </button>
              </>
            )}
            {hasMeeting && hasSegments && !isRecording && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Export transcript"
                    data-testid="export-btn"
                    className="inline-flex items-center justify-center gap-2 border border-[#0A0A0A] text-[#0A0A0A] bg-white rounded-none px-4 py-3 font-medium hover:bg-[#F9FAFB] transition-colors text-xs tracking-wide"
                  >
                    <Download size={16} strokeWidth={1.5} />
                    Export
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-none border-[#E5E7EB]">
                  <DropdownMenuItem
                    data-testid="export-txt-btn"
                    onClick={() => onExport("txt")}
                    className="rounded-none text-sm cursor-pointer"
                  >
                    <FileText size={14} className="mr-2" />
                    Export as TXT
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="export-json-btn"
                    onClick={() => onExport("json")}
                    className="rounded-none text-sm cursor-pointer"
                  >
                    <FileText size={14} className="mr-2" />
                    Export as JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {hasMeeting && engineStatus !== "available" && (
          <div className="mt-4 flex items-start gap-2 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <p className="text-xs leading-5">
              {eng?.name || "This engine"} is{" "}
              {engineStatus === "loading" ? "checking availability" : "not configured right now"}. You can still review existing notes, but recording will fail until the provider is available.
            </p>
          </div>
        )}
      </div>

      <ScrollArea ref={scrollRef} className="flex-1">
        <div className="px-8 py-6" data-testid="transcript-content">
          {!hasMeeting && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <Mic size={48} strokeWidth={1} className="text-[#E5E7EB] mb-6" />
              <p className="text-lg text-[#9CA3AF]" style={{ fontFamily: "var(--font-body)" }}>
                Create a meeting to begin live transcription
              </p>
            </div>
          )}
          {hasMeeting && !hasSegments && !isRecording && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <Mic size={48} strokeWidth={1} className="text-[#E5E7EB] mb-6" />
              <p className="text-lg text-[#9CA3AF]" style={{ fontFamily: "var(--font-body)" }}>
                Click Record to start capturing audio
              </p>
            </div>
          )}
          {hasMeeting && !hasSegments && isRecording && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="w-4 h-4 bg-[#FF2A2A] rounded-full animate-pulse mb-6" />
              <p className="text-lg text-[#9CA3AF]" style={{ fontFamily: "var(--font-body)" }}>
                Listening for speech...
              </p>
            </div>
          )}
          {hasSegments &&
            segments.map((seg, i) => (
              <div
                key={seg.id || i}
                data-testid={`transcript-segment-${i}`}
                className="flex items-start gap-6 py-4 border-b border-[#F3F4F6] hover:bg-[#F9FAFB] transition-colors pr-12"
              >
                <div className="flex flex-col items-start gap-1 w-24 shrink-0 mt-1">
                  <span
                    className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border"
                    style={{
                      backgroundColor: getSpeakerColor(seg.speaker_label) + "12",
                      borderColor: getSpeakerColor(seg.speaker_label),
                      color: getSpeakerColor(seg.speaker_label),
                    }}
                  >
                    {seg.speaker_label}
                  </span>
                  <span className="font-mono text-[10px] text-[#9CA3AF]">
                    {formatTime(seg.timestamp_start)}
                  </span>
                  {seg.language_code && (
                    <span className="font-mono text-[10px] text-[#9CA3AF]">
                      {seg.language_code}
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <p
                    className="text-base leading-relaxed text-[#0A0A0A]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {seg.text}
                  </p>
                  {seg.translated_text && seg.translated_text !== seg.text && (
                    <div className="flex items-start gap-2 mt-1.5">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-[#002FA7] mt-0.5 shrink-0 border border-[#002FA7]/30 px-1 py-0.5">
                        EN
                      </span>
                      <p
                        className="text-sm leading-relaxed text-[#4B5563]"
                        style={{ fontFamily: "var(--font-body)" }}
                      >
                        {seg.translated_text}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
