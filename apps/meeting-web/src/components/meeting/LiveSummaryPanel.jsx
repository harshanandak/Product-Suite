export function LiveSummaryPanel({ meetingState = {} }) {
  const bullets = meetingState.summary_bullets || [];

  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Live Summary</div>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {meetingState.current_topic || "Now"}
      </h2>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">
        {meetingState.current_goal || "No active goal yet."}
      </p>

      {bullets.length > 0 ? (
        <ul className="mt-5 space-y-0 border-t border-white/8">
          {bullets.map((bullet, index) => (
            <li
              key={`${bullet}-${index}`}
              className="border-b border-white/8 py-3 text-sm leading-7 text-foreground/90"
            >
              <span className="mr-3 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
