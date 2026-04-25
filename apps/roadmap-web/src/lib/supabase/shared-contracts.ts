import {
  canvasCoreContract,
  conversationContract,
} from "@product-suite/contracts";

import type { Tables } from "./types";

export { canvasCoreContract, conversationContract };

export const SHARED_CONVERSATION_THREAD_TABLE =
  conversationContract.thread.table as "chat_threads";
export const SHARED_CONVERSATION_MESSAGE_TABLE =
  conversationContract.message.table as "chat_messages";
export const SHARED_CANVAS_DOCUMENT_TABLE =
  canvasCoreContract.document.table as "blocksuite_documents";

export type SharedConversationThreadRow = Tables<typeof SHARED_CONVERSATION_THREAD_TABLE>;
export type SharedConversationMessageRow = Tables<typeof SHARED_CONVERSATION_MESSAGE_TABLE>;
export type SharedCanvasDocumentRow = Tables<typeof SHARED_CANVAS_DOCUMENT_TABLE>;
