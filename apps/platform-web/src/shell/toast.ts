/**
 * Minimal transient toast for actions wired in the IA but not implemented in
 * F1 (mirrors the wireframe's `toast('… — not in prototype')`). Replaced by the
 * real notification surface in a later lane.
 */
export function toast(message: string, timeoutMs = 2600): void {
  if (typeof document === "undefined") return;

  let host = document.getElementById("ps-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "ps-toast-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.className =
      "pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2";
    document.body.appendChild(host);
  }

  const toastEl = document.createElement("div");
  toastEl.className =
    "rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md";
  toastEl.textContent = message;
  host.appendChild(toastEl);

  window.setTimeout(() => {
    toastEl.remove();
  }, timeoutMs);
}
