import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Marquee } from "@/components/ui/marquee";

const testimonials = [
  {
    quote:
      "The product keeps our post-meeting work in one place. No more scattered docs or forgotten follow-ups.",
    author: "Operations lead",
    initials: "OL",
  },
  {
    quote:
      "The dashboard tells you what matters before you even reopen the meeting.",
    author: "Product manager",
    initials: "PM",
  },
  {
    quote:
      "We stopped losing decisions between meetings. Everything is searchable now.",
    author: "Engineering lead",
    initials: "EL",
  },
  {
    quote:
      "The workflow memory is what sold us. No more dead-end meeting notes.",
    author: "VP of Product",
    initials: "VP",
  },
];

/**
 * Testimonial section with scrolling Marquee of cards.
 * Split layout: heading left, marquee right on large screens.
 */
export default function TestimonialCards() {
  return (
    <section
      id="trust"
      data-testid="testimonial-section"
      className="bg-secondary text-foreground"
    >
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_2fr] lg:gap-16">
          {/* Left -- Heading */}
          <div>
            <span className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Trust
            </span>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight md:text-4xl"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Trusted by teams that ship.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Hear from teams who replaced scattered meeting notes with a single
              intelligent workspace.
            </p>
          </div>

          {/* Right -- Marquee */}
          <div className="relative overflow-hidden">
            <Marquee pauseOnHover className="[--duration:35s]">
              {testimonials.map(({ quote, author, initials }) => (
                <Card
                  key={author}
                  className="w-72 shrink-0 bg-card shadow-sm"
                  data-testid={`testimonial-card-${initials.toLowerCase()}`}
                >
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      &ldquo;{quote}&rdquo;
                    </p>
                  </CardContent>
                  <CardFooter className="gap-3">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {initials}
                    </div>
                    <span className="text-sm font-medium">{author}</span>
                  </CardFooter>
                </Card>
              ))}
            </Marquee>
          </div>
        </div>
      </div>
    </section>
  );
}
