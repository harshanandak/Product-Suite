export { cn } from "./lib/cn";

// shadcn registry components (UI-revamp Workstream A — product-suite-o1g)
export * from "./components/avatar";
export * from "./components/badge";
export * from "./components/button";
export * from "./components/button-group";
export * from "./components/card";
export * from "./components/checkbox";
export * from "./components/command";
export * from "./components/dialog";
export * from "./components/dropdown-menu";
export * from "./components/hover-card";
export * from "./components/input";
export * from "./components/input-group";
export * from "./components/label";
export * from "./components/scroll-area";
export * from "./components/select";
export * from "./components/separator";
export * from "./components/sheet";
export * from "./components/sidebar";
export * from "./components/skeleton";
export * from "./components/sonner";
export * from "./components/spinner";
export * from "./components/table";
export * from "./components/tabs";
export * from "./components/textarea";
export * from "./components/tooltip";

// Suite-specific components (owned, not from a registry)
export { PhasePill, PHASE_LABELS } from "./components/phase-pill";
export type { Phase, PhasePillProps } from "./components/phase-pill";

export { PhaseSelect, PHASE_SELECT_OPTIONS } from "./components/phase-select";
export type { PhaseSelectProps } from "./components/phase-select";

export { StatusPill, STATUS_LABELS } from "./components/status-pill";
export type { TaskStatus, StatusPillProps } from "./components/status-pill";

export { HealthBadge, HEALTH_LABELS } from "./components/health-badge";
export type { Health, HealthBadgeProps } from "./components/health-badge";

export {
  PriorityBadge,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
} from "./components/priority-badge";
export type { Priority, PriorityBadgeProps } from "./components/priority-badge";

export {
  PrioritySelect,
  PRIORITY_SELECT_OPTIONS,
} from "./components/priority-select";
export type { PrioritySelectProps } from "./components/priority-select";

export {
  WorkItemTypeBadge,
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
} from "./components/work-item-type-badge";
export type {
  WorkItemType,
  WorkItemTypeBadgeProps,
} from "./components/work-item-type-badge";

export {
  WorkItemTypeSelect,
  WORK_ITEM_TYPE_SELECT_OPTIONS,
} from "./components/work-item-type-select";
export type { WorkItemTypeSelectProps } from "./components/work-item-type-select";

export {
  ProvenanceChip,
  WORK_ITEM_SOURCE_LABELS,
} from "./components/provenance-chip";
export type {
  WorkItemSource,
  ProvenanceChipProps,
} from "./components/provenance-chip";

export {
  AssigneePicker,
  ASSIGNEE_UNASSIGNED_VALUE,
} from "./components/assignee-picker";
export type { Assignee, AssigneePickerProps } from "./components/assignee-picker";

export {
  TagInput,
  TagList,
  addTagValue,
  removeTagValue,
} from "./components/tag-input";
export type { TagInputProps, TagListProps } from "./components/tag-input";

export { EmptyState } from "./components/empty-state";
export type { EmptyStateProps } from "./components/empty-state";

export { ErrorState } from "./components/error-state";
export type { ErrorStateProps } from "./components/error-state";

export { ThemeProvider, useTheme, applyTheme } from "./components/theme-provider";
export type { Theme, ResolvedTheme } from "./components/theme-provider";

export { ThemeToggle } from "./components/theme-toggle";
export { useIsMobile } from "./hooks/use-mobile";
