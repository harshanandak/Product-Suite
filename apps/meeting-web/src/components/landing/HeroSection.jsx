import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mic, FileText, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

const featurePills = [
  "Real-time transcription",
  "AI-powered summaries",
  "Searchable memory",
];

const infoBoxes = [
  {
    icon: Mic,
    overline: "Capture",
    text: "Every word, every speaker, every meeting -- captured automatically.",
  },
  {
    icon: FileText,
    overline: "Summaries",
    text: "Actionable recaps generated the moment the meeting ends.",
  },
  {
    icon: Brain,
    overline: "Memory",
    text: "Retrieval-ready context that compounds across sessions.",
  },
];

/**
 * Hero section for the landing page.
 * Full-width dark section with left-right grid layout on large screens.
 *
 * @param {{ authCheckStatus?: string }} props
 */
export default function HeroSection({ authCheckStatus }) {
  const getStatusText = () => {
    if (authCheckStatus === "redirecting") {
      return "Redirecting to your workspace...";
    }
    if (authCheckStatus === "checking") {
      return "Checking authentication status...";
    }
    return "Your meeting intelligence workspace is ready.";
  };

  return (
    <section
      data-testid="hero-section"
      className="relative w-full text-white"
      style={{ background: 'linear-gradient(135deg, hsl(280, 5%, 8%) 0%, hsl(231, 60%, 25%) 50%, hsl(231, 76%, 34%) 100%)' }}
    >
      <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        {/* Main grid */}
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left -- Content */}
          <div className="flex flex-col gap-6">
            {/* Overline */}
            <span
              className="font-mono text-xs font-medium uppercase tracking-widest text-white/50"
              data-testid="hero-overline"
            >
              Meeting Intelligence Platform
            </span>

            {/* Auth status */}
            <p className="text-sm text-white/60" data-testid="hero-auth-status">
              {getStatusText()}
            </p>

            {/* Heading */}
            <h1
              className="text-5xl font-bold leading-tight tracking-tight text-white md:text-6xl"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Meet the night shift.
            </h1>

            {/* Body */}
            <p className="max-w-lg text-base leading-relaxed text-white/70">
              Meeting Agent captures every conversation, extracts decisions, and
              builds a searchable knowledge base -- so your team can move
              forward without looking back.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/auth/sign-in"
                className={buttonVariants({ size: "lg" })}
                data-testid="hero-cta-signin"
              >
                Sign in to workspace
              </Link>
              <a
                href="#workflow"
                data-testid="hero-cta-workflow"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white",
                )}
              >
                Preview workflow
              </a>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2">
              {featurePills.map((pill) => (
                <Badge
                  key={pill}
                  variant="secondary"
                  className="bg-white/10 text-white/80"
                >
                  {pill}
                </Badge>
              ))}
            </div>
          </div>

          {/* Right -- Product preview mockup */}
          <div className="hidden lg:block">
            <Card className="bg-background text-foreground shadow-2xl ring-1 ring-white/10">
              <CardHeader>
                <CardTitle
                  style={{ fontFamily: "var(--font-heading)" }}
                  className="text-sm font-semibold"
                >
                  Workspace Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  {/* Sidebar mock */}
                  <div className="col-span-1 flex flex-col gap-3 rounded-xl border border-border p-3">
                    <div className="h-3 w-full rounded-full bg-muted" />
                    <div className="h-3 w-3/4 rounded-full bg-muted" />
                    <div className="h-3 w-5/6 rounded-full bg-primary/20" />
                    <div className="h-3 w-2/3 rounded-full bg-muted" />
                    <div className="h-3 w-4/5 rounded-full bg-muted" />
                    <div className="mt-auto h-3 w-1/2 rounded-full bg-muted" />
                  </div>

                  {/* Live meeting panel mock */}
                  <div className="col-span-2 flex flex-col gap-3 rounded-xl border border-border p-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-block size-2 animate-pulse rounded-full bg-destructive" />
                      <span className="text-xs font-medium text-destructive">
                        Live Meeting
                      </span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-muted" />
                    <div className="h-3 w-5/6 rounded-full bg-muted" />
                    <div className="h-3 w-4/6 rounded-full bg-primary/15" />
                    <div className="h-3 w-full rounded-full bg-muted" />
                    <div className="h-3 w-3/4 rounded-full bg-muted" />
                    <div className="mt-2 flex gap-2">
                      <div className="h-6 w-16 rounded-md bg-primary/10" />
                      <div className="h-6 w-20 rounded-md bg-muted" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Info boxes */}
        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {infoBoxes.map(({ icon: Icon, overline, text }) => (
            <div
              key={overline}
              className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/20">
                <Icon className="size-5 text-primary" />
              </div>
              <span className="font-mono text-xs font-medium uppercase tracking-widest text-white/50">
                {overline}
              </span>
              <p className="text-sm leading-relaxed text-white/70">
                {text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
