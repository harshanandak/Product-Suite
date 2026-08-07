import { createRequire } from "node:module";

const require = createRequire(
  new URL("./apps/platform-web/package.json", import.meta.url),
);
const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["apps/platform-api/src/**/*.ts", "packages/db/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
