export const MEMBERSHIP_ROLE_VALUES = ["viewer", "member", "admin", "owner"];

const MEMBERSHIP_ROLES = new Set(MEMBERSHIP_ROLE_VALUES);

export function isMembershipRole(value) {
  return typeof value === "string" && MEMBERSHIP_ROLES.has(value);
}

export function parseMembershipRole(value) {
  if (!isMembershipRole(value)) {
    throw new TypeError("Invalid membership role");
  }
  return value;
}
