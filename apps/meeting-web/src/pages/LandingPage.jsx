import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import CTABanner from "@/components/landing/CTABanner";
import FAQSection from "@/components/landing/FAQSection";
import FeatureGrid from "@/components/landing/FeatureGrid";
import HeroSection from "@/components/landing/HeroSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import LandingFooter from "@/components/landing/LandingFooter";
import LandingNavbar from "@/components/landing/LandingNavbar";
import StatsBar from "@/components/landing/StatsBar";
import TestimonialCards from "@/components/landing/TestimonialCards";
import { PublicLayout } from "@/layouts/PublicLayout";
import { clearAuthToken, getCurrentUser, getStoredAuthToken, initializeRuntimeConfig } from "@/lib/api";

export function LandingPage() {
  const navigate = useNavigate();
  const [authCheckStatus, setAuthCheckStatus] = useState("idle");

  useEffect(() => {
    let cancelled = false;

    async function maybeRedirectAuthenticatedUser() {
      setAuthCheckStatus("checking");

      try {
        const runtimeConfig = await initializeRuntimeConfig();
        if (cancelled || !runtimeConfig?.auth?.required) {
          if (!cancelled) {
            setAuthCheckStatus("ready");
          }
          return;
        }

        const storedToken = getStoredAuthToken();
        if (!storedToken) {
          if (!cancelled) {
            setAuthCheckStatus("ready");
          }
          return;
        }

        await getCurrentUser();
        if (!cancelled) {
          setAuthCheckStatus("redirecting");
          navigate("/app", { replace: true });
        }
      } catch {
        clearAuthToken();
        if (!cancelled) {
          setAuthCheckStatus("ready");
        }
      }
    }

    void maybeRedirectAuthenticatedUser();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <PublicLayout accent="dark">
      <LandingNavbar />
      <main>
        <HeroSection authCheckStatus={authCheckStatus} />
        <StatsBar />
        <FeatureGrid />
        <HowItWorksSection />
        <TestimonialCards />
        <FAQSection />
        <CTABanner />
      </main>
      <LandingFooter />
    </PublicLayout>
  );
}
