import { useEffect, useRef, useState, useCallback } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  ListChecks,
  Hash,
  ChevronDown,
  ChevronUp,
  Languages,
  Mic,
  Square,
  Volume2,
  PlayCircle,
  AlertTriangle,
} from "lucide-react";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import ReactMarkdown from "react-markdown";

const LANGUAGES = [
  { code: "en-IN", name: "English" },
  { code: "hi-IN", name: "Hindi" },
  { code: "ta-IN", name: "Tamil" },
  { code: "te-IN", name: "Telugu" },
  { code: "kn-IN", name: "Kannada" },
  { code: "ml-IN", name: "Malayalam" },
  { code: "mr-IN", name: "Marathi" },
  { code: "gu-IN", name: "Gujarati" },
  { code: "bn-IN", name: "Bengali" },
  { code: "pa-IN", name: "Punjabi" },
  { code: "or-IN", name: "Odia" },
  { code: "ur-IN", name: "Urdu" },
];

export function AIToolsPanel({
  meeting,
  summary,
  chatMessages,
  hasTranscript,
  isSummaryLoading,
  isChatLoading,
  isTranslating,
  onGenerateSummary,
  onSendChat,
  onTranslate,
  onVoiceChat,
  engineAvailability,
}) {
  const [chatInput, setChatInput] = useState("");
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [translateLang, setTranslateLang] = useState("en-IN");

  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  const openAIStatus = engineAvailability?.whisper?.state || "loading";
  const sarvamStatus = engineAvailability?.sarvam?.state || "loading";
  const canUseOpenAI = openAIStatus === "available";
  const canUseSarvam = sarvamStatus === "available";
  const lastVoiceMessage = [...chatMessages].reverse().find(
    (message) => message.role === "assistant" && message.audio_base64
  );

  const handleSend = () => {
    if (!chatInput.trim() || !canUseOpenAI) return;
    onSendChat(chatInput.trim());
    setChatInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const playAudioResponse = useCallback((base64Audio) => {
    try {
      const audioData = atob(base64Audio);
      const bytes = new Uint8Array(audioData.length);
      for (let i = 0; i < audioData.length; i += 1) {
        bytes[i] = audioData.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(url);
      audioRef.current = audio;
      setIsPlayingAudio(true);
      audio.play();
      audio.onended = () => {
        setIsPlayingAudio(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setIsPlayingAudio(false);
        URL.revokeObjectURL(url);
      };
    } catch (err) {
      console.error("Audio playback error:", err);
      setIsPlayingAudio(false);
    }
  }, []);

  const stopVoiceRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsVoiceRecording(false);
  }, []);

  const startVoiceRecording = useCallback(async () => {
    if (!canUseOpenAI) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (blob.size > 500 && onVoiceChat) {
          setIsVoiceProcessing(true);
          try {
            const result = await onVoiceChat(blob);
            if (result?.audio_base64) {
              playAudioResponse(result.audio_base64);
            }
          } finally {
            setIsVoiceProcessing(false);
          }
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsVoiceRecording(true);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  }, [canUseOpenAI, onVoiceChat, playAudioResponse]);

  const replayLastAudio = useCallback(() => {
    if (lastVoiceMessage?.audio_base64) {
      playAudioResponse(lastVoiceMessage.audio_base64);
    }
  }, [lastVoiceMessage, playAudioResponse]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const hasMeeting = !!meeting;
  const hasSummary = summary && summary.summary_text;
  const openAIUnavailable = hasMeeting && openAIStatus === "unavailable";
  const openAILoading = hasMeeting && openAIStatus === "loading";
  const openAIError = hasMeeting && openAIStatus === "error";
  const sarvamUnavailable = hasMeeting && sarvamStatus === "unavailable";
  const sarvamLoading = hasMeeting && sarvamStatus === "loading";
  const sarvamError = hasMeeting && sarvamStatus === "error";

  return (
    <div className="flex flex-col h-full bg-[#FCFCFD]" data-testid="ai-tools-panel">
      <div className="border-b border-[#E5E7EB]">
        <button
          type="button"
          aria-expanded={summaryExpanded}
          aria-controls="summary-panel"
          className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-[#F9FAFB] transition-colors"
          onClick={() => setSummaryExpanded((v) => !v)}
        >
          <p className="overline-label flex items-center gap-2">
            <Sparkles size={14} strokeWidth={1.5} />
            SUMMARY & ACTIONS
          </p>
          {summaryExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {summaryExpanded && (
          <div id="summary-panel" className="px-6 pb-4">
            {openAIUnavailable && (
              <div className="mb-4 flex items-start gap-2 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <p className="text-xs leading-5">
                  OpenAI is not configured, so summary and chat tools are temporarily unavailable.
                </p>
              </div>
            )}
            {openAILoading && (
              <div className="mb-4 flex items-start gap-2 rounded-none border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <p className="text-xs leading-5">Checking OpenAI availability...</p>
              </div>
            )}
            {openAIError && (
              <div className="mb-4 flex items-start gap-2 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <p className="text-xs leading-5">OpenAI status check failed.</p>
              </div>
            )}
            {!hasMeeting && (
              <p className="text-sm text-[#6B7280]">
                Select a meeting to see AI summaries, follow-ups, and voice answers.
              </p>
            )}
            {hasMeeting && !hasSummary && (
              <button
                type="button"
                data-testid="generate-summary-btn"
                onClick={onGenerateSummary}
                disabled={isSummaryLoading || !canUseOpenAI}
                className="bg-[#002FA7] text-white rounded-none px-6 py-3 font-medium hover:bg-[#00237C] transition-colors text-sm tracking-wide w-full flex items-center justify-center gap-2 disabled:opacity-50"
                aria-label="Generate summary"
              >
                {isSummaryLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <Sparkles size={16} strokeWidth={1.5} />
                    Generate summary
                  </>
                )}
              </button>
            )}
            {hasSummary && (
              <div className="space-y-4">
                <div className="rounded-none border border-[#E5E7EB] bg-white p-4 shadow-sm shadow-slate-50">
                  <p
                    className="text-sm leading-relaxed text-[#0A0A0A]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {summary.summary_text}
                  </p>
                </div>
                {summary.action_items && summary.action_items.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1 overline-label mb-2">
                      <ListChecks size={12} strokeWidth={1.5} />
                      ACTION ITEMS
                    </p>
                    <ul className="space-y-1">
                      {summary.action_items.map((item, i) => (
                        <li key={i} className="text-sm text-[#0A0A0A] flex items-start gap-2">
                          <span className="text-[#002FA7] mt-0.5 shrink-0">-</span>
                          <span style={{ fontFamily: "var(--font-body)" }}>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.key_topics && summary.key_topics.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1 overline-label mb-2">
                      <Hash size={12} strokeWidth={1.5} />
                      KEY TOPICS
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {summary.key_topics.map((topic, i) => (
                        <span
                          key={i}
                          className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-[#E5E7EB] text-[#4B5563] bg-[#F9FAFB]"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  data-testid="regenerate-summary-btn"
                  onClick={onGenerateSummary}
                  disabled={isSummaryLoading || !canUseOpenAI}
                  className="border border-[#0A0A0A] text-[#0A0A0A] bg-transparent rounded-none px-4 py-2 font-medium hover:bg-[#F9FAFB] transition-colors text-xs tracking-wide flex items-center gap-2 disabled:opacity-50"
                  aria-label="Regenerate summary"
                >
                  {isSummaryLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Regenerate
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {hasMeeting && hasTranscript && (
        <div className="border-b border-[#E5E7EB] px-6 py-4">
          <p className="overline-label flex items-center gap-2 mb-2">
            <Languages size={14} strokeWidth={1.5} />
            TRANSLATE TO OTHER LANGUAGES
          </p>
          <p className="text-[11px] text-[#4B5563] mb-3" style={{ fontFamily: "var(--font-body)" }}>
            Non-English speech is auto-translated to English. Use Sarvam to translate into another Indian language.
          </p>
          {sarvamUnavailable && (
            <div className="mb-3 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="text-xs leading-5">
                Sarvam is not configured, so translation is disabled for now.
              </p>
            </div>
          )}
          {sarvamLoading && (
            <div className="mb-3 rounded-none border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
              <p className="text-xs leading-5">Checking Sarvam availability...</p>
            </div>
          )}
          {sarvamError && (
            <div className="mb-3 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              <p className="text-xs leading-5">Sarvam status check failed.</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Select value={translateLang} onValueChange={setTranslateLang} disabled={!canUseSarvam}>
              <SelectTrigger
                className="rounded-none border-[#E5E7EB] text-sm h-10 flex-1 bg-white"
                data-testid="translate-language-select"
              >
                <SelectValue placeholder="Translate into..." />
              </SelectTrigger>
              <SelectContent className="rounded-none border-[#E5E7EB]">
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code} className="rounded-none text-sm">
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              data-testid="translate-btn"
              onClick={() => onTranslate(translateLang)}
              disabled={isTranslating || !canUseSarvam}
              className="bg-[#16A34A] text-white rounded-none px-4 py-2.5 font-medium hover:bg-[#15803D] transition-colors text-xs tracking-wide flex items-center gap-2 disabled:opacity-50 shrink-0"
              aria-label="Translate transcript"
            >
              {isTranslating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Languages size={14} strokeWidth={1.5} />
              )}
              Translate
            </button>
          </div>
          <p className="text-[10px] text-[#9CA3AF] mt-2 font-mono">
            Powered by Sarvam AI
          </p>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <p className="overline-label">Q&A CHAT</p>
          <div className="flex items-center gap-2">
            {lastVoiceMessage?.audio_base64 && (
              <button
                type="button"
                data-testid="replay-last-audio-btn"
                onClick={replayLastAudio}
                className="inline-flex items-center gap-2 rounded-none border border-[#0A0A0A] bg-white px-3 py-1.5 text-[11px] font-medium hover:bg-[#F9FAFB] transition-colors"
                aria-label="Replay last voice answer"
              >
                <PlayCircle size={14} strokeWidth={1.5} />
                Replay voice answer
              </button>
            )}
            {hasMeeting && hasTranscript && isPlayingAudio && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-[#002FA7]">
                <Volume2 size={12} className="animate-pulse" />
                SPEAKING
              </span>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-4" data-testid="chat-messages">
            {!hasMeeting && (
              <p className="text-sm text-[#6B7280]">Select a meeting to ask questions.</p>
            )}
            {hasMeeting && chatMessages.length === 0 && (
              <div className="text-center py-6">
                <Mic size={24} strokeWidth={1} className="text-[#E5E7EB] mx-auto mb-3" />
                <p className="text-sm text-[#6B7280] mb-1">Ask questions about this meeting</p>
                <p className="text-[11px] text-[#9CA3AF]">
                  Type a question or use voice to capture it faster.
                </p>
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={msg.id || i}
                data-testid={`chat-message-${i}`}
                className={`${
                  msg.role === "user"
                    ? "bg-[#F3F4F6] p-3"
                    : "bg-white border-l-2 border-l-[#002FA7] p-3 shadow-sm shadow-slate-50"
                }`}
              >
                <p className="font-mono text-[10px] uppercase tracking-wider text-[#9CA3AF] mb-1">
                  {msg.role === "user" ? "YOU" : "AI"}
                </p>
                <div
                  className="text-sm text-[#0A0A0A] leading-relaxed prose prose-sm max-w-none"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {(isChatLoading || isVoiceProcessing) && (
              <div className="flex items-center gap-2 p-3">
                <Loader2 size={14} className="animate-spin text-[#002FA7]" />
                <span className="text-sm text-[#6B7280]">
                  {isVoiceProcessing ? "Listening and thinking..." : "Thinking..."}
                </span>
              </div>
            )}
          </div>
        </ScrollArea>

        {hasMeeting && (
          <div className="px-6 py-4 border-t border-[#E5E7EB]">
            {openAIUnavailable && (
              <div className="mb-3 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <p className="text-xs leading-5">
                  OpenAI is not configured, so text chat and voice Q&A are disabled.
                </p>
              </div>
            )}
            {hasTranscript && (
              <div className="mb-3">
                {!isVoiceRecording ? (
                  <button
                    type="button"
                    data-testid="voice-chat-btn"
                    onClick={startVoiceRecording}
                    disabled={isVoiceProcessing || isChatLoading || !canUseOpenAI}
                    className="w-full border-2 border-dashed border-[#002FA7]/30 bg-[#002FA7]/5 text-[#002FA7] rounded-none px-4 py-3 font-medium hover:bg-[#002FA7]/10 hover:border-[#002FA7]/50 transition-colors text-xs tracking-wide flex items-center justify-center gap-2 disabled:opacity-50"
                    aria-label="Start voice question"
                  >
                    <Mic size={16} strokeWidth={1.5} />
                    {isVoiceProcessing ? "Processing" : "Click to start voice question"}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="voice-chat-stop-btn"
                    onClick={stopVoiceRecording}
                    className="w-full border-2 border-[#FF2A2A] bg-[#FF2A2A]/10 text-[#FF2A2A] rounded-none px-4 py-3 font-bold uppercase tracking-widest flex items-center justify-center gap-2 text-xs animate-pulse"
                    aria-label="Send voice question"
                  >
                    <Square size={14} strokeWidth={1.5} />
                    Click to send question
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <label htmlFor="chat-input" className="sr-only">
                Ask a question about the meeting
              </label>
              <input
                id="chat-input"
                data-testid="chat-input"
                type="text"
                placeholder="Type your question..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isChatLoading || isVoiceProcessing || !canUseOpenAI}
                className="border-b-2 border-[#E5E7EB] bg-transparent px-0 py-2 rounded-none focus:outline-none focus:border-[#002FA7] focus:ring-0 transition-colors placeholder:text-[#9CA3AF] text-[#0A0A0A] w-full text-sm flex-1"
              />
              <button
                type="button"
                data-testid="send-chat-btn"
                onClick={handleSend}
                disabled={!chatInput.trim() || isChatLoading || isVoiceProcessing || !canUseOpenAI}
                className="bg-[#002FA7] text-white rounded-none p-3 hover:bg-[#00237C] transition-colors disabled:opacity-50"
                aria-label="Send chat message"
              >
                <Send size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
