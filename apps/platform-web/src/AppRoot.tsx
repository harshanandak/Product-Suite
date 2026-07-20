import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "@tanstack/react-router";

import { MemoriesProvider } from "./data/memories";
import { MemoryImpactProvider } from "./data/memory-impact";
import { ProposalRepositoryProvider } from "./data/proposals";
import { RepositoryProvider } from "./data/work-items/RepositoryProvider";
import { CLERK_PUBLISHABLE_KEY, hasClerkKey } from "./env";
import { USE_FIXTURES } from "./fixtures-mode";
import { router } from "./router";
import { SetupNotice } from "./shell/SetupNotice";

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
export function AppRoot() {
  if (USE_FIXTURES) {
    return (
      <RepositoryProvider>
        <ProposalRepositoryProvider>
          <MemoriesProvider>
            <MemoryImpactProvider>
              <RouterProvider router={router} />
            </MemoryImpactProvider>
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
            <MemoryImpactProvider>
              <RouterProvider router={router} />
            </MemoryImpactProvider>
          </MemoriesProvider>
        </ProposalRepositoryProvider>
      </RepositoryProvider>
    </ClerkProvider>
  );
}
