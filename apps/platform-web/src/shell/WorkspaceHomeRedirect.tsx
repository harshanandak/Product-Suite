import { useOrganization } from "@clerk/clerk-react";
import { Navigate } from "@tanstack/react-router";

import { workspaceSlugFromOrg } from "./workspace";

/**
 * Index ("/") redirect: lands the signed-in user in their active workspace.
 * Model A (DESIGN §12: "Clerk orgs → platform workspaces"): the Clerk org IS
 * the workspace, 1:1, so route by the active org's slug rather than a hardcoded
 * default. Wait for Clerk to resolve before deciding — redirecting while the
 * session is still loading would bounce the user to the default and strand them
 * away from their own org.
 */
export function WorkspaceHomeRedirect() {
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
