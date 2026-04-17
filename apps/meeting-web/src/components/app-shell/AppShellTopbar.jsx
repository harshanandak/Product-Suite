import { ChevronRight, LogOut, Search, Settings2 } from "lucide-react";

export function AppShellTopbar({
  workspaceName = "Workspace",
  pageTitle = "Dashboard",
  pageDescription = "Overview",
  userEmail = "",
  deploymentMode = "",
  onSearch,
  onSettings,
  onSignOut,
}) {
  const hasActions = Boolean(onSearch || onSettings || onSignOut);

  return (
    <header className="sticky top-0 z-20 border-b border-[#E5E7EB] bg-white/85 px-4 py-4 backdrop-blur-xl sm:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-[0.24em] text-[#94A3B8] sm:text-[10px]">
            <span className="truncate">{workspaceName}</span>
            <ChevronRight size={12} className="shrink-0" />
            <span className="truncate">{pageDescription}</span>
          </div>
          <h1
            className="mt-2 truncate text-2xl font-semibold tracking-tight text-[#0A0A0A] sm:text-3xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {pageTitle}
          </h1>
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {deploymentMode ? (
              <span className="max-w-full truncate rounded-full border border-[#DDE3F0] bg-[#FBFDFF] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#64748B]">
                {deploymentMode}
              </span>
            ) : null}
            {userEmail ? (
              <span className="max-w-full truncate rounded-full border border-[#DDE3F0] bg-[#FBFDFF] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#64748B]">
                {userEmail}
              </span>
            ) : null}
          </div>

          {hasActions ? (
            <div className="grid w-full gap-2 sm:flex sm:flex-wrap sm:items-center lg:w-auto">
              {onSearch ? (
                <button
                  type="button"
                  onClick={onSearch}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#DDE3F0] bg-white px-4 py-2.5 text-sm text-[#334155] transition hover:border-[#C7D2FE] hover:bg-[#FBFBFD] sm:w-auto"
                >
                  <Search size={15} />
                  Search
                </button>
              ) : null}
              {onSettings ? (
                <button
                  type="button"
                  onClick={onSettings}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[#DDE3F0] bg-white px-4 py-2.5 text-sm text-[#334155] transition hover:border-[#C7D2FE] hover:bg-[#FBFBFD] sm:w-auto"
                >
                  <Settings2 size={15} />
                  Settings
                </button>
              ) : null}
              {onSignOut ? (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#111827] px-4 py-2.5 text-sm text-white transition hover:bg-[#1f2937] sm:w-auto"
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
