import { BarChart3, CalendarDays, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";

const DEFAULT_NAV_ITEMS = [
  { href: "/app", label: "Dashboard", icon: BarChart3 },
  { href: "/meetings", label: "Meetings", icon: CalendarDays },
  { href: "/meetings", label: "Search", icon: Search },
];

export function AppShellSidebar({
  brand = "Meeting Agent",
  // eslint-disable-next-line no-unused-vars
  title = "Workspace",
  subtitle = "Meeting intelligence",
  deploymentMode = "",
  navItems = DEFAULT_NAV_ITEMS,
  activePath = "/app",
  onCreateMeeting,
}) {
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="data-[slot=sidebar-menu-button]:p-1.5!">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Sparkles size={16} />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">{brand}</span>
                <span className="text-xs text-muted-foreground">{subtitle}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {deploymentMode ? (
          <Badge variant="secondary" className="mx-3 w-fit text-[10px] uppercase tracking-[0.18em]">
            {deploymentMode} mode
          </Badge>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon;

                if (item.onClick) {
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={activePath === item.href}
                        onClick={item.onClick}
                        data-testid={`nav-item-${item.label.toLowerCase()}`}
                      >
                        {Icon && <Icon size={16} />}
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      render={<a href={item.href} aria-label={item.label} />}
                      isActive={activePath === item.href}
                      data-testid={`nav-item-${item.label.toLowerCase()}`}
                    >
                      {Icon && <Icon size={16} />}
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {onCreateMeeting && (
          <Button
            onClick={onCreateMeeting}
            className="w-full"
            data-testid="create-meeting-btn"
          >
            New meeting
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
