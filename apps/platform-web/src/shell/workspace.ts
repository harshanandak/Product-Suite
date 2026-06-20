import { DEFAULT_WORKSPACE } from "../env";

/**
 * The workspace slug for the active Clerk organization. Model A (DESIGN §12:
 * "Clerk orgs → platform workspaces"): the org IS the workspace, 1:1, so the
 * org's slug is the workspace slug. Falls back to the configured default when
 * there is no active org or it has no slug yet — e.g. signed-out, or the brief
 * pre-org bootstrap before Clerk resolves the session.
 */
export function workspaceSlugFromOrg(
  organization?: { slug?: string | null } | null,
): string {
  const slug = organization?.slug?.trim();
  return slug ? slug : DEFAULT_WORKSPACE;
}
