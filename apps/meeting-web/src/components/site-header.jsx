import { SearchIcon, Settings2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader({
  workspaceName = "Meeting Agent",
  pageTitle = "Dashboard",
  pageDescription = "Overview",
  userEmail = "",
  deploymentMode = "",
  onSearch,
  onSettings,
  onSignOut,
}) {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-height)] shrink-0 items-center border-b border-white/6 bg-[rgba(18,14,22,0.82)] backdrop-blur-xl">
      <div className="flex w-full items-center gap-3 px-4 md:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 hidden h-4 bg-white/10 sm:block" />
        <div className="min-w-0 flex-1">
          <Breadcrumb>
            <BreadcrumbList className="text-xs uppercase tracking-[0.18em] text-muted-foreground/80">
              <BreadcrumbItem>{workspaceName}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{pageDescription}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="truncate font-heading text-xl font-semibold tracking-tight sm:text-2xl">{pageTitle}</h1>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          {deploymentMode ? (
            <Badge variant="secondary" className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-foreground/90">
              {deploymentMode}
            </Badge>
          ) : null}
          {userEmail ? (
            <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-foreground/80">
              {userEmail}
            </Badge>
          ) : null}
          {onSearch ? (
            <Button variant="outline" size="sm" className="border-white/10 bg-white/5 hover:bg-white/10" onClick={onSearch}>
              <SearchIcon className="size-4" />
              Search
            </Button>
          ) : null}
          {onSettings ? (
            <Button variant="outline" size="sm" className="border-white/10 bg-white/5 hover:bg-white/10" onClick={onSettings}>
              <Settings2Icon className="size-4" />
              Settings
            </Button>
          ) : null}
          {onSignOut ? (
            <Button size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
