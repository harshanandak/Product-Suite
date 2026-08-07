import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { conversationContract } from "./conversation.js";

const artifact = JSON.parse(
  readFileSync(new URL("../contracts/conversation.json", import.meta.url), "utf8"),
);
const typeDeclarations = readFileSync(new URL("./index.d.ts", import.meta.url), "utf8");

describe("conversation authority contract", () => {
  test("keeps runtime, JSON, and declarations aligned", () => {
    expect(conversationContract).toEqual(artifact);
    expect(conversationContract.actor.kindValues).toEqual(["human", "agent", "service"]);
    expect(conversationContract.conversation.table).toBe("conversations");
    expect(conversationContract.membership.roleValues).toEqual(["reader", "writer", "admin"]);
    expect(typeDeclarations).toContain('export type CollaborationActorKind = "human" | "agent" | "service"');
    expect(typeDeclarations).toContain('export type ConversationMembershipRole = "reader" | "writer" | "admin"');
    expect(typeDeclarations).toContain("readonly sequence: number");
    expect(typeDeclarations).toContain("readonly actor_id: string");
    expect(typeDeclarations).toContain("readonly domain: ConversationReferenceDomain");
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