import { ArrowRight, ShieldCheck } from "lucide-react";

export function HostedSignedOutPage({ onReturnToSignIn }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#e0e7ff_0%,#f8fafc_45%,#ffffff_100%)] px-6 py-10 text-[#0A0A0A]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl items-center justify-center">
        <div className="grid w-full gap-6 border border-[#DDE3F0] bg-white/95 p-8 shadow-[0_30px_100px_rgba(15,23,42,0.12)] backdrop-blur-sm lg:grid-cols-[1.1fr,0.9fr]">
          <section className="border border-[#E2E8F0] bg-[#0F172A] p-6 text-white">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#C7D2FE]">
              <ShieldCheck size={14} />
              SESSION CLOSED
            </div>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
              You have been signed out.
            </h1>
            <p className="mt-3 text-sm leading-7 text-[#CBD5E1]">
              Your Meeting Agent session has been cleared locally and from the hosted identity session. Use the secure
              entry page to start a new session.
            </p>
          </section>
          <section className="flex flex-col justify-center border border-[#E2E8F0] bg-[#F8FAFC] p-6">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#64748B]">Next Step</div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[#0F172A]" style={{ fontFamily: "var(--font-heading)" }}>
              Return to secure sign-in
            </h2>
            <p className="mt-3 text-sm leading-7 text-[#475569]">
              Sign back in with the hosted identity flow. The app will bring you back to the workspace after authentication.
            </p>
            <button
              type="button"
              onClick={onReturnToSignIn}
              className="mt-8 inline-flex items-center justify-center gap-2 bg-[#002FA7] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#00278b]"
            >
              Go to sign-in
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
