import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { conversationContract } from "./conversation.js";

const artifact = JSON.parse(
  readFileSync(new URL("../contracts/conversation.json", import.meta.url), "utf8"),
);
const typeDeclarations = readFileSync(new URL("./index.d.ts", import.meta.url), "utf8");
const normalizedTypeDeclarations = typeDeclarations.replace(/\s+/g, " ");

function expectDeclaration(fragment: string) {
  expect(normalizedTypeDeclarations).toContain(fragment.replace(/\s+/g, " ").trim());
}

describe("conversation authority contract", () => {
  test("keeps runtime, JSON, and declarations aligned", () => {
    expect(conversationContract).toEqual(artifact);
    expect(conversationContract.actor.kindValues).toEqual(["human", "agent", "service"]);
    expect(conversationContract.conversation.table).toBe("conversations");
    expect(conversationContract.membership.roleValues).toEqual(["reader", "writer", "admin"]);
    expectDeclaration('export type CollaborationActorKind = "human" | "agent" | "service";');
    expectDeclaration('export type ConversationStatus = "active" | "archived";');
    expectDeclaration('export type ConversationMembershipRole = "reader" | "writer" | "admin";');
    expectDeclaration('export type ConversationMembershipStatus = "active" | "removed";');
    expectDeclaration(`export type ConversationEventKind =
      | "message.created" | "message.edited" | "message.deleted"
      | "membership.added" | "membership.changed" | "membership.removed";`);
    expectDeclaration(`export type ConversationReferenceDomain =
      | "agent_run" | "proposal" | "approval" | "schedule"
      | "meeting" | "work_item" | "canvas_document";`);

    expectDeclaration(`export interface ConversationDomainReference {
      readonly domain: ConversationReferenceDomain; readonly id: string;
    }`);
    expectDeclaration(`export interface CollaborationActor {
      readonly id: string; readonly tenant_id: string; readonly kind: CollaborationActorKind;
      readonly owning_domain: string; readonly owning_id: string; readonly disabled_at: string | null;
    }`);
    expectDeclaration(`export interface Conversation {
      readonly id: string; readonly tenant_id: string; title: string; status: ConversationStatus;
      subject_ref: ConversationDomainReference | null; readonly created_by_actor_id: string;
      readonly next_sequence: number; readonly legacy_source: string | null; readonly legacy_id: string | null;
      readonly created_at: string; readonly updated_at: string;
    }`);
    expectDeclaration(`export interface ConversationMembership {
      readonly id: string; readonly tenant_id: string; readonly conversation_id: string;
      readonly actor_id: string; role: ConversationMembershipRole; status: ConversationMembershipStatus;
      readonly created_by_actor_id: string; readonly created_at: string; readonly updated_at: string;
    }`);
    expectDeclaration(`export interface ConversationEvent {
      readonly id: string; readonly tenant_id: string; readonly conversation_id: string;
      readonly actor_id: string; readonly sequence: number; readonly idempotency_key: string;
      readonly kind: ConversationEventKind; readonly payload: Record<string, unknown>;
      readonly reply_to_event_id: string | null; readonly target_event_id: string | null;
      readonly references: readonly ConversationDomainReference[]; readonly created_at: string;
    }`);

    for (const [section, keys] of Object.entries(conversationContract)) {
      if (!keys || typeof keys !== "object" || Array.isArray(keys)) continue;
      for (const key of Object.keys(keys)) {
        expect(typeDeclarations, `ConversationContract.${section}.${key}`).toMatch(
          new RegExp(`\\b${key}\\??:`),
        );
      }
    }
    expectDeclaration(`export interface ConversationContract {
      module: "conversation"; authorityVersion: 1;`);
    expectDeclaration(`actor: { table: string; idKey: string; tenantIdKey: string; kindKey: string;
      kindValues: readonly CollaborationActorKind[]; owningDomainKey: string; owningIdKey: string;
      disabledAtKey: string; };`);
    expectDeclaration(`conversation: { table: string; idKey: string; tenantIdKey: string; titleKey: string;
      statusKey: string; statusValues: readonly ConversationStatus[]; subjectRefKey: string;
      createdByActorIdKey: string; nextSequenceKey: string; legacySourceKey: string; legacyIdKey: string;
      createdAtKey: string; updatedAtKey: string; };`);
    expectDeclaration(`membership: { table: string; idKey: string; tenantIdKey: string; conversationIdKey: string;
      actorIdKey: string; roleKey: string; roleValues: readonly ConversationMembershipRole[];
      statusKey: string; statusValues: readonly ConversationMembershipStatus[]; createdByActorIdKey: string;
      createdAtKey: string; updatedAtKey: string; };`);
    expectDeclaration(`event: { table: string; idKey: string; tenantIdKey: string; conversationIdKey: string;
      actorIdKey: string; sequenceKey: string; idempotencyKey: string; kindKey: string;
      kindValues: readonly ConversationEventKind[]; payloadKey: string; replyToEventIdKey: string;
      targetEventIdKey: string; referencesKey: string; createdAtKey: string;`);
    expectDeclaration(`cursor: { field: "sequence"; mode: "exclusive" };
      idempotency: { scope: readonly string[]; conflictStatus: 409 }; immutable: true;`);
    expectDeclaration(`access: { readRoles: readonly ConversationMembershipRole[];
      writeRoles: readonly ConversationMembershipRole[]; adminRoles: readonly ConversationMembershipRole[];
      denyByDefault: true; };`);
    expectDeclaration(`authority: { store: "shared_postgres"; actorDerivedServerSide: true;
      runIsActor: false; owningDomainReferences: readonly ConversationReferenceDomain[]; };`);
    expectDeclaration(`thread: { table: string; idKey: string; workspaceIdKey: string; teamIdKey: string;
      titleKey: string; statusKey: string; metadataKey: string; createdAtKey: string; updatedAtKey: string;
      createdByKey: string; };`);
    expectDeclaration(`message: { table: string; idKey: string; threadIdKey: string; roleKey: string;
      contentKey: string; partsKey: string; metadataKey: string; toolInvocationsKey: string;
      modelUsedKey: string; createdAtKey: string; };`);
  });

  test("defines immutable ordered events and owning-domain references", () => {
    expect(conversationContract.event.kindValues).toEqual([
      "message.created",
      "message.edited",
      "message.deleted",
      "membership.added",
      "membership.changed",
      "membership.removed",
    ]);
    expect(conversationContract.event.cursor).toEqual({ field: "sequence", mode: "exclusive" });
    expect(conversationContract.event.idempotency.conflictStatus).toBe(409);
    expect(conversationContract.event.immutable).toBe(true);
    expect(conversationContract.authority.runIsActor).toBe(false);
    expect(conversationContract.authority.owningDomainReferences).toContain("agent_run");
  });
});
