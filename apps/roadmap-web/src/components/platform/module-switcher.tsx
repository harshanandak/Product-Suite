import {
  Bot,
  CalendarDays,
  LayoutDashboard,
  Map,
  PanelsTopLeft,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  getPlatformModules,
  resolvePlatformModule,
  type PlatformModuleId,
} from "@/lib/platform/module-registry";
import { cn } from "@/lib/utils";

const moduleIcons: Record<PlatformModuleId, LucideIcon> = {
  meetings: CalendarDays,
  roadmap: Map,
  canvas: PanelsTopLeft,
  agents: Bot,
  settings: Settings,
};

type ModuleSwitcherProps = Readonly<{
  activePath: string;
  className?: string;
}>;

export function ModuleSwitcher({ activePath, className }: ModuleSwitcherProps) {
  const activeModule = resolvePlatformModule(activePath);

  return (
    <nav
      aria-label="Product Suite modules"
      className={cn(
        "flex flex-col gap-1 border-r border-slate-200 bg-white px-3 py-4 text-sm",
        className,
      )}
    >
      <a
        href="/roadmap"
        className="mb-3 flex items-center gap-2 rounded-md px-2 py-2 font-semibold text-slate-950"
      >
        <LayoutDashboard aria-hidden="true" className="size-4" />
        Product Suite
      </a>
      {getPlatformModules().map((module) => {
        const Icon = moduleIcons[module.id];
        const isActive = activeModule?.id === module.id;
        const isReserved = module.status === "reserved";
        const itemClassName = cn(
          "flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-slate-700 transition-colors",
          isActive && "bg-slate-950 text-white",
          !isActive && !isReserved && "hover:bg-slate-100 hover:text-slate-950",
          isReserved && "cursor-not-allowed text-slate-500",
        );
        const itemContent = (
          <>
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{module.label}</span>
              {isReserved ? (
                <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-normal text-slate-500">
                  Coming soon
                </span>
              ) : null}
            </span>
          </>
        );

        return isReserved ? (
          <span
            key={module.id}
            aria-current={isActive ? "page" : undefined}
            aria-disabled="true"
            className={itemClassName}
          >
            {itemContent}
          </span>
        ) : (
          <a
            key={module.id}
            href={module.href}
            aria-current={isActive ? "page" : undefined}
            className={itemClassName}
          >
            {itemContent}
          </a>
        );
      })}
    </nav>
  );
}
