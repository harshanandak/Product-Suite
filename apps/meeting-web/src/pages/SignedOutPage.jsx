import { PublicLayout } from "@/layouts/PublicLayout";

export function SignedOutPage() {
  return (
    <PublicLayout accent="light">
      <main className="min-h-screen px-6 py-10 lg:px-12">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
          <div className="grid w-full gap-6 border border-[#DDD2C5] bg-white p-8 shadow-[0_30px_100px_rgba(15,23,42,0.08)] lg:grid-cols-[1.05fr_0.95fr]">
            <section className="border border-[#E7DDD0] bg-[#0F1A42] p-6 text-white">
              <div className="text-[11px] uppercase tracking-[0.22em] text-[#A7B6FF]">Session closed</div>
              <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em]" style={{ fontFamily: "var(--font-heading)" }}>
                You are signed out.
              </h1>
              <p className="mt-4 text-sm leading-7 text-[#D0D8FF]">
                The hosted identity session and local workspace token are both cleared. Return when you want to keep moving
                with the dashboard and meeting workspace.
              </p>
            </section>
            <section className="flex flex-col justify-center border border-[#E7DDD0] bg-[#F8F4EE] p-6">
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#6B7280]">Next step</div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[#0A0A0A]" style={{ fontFamily: "var(--font-heading)" }}>
                Return to sign-in
              </h2>
              <p className="mt-4 text-sm leading-7 text-[#4B5563]">
                Use the secure hosted sign-in page to start a new session. The app will send you back to your workspace
                after authentication.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="/auth/sign-in"
                  className="inline-flex items-center justify-center bg-[#4B6BFF] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#5b79ff]"
                >
                  Return to sign-in
                </a>
                <a
                  href="/"
                  className="inline-flex items-center justify-center border border-[#D6CCBE] bg-white px-5 py-3 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#F7F3EE]"
                >
                  Back to landing page
                </a>
              </div>
            </section>
          </div>
        </div>
      </main>
    </PublicLayout>
  );
}
