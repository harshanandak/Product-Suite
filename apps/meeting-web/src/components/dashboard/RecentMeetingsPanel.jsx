import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RecentMeetingCard } from "./RecentMeetingCard";
import { cn } from "@/lib/utils";

/**
 * Panel that lists recent meetings with loading, empty, and populated states.
 *
 * @param {object}   props
 * @param {Array}    props.meetings        - Array of meeting objects ({id, title, summary, href}).
 * @param {string}   props.bootstrapStatus - "loading" | "ready" | any other string.
 */
export function RecentMeetingsPanel({ meetings = [], bootstrapStatus }) {
  const isLoading = bootstrapStatus === "loading";
  const isEmpty = !isLoading && meetings.length === 0;
  const hasMeetings = !isLoading && meetings.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Overview
        </div>
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl">
            Recent meetings
          </CardTitle>
          <Link
            to="/meetings"
            className="text-sm text-primary hover:underline"
            data-testid="view-all-meetings"
          >
            View all
          </Link>
        </div>
        <CardDescription>
          Your latest meetings and their summaries.
        </CardDescription>
      </CardHeader>

      <Separator />

      <CardContent className="pt-6">
        {/* Loading state */}
        {isLoading && (
          <p className="text-sm text-muted-foreground">
            Loading recent meetings...
          </p>
        )}

        {/* Empty state */}
        {isEmpty && (
          <Card className="border-dashed">
            <CardContent className="pt-6 text-center">
              <h3 className="font-heading text-xl font-semibold text-foreground">
                No meetings yet.
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Start a recording from the workspace and the dashboard will begin to fill with meeting summaries,
                decisions, and follow-up work.
              </p>

              <div className="mt-6 flex justify-center gap-3">
                <Link
                  to="/meetings"
                  data-testid="empty-open-workspace"
                  className={buttonVariants({})}
                >
                  Open workspace
                </Link>
                <Link
                  to="/meetings"
                  data-testid="empty-review-history"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  Review meeting history
                </Link>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-md border border-border p-4 text-left">
                  <div className="text-sm font-medium text-foreground">
                    Transcripts
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Automatic speech-to-text for every meeting.
                  </p>
                </div>
                <div className="rounded-md border border-border p-4 text-left">
                  <div className="text-sm font-medium text-foreground">
                    Summaries
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    AI-generated meeting summaries and key points.
                  </p>
                </div>
                <div className="rounded-md border border-border p-4 text-left">
                  <div className="text-sm font-medium text-foreground">
                    Action items
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Follow-ups extracted and assigned automatically.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Populated state */}
        {hasMeetings && (
          <div className="grid gap-4 md:grid-cols-2">
            {meetings.map((meeting) => (
              <RecentMeetingCard
                key={meeting.id}
                title={meeting.title || "Untitled meeting"}
                summary={`${meeting.duration_seconds || 0}s captured`}
                href={`/meetings/${meeting.id}`}
                status={meeting.status || "created"}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
