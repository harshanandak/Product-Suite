import "@/App.css";
import { CallbackPage } from "@/pages/CallbackPage";
import { DashboardHomePage } from "@/pages/DashboardHomePage";
import { LandingPage } from "@/pages/LandingPage";
import { MeetingCreatePage } from "@/pages/MeetingCreatePage";
import { MeetingsIndexPage } from "@/pages/MeetingsIndexPage";
import { MeetingWorkspacePage } from "@/pages/MeetingWorkspacePage";
import { SignedOutPage } from "@/pages/SignedOutPage";
import { SignInPage } from "@/pages/SignInPage";

export const meetingRouteCompatibility = {
  standaloneBasePath: "/",
  platformShellBasePath: "/meetings",
  shellOwnedEntryPath: "/meetings",
  runtimeOwner: "meeting-web",
  dataOwner: "meeting-api",
  preservesStandaloneRoutes: true,
};

export function createAppRouter() {
  return [
    {
      path: "/",
      element: <LandingPage />,
    },
    {
      path: "/auth/sign-in",
      element: <SignInPage />,
    },
    {
      path: "/auth/callback",
      element: <CallbackPage />,
    },
    {
      path: "/auth/signed-out",
      element: <SignedOutPage />,
    },
    {
      path: "/app",
      element: <DashboardHomePage />,
    },
    {
      path: "/meetings",
      element: <MeetingsIndexPage />,
    },
    {
      path: "/meetings/new",
      element: <MeetingCreatePage />,
    },
    {
      path: "/meetings/:meetingId",
      element: <MeetingWorkspacePage />,
    },
  ];
}
