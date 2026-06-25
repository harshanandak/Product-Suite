import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";

import { ThemeProvider } from "@product-suite/ui";

import "./styles.css";
import { CLERK_PUBLISHABLE_KEY, hasClerkKey } from "./env";
import { router } from "./router";
import { SetupNotice } from "./shell/SetupNotice";

// React Grab — DEV + PREVIEW only. Hover any UI element and press ⌘/Ctrl-C to
// copy its source context (file · component · stack) to paste into an AI agent.
// Enabled in local dev AND on Cloudflare PREVIEW deploys (built with
// `--mode preview` → import.meta.env.MODE === "preview"). Production builds
// (mode "production") statically evaluate this to `false`, so React Grab is
// tree-shaken out entirely — it must never ship to prod (it exposes source).
if (import.meta.env.DEV || import.meta.env.MODE === "preview") {
  void import("react-grab");
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    {/* App-wide motion default: honor the OS reduced-motion preference (DESIGN
        section 8). Per-loop useReducedMotion() gates layer on top for the
        animated loops AI Elements / @fluid ship that aren't safe by default. */}
    <MotionConfig reducedMotion="user">
      <ThemeProvider defaultTheme="system">
        {hasClerkKey() ? (
          <ClerkProvider
            publishableKey={CLERK_PUBLISHABLE_KEY}
            signInUrl="/sign-in"
            afterSignOutUrl="/sign-in"
            signInFallbackRedirectUrl="/"
          >
            <RouterProvider router={router} />
          </ClerkProvider>
        ) : (
          <SetupNotice />
        )}
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
);
