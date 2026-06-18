import { ThemeToggle } from "@product-suite/ui";

/**
 * Shown when no Clerk publishable key is configured, so the app still boots
 * (and dark mode still works) for local/preview inspection. With a key set,
 * `main.tsx` renders the real Clerk-gated app instead.
 */
export function SetupNotice() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-lg font-semibold">Product Suite</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add a Clerk publishable key to enable sign-in.
        </p>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Copy <code className="rounded bg-muted px-1">.env.example</code> to{" "}
            <code className="rounded bg-muted px-1">.env.local</code>
          </li>
          <li>
            Set <code className="rounded bg-muted px-1">VITE_CLERK_PUBLISHABLE_KEY</code>{" "}
            from the Clerk dashboard
          </li>
          <li>Restart the dev server</li>
        </ol>
      </div>
    </div>
  );
}
