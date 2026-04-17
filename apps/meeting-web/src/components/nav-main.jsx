import { PlusIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function NavMain({ items = [], activePath = "", onCreateMeeting }) {
  return (
    <SidebarGroup className="gap-3">
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarGroupContent className="flex flex-col gap-3">
        {onCreateMeeting ? (
          <Button className="justify-start gap-2 rounded-2xl bg-primary shadow-[0_12px_28px_rgba(58,94,255,0.25)] hover:bg-primary/90" onClick={onCreateMeeting}>
            <PlusIcon className="size-4" />
            <span>New meeting</span>
          </Button>
        ) : null}
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton
                render={item.onClick ? undefined : <Link to={item.href} aria-label={item.label} />}
                isActive={activePath === item.href}
                onClick={item.onClick}
                tooltip={item.label}
              >
                {item.icon ? <item.icon /> : null}
                <span>{item.label}</span>
              </SidebarMenuButton>
              {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
