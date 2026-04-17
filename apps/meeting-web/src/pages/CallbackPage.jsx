import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { HostedAuthStatusPage } from "@/components/HostedAuthStatusPage";
import { PublicLayout } from "@/layouts/PublicLayout";
import { clearAuthAndPostLoginState, completeHostedExchange, describeRequestError, resolvePostAuthPath } from "@/pages/authPageUtils";
import { initializeRuntimeConfig } from "@/lib/api";

export function CallbackPage() {
  const navigate = useNavigate();
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function completeCallback() {
      try {
        await initializeRuntimeConfig();
        const exchangeData = await completeHostedExchange();

        if (!exchangeData) {
          throw new Error("Hosted session was not established");
        }

        const nextPath = await resolvePostAuthPath();
        if (!cancelled) {
          navigate(nextPath, { replace: true });
        }
      } catch (error) {
        clearAuthAndPostLoginState();
        if (!cancelled) {
          setAuthError(describeRequestError(error, "Hosted sign-in failed"));
        }
      }
    }

    void completeCallback();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <PublicLayout accent="dark">
      <HostedAuthStatusPage
        title="Completing sign-in"
        description="Meeting Agent is exchanging the hosted identity session and returning you to the workspace."
        error={authError}
        action={
          authError ? (
            <a
              href="/auth/sign-in"
              className="inline-flex items-center justify-center bg-[#4B6BFF] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#5b79ff]"
            >
              Return to sign-in
            </a>
          ) : null
        }
      />
    </PublicLayout>
  );
}
