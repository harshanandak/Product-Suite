/**
 * Workboard data-seam vocabulary — a THIN, TRANSPARENT re-import (move ②).
 *
 * The core object model (Project, Owner, WorkItem, Check, WorkItemDependency,
 * ActivityEvent, WorkItemPatch, WorkItemRow), its provenance/source, the two
 * closed sets it carries (DependencyRelationship, ActivityEventKind), and the
 * derived-health helper now live framework-neutral in `@product-suite/contracts`
 * (DESIGN §5), so the Python backend + SDK share ONE artifact instead of forking
 * a copy. This file stays as platform-web's import site so every current
 * consumer keeps working UNCHANGED — the public surface is identical to before.
 *
 * The enum TYPES (`Phase`, `CheckStatus`, `Health`, `Priority`, `WorkItemType`,
 * `WorkItemSource`) are re-exported from `@product-suite/ui` (the app's single UI
 * vocabulary surface — DESIGN §5). Contracts is their ultimate source; ui
 * re-exports them, and platform-web reads them through ui exactly as before.
 *
 * Hard rules the model encodes (DESIGN §1 / §3 / §11):
 *  - `phase` lives on WORK ITEMS only; `status` lives on CHECKS only.
 *  - `health` is DERIVED client-side, never stored (see {@link deriveHealth}).
 *  - `project_id` is nullable: a work item may have no project.
 *  - Timestamp fields are ISO-8601 strings — no `Date` crosses the seam.
 */
export type {
  Health,
  Phase,
  Priority,
  CheckStatus,
  WorkItemSource,
  WorkItemType,
} from "@product-suite/ui";

export type {
  ActivityEvent,
  ActivityEventKind,
  DependencyRelationship,
  Owner,
  Project,
  Status,
  StatusCategory,
  Check,
  WorkItem,
  WorkItemDependency,
  WorkItemPatch,
  WorkItemRow,
} from "@product-suite/contracts";

export { deriveHealth } from "@product-suite/contracts";
