import axios from "axios";
import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";
import { createMeetingApiClient } from "@product-suite/sdk";
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
const meetingApi = createMeetingApiClient({ transport: api });

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
  return meetingApi.exchangeHostedSession(
    providerToken,
    runtimeConfig?.auth?.[identityAuth.providerKey] || "neon",
  );
};
export const getCurrentUser = () => meetingApi.getCurrentUser();
export const getOnboardingState = () => meetingApi.getOnboardingState();
export const createOrganization = (name, slug) =>
  meetingApi.createOrganization(name, slug);
export const acceptOrganizationInvite = (inviteToken) =>
  meetingApi.acceptOrganizationInvite(inviteToken);

export const createMeeting = (title, engine = "whisper") =>
  meetingApi.createMeeting(title, engine);
export const listMeetings = () => meetingApi.listMeetings();
export const getMeeting = (id) => meetingApi.getMeeting(id);
export const updateMeeting = (id, data) => meetingApi.updateMeeting(id, data);
export const deleteMeeting = (id) => meetingApi.deleteMeeting(id);

export const transcribeAudio = (meetingId, formData) =>
  meetingApi.transcribeAudio(meetingId, formData);

export const getTranscript = (meetingId) =>
  meetingApi.getTranscript(meetingId);

export const generateSummary = (meetingId) =>
  meetingApi.generateSummary(meetingId);
export const getSummary = (meetingId) =>
  meetingApi.getSummary(meetingId);

export const sendChatMessage = (meetingId, content) =>
  meetingApi.sendChatMessage(meetingId, content);
export const getChatHistory = (meetingId) =>
  meetingApi.getChatHistory(meetingId);

export const searchTranscripts = (q) =>
  meetingApi.searchTranscripts(q);

export const exportTranscript = (meetingId, format = "txt") =>
  meetingApi.exportTranscript(meetingId, format);

export const listEngines = () => meetingApi.listEngines();
export const getHealth = () => meetingApi.getHealth();

export const voiceChat = (meetingId, formData) =>
  meetingApi.voiceChat(meetingId, formData);
export const listLanguages = () => meetingApi.listLanguages();
export const translateText = (text, sourceLang, targetLang) =>
  meetingApi.translateText(text, sourceLang, targetLang);
export const translateMeetingTranscript = (meetingId, targetLanguage) =>
  meetingApi.translateMeetingTranscript(meetingId, targetLanguage);
