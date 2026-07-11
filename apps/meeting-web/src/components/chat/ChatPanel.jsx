import { ChatMessageList } from "@product-suite/ui-chat";

export function ChatPanel({ messages = [], onSendMessage, disabled = false }) {
  return (
    <div className="flex flex-col gap-3">
      <ChatMessageList
        messages={messages}
        className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5"
      />
      {onSendMessage ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const message = String(form.get("message") || "").trim();
            if (message) {
              event.currentTarget.reset();
              void Promise.resolve(onSendMessage(message)).catch(() => undefined);
            }
          }}
        >
          <textarea
            name="message"
            rows={2}
            disabled={disabled}
            placeholder="Ask the buddy about this meeting..."
            className="flex-1 resize-none rounded-2xl border border-white/8 bg-black/20 p-3 text-sm text-white/90 placeholder:text-white/40"
          />
          <button
            type="submit"
            disabled={disabled}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      ) : null}
    </div>
  );
}
