import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";

import { ThemeProvider, Toaster } from "@product-suite/ui";

import "./styles.css";
import { MemoriesProvider } from "./data/memories";
import { ProposalRepositoryProvider } from "./data/proposals";
import { RepositoryProvider } from "./data/work-items/RepositoryProvider";
import { CLERK_PUBLISHABLE_KEY, hasClerkKey } from "./env";
import { USE_FIXTURES } from "./fixtures-mode";
import { router } from "./router";
import { SetupNotice } from "./shell/SetupNotice";

// React Grab — DEV + PREVIEW only. Hover any UI element and press ⌘/Ctrl-C to
// copy its source context (file · component · stack) to paste into an AI agent.
// Enabled in local dev AND on Cloudflare PREVIEW deploys, where the deploy
// workflow sets VITE_ENABLE_REACT_GRAB=true on the single (Clerk-keyed) build
// for pull requests only. Production builds leave it unset, so this branch is
// statically false and React Grab is tree-shaken out — it must never ship to
// production (it exposes source structure).
if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_REACT_GRAB === "true") {
  // Best-effort: if the chunk is missing/blocked, degrade quietly instead of
  // leaving an unhandled rejection (React Grab is a dev/preview-only nicety).
  void import("react-grab").catch((error: unknown) => {
    console.warn("react-grab failed to load:", error);
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

/**
 * The app tree, minus the ambient providers. Three mutually-exclusive roots,
 * selected with early returns (not a nested ternary):
 *  - DEV-ONLY fixtures/preview: NO ClerkProvider — the repository providers serve
 *    in-memory fixtures and the shell renders without the auth gate, so the
 *    workboard + review inbox are viewable with no backend and no Clerk key
 *    (`bun run dev:fixtures`). USE_FIXTURES is compile-time `false` in production,
 *    so this branch is dead-code-eliminated and prod ALWAYS takes the Clerk path.
 *  - No Clerk key configured → a setup notice.
 *  - Normal: the Clerk-gated app. The network repositories are built ONCE here,
 *    inside Clerk (so they can read the session token) and above the router (so
 *    they never remount on navigation); a read while signed out omits the bearer
 *    and the API answers 401, surfaced through the hook's error state.
 */
function AppRoot() {
  if (USE_FIXTURES) {
    return (
      <RepositoryProvider>
        <ProposalRepositoryProvider>
          <MemoriesProvider>
            <RouterProvider router={router} />
          </MemoriesProvider>
        </ProposalRepositoryProvider>
      </RepositoryProvider>
    );
  }
  if (!hasClerkKey()) {
    return <SetupNotice />;
  }
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      afterSignOutUrl="/sign-in"
      signInFallbackRedirectUrl="/"
    >
      <RepositoryProvider>
        <ProposalRepositoryProvider>
          <MemoriesProvider>
            <RouterProvider router={router} />
          </MemoriesProvider>
        </ProposalRepositoryProvider>
      </RepositoryProvider>
    </ClerkProvider>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    {/* App-wide motion default: honor the OS reduced-motion preference (DESIGN
        section 8). Per-loop useReducedMotion() gates layer on top for the
        animated loops AI Elements / @fluid ship that aren't safe by default. */}
    <MotionConfig reducedMotion="user">
      <ThemeProvider defaultTheme="system">
        <AppRoot />
        {/* Single app-wide toast surface (sonner). Mounted once here, inside the
            ThemeProvider it themes from, so any view can fire `toast(...)` —
            e.g. a failed inline/bulk Workboard edit — and have it announced. */}
        <Toaster />
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
);
