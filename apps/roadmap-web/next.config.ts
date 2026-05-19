import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // Transpile BlockSuite packages to fix ESM compatibility
  transpilePackages: [
    "@blocksuite/presets",
    "@blocksuite/store",
    "@blocksuite/blocks",
    "@blocksuite/affine-model",
    "@blocksuite/affine-block-surface",
    "@blocksuite/affine-components",
    "@blocksuite/data-view",
    "@blocksuite/icons",
    "@blocksuite/inline",
    "@blocksuite/block-std",
    "@blocksuite/global",
    "@product-suite/agent-core",
    "@product-suite/ui-chat",
    "@product-suite/ui-canvas",
    "@product-suite/ui-meeting",
    "@product-suite/ui-planning",
    "@product-suite/ui-charting",
  ],

  // Point Turbopack at the monorepo root so hoisted workspace dependencies resolve.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },

  // Webpack configuration for BlockSuite ESM compatibility
  // Note: Icon typo bug (CheckBoxCkeckSolidIcon) is fixed via patch-package in patches/
  webpack: (config) => {
    // Preserve existing aliases
    config.resolve.alias = {
      ...config.resolve.alias,
    };

    // Fix ESM module resolution for BlockSuite packages
    // Required because BlockSuite uses ESM with .js extensions
    config.module.rules.push({
      test: /\.m?js$/,
      include: /node_modules\/@blocksuite/,
      resolve: {
        fullySpecified: false,
      },
    });

    return config;
  },
};

export default nextConfig;
