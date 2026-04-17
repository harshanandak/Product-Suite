import { Loader2, ShieldCheck } from "lucide-react";

export function HostedAuthStatusPage({
  eyebrow = "SECURE ACCESS",
  title,
  description,
  error = "",
  action = null,
}) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-6 py-10 text-[#0A0A0A]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <div className="w-full border border-[#DDE3F0] bg-white/90 p-8 shadow-[0_30px_100px_rgba(15,23,42,0.12)] backdrop-blur-sm">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#3730A3]">
            <ShieldCheck size={14} />
            {eyebrow}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-[#0F172A]" style={{ fontFamily: "var(--font-heading)" }}>
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#475569]">{description}</p>
          {error ? (
            <div className="mt-6 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>
          ) : (
            <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2 text-sm text-[#334155]">
              <Loader2 size={16} className="animate-spin" />
              Working
            </div>
          )}
          {action ? <div className="mt-8">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
