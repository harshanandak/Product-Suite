export interface IdentityScopeContract {
  module: "identity";
  auth: {
    providerKey: string;
    requiredKey: string;
    modeKey: string;
    supportedProvidersKey: string;
    organizationRequiredKey: string;
    onboardingRequiredKey: string;
    hostedAuthUrlKey: string;
  };
  deployment: {
    deploymentModeKey: string;
    tenantModeKey: string;
    backendUrlKey: string;
  };
}

export interface AuthCoreContract {
  module: "auth";
  claims: {
    shape: "AuthClaims";
    requiredKeys: string[];
    optionalKeys: string[];
  };
  tokenVerifier: {
    shape: "TokenVerifier";
    inputKey: string;
    outputKey: string;
    failureKey: string;
  };
  sessionBridge: {
    shape: "SessionBridge";
    stateKey: string;
    claimsKey: string;
    tokenKey: string;
  };
  workspaceAccessResolver: {
    shape: "WorkspaceAccessResolver";
    workspaceIdKey: string;
    claimsKey: string;
    resultKey: string;
  };
  supabaseRls: {
    shape: "PlatformSupabaseRlsContract";
    claimsKey: string;
  };
}

export interface ClerkEnvironmentContract {
  provider: "clerk";
  keys: {
    publishableKey: string;
    secretKey: string;
    issuer: string;
    audience: string;
    authorizedParties: string;
    signInUrl: string;
    signUpUrl: string;
    signInFallbackRedirectUrl: string;
    signUpFallbackRedirectUrl: string;
  };
  routes: {
    publicRoutes: string[];
    protectedPrefixes: string[];
    callbackPath: string;
    allowedRedirectPrefixes: readonly string[];
  };
  runtimeModes: {
    local: string;
    preview: string;
    production: string;
  };
}

export interface AuthRedirectContract {
  returnToKey: string;
  signatureKey: string;
  moduleHintKey: string;
  workspaceHintKey: string;
  callbackPath: string;
  signInPath: string;
  signUpPath: string;
  allowedRedirectPrefixes: readonly string[];
}

export interface ClerkJwtVerificationContract {
  tokenSources: {
    authorizationHeader: string;
    sessionCookie: string;
  };
  authorizationScheme: string;
  algorithms: string[];
  requiredClaims: string[];
  authorizedPartyClaim: string;
  jwks: {
    keyIdClaim: string;
    cacheKey: string;
  };
}

export interface PlatformSupabaseRlsContract {
  provider: "clerk";
  jwtTemplate: string;
  rlsIdentitySource: string;
  claims: {
    internalUserId: string;
    internalWorkspaceId: string;
    internalMembershipId: string;
    externalSubject: string;
    externalOrganizationId: string;
    issuer: string;
    audience: string;
  };
  allowedBrowserSchemas: readonly string[];
  privateSchemas: readonly string[];
  supabaseManagedSchemas: readonly string[];
  disallowedAssumptions: readonly string[];
}

export interface PlatformIdentitySyncContract {
  provider: "clerk";
  user: {
    internalUserIdKey: string;
    externalProviderKey: string;
    externalProviderIdKey: string;
    externalUserIdKey: string;
    emailKey: string;
    displayNameKey: string;
  };
  workspace: {
    internalWorkspaceIdKey: string;
    externalProviderKey: string;
    externalProviderIdKey: string;
    externalOrganizationIdKey: string;
    nameKey: string;
    disabledAtKey: string;
  };
  membership: {
    internalMembershipIdKey: string;
    internalUserIdKey: string;
    internalWorkspaceIdKey: string;
    externalUserIdKey: string;
    externalOrganizationIdKey: string;
    roleKey: string;
    statusKey: string;
    lastSyncedAtKey: string;
  };
  sync: {
    idempotencyKey: string;
    reconciliationMode: string;
    softDeleteMode: string;
  };
  scope: {
    createsSchemaMigrations: boolean;
  };
}

export interface PlatformEventIdentityContract {
  identity: {
    userIdKey: string;
    workspaceIdKey: string;
    membershipIdKey: string;
  };
  context: {
    moduleKey: string;
    eventNameKey: string;
    acquisitionSourceKey: string;
    pricingVariantKey: string;
  };
  scope: {
    implementsAnalyticsSink: boolean;
  };
}

export interface AuthClaims {
  provider: string;
  subject: string;
  issuer?: string;
  audience?: string[];
  authorized_party?: string;
  email?: string;
  display_name?: string;
  tenant_id?: string;
  workspace_ids?: string[];
  roles?: string[];
  permissions?: string[];
  issued_at?: number | string;
  expires_at?: number | string;
  jwt_id?: string;
  provider_claims?: Record<string, unknown>;
}

export type AuthClaimsValidationResult =
  | {
      ok: true;
      claims: AuthClaims;
    }
  | {
      ok: false;
      error: {
        code: "AUTH_CLAIMS_INVALID";
        missing: string[];
      };
    };

export interface ClerkEnvironment {
  provider: "clerk";
  publishableKey: string;
  secretKeyConfigured: boolean;
  issuer?: string;
  audience: string[];
  authorizedParties: string[];
  signInUrl?: string;
  signUpUrl?: string;
  signInFallbackRedirectUrl?: string;
  signUpFallbackRedirectUrl?: string;
  publicRoutes: string[];
  protectedPrefixes: string[];
  callbackPath: string;
  allowedRedirectPrefixes: string[];
}

export type ClerkEnvironmentValidationResult =
  | {
      ok: true;
      environment: ClerkEnvironment;
    }
  | {
      ok: false;
      error: {
        code: "CLERK_ENV_INVALID";
        missing: string[];
      };
    };

export interface AuthReturnIntent {
  returnTo: string;
  moduleHint?: string;
  workspaceHint?: string;
}

export type AuthReturnIntentValidationResult =
  | {
      ok: true;
      intent: AuthReturnIntent;
    }
  | {
      ok: false;
      error: {
        code: "AUTH_RETURN_INTENT_INVALID";
        reason:
          | "MISSING_RETURN_TO"
          | "SIGNATURE_MISMATCH"
          | "EXTERNAL_RETURN_URL"
          | "RETURN_LOOP"
          | "RETURN_PREFIX_NOT_ALLOWED";
      };
    };

export type ClerkSessionTokenExtractionResult =
  | {
      ok: true;
      token: string;
      source: string;
    }
  | {
      ok: false;
      error: {
        code: "CLERK_SESSION_TOKEN_MISSING";
      };
    };

export type ClerkJwtPayloadValidationResult =
  | AuthClaimsValidationResult
  | {
      ok: false;
      error: {
        code: "CLERK_JWT_INVALID";
        reason:
          | "PAYLOAD_INVALID"
          | "MISSING_CLAIM"
          | "ISSUER_MISMATCH"
          | "AUDIENCE_MISMATCH"
          | "TOKEN_EXPIRED"
          | "TOKEN_NOT_YET_VALID"
          | "AUTHORIZED_PARTY_MISMATCH";
        claim?: string;
      };
    };

export interface ConversationContract {
  module: "conversation";
  thread: {
    table: string;
    idKey: string;
    workspaceIdKey: string;
    teamIdKey: string;
    titleKey: string;
    statusKey: string;
    metadataKey: string;
    createdAtKey: string;
    updatedAtKey: string;
    createdByKey: string;
  };
  message: {
    table: string;
    idKey: string;
    threadIdKey: string;
    roleKey: string;
    contentKey: string;
    partsKey: string;
    metadataKey: string;
    toolInvocationsKey: string;
    modelUsedKey: string;
    createdAtKey: string;
  };
}

export interface MeetingCoreContract {
  module: "meeting";
  runtimeConfig: {
    deploymentModeKey: string;
    tenantModeKey: string;
    backendUrlKey: string;
    capabilitiesKey: string;
    enginesKey: string;
    auth: {
      requiredKey: string;
      modeKey: string;
      providerKey: string;
      supportedProvidersKey: string;
      organizationRequiredKey: string;
      onboardingRequiredKey: string;
      neonAuthUrlKey: string;
    };
    database: {
      providerKey: string;
    };
    storage: {
      backendKey: string;
      audioArchivalEnabledKey: string;
    };
    summaryPolicy: {
      rawAudioRetentionDaysKey: string;
      transcriptRetentionDaysKey: string;
      derivedRetentionDaysKey: string;
      stateWindowSecondsKey: string;
      chapterWindowSecondsKey: string;
      inactivityTimeoutSecondsKey: string;
      fullTranscriptRetainedKey: string;
    };
    retrievalPolicy: {
      historyCorpusKey: string;
      rankingProfileKey: string;
    };
  };
}

export interface CanvasCoreContract {
  module: "canvas";
  document: {
    table: string;
    idKey: string;
    workspaceIdKey: string;
    teamIdKey: string;
    documentTypeKey: string;
    storagePathKey: string;
    storageSizeBytesKey: string;
    syncVersionKey: string;
    activeEditorsKey: string;
    lastSyncAtKey: string;
    titleKey: string;
    createdAtKey: string;
    updatedAtKey: string;
  };
}

export const identityScopeContract: IdentityScopeContract;
export const authCoreContract: AuthCoreContract;
export const authRedirectContract: AuthRedirectContract;
export const clerkEnvironmentContract: ClerkEnvironmentContract;
export const clerkJwtVerificationContract: ClerkJwtVerificationContract;
export const platformIdentitySyncContract: PlatformIdentitySyncContract;
export const platformEventIdentityContract: PlatformEventIdentityContract;
export const platformSupabaseRlsContract: PlatformSupabaseRlsContract;
export function extractClerkSessionToken(input: unknown): ClerkSessionTokenExtractionResult;
export function validateAuthClaims(
  input: unknown,
  options?: { requireClerkVerification?: boolean },
): AuthClaimsValidationResult;
export function validateAuthReturnIntent(
  input: unknown,
  options: { expectedSignature: string },
): AuthReturnIntentValidationResult;
export function validateClerkEnvironment(
  input: unknown,
  options?: { protectedRuntime?: boolean },
): ClerkEnvironmentValidationResult;
export function validateClerkJwtPayload(
  payload: unknown,
  options?: {
    issuer?: string;
    audience?: string | string[];
    authorizedParties?: string[];
    now?: number;
  },
): ClerkJwtPayloadValidationResult;
export const conversationContract: ConversationContract;
export const meetingCoreContract: MeetingCoreContract;
export const canvasCoreContract: CanvasCoreContract;

// ---------------------------------------------------------------------------
// Domain enums (DESIGN §5). Framework-neutral vocabularies shared by the React
// UI, the Python backend, and the SDK. Runtime values live in `./enums.js`; the
// canonical JSON mirror is `../contracts/enums.json`. The union members below
// MUST stay in lockstep with both — `enums.test.ts` fails on drift.
// ---------------------------------------------------------------------------

/** Universal work-item phase loop (§1 / §5). */
export type Phase = "plan" | "execute" | "review" | "done";
/** Task / agent-run status triad — never on work items (§5 / §11). */
export type TaskStatus = "todo" | "in_progress" | "completed";
/** Derived work-item health — never stored (§3 / §5). */
export type Health = "on_track" | "at_risk" | "blocked";
/** Stored work-item priority / severity (§5 / §11). */
export type Priority = "critical" | "high" | "medium" | "low";
/** Kind of work a work item represents (§5 / §11). */
export type WorkItemType = "feature" | "bug" | "chore" | "research";
/** Work-item provenance — where an object came from (§5 / §11). */
export type WorkItemSource = "manual" | "meeting" | "agent" | "feedback";

export const PHASE_VALUES: readonly Phase[];
export const PHASE_LABELS: Record<Phase, string>;
export const PHASE_ORDER: readonly Phase[];
export const TASK_STATUS_VALUES: readonly TaskStatus[];
export const STATUS_LABELS: Record<TaskStatus, string>;
export const TASK_STATUS_ORDER: readonly TaskStatus[];
export const HEALTH_VALUES: readonly Health[];
export const HEALTH_LABELS: Record<Health, string>;
export const HEALTH_ORDER: readonly Health[];
export const PRIORITY_VALUES: readonly Priority[];
export const PRIORITY_LABELS: Record<Priority, string>;
export const PRIORITY_ORDER: readonly Priority[];
export const WORK_ITEM_TYPE_VALUES: readonly WorkItemType[];
export const WORK_ITEM_TYPE_LABELS: Record<WorkItemType, string>;
export const WORK_ITEM_TYPE_ORDER: readonly WorkItemType[];
export const WORK_ITEM_SOURCE_VALUES: readonly WorkItemSource[];
export const WORK_ITEM_SOURCE_LABELS: Record<WorkItemSource, string>;
export const WORK_ITEM_SOURCE_ORDER: readonly WorkItemSource[];
export const ASSIGNEE_UNASSIGNED_VALUE: "__unassigned__";

export interface EnumDescriptor<T extends string> {
  values: readonly T[];
  labels: Record<T, string>;
  order: readonly T[];
}

export const enums: {
  phase: EnumDescriptor<Phase>;
  taskStatus: EnumDescriptor<TaskStatus>;
  health: EnumDescriptor<Health>;
  priority: EnumDescriptor<Priority>;
  workItemType: EnumDescriptor<WorkItemType>;
  workItemSource: EnumDescriptor<WorkItemSource>;
  assignee: { unassignedValue: typeof ASSIGNEE_UNASSIGNED_VALUE };
};

// ---------------------------------------------------------------------------
// Work-item core vocabulary (DESIGN §1 / §2 / §11). Framework-neutral object
// model shared by the React UI, the Python backend, and the SDK. Runtime values
// + `deriveHealth` live in `./work-items.js`; the canonical JSON mirror is
// `../contracts/work-items-core.json`. The unions/const below MUST stay in
// lockstep with both — `work-items.test.ts` fails on drift.
//
// Timestamp fields are ISO-8601 strings (e.g. `2026-06-20T09:30:00.000Z`) —
// plain `string` keeps the model JSON-friendly across the transport seam.
// ---------------------------------------------------------------------------

/** Relationship kind on a dependency edge; v1 renders only `depends_on` (§10). */
export type DependencyRelationship = "depends_on" | "blocks" | "complements";
/** The kind of change an {@link ActivityEvent} records (drives the feed icon). */
export type ActivityEventKind =
  | "created"
  | "updated"
  | "dependency_added"
  | "dependency_removed";
/**
 * Immutable status CATEGORY — the closed set every {@link Status} maps to. A team
 * customizes a status's NAME and order, never its category; all rollups /
 * automation read the category, never the name. `triage` is reserved for the
 * integration/agent inbox. Mirrors the DB `status_category` enum.
 */
export type StatusCategory =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "triage";

/**
 * A project — top of the object ladder (§1). A "category of work as one
 * switchable thing". Projects never carry a phase — a project's stage is derived
 * from the distribution of its items' phases (§1 phase-ownership rule).
 */
export interface Project {
  readonly id: string;
  name: string;
  /** Project kind drives playbook/department defaults (§1 / §11). */
  kind: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A team — the mandatory owner/partition WITHIN an org (promoted from the old
 * free-text `WorkItem.department`). Every work item belongs to exactly one team
 * via its required `team_id`; teams belong to exactly one tenant (org). Unlike
 * {@link Project}, a Team carries its `tenant_id` on the wire (its members are in
 * that org already, so it is not a cross-tenant leak — it anchors the team to its
 * org for the picker).
 */
export interface Team {
  readonly id: string;
  /** The owning org (= workspace = tenant). Server-owned. */
  readonly tenant_id: string;
  name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A status — a team's named workflow state. Each maps to exactly one immutable
 * {@link StatusCategory}; the team customizes the `name` and order (`position`),
 * never the category. A work item's lifecycle state is its required `status_id`
 * (one of its owning team's statuses), superseding the deprecated `phase`. The
 * `team_id` is server-owned and scopes the status to its team.
 */
export interface Status {
  readonly id: string;
  /** The owning {@link Team} id. Server-owned. */
  readonly team_id: string;
  name: string;
  /** The immutable category this status maps to (drives every rollup). */
  category: StatusCategory;
  /** Sort order within the team's board (ascending). */
  position: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A person who can own a work item — the resolved display target for an item's
 * `assignee_id` (§1 owner concept). The store holds only `assignee_id`; views
 * resolve id → {@link Owner} via the `owners` lookup (never embed the owner on
 * the row).
 */
export interface Owner {
  /** Stable internal id — matches a work item's `assignee_id`. Never a provider id. */
  readonly id: string;
  /** Display name shown in pickers / the owner column. */
  name: string;
  /** Optional 1–2 char initials; the picker derives them from `name` when omitted. */
  initials?: string;
}

/**
 * A work item — the coalition hub (§1, middle of the object ladder).
 *
 * Carries `phase` (the only stored lifecycle on a work item) and a
 * workspace-defined `department` for swimlanes. `project_id` is nullable
 * (containment is optional at every level — §1 / §11). There is deliberately
 * NO `status` field and NO stored `health`.
 */
export interface WorkItem {
  readonly id: string;
  title: string;
  /** Free-form brief / description (plain text); absent or `""` = none. Editable. */
  description?: string;
  /** Universal phase loop `plan → execute → review → done` (§1). */
  phase: Phase;
  /** Kind of work — drives the Type column / filter (§11 playbook resolution). */
  type: WorkItemType;
  /** Severity used for the Priority column / sort (critical → low). */
  priority: Priority;
  /** Free-form labels shown in the Tags column; `[]` when none (never null). */
  tags: string[];
  /** Provenance — how the item entered the board (manual/meeting/agent/feedback). */
  source: WorkItemSource;
  /** Nullable — a work item may belong to no project (§1 / §11). */
  project_id: string | null;
  /**
   * The owning {@link Team} id — MANDATORY (every work item belongs to exactly
   * one team). Promoted from the free-text `department`, which is retained
   * (deprecated) for one contract cycle for back-compat.
   */
  team_id: string;
  /**
   * The owning team's {@link Status} id — MANDATORY (every work item has exactly
   * one workflow state). Must belong to the item's `team_id`. Supersedes the
   * deprecated `phase`, whose category-equivalent it now drives.
   */
  status_id: string;
  /**
   * Optional PARENT work item — a Task is a work item with a parent (the owned
   * child tier). `null` at top level. A child inherits its parent's `team_id`;
   * native creation is depth-capped at 1 (a parent must itself be top-level).
   * The self-FK is ON DELETE RESTRICT: a parent that still has sub-items cannot
   * be hard-deleted until they are detached (children are never auto-orphaned).
   */
  parent_id: string | null;
  /**
   * Materialized tree depth (0 = top-level, 1 = a Task under a parent).
   * Server-derived from `parent_id` — never accepted in a create/patch body.
   */
  readonly depth: number;
  /** @deprecated Workspace-defined department NAME (superseded by `team_id`); still populated for back-compat (§1). */
  department: string;
  /** Owner of the item, or `null` when routed to a department queue (§1). */
  assignee_id: string | null;
  /** Optional due date; feeds derived health (overdue → at risk/blocked). */
  due_date: string | null;
  /** Soft-archived (deactivated) flag. NOT a lifecycle status. Absent ⇒ active. */
  archived?: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A task — the atom (§1, bottom of the object ladder). One action one person
 * takes, with the fixed three-state {@link TaskStatus} lifecycle. Lives under a
 * work item (its `work_item_id`).
 */
export interface Task {
  readonly id: string;
  work_item_id: string;
  title: string;
  /** Task status triad (§1 / §11) — never appears on work items. */
  status: TaskStatus;
  /** Optional due date; an overdue incomplete task raises item health. */
  due_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * An append-only activity record for a work item — emitted by the repository on
 * every mutation and read back by the detail page's Activity tab. Never edited;
 * `summary` is a pre-rendered one-liner so the view stays dumb.
 */
export interface ActivityEvent {
  readonly id: string;
  work_item_id: string;
  kind: ActivityEventKind;
  /** Human-readable one-liner, e.g. "Phase set to Done". */
  summary: string;
  readonly created_at: string;
}

/**
 * A directed dependency edge between two work items — the graph view's edge
 * record (DESIGN §10). Semantics: `source_item_id` **depends on**
 * `target_item_id` (the source cannot finish until the target does); the arrow
 * points source → target. The pair is unique, self-edges are disallowed, and the
 * directed graph must stay acyclic (dagre layout requires a DAG).
 */
export interface WorkItemDependency {
  readonly id: string;
  /** The dependent work item (the one that is blocked). */
  source_item_id: string;
  /** The prerequisite work item (`source` depends on this). */
  target_item_id: string;
  /** Relationship kind; v1 default `depends_on`. */
  relationship_type: DependencyRelationship;
  readonly created_at: string;
}

/**
 * The editable surface of a work item, shared VERBATIM by the repository
 * `update`, the hook, and the Editor. Excludes managed fields (`id`, timestamps)
 * and the derived `health`. `source` is deliberately EXCLUDED — provenance is
 * recorded once at creation and is display-only.
 */
export type WorkItemPatch = Partial<
  Pick<
    WorkItem,
    | "title"
    | "description"
    | "phase"
    | "type"
    | "priority"
    | "tags"
    | "project_id"
    | "team_id"
    | "status_id"
    | "parent_id"
    | "department"
    | "assignee_id"
    | "due_date"
    | "archived"
  >
>;

/**
 * The Table/list view-model row: a {@link WorkItem} plus its read-time derived
 * health and task roll-up counts. Health stays computed-on-read, never stored.
 */
export interface WorkItemRow extends WorkItem {
  /** Derived per {@link deriveHealth} at read time — never persisted. */
  readonly health: Health;
  /** Total tasks under this item. */
  readonly taskCount: number;
  /** Tasks whose status is `completed`. */
  readonly completedTaskCount: number;
}

/** A field descriptor in {@link workItemsCore} — a language-neutral shape spec. */
export interface WorkItemsCoreFieldDescriptor {
  type: "string" | "boolean" | "number" | "string[]" | { kind: "enum"; enum: string };
  nullable?: boolean;
  optional?: boolean;
  readonly?: boolean;
}

/** One object's field map in {@link workItemsCore}. */
export interface WorkItemsCoreObject {
  fields: Record<string, WorkItemsCoreFieldDescriptor>;
}

/** Shape of the canonical {@link workItemsCore} artifact. */
export interface WorkItemsCore {
  dependencyRelationship: {
    values: readonly DependencyRelationship[];
    default: DependencyRelationship;
  };
  activityEventKind: { values: readonly ActivityEventKind[] };
  statusCategory: { values: readonly StatusCategory[] };
  workItemPatchFields: readonly (keyof WorkItemPatch)[];
  taskPatchFields: readonly ("title" | "status" | "due_date")[];
  objects: Record<
    | "Project"
    | "Team"
    | "Status"
    | "Owner"
    | "WorkItem"
    | "Task"
    | "ActivityEvent"
    | "WorkItemDependency",
    WorkItemsCoreObject
  >;
}

export const DEPENDENCY_RELATIONSHIP_VALUES: readonly DependencyRelationship[];
export const DEPENDENCY_RELATIONSHIP_DEFAULT: DependencyRelationship;
export const ACTIVITY_EVENT_KIND_VALUES: readonly ActivityEventKind[];
export const STATUS_CATEGORY_VALUES: readonly StatusCategory[];
export const WORK_ITEM_PATCH_FIELDS: readonly (keyof WorkItemPatch)[];
export const TASK_PATCH_FIELDS: readonly ("title" | "status" | "due_date")[];
export const workItemsCore: WorkItemsCore;

/**
 * Pure health derivation (DESIGN §1 / §3 — health is ALWAYS derived, never
 * stored). Maps `(workItem, tasks)` to a {@link Health} value. `now` is injected
 * (defaulted to `Date.now()`) so callers and tests stay deterministic.
 */
export function deriveHealth(
  workItem: Pick<WorkItem, "phase" | "due_date">,
  tasks: ReadonlyArray<Pick<Task, "status" | "due_date">>,
  now?: number,
): Health;
