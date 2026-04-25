import { describe, expect, expectTypeOf, it } from "vitest";
import {
  canvasCoreContract,
  conversationContract,
} from "@product-suite/contracts";
import { BLOCKSUITE_DOCUMENTS_TABLE } from "../../components/blocksuite/use-blocksuite-sync";
import {
  CHAT_MESSAGES_TABLE,
  CHAT_THREADS_TABLE,
} from "../../hooks/use-chat-threads";
import {
  SHARED_CANVAS_DOCUMENT_TABLE,
  SHARED_CONVERSATION_MESSAGE_TABLE,
  SHARED_CONVERSATION_THREAD_TABLE,
} from "../supabase/shared-contracts";
import type {
  SharedCanvasDocumentRow,
  SharedConversationMessageRow,
  SharedConversationThreadRow,
} from "../supabase/shared-contracts";
import type { Tables } from "../supabase/types";

describe("roadmap shared contracts adoption", () => {
  it("uses shared conversation and canvas contracts instead of hardcoded table names", () => {
    expect(conversationContract.thread.table).toBe("chat_threads");
    expect(conversationContract.message.table).toBe("chat_messages");
    expect(canvasCoreContract.document.table).toBe("blocksuite_documents");
    expect(SHARED_CONVERSATION_THREAD_TABLE).toBe(conversationContract.thread.table);
    expect(SHARED_CONVERSATION_MESSAGE_TABLE).toBe(conversationContract.message.table);
    expect(SHARED_CANVAS_DOCUMENT_TABLE).toBe(canvasCoreContract.document.table);
    expect(CHAT_THREADS_TABLE).toBe(SHARED_CONVERSATION_THREAD_TABLE);
    expect(CHAT_MESSAGES_TABLE).toBe(SHARED_CONVERSATION_MESSAGE_TABLE);
    expect(BLOCKSUITE_DOCUMENTS_TABLE).toBe(SHARED_CANVAS_DOCUMENT_TABLE);
  });

  it("exports shared row aliases from the companion supabase module", () => {
    expectTypeOf<SharedConversationThreadRow>().toEqualTypeOf<Tables<"chat_threads">>();
    expectTypeOf<SharedConversationMessageRow>().toEqualTypeOf<Tables<"chat_messages">>();
    expectTypeOf<SharedCanvasDocumentRow>().toEqualTypeOf<Tables<"blocksuite_documents">>();
  });
});
