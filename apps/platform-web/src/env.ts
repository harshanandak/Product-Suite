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
  }
}

export const CLERK_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

const configuredWorkspace = import.meta.env.VITE_DEFAULT_WORKSPACE?.trim();
export const DEFAULT_WORKSPACE: string =
  configuredWorkspace && configuredWorkspace.length > 0
    ? configuredWorkspace
    : "befach-hq";

/** Whether a Clerk publishable key is configured (gates real sign-in). */
export function hasClerkKey(): boolean {
  return CLERK_PUBLISHABLE_KEY.trim().length > 0;
}
