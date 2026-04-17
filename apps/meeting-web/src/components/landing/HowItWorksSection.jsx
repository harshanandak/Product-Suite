import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Search, NotebookPen } from "lucide-react";

const workflows = [
  {
    icon: Search,
    title: "One search for everything",
    description:
      "Bring transcript retrieval and summaries together. Find any decision, action item, or discussion point across all your meetings in seconds.",
    accentClass: "bg-destructive/10",
    iconAccent: "text-destructive",
  },
  {
    icon: NotebookPen,
    title: "Perfect notes, every time",
    description:
      "Keep chapters, chat, and generated follow-up in the same workspace. No more copying between tools or losing context between sessions.",
    accentClass: "bg-primary/10",
    iconAccent: "text-primary",
  },
];

/**
 * How-it-works section with split heading and workflow cards.
 */
export default function HowItWorksSection() {
  return (
    <section
      id="workflow"
      data-testid="how-it-works-section"
      className="bg-background text-foreground"
    >
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
        {/* Split header */}
        <div className="mb-14 grid gap-6 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Workflow
            </span>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight md:text-4xl"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              How it works.
            </h2>
          </div>
          <p className="self-end text-base leading-relaxed text-muted-foreground">
            Meeting Agent integrates into your existing workflow -- joining
            calls, capturing context, and surfacing the information you need
            before you ask for it.
          </p>
        </div>

        {/* Workflow cards */}
        <div className="grid gap-6 lg:grid-cols-2">
          {workflows.map(
            ({ icon: Icon, title, description, accentClass, iconAccent }) => (
              <Card key={title} className={cn("border-0 shadow-sm", accentClass)}>
                <CardHeader>
                  <div
                    className={cn(
                      "mb-2 flex size-10 items-center justify-center rounded-xl",
                      accentClass
                    )}
                  >
                    <Icon className={cn("size-5", iconAccent)} />
                  </div>
                  <CardTitle style={{ fontFamily: "var(--font-heading)" }}>
                    {title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">
                    {description}
                  </CardDescription>
                </CardContent>
              </Card>
            )
          )}
        </div>
      </div>
    </section>
  );
}
