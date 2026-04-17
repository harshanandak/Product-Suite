import { Link } from "react-router-dom";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Hero greeting card shown at the top of the dashboard.
 *
 * @param {object} props
 * @param {string} props.displayName - The current user's display name.
 */
export function DashboardGreeting({ displayName }) {
  return (
    <Card className="bg-primary text-primary-foreground">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Keep every meeting moving for {displayName}.
        </CardTitle>
        <CardDescription className="text-primary-foreground/80">
          Start a recording, review the latest decisions, and reopen any
          workspace without losing the thread.
        </CardDescription>
      </CardHeader>

      <div className="flex flex-wrap gap-3 px-6">
        <Link
          to="/meetings/new"
          data-testid="greeting-start-meeting"
          className={buttonVariants({ variant: "secondary" })}
        >
          Start a meeting
        </Link>
        <Link
          to="/meetings"
          data-testid="greeting-open-history"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10",
          )}
        >
          Open meeting history
        </Link>
      </div>
    </Card>
  );
}
