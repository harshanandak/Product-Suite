import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { CircleUserRoundIcon, EllipsisVerticalIcon, LogOutIcon, SparklesIcon } from "lucide-react";

function getFallback(name = "", email = "") {
  const value = name || email || "Meeting Agent";
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function NavUser({ user = {}, onSignOut }) {
  const { isMobile } = useSidebar();
  const name = user.name || "Meeting Agent";
  const email = user.email || "workspace@meeting-agent.app";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="rounded-2xl bg-white/5 aria-expanded:bg-sidebar-accent" />}>
            <Avatar className="size-8 rounded-2xl border border-white/10 bg-sidebar-accent text-sidebar-accent-foreground">
              <AvatarFallback className="rounded-2xl">{getFallback(name, email)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-sidebar-foreground/70">{email}</span>
            </div>
            <EllipsisVerticalIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 border-white/10 bg-[hsl(var(--popover))]" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuLabel className="flex items-center gap-3 p-2">
              <Avatar className="size-9 rounded-2xl border border-border bg-primary/10 text-primary">
                <AvatarFallback className="rounded-2xl">{getFallback(name, email)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <CircleUserRoundIcon className="size-4" />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <SparklesIcon className="size-4" />
                Workspace settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {onSignOut ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOutIcon className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
