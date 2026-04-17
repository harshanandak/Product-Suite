import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicRuntimeConfigPath = path.resolve(__dirname, "public", "runtime-config.json");
const distRuntimeConfigPath = path.resolve(__dirname, "dist", "runtime-config.json");

function normalizeBaseUrl(value) {
  return (value || "").trim().replace(/\/$/, "");
}

function normalizeBackendOrigin(value) {
  const normalizedValue = normalizeBaseUrl(value);
  return normalizedValue.endsWith("/api") ? normalizedValue.slice(0, -4) : normalizedValue;
}

function loadBaseRuntimeConfig() {
  try {
    return JSON.parse(readFileSync(publicRuntimeConfigPath, "utf8"));
  } catch {
    return {};
  }
}

function buildRuntimeConfigPayload(env) {
  const baseConfig = loadBaseRuntimeConfig();
  const configuredBackend =
    normalizeBaseUrl(env.VITE_BACKEND_URL) ||
    normalizeBaseUrl(env.VITE_REACT_APP_BACKEND_URL) ||
    normalizeBaseUrl(env.REACT_APP_BACKEND_URL);

  if (!configuredBackend) {
    return `${JSON.stringify(baseConfig, null, 2)}\n`;
  }

  const backendUrl = normalizeBackendOrigin(configuredBackend);
  const apiBaseUrl = `${backendUrl}/api`;

  return `${JSON.stringify(
    {
      ...baseConfig,
      backendUrl,
      backend_url: backendUrl,
      baseUrl: backendUrl,
      base_url: backendUrl,
      apiBaseUrl,
      api_base_url: apiBaseUrl,
    },
    null,
    2
  )}\n`;
}

function runtimeConfigAssetPlugin(env) {
  return {
    name: "meeting-agent-runtime-config-asset",
    apply: "build",
    closeBundle() {
      writeFileSync(distRuntimeConfigPath, buildRuntimeConfigPayload(env), "utf8");
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const backendProxyTarget =
    normalizeBackendOrigin(env.VITE_BACKEND_URL) ||
    normalizeBackendOrigin(env.VITE_REACT_APP_BACKEND_URL) ||
    normalizeBackendOrigin(env.REACT_APP_BACKEND_URL) ||
    "http://127.0.0.1:8000";

  return {
    plugins: [react(), runtimeConfigAssetPlugin(env)],
    server: {
      proxy: {
        "/api": {
          target: backendProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        "/api": {
          target: backendProxyTarget,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
