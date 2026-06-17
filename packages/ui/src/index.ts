export { cn } from "./lib/cn";

// shadcn registry components (UI-revamp Workstream A — product-suite-o1g)
export * from "./components/avatar";
export * from "./components/badge";
export * from "./components/button";
export * from "./components/card";
export * from "./components/command";
export * from "./components/dialog";
export * from "./components/dropdown-menu";
export * from "./components/input";
export * from "./components/label";
export * from "./components/scroll-area";
export * from "./components/select";
export * from "./components/separator";
export * from "./components/sheet";
export * from "./components/sidebar";
export * from "./components/skeleton";
export * from "./components/sonner";
export * from "./components/table";
export * from "./components/tabs";
export * from "./components/tooltip";

// Suite-specific components (owned, not from a registry)
export { PhasePill, PHASE_LABELS } from "./components/phase-pill";
export type { Phase, PhasePillProps } from "./components/phase-pill";

export { StatusPill, STATUS_LABELS } from "./components/status-pill";
export type { TaskStatus, StatusPillProps } from "./components/status-pill";

export { HealthBadge, HEALTH_LABELS } from "./components/health-badge";
export type { Health, HealthBadgeProps } from "./components/health-badge";

export { EmptyState } from "./components/empty-state";
export type { EmptyStateProps } from "./components/empty-state";

export { ErrorState } from "./components/error-state";
export type { ErrorStateProps } from "./components/error-state";

export { ThemeProvider, useTheme, applyTheme } from "./components/theme-provider";
export type { Theme, ResolvedTheme } from "./components/theme-provider";

export { ThemeToggle } from "./components/theme-toggle";
export { useIsMobile } from "./hooks/use-mobile";
