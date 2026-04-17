import { formatConfidence, resolveStatusLabel } from "./generatedRecordHelpers";

export function ActionItemsPanel({ actionItems = [] }) {
  return (
    <section className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Action Items</div>
      <div className="mt-4 space-y-0 border-t border-white/8">
        {actionItems.map((item, index) => (
          <div key={item.id || index} className="border-b border-white/8 py-4 text-sm text-foreground/90">
            <div className="leading-7">{item.text || item.summary || item}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-foreground/60">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                {resolveStatusLabel(item)}
              </span>
              {formatConfidence(item.confidence) ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  {formatConfidence(item.confidence)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-[11px] text-foreground/55">
              Origin: {item.record_origin || "generated"}
            </div>
            {item.promotion_reason ? (
              <div className="mt-2 text-xs leading-6 text-muted-foreground">{item.promotion_reason}</div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
