import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";

import { ThemeProvider, Toaster } from "@product-suite/ui";

import "./styles.css";
import { AppRoot } from "./AppRoot";

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
