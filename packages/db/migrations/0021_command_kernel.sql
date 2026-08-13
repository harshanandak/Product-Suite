BEGIN;

ALTER TABLE "work_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "work_items" ADD COLUMN "last_command_marker" uuid;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_version_positive" CHECK ("version" > 0);

CREATE TABLE "command_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "actor_type" "actor_type" NOT NULL,
  "actor_id" text NOT NULL,
  "command" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "request_id" text NOT NULL,
  "response" jsonb NOT NULL,
  "resource_version" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "command_idempotency_resource_version_positive" CHECK ("resource_version" > 0),
  CONSTRAINT "command_idempotency_request_hash_sha256" CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "command_idempotency_scope_uniq" ON "command_idempotency"
  ("tenant_id", "actor_type", "actor_id", "command", "idempotency_key");
CREATE UNIQUE INDEX "command_idempotency_tenant_request_uniq" ON "command_idempotency"
  ("tenant_id", "request_id");

CREATE TABLE "command_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "idempotency_id" uuid NOT NULL,
  "request_id" text NOT NULL,
  "command" text NOT NULL,
  "actor_type" "actor_type" NOT NULL,
  "actor_id" text NOT NULL,
  "on_behalf_of" text,
  "capability" text NOT NULL,
  "approval" jsonb NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "before" jsonb,
  "after" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "command_audit_events_idempotency_fk" FOREIGN KEY ("idempotency_id")
    REFERENCES "command_idempotency"("id") ON DELETE RESTRICT,
  CONSTRAINT "command_audit_events_approval_object" CHECK (jsonb_typeof("approval") = 'object'),
  CONSTRAINT "command_audit_events_after_object" CHECK (jsonb_typeof("after") = 'object')
);

CREATE INDEX "command_audit_events_tenant_created_idx" ON "command_audit_events"
  ("tenant_id", "created_at");
CREATE UNIQUE INDEX "command_audit_events_tenant_request_uniq" ON "command_audit_events"
  ("tenant_id", "request_id");

ALTER TABLE "command_idempotency" ADD CONSTRAINT "command_idempotency_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
ALTER TABLE "command_audit_events" ADD CONSTRAINT "command_audit_events_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;

CREATE FUNCTION reject_command_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'command ledgers are append-only' USING ERRCODE = '55000';
END;
$$;
DO $immutable_triggers$
BEGIN
  EXECUTE 'CREATE TRIGGER command_idempotency_immutable BEFORE UPDATE OR DELETE ON "command_idempotency" FOR EACH ROW EXECUTE FUNCTION reject_command_ledger_mutation()';
  EXECUTE 'CREATE TRIGGER command_audit_events_immutable BEFORE UPDATE OR DELETE ON "command_audit_events" FOR EACH ROW EXECUTE FUNCTION reject_command_ledger_mutation()';
END
$immutable_triggers$;

GRANT SELECT, INSERT ON TABLE "command_idempotency" TO product_suite_platform_runtime;
GRANT SELECT, INSERT ON TABLE "command_audit_events" TO product_suite_platform_runtime;

COMMIT;
