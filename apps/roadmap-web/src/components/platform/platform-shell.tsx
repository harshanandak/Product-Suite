import type { ReactNode } from "react";

import { ModuleSwitcher } from "./module-switcher";

type PlatformShellProps = {
  activePath: string;
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
};

export function PlatformShell({
  activePath,
  title,
  eyebrow,
  description,
  children,
}: PlatformShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)]">
        <ModuleSwitcher activePath={activePath} />
        <main className="min-w-0">
          <header className="border-b border-slate-200 bg-white px-6 py-5">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">
                {eyebrow}
              </p>
            ) : null}
            <div className="mt-1 max-w-3xl">
              <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
                {title}
              </h1>
              {description ? (
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {description}
                </p>
              ) : null}
            </div>
          </header>
          <section className="px-6 py-6">{children}</section>
        </main>
      </div>
    </div>
  );
}
