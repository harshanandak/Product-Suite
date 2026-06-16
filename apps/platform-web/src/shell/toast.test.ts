import { describe, it, expect, vi, afterEach } from "vitest";
import { toast } from "./toast";

afterEach(() => {
  vi.useRealTimers();
  document.getElementById("ps-toast-host")?.remove();
});

describe("toast", () => {
  it("appends a node whose text includes the message", () => {
    toast("hello");

    const host = document.getElementById("ps-toast-host");
    expect(host).not.toBeNull();
    expect(host?.textContent).toContain("hello");
  });

  it("removes the toast node after the timeout elapses", () => {
    vi.useFakeTimers();

    toast("hello", 2600);

    const host = document.getElementById("ps-toast-host");
    expect(host?.textContent).toContain("hello");

    vi.advanceTimersByTime(2599);
    expect(host?.textContent).toContain("hello");

    vi.advanceTimersByTime(1);
    expect(host?.textContent).not.toContain("hello");
  });
});
