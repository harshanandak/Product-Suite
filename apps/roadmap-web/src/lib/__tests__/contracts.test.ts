import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canvasCoreContract,
  conversationContract,
} from "@product-suite/contracts";

describe("roadmap shared contracts adoption", () => {
  it("uses shared conversation and canvas contracts instead of hardcoded table names", () => {
    const chatHookSource = readFileSync(
      new URL("../../hooks/use-chat-threads.ts", import.meta.url),
      "utf8",
    );
    const blockSuiteSyncSource = readFileSync(
      new URL("../../components/blocksuite/use-blocksuite-sync.ts", import.meta.url),
      "utf8",
    );
    const supabaseTypesSource = readFileSync(
      new URL("../supabase/types.ts", import.meta.url),
      "utf8",
    );

    expect(chatHookSource).toContain("@product-suite/contracts");
    expect(chatHookSource).toContain("conversationContract.thread.table");
    expect(chatHookSource).toContain("conversationContract.message.table");
    expect(chatHookSource).not.toContain(".from('chat_threads')");
    expect(chatHookSource).not.toContain(".from('chat_messages')");

    expect(blockSuiteSyncSource).toContain("@product-suite/contracts");
    expect(blockSuiteSyncSource).toContain("canvasCoreContract.document.table");
    expect(blockSuiteSyncSource).not.toContain(".from('blocksuite_documents')");

    expect(supabaseTypesSource).toContain("@product-suite/contracts");
    expect(supabaseTypesSource).toContain("SharedConversationThreadRow");
    expect(supabaseTypesSource).toContain("SharedConversationMessageRow");
    expect(supabaseTypesSource).toContain("SharedCanvasDocumentRow");

    expect(conversationContract.thread.table).toBe("chat_threads");
    expect(conversationContract.message.table).toBe("chat_messages");
    expect(canvasCoreContract.document.table).toBe("blocksuite_documents");
  });
});
