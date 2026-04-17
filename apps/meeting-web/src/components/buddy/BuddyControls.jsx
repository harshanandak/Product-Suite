export function BuddyControls({ response, loading, error, onAskBuddy, disabled = false }) {
  const provenance = Array.isArray(response?.provenance) ? response.provenance : [];

  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Buddy</div>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) {
            return;
          }
          const form = new FormData(event.currentTarget);
          const message = String(form.get("message") || "").trim();
          if (message) {
            void Promise.resolve(onAskBuddy?.(message)).catch(() => undefined);
          }
          event.currentTarget.reset();
        }}
      >
        <textarea
          name="message"
          rows={4}
          disabled={disabled}
          placeholder={disabled ? "Select a meeting to ask Buddy" : "Ask about the discussion"}
          className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-2xl border border-primary/35 bg-[linear-gradient(180deg,hsl(229,68%,52%),hsl(231,76%,34%))] px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>
      {error ? <p className="mt-3 text-sm text-destructive">{error.message || String(error)}</p> : null}
      {response ? (
        <div className="mt-4 border-t border-white/8 pt-4 text-sm text-foreground/90">
          {response.isStub ? (
            <div className="mb-3 inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-amber-200">
              Preview
            </div>
          ) : null}
          <div className="leading-7">{response.answer}</div>
          <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-foreground/55">{response.sourceKind}</div>
          {provenance.length > 0 ? (
            <div className="mt-4 border-t border-white/8 pt-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/55">Source provenance</div>
              <ul className="mt-2 space-y-2 text-xs leading-6 text-muted-foreground">
                {provenance.map((item, index) => (
                  <li key={`${item.source || "source"}-${index}`} className="border-l border-white/10 pl-3">
                    <span className="font-medium text-foreground/85">{item.source}</span>
                    {item.detail ? <span> - {item.detail}</span> : null}
                    {item.url ? <span className="ml-1 text-primary">{item.url}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
