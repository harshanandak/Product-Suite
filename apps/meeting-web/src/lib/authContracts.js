import { validateAuthClaims } from "@product-suite/contracts";

export function mapHostedSessionToAuthClaims(input = {}) {
  const session = input.session ?? input;
  const user = session.user ?? input.user ?? {};
  const organization = session.organization ?? input.organization ?? {};
  const workspaceId = input.workspaceId ?? session.workspaceId ?? session.workspace_id;

  return validateAuthClaims({
    provider: "hosted",
    subject: user.id,
    email: user.email,
    display_name: user.name ?? user.displayName ?? user.display_name,
    tenant_id: organization.id ?? organization.organization_id ?? organization.tenant_id,
    workspace_ids: workspaceId ? [workspaceId] : [],
  });
}
