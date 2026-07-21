import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for the Lane C screenshot harness (e2e-harness/). It roots at this
 * folder, aliases `@` to the app `src`, and aliases `@tanstack/react-router` to a
 * Link shim so `ProposalDetail` renders with no RouterProvider/Clerk/backend.
 * Tailwind picks up the real component classes via the `@source` globs in
 * `src/styles.css` (relative to that file, so root-independent).
 */
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@tanstack/react-router",
        replacement: path.resolve(here, "link-shim.e2e.tsx"),
      },
      { find: "@", replacement: path.resolve(here, "../src") },
    ],
  },
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
});
