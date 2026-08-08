/**
 * Runtime catalog contract used by the Neon reconciliation checkpoint.
 *
 * The SQL migration performs the same checks inside its transaction.  These
 * small, dependency-free helpers make the contract testable without creating a
 * database and provide one redaction-safe error shape for callers.
 */

export type RelationKind = 'r' | 'p' | 'v' | 'm' | 'f' | 'S'

export interface CatalogRelation {
  kind: RelationKind
  schema: string
}

export interface CatalogColumn {
  type: string
  typmod: number
  collation: string | null
  nullable: boolean
  default: string | null
  identity: string
  generated: string
}

export interface CatalogConstraint {
  definition: string
  columns: string[]
  referencedColumns: string[]
  match: string
  deferrable: boolean
  initiallyDeferred: boolean
  onUpdate: string
  onDelete: string
}

export interface CatalogIndex {
  unique: boolean
  method: string
  keys: string[]
  opclasses: string[]
  include: string[]
  predicate: string | null
}

export interface CatalogSnapshot {
  relations: Record<string, CatalogRelation>
  columns: Record<string, CatalogColumn>
  enums: Record<string, string[]>
  constraints: Record<string, CatalogConstraint>
  indexes: Record<string, CatalogIndex>
}

export interface RoleSnapshot {
  name: string
  canLogin: boolean
  isSuperuser: boolean
  memberships?: string[]
}

export const REQUIRED_RUNTIME_ROLES = [
  'product_suite_platform_runtime',
  'product_suite_meeting_runtime',
] as const

const FORBIDDEN_MEMBERSHIPS = new Set([
  'postgres',
  'neondb_owner',
  'neondb_admin',
  'rds_superuser',
])

export type CatalogMismatchCategory = 'relation' | 'column' | 'enum' | 'constraint' | 'index' | 'role'

export class CatalogContractError extends Error {
  readonly code = 'CATALOG_MISMATCH'
  readonly sqlState = 'P0001'
  readonly category: CatalogMismatchCategory
  readonly objectName: string
  readonly expected: unknown
  readonly actual: unknown

  constructor(category: CatalogMismatchCategory, objectName: string, expected: unknown, actual: unknown) {
    super(`catalog mismatch (${category}): ${objectName}`)
    this.name = 'CatalogContractError'
    this.category = category
    this.objectName = objectName
    this.expected = expected
    this.actual = actual
  }
}

function stable(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort())
}

function compareMap<T>(
  category: CatalogMismatchCategory,
  expected: Record<string, T>,
  actual: Record<string, T>,
): void {
  for (const [name, expectedValue] of Object.entries(expected)) {
    if (!(name in actual) || stable(expectedValue) !== stable(actual[name])) {
      throw new CatalogContractError(category, name, expectedValue, actual[name])
    }
  }
}

/** Compare an observed catalog with the exact expected checkpoint contract. */
export function assertCatalog(expected: CatalogSnapshot, actual: CatalogSnapshot): void {
  compareMap('relation', expected.relations, actual.relations)
  compareMap('column', expected.columns, actual.columns)
  compareMap('enum', expected.enums, actual.enums)
  compareMap('constraint', expected.constraints, actual.constraints)
  compareMap('index', expected.indexes, actual.indexes)
}

/** Validate the pre-provisioned NOLOGIN grant roles before object DDL runs. */
export function assertRequiredRoles(roles: RoleSnapshot[]): void {
  const byName = new Map(roles.map((role) => [role.name, role]))
  for (const name of REQUIRED_RUNTIME_ROLES) {
    const role = byName.get(name)
    if (!role || role.canLogin || role.isSuperuser) {
      throw new CatalogContractError('role', name, { canLogin: false, isSuperuser: false }, role)
    }
    if ((role.memberships ?? []).some((membership) => FORBIDDEN_MEMBERSHIPS.has(membership))) {
      throw new CatalogContractError('role', name, { memberships: 'least-privilege' }, role.memberships)
    }
  }
}

/**
 * Produce the SQL preflight used by `0019`.  It intentionally only reads
 * `pg_roles`; role creation and LOGIN credential management stay out of the
 * migration authority.
 */
export function buildRolePreflight(roleNames: readonly string[] = REQUIRED_RUNTIME_ROLES): string {
  const names = roleNames.map((name) => `'${name.replaceAll("'", "''")}'`).join(', ')
  return `
DO $$
DECLARE
  required_name text;
  role_record record;
BEGIN
  FOREACH required_name IN ARRAY ARRAY[${names}] LOOP
    SELECT rolcanlogin, rolsuper INTO role_record
      FROM pg_catalog.pg_roles WHERE rolname = required_name;
    IF NOT FOUND OR role_record.rolcanlogin OR role_record.rolsuper THEN
      RAISE EXCEPTION 'required runtime role % must pre-exist as NOLOGIN', required_name
        USING ERRCODE = 'P0001', DETAIL = 'role preflight failed before object DDL';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members members
      JOIN pg_catalog.pg_roles granted ON granted.oid = members.roleid
      JOIN pg_catalog.pg_roles member ON member.oid = members.member
      WHERE member.rolname = required_name
        AND granted.rolname IN ('postgres', 'neondb_owner', 'neondb_admin', 'rds_superuser')
    ) THEN
      RAISE EXCEPTION 'runtime role % has unauthorized administrative membership', required_name
        USING ERRCODE = 'P0001', DETAIL = 'role preflight failed before object DDL';
    END IF;
  END LOOP;
END $$;
`.trim()
}

export interface CatalogAssertionTargets {
  relations: readonly string[]
  columns: readonly string[]
  enums: readonly string[]
  constraints: readonly string[]
  indexes: readonly string[]
}

/**
 * Build a fail-closed SQL assertion block.  The migration adds object-specific
 * expected values around this block; keeping the probes in one helper prevents
 * a future migration from silently dropping a catalog dimension.
 */
export function buildCatalogAssertions(targets: CatalogAssertionTargets): string {
  const list = (values: readonly string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')
  return `
DO $$
DECLARE
  object_name text;
  relation_kind "char";
  actual_type text;
  actual_typmod integer;
  actual_collation text;
  actual_nullable boolean;
  actual_default text;
  actual_identity "char";
  actual_generated "char";
  enum_labels text[];
  constraint_definition text;
  index_method text;
  index_keys text[];
  index_opclasses text[];
  index_include text[];
  index_predicate text;
BEGIN
  FOREACH object_name IN ARRAY ARRAY[${list(targets.relations)}] LOOP
    SELECT c.relkind INTO relation_kind
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = split_part(object_name, '.', 1)
        AND c.relname = split_part(object_name, '.', 2);
    IF relation_kind IS NULL THEN
      RAISE EXCEPTION 'catalog mismatch: relation %', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- Column probes include type, typmod, collation, nullability, default,
  -- identity, and generated state.  Expected values are supplied per target.
  FOREACH object_name IN ARRAY ARRAY[${list(targets.columns)}] LOOP
    SELECT format_type(a.atttypid, a.atttypmod), a.atttypmod,
           CASE WHEN a.attcollation = 0 THEN NULL ELSE c.collname END,
           a.attnotnull, pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated
      INTO actual_type, actual_typmod, actual_collation, actual_nullable,
           actual_default, actual_identity, actual_generated
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class r ON r.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
      LEFT JOIN pg_catalog.pg_collation c ON c.oid = a.attcollation
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = split_part(object_name, '.', 1)
        AND r.relname = split_part(split_part(object_name, '.', 2), '.', 1)
        AND a.attname = split_part(object_name, '.', 3)
        AND a.attnum > 0 AND NOT a.attisdropped;
    IF actual_type IS NULL THEN
      RAISE EXCEPTION 'catalog mismatch: column %', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- Enum order is catalog state, not just membership.
  FOREACH object_name IN ARRAY ARRAY[${list(targets.enums)}] LOOP
    SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO enum_labels
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = split_part(object_name, '.', 1)
        AND t.typname = split_part(object_name, '.', 2);
    IF enum_labels IS NULL THEN
      RAISE EXCEPTION 'catalog mismatch: enum %', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY[${list(targets.constraints)}] LOOP
    SELECT pg_get_constraintdef(con.oid, true) INTO constraint_definition
      FROM pg_catalog.pg_constraint con
      WHERE con.conname = split_part(object_name, '.', 2);
    IF constraint_definition IS NULL THEN
      RAISE EXCEPTION 'catalog mismatch: constraint %', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY[${list(targets.indexes)}] LOOP
    SELECT am.amname, pg_get_expr(i.indpred, i.indrelid),
           ARRAY(SELECT pg_get_indexdef(i.indexrelid, s, true)
             FROM generate_series(1, i.indnkeyatts) s),
           ARRAY(SELECT oc.opcname FROM unnest(i.indclass) WITH ORDINALITY op(oid, ord)
             JOIN pg_catalog.pg_opclass oc ON oc.oid = op.oid ORDER BY op.ord),
           ARRAY(SELECT a.attname FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = i.indexrelid AND a.attnum > i.indnkeyatts
             ORDER BY a.attnum)
      INTO index_method, index_predicate, index_keys, index_opclasses, index_include
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid = c.relam
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname = split_part(object_name, '.', 2);
    IF index_method IS NULL THEN
      RAISE EXCEPTION 'catalog mismatch: index %', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $$;
`.trim()
}

export interface MigrationFirewallFinding {
  token: string
  offset: number
}

export const FORBIDDEN_MIGRATION_TOKENS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'COPY',
  'TRUNCATE',
  'DROP',
] as const

function dollarTagAt(source: string, offset: number): string | null {
  const match = source.slice(offset).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
  return match?.[0] ?? null
}

/** Tokenize authored SQL while skipping comments, quoted literals, and dollar quotes. */
export function scanMigrationSql(source: string): MigrationFirewallFinding[] {
  const findings: MigrationFirewallFinding[] = []
  const forbidden = new Set<string>(FORBIDDEN_MIGRATION_TOKENS)
  let index = 0
  let previousToken: string | null = null
  let statementMode: string | null = null

  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (current === '-' && next === '-') {
      const lineEnd = source.indexOf('\n', index + 2)
      index = lineEnd === -1 ? source.length : lineEnd + 1
      continue
    }
    if (current === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      index = commentEnd === -1 ? source.length : commentEnd + 2
      continue
    }
    if (current === "'" || current === '"') {
      const quote = current
      index += 1
      while (index < source.length) {
        if (source[index] === quote && source[index + 1] === quote) {
          index += 2
          continue
        }
        if (source[index] === quote) {
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    const tag = current === '$' ? dollarTagAt(source, index) : null
    if (tag) {
      const end = source.indexOf(tag, index + tag.length)
      index = end === -1 ? source.length : end + tag.length
      continue
    }
    const token = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0]
    if (token) {
      const upper = token.toUpperCase()
      // DML words are only legal in privilege lists after an actual GRANT.
      // Do not treat every ALTER statement as ALTER DEFAULT PRIVILEGES: that
      // would let destructive `ALTER TABLE ... DROP ...` bypass the firewall.
      const grantStatement = statementMode === 'GRANT'
      // `ON DELETE/UPDATE ...` are referential actions, and privilege lists
      // after GRANT contain the same words as DML. Keep those legal while
      // blocking standalone data-modifying statements.
      if (
        forbidden.has(upper) &&
        !grantStatement &&
        !(previousToken === 'ON' && (upper === 'DELETE' || upper === 'UPDATE'))
      ) {
        findings.push({ token: upper, offset: index })
      }
      if (previousToken === 'CREATE' && upper === 'SCHEMA') findings.push({ token: 'CREATE SCHEMA', offset: index })
      if (upper === 'GRANT') statementMode = 'GRANT'
      else if (upper === 'ALTER') statementMode = 'ALTER'
      else if (statementMode === 'ALTER' && upper === 'DEFAULT') statementMode = 'ALTER_DEFAULT_PRIVILEGES'
      else if (statementMode === 'ALTER') statementMode = null
      previousToken = upper
      index += token.length
      continue
    }
    if (current === ';') statementMode = null
    if (!/\s/.test(current) && current !== ';') previousToken = null
    index += 1
  }

  return findings
}

export function assertMigrationSqlSafe(source: string): void {
  const findings = scanMigrationSql(source)
  if (findings.length > 0) {
    const first = findings[0]
    const error = new Error(`SQL firewall blocked authored token ${first.token}`)
    Object.assign(error, { code: 'SQL_FIREWALL_BLOCKED', token: first.token, offset: first.offset })
    throw error
  }
}

/** Convert driver errors to a stable, credential-free object for readiness logs. */
export function normalizeCatalogError(error: unknown): {
  code: string
  message: string
  category?: CatalogMismatchCategory
  objectName?: string
  sqlState?: string
} {
  if (error instanceof CatalogContractError) {
    return {
      code: error.code,
      message: error.message,
      category: error.category,
      objectName: error.objectName,
      sqlState: error.sqlState,
    }
  }
  const candidate = error as { code?: unknown; message?: unknown; sqlState?: unknown; detail?: unknown }
  const message = String(candidate?.message ?? 'catalog contract failed')
    .replace(/(?:postgres(?:ql)?:\/\/|postgres(?:ql)?\s+)[^\s]+/gi, '[redacted]')
    .replace(/password\s*=\s*[^\s]+/gi, 'password=[redacted]')
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'CATALOG_CONTRACT_FAILED',
    message,
    sqlState: typeof candidate?.sqlState === 'string' ? candidate.sqlState : undefined,
  }
}
