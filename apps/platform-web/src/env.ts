/**
 * Typed build-time environment access (DESIGN §10: Clerk GA SDK, Vite SPA).
 * All client env vars are VITE_-prefixed and embedded at build time.
 */

declare global {
  interface ImportMetaEnv {
    readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
    readonly VITE_DEFAULT_WORKSPACE?: string;
    /** Set to "true" only on preview builds to enable the React Grab dev overlay. */
    readonly VITE_ENABLE_REACT_GRAB?: string;
    /**
     * DEV-ONLY: set to "true" (via `bun run dev:fixtures`) to serve in-memory
     * fixture data and bypass the Clerk auth gate for local visual review. Has
     * NO effect in a production build — `import.meta.env.DEV` is compile-time
     * `false` there, so the guard folds away (see `fixtures-mode.ts`).
     */
    readonly VITE_USE_FIXTURES?: string;
    /**
     * Origin of the platform API (no trailing slash), e.g.
     * `https://api.example.com`. Empty/unset ⇒ same-origin `/api/*` (the Vite
     * dev proxy or a co-hosted deploy serves it).
     */
    readonly VITE_API_BASE_URL?: string;
  }
}

export const CLERK_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

/**
 * Base origin for platform-API calls. Empty string ⇒ same-origin requests to
 * `/api/*` (dev proxy or co-hosted prod). Set `VITE_API_BASE_URL` to target a
 * cross-origin API host.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

const configuredWorkspace = import.meta.env.VITE_DEFAULT_WORKSPACE?.trim();
export const DEFAULT_WORKSPACE: string =
  configuredWorkspace && configuredWorkspace.length > 0
    ? configuredWorkspace
    : "befach-hq";

/** Whether a Clerk publishable key is configured (gates real sign-in). */
export function hasClerkKey(): boolean {
  return CLERK_PUBLISHABLE_KEY.trim().length > 0;
}
