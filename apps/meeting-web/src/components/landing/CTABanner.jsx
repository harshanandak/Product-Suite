import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Call-to-action banner with primary background.
 * Dual buttons: "Get started" (secondary) and "Learn more" (outline on primary bg).
 */
export default function CTABanner() {
  return (
    <section
      data-testid="cta-banner-section"
      className="bg-primary text-primary-foreground"
    >
      <div className="mx-auto max-w-3xl px-6 py-16 text-center lg:py-24">
        <h2
          className="text-3xl font-bold tracking-tight md:text-4xl"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Ready to keep every meeting moving?
        </h2>
        <p className="mt-4 text-base leading-relaxed text-primary-foreground/80">
          Start capturing decisions, building team memory, and eliminating
          meeting follow-up overhead -- all in one workspace.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth/sign-in"
            className={buttonVariants({ variant: "secondary", size: "lg" })}
            data-testid="cta-get-started-btn"
          >
            Get started
          </Link>
          <a
            href="#product"
            data-testid="cta-learn-more-btn"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground",
            )}
          >
            Learn more
          </a>
        </div>
      </div>
    </section>
  );
}
