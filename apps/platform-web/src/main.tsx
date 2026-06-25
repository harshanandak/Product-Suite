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

// React Grab — DEV ONLY. Hover any UI element and press ⌘/Ctrl-C to copy its
// source context (file path · component · stack) to paste into an AI agent.
// Dynamically imported behind `import.meta.env.DEV` so it is tree-shaken out of
// production builds entirely — it must never ship (it exposes source structure).
if (import.meta.env.DEV) {
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
