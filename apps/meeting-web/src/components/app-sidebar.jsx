import { Badge } from "@/components/ui/badge";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail } from "@/components/ui/sidebar";
import { NavDocuments } from "@/components/nav-documents";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { CalendarDaysIcon, CommandIcon, LayoutDashboardIcon } from "lucide-react";
import { Link } from "react-router-dom";

const FALLBACK_NAV_ITEMS = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/meetings", label: "Meetings", icon: CalendarDaysIcon },
];

const DEFAULT_DOCUMENTS = [];

const DEFAULT_SECONDARY = [];

function withIcons(items) {
  return items.map((item) => {
    if (item.icon) {
      return item;
    }

    if (item.href === "/app" || item.label === "Dashboard") {
      return { ...item, icon: LayoutDashboardIcon };
    }

    if (item.href === "/meetings" || item.label === "Meetings") {
      return { ...item, icon: CalendarDaysIcon };
    }

    return { ...item, icon: CommandIcon };
  });
}

export function AppSidebar({
  brand = "Meeting Agent",
  subtitle = "Meeting intelligence",
  deploymentMode = "",
  navItems = FALLBACK_NAV_ITEMS,
  activePath = "/app",
  onCreateMeeting,
  user,
  onSignOut,
  documents = DEFAULT_DOCUMENTS,
  secondaryItems = DEFAULT_SECONDARY,
}) {
  return (
    <Sidebar collapsible="icon" variant="inset" className="border-r border-sidebar-border/80">
      <SidebarHeader className="gap-4 px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="data-[slot=sidebar-menu-button]:p-2" size="lg" render={<Link to="/app" aria-label={brand} />}>
              <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(58,94,255,0.3)]">
                <CommandIcon className="size-5" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-base font-semibold">{brand}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">{subtitle}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {deploymentMode ? (
          <Badge variant="secondary" className="mx-2 w-fit rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/75 group-data-[collapsible=icon]:hidden">
            {deploymentMode} mode
          </Badge>
        ) : null}
      </SidebarHeader>
      <SidebarContent className="px-2 pb-2">
        <NavMain items={withIcons(navItems)} activePath={activePath} onCreateMeeting={onCreateMeeting} />
        <NavDocuments items={withIcons(documents)} activePath={activePath} />
        <NavSecondary items={withIcons(secondaryItems)} activePath={activePath} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="px-3 py-4">
        <NavUser user={user} onSignOut={onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
