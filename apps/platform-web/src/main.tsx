import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "@tanstack/react-router";

import { ThemeProvider } from "@product-suite/ui";

import "./styles.css";
import { CLERK_PUBLISHABLE_KEY, hasClerkKey } from "./env";
import { router } from "./router";
import { SetupNotice } from "./shell/SetupNotice";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
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
  </StrictMode>,
);
