import { useLocation, useParams } from "@tanstack/react-router";

import { EmptyState } from "@product-suite/ui";

import { DEFAULT_WORKSPACE } from "../env";
import { resolveScreen } from "./boards";

/**
 * Generic board content placeholder for the F1 shell. Each board lane (L1–L4)
 * replaces these with real content in Phase 1. Renders the Empty required state
 * (DESIGN §4) so the chrome reads as a real, navigable app.
 */
export function BoardScreen() {
  const { workspace } = useParams({ strict: false }) as { workspace?: string };
  const slug = workspace ?? DEFAULT_WORKSPACE;
  const { pathname } = useLocation();
  const { board, title } = resolveScreen(pathname, slug);

  return (
    <section className="mx-auto max-w-5xl">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {board?.title ?? "Workspace"}
        </p>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      </header>
      <EmptyState
        title={`${title} — coming soon`}
        description="This board lane ships in Phase 1. The F1 shell establishes the chrome, the navigation law, and the design system this screen builds on."
      />
    </section>
  );
}
