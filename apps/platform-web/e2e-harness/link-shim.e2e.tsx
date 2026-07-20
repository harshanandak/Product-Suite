import type { ReactNode } from "react";

/**
 * A build-time alias for `@tanstack/react-router` used ONLY by the screenshot
 * harness (see vite.harness.config.ts). It renders `Link` as a plain anchor and
 * stubs `useParams`/`useSearch`, so `ProposalDetail` mounts standalone — no
 * RouterProvider, no Clerk, no backend — to visually verify the accept states.
 * This file is never part of the shipped app bundle.
 */
export function Link({
  to,
  params,
  children,
  ...rest
}: {
  to: string;
  params?: Record<string, string>;
  children: ReactNode;
} & Record<string, unknown>) {
  const href = Object.entries(params ?? {}).reduce(
    (acc, [key, value]) => acc.replace(`$${key}`, value),
    to,
  );
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export const useParams = () => ({ workspace: "acme" });
export const useSearch = () => ({}) as Record<string, string | undefined>;

/**
 * A no-op navigate for the harness — the real `ProposalCard` calls `useNavigate()`
 * for its "View item" / Edit affordances. The harness only screenshots state, so
 * navigation is inert here (there is no router).
 */
export const useNavigate = () => (_options?: unknown): void => {};
