import * as React from "react";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";

import { useTheme } from "@product-suite/ui";

import { useAskAgent } from "@/agent-chat/ask-agent";

import { BOARDS, type To, href } from "./boards";
import {
  getDefaultRepository,
  useRepositoryContext,
  type WorkItem,
  type WorkItemRepository,
} from "../data/work-items";

/**
 * Command palette (DESIGN §2: Cmd+K ships in every build). F1 stub: navigation
 * to every board + settings, plus a couple of actions. Open/close and the
 * Cmd+1…5 board shortcuts are owned by the shell; this renders the surface.
 */
export function CommandPalette({
  open,
  onOpenChange,
  workspace,
  repository,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: string;
  /** Injectable seam for tests; defaults to the provider/module repository. */
  repository?: WorkItemRepository;
}>) {
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const askAgent = useAskAgent();

  // Resolve the repository once (injected prop wins, else the provider's repo,
  // else the module singleton) — the useWorkItems/useTeams convention.
  const contextRepository = useRepositoryContext();
  const [repo] = React.useState<WorkItemRepository>(
    () => repository ?? contextRepository ?? getDefaultRepository(),
  );

  // Work items feeding the palette's "Work items" group. Loaded once per open
  // transition so ⌘K search always reflects the current set.
  const [workItems, setWorkItems] = React.useState<WorkItem[]>([]);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    repo
      .list()
      .then((items) => {
        if (!cancelled) setWorkItems(items);
      })
      .catch(() => {
        if (!cancelled) setWorkItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repo]);

  const go = React.useCallback(
    (to: To) => {
      onOpenChange(false);
      navigate({ to: href(to, workspace) });
    },
    [navigate, onOpenChange, workspace],
  );

  const dialogRef = React.useRef<HTMLDivElement>(null);

  // Restore focus to the invoking control when the palette closes (DESIGN §8).
  React.useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    return () => trigger?.focus?.();
  }, [open]);

  // Escape closes; Tab is trapped within the dialog so focus cannot reach the
  // inert chrome behind the backdrop (DESIGN §8: focus trapped in dialogs).
  const onDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onOpenChange],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-overlay/40 p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onDialogKeyDown}
        className="relative w-full max-w-lg overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <Command label="Command palette" className="flex flex-col">
          <Command.Input
            autoFocus
            placeholder="Search boards, actions, agents…"
            className="w-full border-b border-border bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {workItems.length > 0 && (
              <Command.Group
                heading="Work items"
                className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {workItems.map((item) => (
                  <Command.Item
                    key={item.id}
                    // Fold the id into the value so cmdk matches BOTH the title
                    // text and a typed/pasted id (open-by-id, no special-casing).
                    value={`${item.id} ${item.title}`}
                    onSelect={() => {
                      onOpenChange(false);
                      navigate({
                        to: "/w/$workspace/workboard/item/$itemId",
                        params: { workspace, itemId: item.id },
                      });
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    {item.title}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group
              heading="Boards"
              className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {BOARDS.map((board) => (
                <Command.Item
                  key={board.id}
                  value={`Go to ${board.label}`}
                  onSelect={() => go(board.entry)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <board.icon className="size-4" />
                  {board.label}
                </Command.Item>
              ))}
              <Command.Item
                value="Go to Settings"
                onSelect={() => go("/w/$workspace/settings")}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                Settings
              </Command.Item>
            </Command.Group>

            <Command.Group
              heading="Actions"
              className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              <Command.Item
                value="Log a decision"
                onSelect={() => {
                  onOpenChange(false);
                  navigate({
                    to: "/w/$workspace/memory",
                    params: { workspace },
                    search: { new: true },
                  });
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                Log a decision
              </Command.Item>
              <Command.Item
                value="Toggle theme (dark / light)"
                onSelect={() => {
                  onOpenChange(false);
                  toggle();
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                Toggle theme
              </Command.Item>
              <Command.Item
                value="Ask agent"
                onSelect={() => {
                  // Close the palette FIRST so the two overlays never stack,
                  // then open + focus the agent chat via the single invocation
                  // seam (see useAskAgent). Invoking while it's already open just
                  // re-focuses the input — no toggle-closed surprise.
                  onOpenChange(false);
                  askAgent();
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                Ask agent
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
