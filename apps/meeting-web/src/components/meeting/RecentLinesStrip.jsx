export function RecentLinesStrip({ recentLines = [] }) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Recent Lines</div>
      <div className="mt-4 space-y-0 border-t border-white/8">
        {recentLines.map((line, index) => (
          <div
            key={line.id || `${line.timestamp_start || 0}-${index}`}
            className="border-b border-white/8 py-3 text-sm leading-7 text-foreground/90"
          >
            <div>
              <span className="font-semibold text-foreground">{line.speaker_label}: </span>
              <span>{line.text}</span>
            </div>
            {line.translated_text ? (
              <div className="mt-1 pl-4 text-xs leading-6 text-muted-foreground">
                English: {line.translated_text}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
