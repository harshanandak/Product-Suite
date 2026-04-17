import { Cpu, Mic, Sparkles, Waves } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function describeStatus(status) {
  if (status === "available") return "Ready";
  if (status === "loading") return "Checking availability";
  if (status === "unavailable") return "Connect provider";
  return "Status error";
}

function normalizeSingleToggleValue(value, fallback = "") {
  if (Array.isArray(value)) {
    return value[0] || fallback;
  }

  return typeof value === "string" && value ? value : fallback;
}

export function MeetingCreateScreen({
  title,
  engine,
  defaultEngine = "whisper",
  engineAvailability,
  onTitleChange,
  onEngineChange,
  onCreateMeeting,
  onOpenHistory,
  isSubmitting = false,
}) {
  const whisperStatus = engineAvailability?.whisper?.state || "loading";
  const sarvamStatus = engineAvailability?.sarvam?.state || "loading";
  const selectedEngine = normalizeSingleToggleValue(engine, defaultEngine);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent p-5">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(34,27,40,0.96),rgba(19,15,24,0.98))] shadow-[0_24px_90px_rgba(0,0,0,0.28)] lg:flex-row">
        <section className="flex-1 px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-foreground/75">
              Meetings workspace
            </Badge>
            <Badge variant="secondary" className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-primary-foreground">
              New meeting
            </Badge>
          </div>

          <div className="mt-6 max-w-3xl">
            <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Start a meeting with room to think.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">
              Create the workspace first, then move straight into live capture, summary-first review, and follow-up.
              This route uses the shell directly instead of compressing creation into a sidebar dialog.
            </p>
          </div>

          <form
            className="mt-8 space-y-8"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateMeeting?.();
            }}
          >
            <div className="border-t border-white/8 pt-6">
              <Label htmlFor="new-meeting-page-title" className="text-[11px] uppercase tracking-[0.22em] text-foreground/60">
                Meeting title
              </Label>
              <Input
                id="new-meeting-page-title"
                value={title}
                onChange={(event) => onTitleChange?.(event.target.value)}
                placeholder="Weekly review, founder sync, design critique..."
                autoComplete="off"
                className="mt-3 h-12 rounded-[1.5rem] border border-white/10 bg-white/5 px-4 text-sm text-foreground placeholder:text-muted-foreground"
              />
              <p className="mt-3 text-sm text-muted-foreground">
                Leave it blank and Meeting Agent will create a timestamped title automatically.
              </p>
            </div>

            <div className="border-t border-white/8 pt-6">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" />
                <Label className="text-[11px] uppercase tracking-[0.22em] text-foreground/60">
                  Transcription engine
                </Label>
              </div>

              <ToggleGroup
                multiple={false}
                value={selectedEngine ? [selectedEngine] : []}
                onValueChange={(value) => {
                  const nextEngine = normalizeSingleToggleValue(value);
                  if (nextEngine) {
                    onEngineChange?.(nextEngine);
                  }
                }}
                className="mt-4 grid w-full gap-3 md:grid-cols-2"
              >
                <ToggleGroupItem
                  value="whisper"
                  variant="outline"
                  className="h-auto w-full flex-col items-start rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-left data-[state=on]:border-primary/40 data-[state=on]:bg-primary/12"
                >
                  <span className="text-sm font-semibold text-foreground">OpenAI GPT-4o Transcribe</span>
                  <span className="mt-2 text-xs leading-6 text-muted-foreground">Multilingual, high-accuracy meeting capture.</span>
                  <span className="mt-3 text-[10px] uppercase tracking-[0.18em] text-foreground/55">
                    {describeStatus(whisperStatus)}
                  </span>
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="sarvam"
                  variant="outline"
                  className="h-auto w-full flex-col items-start rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-left data-[state=on]:border-primary/40 data-[state=on]:bg-primary/12"
                >
                  <span className="text-sm font-semibold text-foreground">Sarvam Saaras v3</span>
                  <span className="mt-2 text-xs leading-6 text-muted-foreground">Indian language and code-mix friendly capture.</span>
                  <span className="mt-3 text-[10px] uppercase tracking-[0.18em] text-foreground/55">
                    {describeStatus(sarvamStatus)}
                  </span>
                </ToggleGroupItem>
              </ToggleGroup>

              <p className="mt-4 text-sm text-muted-foreground">
                You can still prepare the meeting workspace before recording starts. Provider connectivity affects live capture, not navigation.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-white/8 pt-6">
              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting}
                className="rounded-2xl px-5 shadow-[0_14px_36px_rgba(58,94,255,0.28)]"
              >
                {isSubmitting ? "Creating meeting..." : "Create meeting"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onOpenHistory}
                className="rounded-2xl border-white/10 bg-white/5 px-5 hover:bg-white/10"
              >
                Review meeting history
              </Button>
            </div>
          </form>
        </section>

        <aside className="w-full border-t border-white/8 px-6 py-8 sm:px-8 lg:w-[360px] lg:border-t-0 lg:border-l lg:px-8 lg:py-10">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.22em] text-foreground/55">What happens next</div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">One focused workspace, then capture.</h3>
          </div>

          <div className="mt-6 space-y-6 border-t border-white/8 pt-6">
            <div className="flex gap-3">
              <Mic className="mt-0.5 size-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">Live recording</div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Start recording as soon as the workspace opens. Controls stay with the meeting instead of the index.
                </p>
              </div>
            </div>
            <div className="flex gap-3 border-t border-white/8 pt-6">
              <Sparkles className="mt-0.5 size-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">Summary-first view</div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Decisions, action items, and open questions stay in the same workspace after creation.
                </p>
              </div>
            </div>
            <div className="flex gap-3 border-t border-white/8 pt-6">
              <Waves className="mt-0.5 size-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">No nested setup cards</div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  The create flow now uses one rounded shell with section dividers instead of cards inside cards inside cards.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
