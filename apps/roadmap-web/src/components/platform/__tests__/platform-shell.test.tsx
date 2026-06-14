import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlatformShell } from "../platform-shell";

const currentDir = dirname(fileURLToPath(import.meta.url));
const shellSource = readFileSync(resolve(currentDir, "../platform-shell.tsx"), "utf8");
const switcherSource = readFileSync(resolve(currentDir, "../module-switcher.tsx"), "utf8");

describe("platform shell", () => {
  it("renders module navigation, active state, reserved states, and page content", () => {
    const html = renderToStaticMarkup(
      <PlatformShell
        activePath="/w/acme/meetings/new"
        title="Meeting workspace"
        eyebrow="Product Suite"
        description="Plan and follow up on customer calls."
      >
        <section data-testid="module-content">Meeting module content</section>
      </PlatformShell>,
    );

    expect(html).toContain('href="/w/acme/meetings"');
    expect(html).toContain('href="/w/acme/workboard"');
    expect(html).toContain('href="/w/acme"');
    expect(html).not.toContain('href="/canvas"');
    expect(html).not.toContain('href="/agents"');
    expect(html).not.toContain('href="/settings"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Meetings");
    expect(html).toContain("Workboard");
    expect(html).toContain("Canvas");
    expect(html).toContain("Agents");
    expect(html).toContain("Settings");
    expect(html).toContain("Coming soon");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Meeting workspace");
    expect(html).toContain("Meeting module content");
  });

  it("does not call backend, auth, or module runtime APIs from the shell", () => {
    const combinedSource = `${shellSource}\n${switcherSource}`;

    expect(combinedSource).not.toContain("fetch(");
    expect(combinedSource).not.toContain("createClient");
    expect(combinedSource).not.toContain("@clerk/");
    expect(combinedSource).not.toContain("@supabase/");
    expect(combinedSource).not.toContain("@product-suite/ui-meeting");
    expect(combinedSource).not.toContain("apps/meeting-web");
  });
});
