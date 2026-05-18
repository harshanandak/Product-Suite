// src/index.jsx
import React from "react";
import { jsxDEV } from "react/jsx-dev-runtime";
function getChatMessageText(message = {}) {
  if (typeof message.content === "string" && message.content.trim()) {
    return message.content;
  }
  if (Array.isArray(message.parts)) {
    return message.parts.map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join(`
`);
  }
  return "";
}
function sortChatThreadsByUpdatedAt(threads = []) {
  return [...threads].sort((first, second) => {
    const firstTime = Date.parse(first?.updated_at || first?.created_at || "");
    const secondTime = Date.parse(second?.updated_at || second?.created_at || "");
    return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
  });
}
function createChatRecordId(now = Date.now) {
  return String(now());
}
function roleLabel(role) {
  return role || "message";
}
function ChatMessageList({
  messages = [],
  title = "Discussion Chat",
  emptyLabel = "No messages yet.",
  className = ""
}) {
  const hasMessages = messages.length > 0;
  return /* @__PURE__ */ jsxDEV("section", {
    className,
    children: [
      /* @__PURE__ */ jsxDEV("div", {
        className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
        children: title
      }, undefined, false, undefined, this),
      hasMessages ? /* @__PURE__ */ jsxDEV("div", {
        className: "mt-4 space-y-0 border-t border-white/8",
        children: messages.map((message, index) => /* @__PURE__ */ jsxDEV("div", {
          className: "border-b border-white/8 py-4 text-sm text-foreground/90",
          children: [
            /* @__PURE__ */ jsxDEV("div", {
              className: "text-[10px] uppercase tracking-[0.16em] text-foreground/55",
              children: roleLabel(message.role)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("div", {
              className: "mt-2 whitespace-pre-wrap leading-7",
              children: getChatMessageText(message)
            }, undefined, false, undefined, this)
          ]
        }, message.id || index, true, undefined, this))
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV("div", {
        className: "mt-4 border-t border-white/8 py-4 text-sm leading-7 text-muted-foreground",
        children: emptyLabel
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function ChatThreadList({
  threads = [],
  selectedThreadId = null,
  onSelectThread,
  emptyLabel = "No chat threads yet.",
  className = ""
}) {
  const sortedThreads = sortChatThreadsByUpdatedAt(threads);
  const canSelectThread = typeof onSelectThread === "function";
  return /* @__PURE__ */ jsxDEV("section", {
    className,
    children: [
      /* @__PURE__ */ jsxDEV("div", {
        className: "text-[10px] uppercase tracking-[0.22em] text-foreground/55",
        children: "Chat Threads"
      }, undefined, false, undefined, this),
      sortedThreads.length > 0 ? /* @__PURE__ */ jsxDEV("div", {
        className: "mt-3 space-y-2",
        children: sortedThreads.map((thread) => {
          const isSelected = thread.id === selectedThreadId;
          return /* @__PURE__ */ jsxDEV("button", {
            type: "button",
            onClick: canSelectThread ? () => onSelectThread(thread.id) : undefined,
            disabled: !canSelectThread,
            className: `w-full border px-3 py-2 text-left text-sm ${isSelected ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5"} disabled:cursor-not-allowed disabled:opacity-60`,
            children: [
              /* @__PURE__ */ jsxDEV("span", {
                className: "block font-medium text-foreground",
                children: thread.title || "Untitled chat"
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("span", {
                className: "mt-1 block text-xs text-muted-foreground",
                children: thread.updated_at || thread.created_at || ""
              }, undefined, false, undefined, this)
            ]
          }, thread.id, true, undefined, this);
        })
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV("div", {
        className: "mt-3 text-sm leading-7 text-muted-foreground",
        children: emptyLabel
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
export {
  sortChatThreadsByUpdatedAt,
  getChatMessageText,
  createChatRecordId,
  ChatThreadList,
  ChatMessageList
};
