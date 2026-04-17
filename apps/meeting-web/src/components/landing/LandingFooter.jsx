import { Link } from "react-router-dom";
import { Separator } from "@/components/ui/separator";

const footerLinks = [
  { label: "Product", href: "#product" },
  { label: "Workflow", href: "#workflow" },
  { label: "Trust", href: "#trust" },
  { label: "Sign in", href: "/auth/sign-in", isRoute: true },
];

/**
 * Dark landing page footer with brand, navigation links, and copyright.
 */
export default function LandingFooter() {
  return (
    <footer
      data-testid="landing-footer"
      className="text-white"
      style={{ background: 'hsl(280, 5%, 8%)' }}
    >
      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Top row */}
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          {/* Brand */}
          <span
            className="text-lg font-semibold tracking-tight text-white"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Meeting Agent
          </span>

          {/* Nav links */}
          <nav className="flex flex-wrap gap-6" data-testid="footer-nav">
            {footerLinks.map(({ label, href, isRoute }) =>
              isRoute ? (
                <Link
                  key={label}
                  to={href}
                  className="text-sm text-white/60 transition-colors hover:text-white"
                >
                  {label}
                </Link>
              ) : (
                <a
                  key={label}
                  href={href}
                  className="text-sm text-white/60 transition-colors hover:text-white"
                >
                  {label}
                </a>
              )
            )}
          </nav>
        </div>

        <Separator className="my-8 bg-white/10" />

        {/* Copyright */}
        <p className="text-xs text-white/40">
          &copy; 2024 Meeting Agent. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
