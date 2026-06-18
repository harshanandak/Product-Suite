import { SignIn } from "@clerk/clerk-react";

import { ThemeToggle } from "@product-suite/ui";

/**
 * Sign-in route (DESIGN §10: Clerk GA SDK). Hash routing keeps Clerk's internal
 * steps off the app router so no splat route is needed. Dark mode available
 * pre-auth (DESIGN §8).
 */
export function SignInPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <SignIn routing="hash" fallbackRedirectUrl="/" />
    </div>
  );
}
