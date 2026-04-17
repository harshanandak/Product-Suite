import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function NavSecondary({ items = [], activePath = "", ...props }) {
  if (!items.length) {
    return null;
  }

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton
                render={item.onClick ? undefined : <a href={item.href} aria-label={item.label} />}
                isActive={activePath === item.href}
                onClick={item.onClick}
                tooltip={item.label}
              >
                {item.icon ? <item.icon /> : null}
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
