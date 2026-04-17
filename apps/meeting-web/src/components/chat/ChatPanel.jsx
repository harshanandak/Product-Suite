export function ChatPanel({ messages = [] }) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Discussion Chat</div>
      <div className="mt-4 space-y-0 border-t border-white/8">
        {messages.map((message) => (
          <div key={message.id} className="border-b border-white/8 py-4 text-sm text-foreground/90">
            <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/55">{message.role}</div>
            <div className="mt-2 leading-7">{message.content}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
