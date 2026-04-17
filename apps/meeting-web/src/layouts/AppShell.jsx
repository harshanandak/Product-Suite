import * as React from "react";
import { useHotkeySequence, useHotkeys } from "@tanstack/react-hotkeys";
import { Toaster } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AppShell({
  children,
  workspaceName = "Meeting Agent",
  pageTitle = "Workspace",
  pageDescription = "Overview",
  userName = "",
  userEmail = "",
  deploymentMode = "",
  activePath = "/app",
  navItems,
  onCreateMeeting,
  onSearch,
  onSettings,
  onSignOut,
}) {
  const secondaryItems = [];
  const handleCreateMeeting = React.useCallback(() => {
    onCreateMeeting?.();
  }, [onCreateMeeting]);
  const handleSearch = React.useCallback(() => {
    onSearch?.();
  }, [onSearch]);
  const navigateTo = React.useCallback(
    (path) => {
      if (typeof window === "undefined") {
        return;
      }

      if (window.location.pathname !== path) {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    },
    [],
  );

  useHotkeys(
    [
      {
        hotkey: "/",
        callback: () => handleSearch(),
        options: { enabled: Boolean(onSearch) },
      },
      {
        hotkey: "Mod+K",
        callback: () => handleSearch(),
        options: { enabled: Boolean(onSearch) },
      },
      {
        hotkey: "n",
        callback: () => handleCreateMeeting(),
        options: { enabled: Boolean(onCreateMeeting) },
      },
      {
        hotkey: "Mod+Shift+N",
        callback: () => handleCreateMeeting(),
        options: { enabled: Boolean(onCreateMeeting) },
      },
    ],
    { preventDefault: true },
  );

  useHotkeySequence(["G", "D"], () => navigateTo("/app"));
  useHotkeySequence(["G", "M"], () => navigateTo("/meetings"));

  if (onSearch) {
    secondaryItems.push({
      label: "Search",
      onClick: onSearch,
    });
  }

  if (onSettings) {
    secondaryItems.push({
      label: "Settings",
      onClick: onSettings,
    });
  }

  return (
    <div className="dark min-h-screen bg-[radial-gradient(circle_at_top,_hsl(228,32%,16%),_hsl(284,18%,7%)_55%)] text-foreground">
      <Toaster position="top-right" richColors />
      <SidebarProvider style={{ "--header-height": "4.5rem" }}>
        <AppSidebar
          brand={workspaceName}
          subtitle="Meeting intelligence"
          deploymentMode={deploymentMode}
          navItems={navItems}
          activePath={activePath}
          onCreateMeeting={onCreateMeeting}
          secondaryItems={secondaryItems}
          user={{
            name: userName || workspaceName,
            email: userEmail,
          }}
          onSignOut={onSignOut}
        />
        <SidebarInset>
          <SiteHeader
            workspaceName={workspaceName}
            pageTitle={pageTitle}
            pageDescription={pageDescription}
            userEmail={userEmail}
            deploymentMode={deploymentMode}
            onSearch={onSearch}
            onSettings={onSettings}
            onSignOut={onSignOut}
          />
          <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:px-6 md:py-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
