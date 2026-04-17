import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";

const navLinks = [
  { label: "Product", href: "#product" },
  { label: "Workflow", href: "#workflow" },
  { label: "Trust", href: "#trust" },
];

/**
 * Sticky top navigation bar for the landing page.
 * Dark-themed to sit inside the PublicLayout dark background.
 * Hides nav links on mobile, always shows sign-in.
 */
export default function LandingNavbar() {
  return (
    <nav
      data-testid="landing-navbar"
      className="sticky top-0 z-50 w-full border-b border-white/10 bg-foreground/95 backdrop-blur supports-[backdrop-filter]:bg-foreground/80"
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        {/* Brand */}
        <Link
          to="/"
          className="text-lg font-semibold tracking-tight text-background"
          style={{ fontFamily: "var(--font-heading)" }}
          data-testid="landing-brand"
        >
          Meeting Agent
        </Link>

        {/* Desktop nav links */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-background/70 transition-colors hover:text-background"
              data-testid={`nav-link-${link.label.toLowerCase()}`}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Sign in */}
        <Link
          to="/auth/sign-in"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
          data-testid="landing-signin-btn"
        >
          Sign in
        </Link>
      </div>
    </nav>
  );
}
