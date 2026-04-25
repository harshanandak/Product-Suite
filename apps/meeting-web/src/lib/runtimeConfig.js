import {
  identityScopeContract,
  meetingCoreContract,
} from "@product-suite/contracts";

const AUTH_TOKEN_KEY = "meeting-agent.auth-token";
const LEGACY_AUTH_TOKEN_KEY = "meeting-agent.auth.token";
const RUNTIME_CONFIG_STORAGE_KEY = "meeting-agent.runtime-config";
const DEFAULT_LOCAL_BACKEND_URL = "http://localhost:8000";
const DEFAULT_LOCAL_API_BASE_URL = `${DEFAULT_LOCAL_BACKEND_URL}/api`;
const LOCAL_DEV_FRONTEND_PORTS = new Set(["3000", "4173", "4174", "4175", "4176", "5173"]);
const identityDeployment = identityScopeContract.deployment;
const identityAuth = identityScopeContract.auth;
const meetingRuntimeConfig = meetingCoreContract.runtimeConfig;
const meetingRuntimeAuth = meetingRuntimeConfig.auth;

const BASE_RUNTIME_CONFIG = {
  appName: "TRANSCRIBE",
  deploymentMode: "oss",
  tenantMode: "single",
  authMode: "none",
  authRequired: false,
  auth: {
    provider: "local",
    neon: {
      auth_url: "",
    },
  },
};

let runtimeConfig = null;
let runtimeConfigInitialized = false;
let runtimeConfigPromise = null;
let authTokenCache = "";

function normalizeBaseUrl(value) {
  return (value || "").trim().replace(/\/$/, "");
}

function stripApiSuffix(value) {
  const normalizedValue = normalizeBaseUrl(value);
  return normalizedValue.endsWith("/api") ? normalizedValue.slice(0, -4) : normalizedValue;
}

function normalizeApiBaseUrl(candidate, fallback = DEFAULT_LOCAL_API_BASE_URL) {
  const backendOrApiBase = normalizeBaseUrl(candidate || "");
  if (!backendOrApiBase) {
    return fallback;
  }

  if (backendOrApiBase.endsWith("/api")) {
    return backendOrApiBase;
  }

  return `${backendOrApiBase}/api`;
}

function safeJsonParse(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function readFrontendEnv(...keys) {
  for (const key of keys) {
    const viteValue = import.meta.env?.[key];
    if (typeof viteValue === "string" && viteValue.trim()) {
      return viteValue.trim();
    }
  }

  if (typeof process !== "undefined" && process?.env) {
    for (const key of keys) {
      const processValue = process.env[key];
      if (typeof processValue === "string" && processValue.trim()) {
        return processValue.trim();
      }
    }
  }

  return "";
}

function readConfiguredBackendEnv() {
  return normalizeBaseUrl(readFrontendEnv("VITE_BACKEND_URL", "VITE_REACT_APP_BACKEND_URL", "REACT_APP_BACKEND_URL"));
}

function readBackendAliasValue(candidate = {}) {
  return (
    candidate.api_base_url ||
    candidate.apiBaseUrl ||
    candidate[meetingRuntimeConfig.backendUrlKey] ||
    candidate.backendUrl ||
    candidate.base_url ||
    candidate.baseUrl ||
    ""
  );
}

function readConfiguredBackendAlias(candidate = {}) {
  return stripApiSuffix(readBackendAliasValue(candidate));
}

function buildDefaultRuntimeConfig() {
  return {
    ...BASE_RUNTIME_CONFIG,
    apiBaseUrl: DEFAULT_LOCAL_API_BASE_URL,
    api_base_url: DEFAULT_LOCAL_API_BASE_URL,
    backendUrl: DEFAULT_LOCAL_BACKEND_URL,
    [meetingRuntimeConfig.backendUrlKey]: DEFAULT_LOCAL_BACKEND_URL,
    baseUrl: DEFAULT_LOCAL_BACKEND_URL,
    base_url: DEFAULT_LOCAL_BACKEND_URL,
    [identityDeployment.deploymentModeKey]: BASE_RUNTIME_CONFIG.deploymentMode,
    [identityDeployment.tenantModeKey]: BASE_RUNTIME_CONFIG.tenantMode,
    auth_mode: BASE_RUNTIME_CONFIG.authMode,
    auth_required: BASE_RUNTIME_CONFIG.authRequired,
  };
}

function deriveAuthConfig(candidateAuth = {}, normalizedConfig) {
  const defaultAuthProvider = normalizedConfig.deploymentMode === "hosted" ? "neon" : "local";

  return {
    ...candidateAuth,
    [identityAuth.requiredKey]: normalizedConfig.authRequired,
    [identityAuth.modeKey]:
      candidateAuth[identityAuth.modeKey] ||
      candidateAuth.auth_mode ||
      normalizedConfig.authMode,
    [identityAuth.providerKey]:
      candidateAuth[identityAuth.providerKey] || defaultAuthProvider,
    [identityAuth.supportedProvidersKey]:
      candidateAuth[identityAuth.supportedProvidersKey] ||
      (normalizedConfig.deploymentMode === "hosted" ? ["email", "google"] : ["email"]),
    [identityAuth.organizationRequiredKey]: Boolean(
      candidateAuth[identityAuth.organizationRequiredKey] ??
        normalizedConfig.tenantMode === "organization"
    ),
    [identityAuth.onboardingRequiredKey]: Boolean(
      candidateAuth[identityAuth.onboardingRequiredKey] ?? false
    ),
    neon: {
      [meetingRuntimeAuth.neonAuthUrlKey]: "",
      ...(candidateAuth.neon || {}),
    },
  };
}

function persistRuntimeConfig(nextConfig) {
  runtimeConfig = nextConfig;
  runtimeConfigInitialized = true;

  if (typeof window !== "undefined") {
    window.__MEETING_AGENT_CONFIG__ = nextConfig;
    try {
      window.localStorage.setItem(RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(nextConfig));
    } catch {
      // Ignore localStorage failures.
    }
  }

  return runtimeConfig;
}

function readInjectedRuntimeConfig() {
  if (typeof window === "undefined") {
    return null;
  }

  const globalCandidate = window.__MEETING_AGENT_CONFIG__ || window.__APP_CONFIG__;
  if (globalCandidate && typeof globalCandidate === "object") {
    return globalCandidate;
  }

  try {
    return safeJsonParse(window.localStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY));
  } catch {
    return null;
  }
}

function resolveWindowOrigin() {
  if (typeof window === "undefined") {
    return "";
  }

  const { hostname = "", origin = "", port = "" } = window.location || {};
  if ((hostname === "localhost" || hostname === "127.0.0.1") && LOCAL_DEV_FRONTEND_PORTS.has(port)) {
    return normalizeBaseUrl(origin);
  }

  return normalizeBaseUrl(origin);
}

function isLocalDevFrontend() {
  if (typeof window === "undefined") {
    return false;
  }

  const { hostname = "", port = "" } = window.location || {};
  return (hostname === "localhost" || hostname === "127.0.0.1") && LOCAL_DEV_FRONTEND_PORTS.has(port);
}

export function resolveConfiguredBackendUrl() {
  const configuredUrl = readConfiguredBackendEnv();
  if (configuredUrl) {
    return configuredUrl;
  }

  return resolveWindowOrigin();
}

export function normalizeRuntimeConfig(candidate = {}, options = {}) {
  const fallbackBackendUrl = normalizeBaseUrl(
    options.fallbackBackendUrl || resolveConfiguredBackendUrl() || DEFAULT_LOCAL_BACKEND_URL
  );
  const deploymentMode =
    candidate[identityDeployment.deploymentModeKey] ||
    candidate.deploymentMode ||
    BASE_RUNTIME_CONFIG.deploymentMode;
  const tenantMode =
    candidate[identityDeployment.tenantModeKey] ||
    candidate.tenantMode ||
    BASE_RUNTIME_CONFIG.tenantMode;
  const authRequired = Boolean(
    candidate.auth_required ??
      candidate.authRequired ??
      candidate.requireAuth ??
      candidate.auth?.required ??
      BASE_RUNTIME_CONFIG.authRequired
  );
  const authMode =
    candidate.auth_mode ||
    candidate.authMode ||
    candidate.auth?.mode ||
    (authRequired ? "token" : BASE_RUNTIME_CONFIG.authMode);
  const apiBaseUrl = normalizeApiBaseUrl(
    candidate.api_base_url ||
      candidate.apiBaseUrl ||
      candidate[meetingRuntimeConfig.backendUrlKey] ||
      candidate.backendUrl ||
      candidate.base_url ||
      candidate.baseUrl ||
      fallbackBackendUrl,
    normalizeApiBaseUrl(fallbackBackendUrl)
  );
  const backendUrl = stripApiSuffix(apiBaseUrl);

  const normalizedConfig = {
    ...buildDefaultRuntimeConfig(),
    ...candidate,
    apiBaseUrl,
    api_base_url: apiBaseUrl,
    backendUrl,
    [meetingRuntimeConfig.backendUrlKey]: backendUrl,
    baseUrl: backendUrl,
    base_url: backendUrl,
    deploymentMode,
    [identityDeployment.deploymentModeKey]: deploymentMode,
    tenantMode,
    [identityDeployment.tenantModeKey]: tenantMode,
    authRequired,
    auth_required: authRequired,
    authMode,
    auth_mode: authMode,
  };

  normalizedConfig.auth = deriveAuthConfig(candidate.auth || {}, normalizedConfig);
  return normalizedConfig;
}

async function readRuntimeConfigFile() {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return {};
  }

  try {
    const response = await fetch("/runtime-config.json", { cache: "no-store" });
    if (!response.ok) {
      return {};
    }

    const rawConfig = await response.text();
    const parsedConfig = safeJsonParse(rawConfig);
    return parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};
  } catch {
    return {};
  }
}

function buildRuntimeConfigFetchError(url, response, detail = "") {
  const suffix = detail ? `: ${detail}` : "";
  return new Error(`Failed to load runtime config from ${url} (${response.status}${suffix})`);
}

async function fetchRemoteRuntimeConfig(backendUrl) {
  const endpoint = `${normalizeBaseUrl(backendUrl)}/api/runtime-config`;
  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).trim();
    } catch {
      detail = "";
    }
    throw buildRuntimeConfigFetchError(endpoint, response, detail);
  }

  return response.json();
}

function validateHostedRuntimeConfig(config, backendUrlSource) {
  if (config.deploymentMode !== "hosted") {
    return config;
  }

  if (!backendUrlSource) {
    throw new Error(
      "Hosted deployment requires a resolvable backend origin. Set VITE_BACKEND_URL or inject runtime-config."
    );
  }

  if (!config.backendUrl) {
    throw new Error("Hosted deployment requires a backendUrl in runtime config.");
  }

  const hostedAuthRequired = Boolean(
    config.authRequired ?? config.auth_required ?? config.auth?.required ?? false
  );
  if (!hostedAuthRequired) {
    throw new Error("Hosted deployment requires auth.required in runtime config.");
  }

  return config;
}

export async function initializeRuntimeConfig({ force = false } = {}) {
  if (runtimeConfigInitialized && runtimeConfig && !force) {
    return runtimeConfig;
  }

  if (runtimeConfigPromise && !force) {
    return runtimeConfigPromise;
  }

  runtimeConfigPromise = (async () => {
    const fileConfig = await readRuntimeConfigFile();
    const injectedConfig = readInjectedRuntimeConfig() || {};
    const staticConfig = { ...injectedConfig, ...fileConfig };
    const envConfiguredBackendUrl = readConfiguredBackendEnv();
    const fileConfiguredBackendUrl = readConfiguredBackendAlias(fileConfig);
    const injectedConfiguredBackendUrl = readConfiguredBackendAlias(injectedConfig);
    const localDevOrigin = resolveWindowOrigin();
    const shouldPreferWindowOrigin =
      isLocalDevFrontend() && !envConfiguredBackendUrl && !fileConfiguredBackendUrl;
    const configuredBackendUrl = normalizeBaseUrl(
      envConfiguredBackendUrl ||
        fileConfiguredBackendUrl ||
        (shouldPreferWindowOrigin ? localDevOrigin : injectedConfiguredBackendUrl) ||
        localDevOrigin
    );
    const forcedBackendUrl =
      envConfiguredBackendUrl || (shouldPreferWindowOrigin ? configuredBackendUrl : "");
    const staticConfigWithResolvedBackend = forcedBackendUrl
      ? {
          ...staticConfig,
          apiBaseUrl: normalizeApiBaseUrl(forcedBackendUrl),
          api_base_url: normalizeApiBaseUrl(forcedBackendUrl),
          backendUrl: forcedBackendUrl,
          [meetingRuntimeConfig.backendUrlKey]: forcedBackendUrl,
          baseUrl: forcedBackendUrl,
          base_url: forcedBackendUrl,
        }
      : staticConfig;
    const initialConfig = normalizeRuntimeConfig(staticConfigWithResolvedBackend, {
      fallbackBackendUrl: configuredBackendUrl || DEFAULT_LOCAL_BACKEND_URL,
    });

    try {
      const remoteConfig = await fetchRemoteRuntimeConfig(configuredBackendUrl || DEFAULT_LOCAL_BACKEND_URL);
      const mergedConfig = normalizeRuntimeConfig(
        {
          ...staticConfigWithResolvedBackend,
          ...remoteConfig,
        },
        {
          fallbackBackendUrl:
            remoteConfig?.[meetingRuntimeConfig.backendUrlKey] ||
            remoteConfig?.backendUrl ||
            configuredBackendUrl ||
            DEFAULT_LOCAL_BACKEND_URL,
        }
      );

      return persistRuntimeConfig(
        validateHostedRuntimeConfig(
          mergedConfig,
          configuredBackendUrl ||
            mergedConfig.backendUrl ||
            mergedConfig[meetingRuntimeConfig.backendUrlKey]
        )
      );
    } catch (error) {
      if (initialConfig.deploymentMode === "hosted") {
        validateHostedRuntimeConfig(initialConfig, configuredBackendUrl);
      }

      if (Object.keys(staticConfig).length > 0) {
        return persistRuntimeConfig(initialConfig);
      }

      throw error;
    }
  })();

  try {
    return await runtimeConfigPromise;
  } finally {
    runtimeConfigPromise = null;
  }
}

export async function loadRuntimeConfig() {
  return initializeRuntimeConfig();
}

export function getRuntimeConfig() {
  if (!runtimeConfig) {
    runtimeConfig = buildDefaultRuntimeConfig();
  }
  return runtimeConfig;
}

export function getCachedRuntimeConfig() {
  return runtimeConfigInitialized ? runtimeConfig : null;
}

export function setRuntimeConfig(nextConfig) {
  return persistRuntimeConfig(
    normalizeRuntimeConfig(nextConfig, {
      fallbackBackendUrl: DEFAULT_LOCAL_BACKEND_URL,
    })
  );
}

export function resolveRuntimeApiBaseUrl(config = getRuntimeConfig()) {
  return config?.apiBaseUrl || DEFAULT_LOCAL_API_BASE_URL;
}

export function getAuthToken() {
  if (authTokenCache) {
    return authTokenCache;
  }

  if (typeof window === "undefined") {
    return "";
  }

  try {
    authTokenCache =
      window.localStorage.getItem(AUTH_TOKEN_KEY) ||
      window.localStorage.getItem(LEGACY_AUTH_TOKEN_KEY) ||
      "";
    return authTokenCache;
  } catch {
    return "";
  }
}

export function setAuthToken(token) {
  authTokenCache = token || "";

  if (typeof window === "undefined") {
    return;
  }

  try {
    if (authTokenCache) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, authTokenCache);
      window.localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, authTokenCache);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore localStorage failures.
  }
}

export function clearAuthToken() {
  setAuthToken("");
}

export function getAuthState() {
  const token = getAuthToken();
  return {
    status: token ? "authenticated" : getRuntimeConfig().authRequired ? "unauthenticated" : "anonymous",
    token,
  };
}
