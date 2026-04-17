import * as React from "react";
import { useHotkeySequence, useHotkeys } from "@tanstack/react-hotkeys";
import { Toaster } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function WorkspaceShellFallback({
  brand = "Meeting Agent",
  eyebrow = "Meeting Agent",
  title = "Loading workspace...",
  description = "Preparing the meeting intelligence shell.",
  variant = "workspace",
  highlights = [],
  action = null,
  onRetry,
  status = "loading",
}) {
  const isIndex = variant === "index";
  const isLoading = status === "loading";
  const isError = status === "error";
  const visibleHighlights = highlights.length
    ? highlights
    : isIndex
      ? ["Recent meetings", "Searchable notes", "Open threads"]
      : ["Transcript", "Summary", "Action items"];
  const primaryHref = isIndex ? "/meetings" : "/app";
  const secondaryHref = isIndex ? "/app" : "/meetings";

  const navigateTo = React.useCallback((path) => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, []);

  const handleRetry = React.useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  useHotkeys(
    [
      {
        hotkey: "b",
        callback: () => navigateTo(primaryHref),
      },
      {
        hotkey: "r",
        callback: () => handleRetry(),
        options: { enabled: Boolean(onRetry) },
      },
    ],
    { preventDefault: true },
  );

  useHotkeySequence(["G", "D"], () => navigateTo("/app"));
  useHotkeySequence(["G", "M"], () => navigateTo("/meetings"));

  return (
    <div
      className="dark flex h-screen flex-col bg-[radial-gradient(circle_at_top,_hsl(228,32%,16%),_hsl(284,18%,7%)_58%)] text-foreground"
      data-testid="app-root"
    >
      <Toaster position="top-right" richColors />
      <header className="shrink-0 border-b border-white/8 bg-[rgba(18,14,22,0.82)] backdrop-blur-xl">
        <div className="flex items-center justify-between px-8 py-4">
          <div>
            <h1
              className="text-xl font-black tracking-[0.18em] text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {brand.toUpperCase()}
            </h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.24em] text-foreground/50">
              {eyebrow}
            </p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {isLoading ? (
              <div className="flex items-center gap-3 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-foreground/60">
                <span className="inline-flex gap-1.5">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="size-1.5 rounded-full bg-primary/80 animate-pulse"
                      style={{ animationDelay: `${dot * 160}ms` }}
                    />
                  ))}
                </span>
                Loading route
              </div>
            ) : (
              <>
                <a
                  href={primaryHref}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "border-white/10 bg-white/5 text-[10px] uppercase tracking-[0.2em] text-foreground/80 hover:bg-white/10",
                  )}
                >
                  {isIndex ? "Browse meetings" : "Dashboard"}
                </a>
                <a
                  href={secondaryHref}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "border-white/10 bg-white/5 text-[10px] uppercase tracking-[0.2em] text-foreground/80 hover:bg-white/10",
                  )}
                >
                  {isIndex ? "Dashboard" : "Meeting history"}
                </a>
              </>
            )}
            {isError && onRetry ? (
              <button
                type="button"
                onClick={handleRetry}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "text-[10px] uppercase tracking-[0.2em]",
                )}
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-3xl">
          <div className="text-center" aria-live={isLoading ? "polite" : undefined}>
            {isLoading ? (
              <div className="mx-auto mb-8 w-full max-w-xl">
                <div className="h-1 overflow-hidden rounded-full bg-white/6">
                  <div className="h-full w-1/3 rounded-full bg-[linear-gradient(90deg,rgba(75,107,255,0.35),rgba(158,190,255,0.95),rgba(75,107,255,0.35))] animate-pulse" />
                </div>
              </div>
            ) : null}
            <div className="text-[11px] uppercase tracking-[0.22em] text-blue-200/65">
              {isIndex ? "Meeting history" : "Focused workspace"}
            </div>
            <h2
              className="mt-4 text-4xl font-semibold tracking-tight text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {title}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-muted-foreground">{description}</p>
            {isLoading ? (
              <div className="mx-auto mt-6 max-w-2xl space-y-3">
                <div className="h-3 rounded-full bg-white/6" />
                <div className="mx-auto h-3 w-4/5 rounded-full bg-white/[0.045]" />
              </div>
            ) : (
              <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-foreground/78">
                {isIndex
                  ? "The route is still available. Open your meeting history, return to the dashboard, or retry the bundle load."
                  : "The route is still available. Return to your meeting history, open the dashboard, or retry the workspace load."}
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-2 text-[11px] uppercase tracking-[0.18em] text-foreground/70">
              {visibleHighlights.map((label) => (
                <span
                  key={label}
                  className={cn(
                    "rounded-full border border-white/10 px-3 py-1",
                    isLoading ? "bg-white/[0.035] animate-pulse" : "bg-white/5",
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
            {isError ? (
              <>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <a href={primaryHref} className={cn(buttonVariants({ size: "lg" }), "rounded-2xl")}>
                    {isIndex ? "Open meeting history" : "Open dashboard"}
                  </a>
                  <a
                    href={secondaryHref}
                    className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-2xl border-white/10 bg-white/5 hover:bg-white/10")}
                  >
                    {isIndex ? "Open dashboard" : "Open meeting history"}
                  </a>
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={handleRetry}
                      className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-2xl border-white/10 bg-transparent hover:bg-white/10")}
                    >
                      Retry load
                    </button>
                  ) : null}
                  {action && !onRetry ? <div className="contents">{action}</div> : null}
                </div>
                <p className="mt-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Hotkeys: <span className="text-foreground/80">B</span> to browse, <span className="text-foreground/80">G then D</span> for dashboard, <span className="text-foreground/80">G then M</span> for meetings{onRetry ? ", R to retry" : ""}.
                </p>
              </>
            ) : (
              <div className="mt-8 flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.24em] text-foreground/55">
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5">Bootstrapping</span>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5">Loading runtime config</span>
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5">Preparing shell</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
