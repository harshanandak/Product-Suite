/**
 * Whether a chat error is the backend's 403 "no active organization" — the AI
 * SDK surfaces the response body as the error message. Distinguished so the panel
 * can show a friendly org-required view instead of a scary chat error bubble.
 *
 * Lives in its own module (not beside {@link AgentChatPanel}) so the panel file
 * only exports a component — keeping React Fast Refresh's single-export boundary
 * clean (`react-refresh/only-export-components`).
 */
export function isOrgRequiredError(error: Error | undefined): boolean {
  return !!error && /no active organization/i.test(error.message);
}
