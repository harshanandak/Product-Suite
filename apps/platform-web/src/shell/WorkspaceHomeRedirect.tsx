import {
  RedirectToSignIn,
  SignedIn,
  SignedOut,
  useOrganization,
} from "@clerk/clerk-react";
import { Navigate } from "@tanstack/react-router";

import { USE_FIXTURES } from "@/fixtures-mode";

import { DEFAULT_WORKSPACE } from "../env";
import { workspaceSlugFromOrg } from "./workspace";

/**
 * Resolves the active Clerk org to its workspace and redirects there. Model A
 * (DESIGN §12: "Clerk orgs → platform workspaces"): the org IS the workspace,
 * 1:1. Only mounted behind the SignedIn guard (see WorkspaceHomeRedirect) so
 * useOrganization always has a session — calling it signed-out makes Clerk warn.
 * Waits for org data to load before deciding; redirecting mid-load would bounce
 * the user to the default and strand them away from their own org.
 */
export function ActiveWorkspaceRedirect() {
  const { organization, isLoaded } = useOrganization();
  if (!isLoaded) {
    return (
      <output className="block space-y-3 p-6" aria-label="Loading workspace">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
      </output>
    );
  }
  return (
    <Navigate
      to="/w/$workspace"
      params={{ workspace: workspaceSlugFromOrg(organization) }}
      replace
    />
  );
}

/**
 * Index ("/") route component. Signed-in users are routed to their active
 * workspace; signed-out users go to sign-in. The org lookup lives behind the
 * SignedIn guard so useOrganization is never invoked without a session.
 */
export function WorkspaceHomeRedirect() {
  // DEV-ONLY fixtures/preview: there is no Clerk session/org to resolve, so land
  // straight on the default workspace. USE_FIXTURES folds to `false` in
  // production, so this branch is dead-code-eliminated (see fixtures-mode.ts).
  if (USE_FIXTURES) {
    return (
      <Navigate
        to="/w/$workspace"
        params={{ workspace: DEFAULT_WORKSPACE }}
        replace
      />
    );
  }
  return (
    <>
      <SignedIn>
        <ActiveWorkspaceRedirect />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
