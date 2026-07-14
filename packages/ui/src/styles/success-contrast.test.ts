import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guards the AA contrast of the `--success` / `--success-foreground` pair the
 * Accept button renders as `bg-success text-success-foreground`. A CodeRabbit
 * review caught the original green failing WCAG AA (3.52:1 light, 2.48:1 dark);
 * this parses the REAL token values from tokens.css and fails the build if
 * either theme block drops below 4.5:1, so a future tweak can't silently regress.
 */
const AA_NORMAL = 4.5;

function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminance([L, C, H]: [number, number, number]): number {
  const [r, g, b] = oklchToLinear(L, C, H).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

/** Extract the `oklch(L C H)` triple for `name` within the `:root {…}` or `.dark {…}` block. */
function tokenIn(block: ":root" | ".dark", name: string): [number, number, number] {
  const start = block === ":root" ? ":root" : "\\.dark";
  const blockRe = new RegExp(`${start}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const body = blockRe.exec(css)?.[1];
  if (!body) throw new Error(`block ${block} not found`);
  const m = new RegExp(`${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(body);
  if (!m) throw new Error(`${name} not found in ${block}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe("success token contrast (WCAG AA)", () => {
  for (const block of [":root", ".dark"] as const) {
    it(`bg-success / text-success-foreground clears AA in ${block}`, () => {
      const surface = tokenIn(block, "--success");
      const foreground = tokenIn(block, "--success-foreground");
      expect(contrast(foreground, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }
});
