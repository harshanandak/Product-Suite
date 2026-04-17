import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { FileText, Users, Search } from "lucide-react";

const features = [
  {
    icon: FileText,
    title: "Summaries that stay useful",
    description:
      "Live meeting context rolls forward into recaps, follow-up prompts, and searchable retrieval.",
  },
  {
    icon: Users,
    title: "Decisions with owners",
    description:
      "Highlight what changed, who owns the next step, and what is still unresolved.",
  },
  {
    icon: Search,
    title: "Searchable team memory",
    description:
      "Bring transcript lines, summaries, and meeting state into one retrieval workflow.",
  },
];

/**
 * Three-column feature grid section.
 * Uses bg-secondary for contrast against the surrounding sections.
 */
export default function FeatureGrid() {
  return (
    <section
      id="product"
      data-testid="feature-grid-section"
      className="bg-secondary text-foreground"
    >
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
        {/* Header */}
        <div className="mb-14 max-w-2xl">
          <span className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Product
          </span>
          <h2
            className="mt-3 text-3xl font-bold tracking-tight md:text-4xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Keep work moving 24/7.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Meeting Agent turns every conversation into structured, searchable
            knowledge -- so decisions never get lost and follow-ups never fall
            through the cracks.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="bg-card shadow-md hover:shadow-lg transition-shadow border-t-2 border-t-primary/30">
              <CardHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="size-5 text-primary" />
                </div>
                <CardTitle
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
