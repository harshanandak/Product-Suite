import { useEffect, useState } from "react";
import { Loader2, LockKeyhole, LogIn, UserPlus } from "lucide-react";

export function authPanelAllowsRegistration(deploymentMode, authProvider) {
  return deploymentMode !== "hosted" || authProvider === "neon";
}

export function resolveAuthPanelMode(mode, deploymentMode, authProvider) {
  if (mode === "register" && !authPanelAllowsRegistration(deploymentMode, authProvider)) {
    return "login";
  }

  return mode;
}

export function AuthPanel({
  deploymentMode,
  authProvider,
  authError,
  isSubmitting,
  onLogin,
  onRegister,
  onHostedSignIn,
  onHostedGoogleSignIn,
  onHostedRegister,
}) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const isHostedMode = deploymentMode === "hosted";
  const isHostedNeon = deploymentMode === "hosted" && authProvider === "neon";
  const registrationEnabled = authPanelAllowsRegistration(deploymentMode, authProvider);
  const resolvedMode = resolveAuthPanelMode(mode, deploymentMode, authProvider);

  useEffect(() => {
    if (!registrationEnabled && mode !== "login") {
      setMode("login");
    }
  }, [mode, registrationEnabled]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      return;
    }

    if (isHostedMode) {
      if (resolvedMode === "register") {
        await onHostedRegister?.({ email: email.trim(), password, name: name.trim() });
        return;
      }

      await onHostedSignIn?.({ email: email.trim(), password });
      return;
    }

    if (resolvedMode === "register") {
      await onRegister({ email: email.trim(), password, name: name.trim() });
      return;
    }

    await onLogin({ email: email.trim(), password });
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-[#FBFBFC] px-6 py-10">
      {isHostedMode ? (
        <div className="w-full max-w-md border border-[#E5E7EB] bg-white p-8 shadow-sm">
          <div className="mb-6">
            <p className="overline-label mb-3">HOSTED ACCESS</p>
            <h2
              className="text-2xl font-semibold tracking-tight text-[#0A0A0A]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Authentication
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#6B7280]">
              Hosted mode requires identity before meetings, transcripts, summaries, and chat can be accessed.
            </p>
            {isHostedNeon && (
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                Neon Auth handles the hosted identity session. Email/password and Google both exchange into the app token
                after sign-in.
              </p>
            )}
          </div>

          <div className="mb-6 flex border border-[#E5E7EB]">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 px-4 py-3 text-sm font-medium ${
                mode === "login" ? "bg-[#0A0A0A] text-white" : "bg-white text-[#0A0A0A]"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <LogIn size={14} />
                Sign in
              </span>
            </button>
            {registrationEnabled && (
              <button
                type="button"
                onClick={() => setMode("register")}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  resolvedMode === "register" ? "bg-[#0A0A0A] text-white" : "bg-white text-[#0A0A0A]"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <UserPlus size={14} />
                  Register
                </span>
              </button>
            )}
          </div>

          {authError && (
            <div className="mb-4 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {authError}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {resolvedMode === "register" && (
              <div>
                <label htmlFor="auth-name" className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]">
                  Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                  placeholder="Your name"
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                placeholder="Minimum 8 characters"
                autoComplete={resolvedMode === "register" ? "new-password" : "current-password"}
                minLength={8}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 bg-[#002FA7] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Working
                </>
              ) : (
                <>
                  <LockKeyhole size={16} />
                  {resolvedMode === "register" ? "Create account" : "Sign in"}
                </>
              )}
            </button>

            {isHostedNeon && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onHostedGoogleSignIn?.()}
                className="inline-flex w-full items-center justify-center gap-2 border border-[#D1D5DB] bg-white px-4 py-3 text-sm font-medium text-[#0A0A0A] disabled:opacity-60"
              >
                <LogIn size={16} />
                Continue with Google
              </button>
            )}
          </form>
        </div>
      ) : (
        <div className="w-full max-w-md border border-[#E5E7EB] bg-white p-8 shadow-sm">
          <div className="mb-6">
            <p className="overline-label mb-3">LOCAL ACCESS</p>
            <h2
              className="text-2xl font-semibold tracking-tight text-[#0A0A0A]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Authentication
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#6B7280]">
              Sign in locally to access meetings, transcripts, summaries, and chat.
            </p>
          </div>

          <div className="mb-6 flex border border-[#E5E7EB]">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 px-4 py-3 text-sm font-medium ${
                mode === "login" ? "bg-[#0A0A0A] text-white" : "bg-white text-[#0A0A0A]"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <LogIn size={14} />
                Sign in
              </span>
            </button>
            {registrationEnabled && (
              <button
                type="button"
                onClick={() => setMode("register")}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  resolvedMode === "register" ? "bg-[#0A0A0A] text-white" : "bg-white text-[#0A0A0A]"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <UserPlus size={14} />
                  Register
                </span>
              </button>
            )}
          </div>

          {authError && (
            <div className="mb-4 border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {authError}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {resolvedMode === "register" && (
              <div>
                <label htmlFor="auth-name" className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]">
                  Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                  placeholder="Your name"
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1 block text-xs font-mono uppercase tracking-[0.16em] text-[#6B7280]">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full border border-[#E5E7EB] px-3 py-3 text-sm text-[#0A0A0A] focus:border-[#002FA7] focus:outline-none"
                placeholder="Minimum 8 characters"
                autoComplete={resolvedMode === "register" ? "new-password" : "current-password"}
                minLength={8}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 bg-[#002FA7] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Working
                </>
              ) : (
                <>
                  <LockKeyhole size={16} />
                  {resolvedMode === "register" ? "Create account" : "Sign in"}
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
