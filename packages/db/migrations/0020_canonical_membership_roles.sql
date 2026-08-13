ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_role_canonical"
  CHECK ("role" IN ('viewer', 'member', 'admin', 'owner'));
