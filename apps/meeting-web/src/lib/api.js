import axios from "axios";
import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react";
import {
  identityScopeContract,
  meetingCoreContract,
} from "@product-suite/contracts";

import {
  clearAuthToken as clearRuntimeAuthToken,
  getAuthToken,
  getCachedRuntimeConfig,
  initializeRuntimeConfig,
  setAuthToken as setRuntimeAuthToken,
} from "./runtimeConfig";

let hostedAuthClient = null;
let hostedAuthClientUrl = "";
const identityAuth = identityScopeContract.auth;
const meetingRuntimeAuth = meetingCoreContract.runtimeConfig.auth;

function normalizeBaseUrl(value) {
  return (value || "").trim().replace(/\/$/, "");
}

export { getCachedRuntimeConfig, initializeRuntimeConfig };

export function getStoredAuthToken() {
  return getAuthToken();
}

export function setAuthToken(token) {
  setRuntimeAuthToken(token);
}

export function clearAuthToken() {
  clearRuntimeAuthToken();
}

async function getHostedAuthClient() {
  const runtimeConfig = await initializeRuntimeConfig();
  const authUrl = normalizeBaseUrl(
    runtimeConfig?.auth?.neon?.[meetingRuntimeAuth.neonAuthUrlKey],
  );

  if (!authUrl) {
    throw new Error("Hosted Neon auth is not configured");
  }

  if (!hostedAuthClient || hostedAuthClientUrl !== authUrl) {
    hostedAuthClient = createAuthClient(authUrl, {
      adapter: BetterAuthReactAdapter(),
    });
    hostedAuthClientUrl = authUrl;
  }

  return hostedAuthClient;
}

const api = axios.create({ timeout: 45000 });

api.interceptors.request.use(async (config) => {
  const runtimeConfig = await initializeRuntimeConfig();
  const nextConfig = { ...config };
  nextConfig.baseURL = runtimeConfig.apiBaseUrl;
  nextConfig.headers = { ...(config.headers || {}) };

  const token = getAuthToken();
  if (token) {
    nextConfig.headers.Authorization = `Bearer ${token}`;
  }

  return nextConfig;
});

export const registerUser = (email, password, name) =>
  api.post("/auth/register", { email, password, name });
export const loginUser = (email, password) =>
  api.post("/auth/login", { email, password });
export const signInHostedWithEmail = async ({ email, password }) => {
  const client = await getHostedAuthClient();
  return client.signIn.email({ email, password });
};
export const signUpHostedWithEmail = async ({ email, password, name }) => {
  const client = await getHostedAuthClient();
  return client.signUp.email({ email, password, name });
};
export const signInHostedWithGoogle = async (callbackURL) => {
  const client = await getHostedAuthClient();
  return client.signIn.social({ provider: "google", callbackURL });
};
export const getHostedSession = async () => {
  const client = await getHostedAuthClient();
  return client.getSession();
};
export const getHostedIdentityToken = async () => {
  const runtimeConfig = await initializeRuntimeConfig();
  const client = await getHostedAuthClient();
  const authUrl = normalizeBaseUrl(
    runtimeConfig?.auth?.neon?.[meetingRuntimeAuth.neonAuthUrlKey],
  );
  const fallbackErrors = [];

  if (authUrl && typeof fetch === "function") {
    try {
      const tokenResponse = await fetch(`${authUrl}/token`, {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "application/json",
        },
      });

      if (!tokenResponse.ok) {
        const errorMessage = (await tokenResponse.text()) || "Hosted identity token is unavailable";
        fallbackErrors.push(new Error(errorMessage));
      } else {
        const tokenPayload = await tokenResponse.json().catch(() => ({}));
        const directToken = tokenPayload?.token || "";
        if (typeof directToken === "string" && directToken) {
          return directToken;
        }
      }
    } catch (error) {
      fallbackErrors.push(error instanceof Error ? error : new Error("Hosted identity token is unavailable"));
    }
  }

  let tokenResult = null;
  if (typeof client.token === "function") {
    try {
      tokenResult = await client.token();
    } catch (error) {
      fallbackErrors.push(error instanceof Error ? error : new Error("Hosted identity token is unavailable"));
    }
  }

  if (typeof tokenResult === "string" && tokenResult) {
    return tokenResult;
  }

  if (tokenResult?.error) {
    fallbackErrors.push(new Error(tokenResult.error?.message || "Hosted identity token is unavailable"));
  }

  const tokenValue = tokenResult?.data?.token || tokenResult?.token || "";
  if (typeof tokenValue === "string" && tokenValue) {
    return tokenValue;
  }

  const sessionResult = await client.getSession();
  const sessionToken =
    sessionResult?.data?.session?.token ||
    sessionResult?.session?.token ||
    "";

  if (typeof sessionToken === "string" && sessionToken) {
    return sessionToken;
  }

  throw new Error("Hosted identity token is unavailable: all token sources exhausted", {
    cause: fallbackErrors.at(-1),
  });
};
export const signOutHostedSession = async () => {
  const client = await getHostedAuthClient();
  return client.signOut();
};
export const exchangeHostedSession = async (providerToken) => {
  const runtimeConfig = await initializeRuntimeConfig();
  return api.post("/auth/session/exchange", {
    provider_token: providerToken,
    provider: runtimeConfig?.auth?.[identityAuth.providerKey] || "neon",
  });
};
export const getCurrentUser = () => api.get("/auth/me");
export const getOnboardingState = () => api.get("/auth/onboarding/state");
export const createOrganization = (name, slug) =>
  api.post("/auth/onboarding/organizations", {
    name,
    ...(slug ? { slug } : {}),
  });
export const acceptOrganizationInvite = (inviteToken) =>
  api.post("/auth/onboarding/invitations/accept", { invite_token: inviteToken });

export const createMeeting = (title, engine = "whisper") =>
  api.post("/meetings", { title, engine });
export const listMeetings = () => api.get("/meetings");
export const getMeeting = (id) => api.get(`/meetings/${id}`);
export const updateMeeting = (id, data) => api.put(`/meetings/${id}`, data);
export const deleteMeeting = (id) => api.delete(`/meetings/${id}`);

export const transcribeAudio = (meetingId, formData) =>
  api.post(`/meetings/${meetingId}/transcribe`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });

export const getTranscript = (meetingId) =>
  api.get(`/meetings/${meetingId}/transcript`);

export const generateSummary = (meetingId) =>
  api.post(`/meetings/${meetingId}/summary`);
export const getSummary = (meetingId) =>
  api.get(`/meetings/${meetingId}/summary`);

export const sendChatMessage = (meetingId, content) =>
  api.post(`/meetings/${meetingId}/chat`, { content });
export const getChatHistory = (meetingId) =>
  api.get(`/meetings/${meetingId}/chat`);

export const searchTranscripts = (q) =>
  api.get(`/meetings/search/transcripts`, { params: { q } });

export const exportTranscript = (meetingId, format = "txt") =>
  api.get(`/meetings/${meetingId}/export`, { params: { format } });

export const listEngines = () => api.get("/engines");
export const getHealth = () => api.get("/health");

export const voiceChat = (meetingId, formData) =>
  api.post(`/meetings/${meetingId}/voice-chat`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 45000,
  });
export const listLanguages = () => api.get("/languages");
export const translateText = (text, sourceLang, targetLang) =>
  api.post("/translate", { text, source_language: sourceLang, target_language: targetLang });
export const translateMeetingTranscript = (meetingId, targetLanguage) => {
  const formData = new FormData();
  formData.append("target_language", targetLanguage);
  return api.post(`/meetings/${meetingId}/translate`, formData);
};
