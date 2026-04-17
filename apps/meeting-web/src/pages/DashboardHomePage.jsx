import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { SectionCards } from "@/components/section-cards";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AppShell } from "@/layouts/AppShell";
import {
  clearAuthToken,
  getCachedRuntimeConfig,
  getCurrentUser,
  getOnboardingState,
  getStoredAuthToken,
  initializeRuntimeConfig,
  listMeetings,
  signOutHostedSession,
} from "@/lib/api";
import { performHostedSignOutFlow } from "@/lib/hostedAuthFlow";
import { setHostedPostLoginPath } from "@/lib/hostedAuthRoutes";
import { cn } from "@/lib/utils";

function describeRequestError(error, fallbackMessage) {
  return error?.response?.data?.detail || error?.message || fallbackMessage;
}

function isAuthSessionError(error) {
  const status = error?.response?.status;
  return status === 401 || status === 403;
}

function isRecoverableOssNetworkError(error, runtimeConfig) {
  if (runtimeConfig?.deployment_mode !== "oss") {
    return false;
  }

  if (runtimeConfig?.auth?.required || error?.response) {
    return false;
  }

  const apiBaseUrl = String(
    runtimeConfig?.apiBaseUrl ||
    runtimeConfig?.api_base_url ||
    runtimeConfig?.backendUrl ||
    runtimeConfig?.backend_url ||
    ""
  );

  try {
    const origin = new URL(apiBaseUrl).origin;
    return origin.includes("localhost") || origin.includes("127.0.0.1");
  } catch {
    return apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
  }
}

export function DashboardHomePage() {
  const navigate = useNavigate();
  const [runtimeConfig, setRuntimeConfig] = useState(getCachedRuntimeConfig());
  const [bootstrapStatus, setBootstrapStatus] = useState("loading");
  const [dashboardError, setDashboardError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [meetings, setMeetings] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapDashboard() {
      setBootstrapStatus("loading");
      setDashboardError("");

      try {
        const nextRuntimeConfig = await initializeRuntimeConfig();
        if (cancelled) {
          return;
        }

        setRuntimeConfig(nextRuntimeConfig);

        if (nextRuntimeConfig?.auth?.required) {
          const storedToken = getStoredAuthToken();
          if (!storedToken) {
            setHostedPostLoginPath("/app");
            navigate("/auth/sign-in", { replace: true, state: { from: "/app" } });
            return;
          }

          try {
            const currentUserResponse = await getCurrentUser();
            if (cancelled) {
              return;
            }

            setCurrentUser(currentUserResponse?.data || null);
          } catch (error) {
            if (isAuthSessionError(error)) {
              clearAuthToken();
              setHostedPostLoginPath("/app");
              navigate("/auth/sign-in", { replace: true, state: { from: "/app" } });
              return;
            }

            if (!cancelled) {
              setDashboardError(describeRequestError(error, "Failed to load workspace identity"));
              setBootstrapStatus("error");
            }
            return;
          }

          try {
            const onboardingResponse = await getOnboardingState();
            if (cancelled) {
              return;
            }

            if (onboardingResponse?.data?.needs_onboarding) {
              navigate("/meetings", { replace: true });
              return;
            }
          } catch (error) {
            if (!cancelled) {
              setDashboardError(describeRequestError(error, "Failed to load onboarding state"));
            }
          }
        }

        try {
          const meetingsResponse = await listMeetings();
          if (cancelled) {
            return;
          }

          setMeetings(Array.isArray(meetingsResponse?.data) ? meetingsResponse.data : []);
          setBootstrapStatus("ready");
        } catch (error) {
          if (cancelled) {
            return;
          }

          if (isRecoverableOssNetworkError(error, nextRuntimeConfig)) {
            setMeetings([]);
            setBootstrapStatus("ready");
            return;
          }

          setDashboardError(describeRequestError(error, "Failed to load dashboard"));
          setBootstrapStatus("error");
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(describeRequestError(error, "Failed to load dashboard"));
          setBootstrapStatus("error");
        }
      }
    }

    void bootstrapDashboard();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const sortedMeetings = [...meetings].sort((left, right) => {
    const leftTimestamp = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTimestamp = new Date(right.updated_at || right.created_at || 0).getTime();

    if (Number.isNaN(leftTimestamp) && Number.isNaN(rightTimestamp)) {
      return 0;
    }
    if (Number.isNaN(leftTimestamp)) {
      return 1;
    }
    if (Number.isNaN(rightTimestamp)) {
      return -1;
    }

    return rightTimestamp - leftTimestamp;
  });

  const recordingMeetings = meetings.filter((meeting) => meeting.status === "recording").length;
  const completedMeetings = meetings.filter((meeting) => meeting.status === "completed").length;
  const openMeetings = Math.max(meetings.length - completedMeetings, 0);
  const recentMeetings = sortedMeetings.slice(0, 12);
  const isHostedMode = runtimeConfig?.deployment_mode === "hosted";
  const navItems = [
    { href: "/app", label: "Dashboard" },
    { href: "/meetings", label: "Meetings" },
  ];
  const displayName = currentUser?.name || currentUser?.full_name || currentUser?.email || "your workspace";

  async function handleSignOut() {
    await performHostedSignOutFlow({
      isHostedMode,
      signOutHostedSession,
      resetLocalSession: clearAuthToken,
      resetWorkspaceState: () => {
        setCurrentUser(null);
        setMeetings([]);
      },
      clearPostLoginPath: () => setHostedPostLoginPath("/app"),
      replaceBrowserPath: (nextPath) => navigate(nextPath, { replace: true }),
    });
  }

  function handleCreateMeeting() {
    navigate("/meetings/new");
  }

  const metricCards = [
    {
      title: "Meetings",
      value: String(meetings.length || 0),
      change: `${Math.max(openMeetings, 0)} open`,
      trend: "up",
      footerTitle: "Workspace activity",
      footerDescription: "Total meetings available in this workspace.",
    },
    {
      title: "Recording now",
      value: String(recordingMeetings),
      change: recordingMeetings ? `+${recordingMeetings}` : "Idle",
      trend: recordingMeetings ? "up" : "down",
      footerTitle: "Live capture status",
      footerDescription: "Active sessions still collecting transcript context.",
    },
    {
      title: "Completed",
      value: String(completedMeetings),
      change: `${completedMeetings}/${meetings.length || 1}`,
      trend: "up",
      footerTitle: "Review-ready",
      footerDescription: "Meetings with summaries ready to reopen.",
    },
    {
      title: "Open queue",
      value: String(openMeetings),
      change: openMeetings ? `${openMeetings} pending` : "Clear",
      trend: openMeetings ? "down" : "up",
      footerTitle: "Follow-through",
      footerDescription: "Meeting work that still needs attention.",
    },
  ];

  return (
    <AppShell
      workspaceName="Meeting Agent"
      pageTitle="Dashboard"
      pageDescription="Overview"
      userName={displayName}
      userEmail={currentUser?.email || ""}
      deploymentMode={runtimeConfig?.deployment_mode || ""}
      activePath="/app"
      navItems={navItems}
      onCreateMeeting={handleCreateMeeting}
      onSearch={() => navigate("/meetings")}
      onSignOut={isHostedMode && currentUser ? handleSignOut : undefined}
    >
      <div className="mx-auto w-full max-w-7xl space-y-8 pb-8">
        {dashboardError && (
          <div className="rounded-3xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {dashboardError}
          </div>
        )}

        <section className="grid gap-8 xl:grid-cols-[1.4fr_0.6fr]">
          <section className="overflow-hidden rounded-[calc(var(--radius)*3.2)] border border-white/8 bg-[linear-gradient(135deg,hsl(237,43%,18%),hsl(232,63%,41%)_58%,hsl(221,80%,62%))] px-6 py-6 text-white">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full border-0 bg-white/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white">
                Dashboard
              </Badge>
              <Badge variant="secondary" className="rounded-full border-0 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/85">
                {runtimeConfig?.deployment_mode || "workspace"}
              </Badge>
            </div>
            <div className="mt-5 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Keep every meeting moving for {displayName}.
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-white/78 sm:text-base">
                  Start a recording, review the latest decisions, and reopen any workspace without losing the thread.
                  The dashboard now uses the same polished shell and data density as the installed shadcn reference.
                </p>
              </div>
              <div className="grid gap-0 border-y border-white/12 lg:border-y-0 lg:border-l">
                <div className="border-b border-white/12 py-3 lg:pl-6">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Latest workspace signal</div>
                  <div className="mt-2 text-lg font-medium text-white">
                    {sortedMeetings[0]?.title || "No recent meetings yet"}
                  </div>
                </div>
                <div className="border-b border-white/12 py-3 lg:pl-6">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Active queue</div>
                  <div className="mt-2 text-lg font-medium text-white">{openMeetings} meetings still in motion</div>
                </div>
                <div className="py-3 lg:pl-6">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Completed recaps</div>
                  <div className="mt-2 text-lg font-medium text-white">{completedMeetings} summaries ready to review</div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-col items-start gap-3 border-t border-white/10 pt-5 sm:flex-row">
              <button
                type="button"
                onClick={handleCreateMeeting}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "rounded-2xl bg-white text-[#16131f] hover:bg-white/90"
                )}
              >
                Start a meeting
              </button>
              <Link
                to="/meetings"
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "rounded-2xl border-white/20 bg-black/10 text-white hover:bg-white/10 hover:text-white"
                )}
              >
                Open meeting history
              </Link>
            </div>
          </section>

          <aside className="rounded-[calc(var(--radius)*2.8)] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.92),rgba(20,16,26,0.94))] px-6 py-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">Workspace pulse</h2>
              <p className="text-sm leading-7 text-muted-foreground">Shortcuts and guidance for the next action in your meeting workspace.</p>
            </div>
            <div className="mt-6 space-y-6 border-t border-white/8 pt-6">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Next move</div>
                <p className="mt-2 text-sm leading-7 text-foreground">
                  Reopen the latest meeting, review summary-first context, and keep the thread alive without rebuilding state.
                </p>
              </div>
              <div className="border-t border-white/8 pt-6">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Recommended</div>
                <p className="mt-2 text-sm leading-7 text-foreground">
                  Use search from the shell when you need the full history instead of hopping through individual recaps.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-col items-start gap-2 border-t border-white/8 pt-6 text-sm text-muted-foreground">
              <span>Meeting Agent now mirrors the installed dashboard-01 density and spacing.</span>
              <Link to="/meetings" className="font-medium text-primary hover:text-primary/80">
                Open workspace
              </Link>
            </div>
          </aside>
        </section>

        <SectionCards cards={metricCards} />

        <section className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <ChartAreaInteractive meetings={sortedMeetings} />
          <aside className="rounded-[calc(var(--radius)*2.8)] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.92),rgba(20,16,26,0.94))] px-6 py-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">Workspace guide</h2>
              <p className="text-sm leading-7 text-muted-foreground">Keep the dashboard focused on the next useful move instead of a long list of custom cards.</p>
            </div>
            <div className="mt-6 space-y-6 border-t border-white/8 pt-6">
              <div>
                <div className="font-medium">Start a new meeting</div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Capture transcript, summary, and follow-up in one workspace.
                </p>
              </div>
              <div className="border-t border-white/8 pt-6">
                <div className="font-medium">Review team memory</div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  Search recent decisions, action items, and open questions from the shell.
                </p>
              </div>
              <div className="border-t border-white/8 pt-6">
                <div className="font-medium">Return to the right thread</div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  The recent meetings table gives you faster jump-back points than stacked cards.
                </p>
              </div>
            </div>
          </aside>
        </section>

        <section className="space-y-4">
          {bootstrapStatus === "loading" ? (
            <section className="overflow-hidden rounded-[calc(var(--radius)*2.8)] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.92),rgba(20,16,26,0.94))] px-5 py-6">
              <h2 className="text-xl font-semibold tracking-tight">Recent meetings</h2>
              <p className="mt-1 text-sm leading-7 text-muted-foreground">Reopen the last working conversations and restore context in one click.</p>
              <div className="mt-6 border-b border-white/8 pb-6 text-sm text-muted-foreground">Loading recent meetings...</div>
            </section>
          ) : recentMeetings.length > 0 ? (
            <DataTable meetings={recentMeetings} />
          ) : (
            <section className="overflow-hidden rounded-[calc(var(--radius)*2.8)] border border-white/8 bg-[linear-gradient(180deg,rgba(33,26,39,0.92),rgba(20,16,26,0.94))] px-5 py-6">
              <h2 className="text-xl font-semibold tracking-tight">Recent meetings</h2>
              <p className="mt-1 text-sm leading-7 text-muted-foreground">Reopen the last working conversations and restore context in one click.</p>
              <div className="mt-6 border-y border-white/8 py-6">
                  <div className="text-base font-semibold text-foreground">No meetings yet.</div>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    Start a recording from the workspace and the dashboard will begin to fill with meeting summaries,
                    decisions, and follow-up work.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link to="/meetings" className={buttonVariants({ className: "rounded-full" })}>
                      Open workspace
                    </Link>
                    <Link to="/meetings" className={buttonVariants({ variant: "outline", className: "rounded-full" })}>
                      Review meeting history
                    </Link>
                  </div>
                  <div className="mt-5 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
                    <div className="border-l border-white/8 pl-4">Record a live meeting</div>
                    <div className="border-l border-white/8 pl-4">See summary-first updates</div>
                    <div className="border-l border-white/8 pl-4">Return here to reopen the right thread</div>
                  </div>
              </div>
            </section>
          )}
        </section>
      </div>
    </AppShell>
  );
}
