import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AuthPanel } from "@/components/AuthPanel";
import { PublicLayout } from "@/layouts/PublicLayout";
import {
  completeHostedExchange,
  describeRequestError,
  resolvePostAuthPath,
} from "@/pages/authPageUtils";
import {
  clearAuthToken,
  getCachedRuntimeConfig,
  getCurrentUser,
  getStoredAuthToken,
  initializeRuntimeConfig,
  loginUser,
  registerUser,
  setAuthToken,
  signInHostedWithEmail,
  signInHostedWithGoogle,
  signUpHostedWithEmail,
} from "@/lib/api";
import { startHostedGoogleSignInFlow } from "@/lib/hostedAuthFlow";
import { getHostedPostLoginPath, sanitizeSameOriginPath, setHostedPostLoginPath } from "@/lib/hostedAuthRoutes";

function isAuthSessionError(error) {
  const status = error?.response?.status;
  return status === 401 || status === 403;
}

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [runtimeConfig, setRuntimeConfig] = useState(getCachedRuntimeConfig());
  const [bootstrapStatus, setBootstrapStatus] = useState(runtimeConfig ? "ready" : "loading");
  const [authError, setAuthError] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  const authProvider = runtimeConfig?.auth?.provider || "local";
  const deploymentMode = runtimeConfig?.deployment_mode || "oss";
  const defaultDestination = useMemo(() => {
    const params = new URLSearchParams(location.search || "");
    const candidate = params.get("next") || location.state?.from || "/app";
    return sanitizeSameOriginPath(candidate, "/app");
  }, [location.search, location.state?.from]);
  const nextStopLabel = useMemo(() => {
    if (defaultDestination.startsWith("/meetings/")) {
      return "Meeting workspace";
    }
    if (defaultDestination === "/meetings") {
      return "Meeting history";
    }
    return "Dashboard";
  }, [defaultDestination]);

  const redirectAfterAuthentication = useCallback(async () => {
    const nextPath = deploymentMode === "hosted" ? await resolvePostAuthPath() : defaultDestination;
    navigate(nextPath, { replace: true });
  }, [defaultDestination, deploymentMode, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapAuth() {
      setBootstrapStatus("loading");
      setAuthError("");

      try {
        const nextRuntimeConfig = await initializeRuntimeConfig();
        if (cancelled) {
          return;
        }

        setRuntimeConfig(nextRuntimeConfig);

        if (!nextRuntimeConfig?.auth?.required) {
          navigate(defaultDestination, { replace: true });
          return;
        }

        const storedToken = getStoredAuthToken();
        if (storedToken) {
          try {
            await getCurrentUser();
            if (!cancelled) {
              await redirectAfterAuthentication();
            }
            return;
          } catch (error) {
            if (isAuthSessionError(error)) {
              clearAuthToken();
            } else if (!cancelled) {
              setBootstrapStatus("error");
              setAuthError(describeRequestError(error, "Failed to verify existing session"));
              return;
            }
          }
        }

        if (!cancelled) {
          setBootstrapStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setBootstrapStatus("error");
          setAuthError(describeRequestError(error, "Failed to load authentication settings"));
        }
      }
    }

    void bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, [defaultDestination, navigate, redirectAfterAuthentication, retryVersion]);

  const handleLogin = useCallback(
    async ({ email, password }) => {
      setIsAuthSubmitting(true);
      setAuthError("");

      try {
        if (deploymentMode === "hosted") {
          await signInHostedWithEmail({ email, password });
          const exchangeData = await completeHostedExchange();
          if (!exchangeData) {
            throw new Error("Hosted session was not established");
          }
        } else {
          const response = await loginUser(email, password);
          setAuthToken(response?.data?.access_token || "");
        }

        await redirectAfterAuthentication();
      } catch (error) {
        setAuthError(describeRequestError(error, "Failed to sign in"));
      } finally {
        setIsAuthSubmitting(false);
      }
    },
    [deploymentMode, redirectAfterAuthentication]
  );

  const handleRegister = useCallback(
    async ({ email, password, name }) => {
      setIsAuthSubmitting(true);
      setAuthError("");

      try {
        if (deploymentMode === "hosted") {
          await signUpHostedWithEmail({ email, password, name });
          const exchangeData = await completeHostedExchange();
          if (!exchangeData) {
            throw new Error("Hosted session was not established");
          }
        } else {
          const response = await registerUser(email, password, name);
          setAuthToken(response?.data?.access_token || "");
        }

        await redirectAfterAuthentication();
      } catch (error) {
        setAuthError(describeRequestError(error, "Failed to create account"));
      } finally {
        setIsAuthSubmitting(false);
      }
    },
    [deploymentMode, redirectAfterAuthentication]
  );

  const handleHostedGoogleSignIn = useCallback(async () => {
    setIsAuthSubmitting(true);
    setAuthError("");

    try {
      await startHostedGoogleSignInFlow({
        search: typeof window !== "undefined" ? window.location.search : "",
        origin: typeof window !== "undefined" ? window.location.origin : "",
        readPostLoginPath: getHostedPostLoginPath,
        writePostLoginPath: setHostedPostLoginPath,
        signInHostedWithGoogle,
      });
    } catch (error) {
      setAuthError(describeRequestError(error, "Failed to start hosted Google sign-in"));
      setIsAuthSubmitting(false);
    }
  }, []);

  return (
    <PublicLayout accent="dark">
      <main className="min-h-screen px-6 py-10 lg:px-12">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="max-w-xl">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#A7B6FF]">Secure workspace access</div>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.04em] text-white" style={{ fontFamily: "var(--font-heading)" }}>
              Sign in
            </h1>
            <p className="mt-4 text-base leading-8 text-[#D0D8FF]">
              Enter the workspace with Google or email and continue directly into your meeting dashboard.
            </p>
            <div className="mt-8 grid gap-4 text-sm text-[#D0D8FF]">
              <div className="border border-white/12 bg-white/5 p-4">
                Hosted mode keeps meeting access behind identity and organization context.
              </div>
              <div className="border border-white/12 bg-white/5 p-4">
                Runtime auth provider: <span className="font-medium text-white">{authProvider}</span>
              </div>
              <div className="border border-white/12 bg-white/5 p-4">
                Next stop after sign-in: <span className="font-medium text-white">{nextStopLabel}</span>
              </div>
            </div>
          </section>
          <section className="border border-white/10 bg-white p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            {bootstrapStatus === "error" ? (
              <div className="space-y-4">
                <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{authError}</div>
                <button
                  type="button"
                  onClick={() => setRetryVersion((current) => current + 1)}
                  className="inline-flex items-center justify-center rounded-full bg-[#111827] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-[#1f2937]"
                >
                  Retry sign-in setup
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {bootstrapStatus === "loading" ? (
                  <div className="border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-sm text-[#475569]">
                    Loading authentication settings and checking whether you already have an active workspace session.
                  </div>
                ) : null}
                <AuthPanel
                  deploymentMode={deploymentMode}
                  authProvider={authProvider}
                  authError={authError}
                  isSubmitting={isAuthSubmitting || bootstrapStatus === "loading"}
                  onLogin={handleLogin}
                  onRegister={handleRegister}
                  onHostedSignIn={handleLogin}
                  onHostedGoogleSignIn={handleHostedGoogleSignIn}
                  onHostedRegister={handleRegister}
                />
              </div>
            )}
          </section>
        </div>
      </main>
    </PublicLayout>
  );
}
