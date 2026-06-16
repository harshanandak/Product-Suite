import * as React from "react";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";

import { useTheme } from "@product-suite/ui";

import { BOARDS, type To, href } from "./boards";
import { toast } from "./toast";

/**
 * Command palette (DESIGN §2: Cmd+K ships in every build). F1 stub: navigation
 * to every board + settings, plus a couple of actions. Open/close and the
 * Cmd+1…5 board shortcuts are owned by the shell; this renders the surface.
 */
export function CommandPalette({
  open,
  onOpenChange,
  workspace,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: string;
}>) {
  const navigate = useNavigate();
  const { toggle } = useTheme();

  const go = React.useCallback(
    (to: To) => {
      onOpenChange(false);
      navigate({ to: href(to, workspace) });
    },
    [navigate, onOpenChange, workspace],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange(false);
        }}
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
                  onOpenChange(false);
                  toast("Agent thread opened");
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
