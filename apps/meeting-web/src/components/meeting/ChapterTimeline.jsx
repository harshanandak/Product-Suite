function resolveBoundaryLabel(chapter) {
  if (chapter?.boundary_source === "semantic_adjustment") {
    return "Semantic boundary adjustment";
  }

  if (chapter?.boundary_source === "fixed_window") {
    return "Fixed window boundary";
  }

  return null;
}

export function ChapterTimeline({ chapters = [] }) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Chapter Timeline</div>
      <div className="mt-4 space-y-0 border-t border-white/8">
        {chapters.map((chapter, index) => (
          <article key={chapter.id || index} className="border-b border-white/8 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-foreground">
                {chapter.title || `Chapter ${index + 1}`}
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/50">
                {chapter.window_label || ""}
              </div>
            </div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              {chapter.summary_text || chapter.summary || ""}
            </p>
            {resolveBoundaryLabel(chapter) ? (
              <div className="mt-2 text-[11px] text-foreground/55">{resolveBoundaryLabel(chapter)}</div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
