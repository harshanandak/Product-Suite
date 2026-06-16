import { Link, useParams } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";

import { cn } from "@product-suite/ui";

import { DEFAULT_WORKSPACE } from "../env";
import { href, workspaceDisplayName } from "./boards";

/**
 * Workspace switcher — top of the left rail (DESIGN §2). Identity affordance:
 * avatar + name + chevron. Stable on every screen; switching workspace keeps
 * the active board. (The switch menu is a later lane; the chevron advertises it.)
 */
export function WorkspaceSwitcher() {
  const { workspace } = useParams({ strict: false }) as { workspace?: string };
  const slug = workspace ?? DEFAULT_WORKSPACE;
  const name = workspaceDisplayName(slug);
  const initials = name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Link
      to={href("/w/$workspace", slug)}
      aria-label={`${name} workspace`}
      className={cn(
        "flex items-center gap-2 border-b border-sidebar-border px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent/50",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground"
      >
        {initials}
      </span>
      <span className="truncate font-medium text-sidebar-foreground">{name}</span>
      <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
