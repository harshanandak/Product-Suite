"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { PlatformShell } from "@/components/platform/platform-shell";
import {
  getPlatformModuleById,
  resolvePlatformModule,
} from "@/lib/platform/module-registry";

type PlatformLayoutProps = {
  children: ReactNode;
};

export default function PlatformLayout({ children }: PlatformLayoutProps) {
  const pathname = usePathname() ?? "/roadmap";
  const activeModule = resolvePlatformModule(pathname);
  const moduleDefinition = activeModule
    ? getPlatformModuleById(activeModule.id)
    : undefined;

  return (
    <PlatformShell
      activePath={pathname}
      eyebrow="Product Suite"
      title={moduleDefinition?.label ?? "Product Suite"}
      description={
        moduleDefinition?.description ??
        "Navigate Product Suite modules from a single shell."
      }
    >
      {children}
    </PlatformShell>
  );
}
