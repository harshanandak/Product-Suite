import { describe, expect, test } from "bun:test";

import { createMeetingApiClient } from "./meeting.js";

function createTransport() {
  const calls: Array<{
    body?: unknown;
    method: string;
    options?: unknown;
    path: string;
  }> = [];

  return {
    calls,
    delete: async (path: string, options?: unknown) => {
      calls.push({ method: "delete", path, options });
      return { data: {} };
    },
    get: async (path: string, options?: unknown) => {
      calls.push({ method: "get", path, options });
      return { data: {} };
    },
    post: async (path: string, body?: unknown, options?: unknown) => {
      calls.push({ method: "post", path, body, options });
      return { data: {} };
    },
    put: async (path: string, body?: unknown, options?: unknown) => {
      calls.push({ method: "put", path, body, options });
      return { data: {} };
    },
  };
}

describe("meeting API client", () => {
  test("rejects transports missing required HTTP methods", () => {
    expect(() => createMeetingApiClient({ transport: {} as never })).toThrow(
      "Meeting API transport requires get, post, put, and delete methods",
    );
  });

  test("exposes the meeting API surface", () => {
    const client = createMeetingApiClient({
      transport: createTransport(),
    });

    expect(Object.keys(client).sort()).toEqual([
      "acceptOrganizationInvite",
      "createMeeting",
      "createOrganization",
      "deleteMeeting",
      "exchangeHostedSession",
      "exportTranscript",
      "generateSummary",
      "getChatHistory",
      "getCurrentUser",
      "getHealth",
      "getMeeting",
      "getOnboardingState",
      "getSummary",
      "getTranscript",
      "listEngines",
      "listLanguages",
      "listMeetings",
      "searchTranscripts",
      "sendChatMessage",
      "transcribeAudio",
      "translateMeetingTranscript",
      "translateText",
      "updateMeeting",
      "voiceChat",
    ]);
  });

  test("maps auth and onboarding endpoints to canonical request shapes", async () => {
    const transport = createTransport();
    const client = createMeetingApiClient({ transport });

    await client.getCurrentUser();
    await client.getOnboardingState();
    await client.createOrganization("Team Alpha", "team-alpha");
    await client.createOrganization("Team Beta");
    await client.acceptOrganizationInvite("invite-123");
    await client.exchangeHostedSession("provider-token", "neon");

    expect(transport.calls).toEqual([
      { method: "get", path: "/auth/me", options: undefined },
      { method: "get", path: "/auth/onboarding/state", options: undefined },
      {
        method: "post",
        path: "/auth/onboarding/organizations",
        body: { name: "Team Alpha", slug: "team-alpha" },
        options: undefined,
      },
      {
        method: "post",
        path: "/auth/onboarding/organizations",
        body: { name: "Team Beta" },
        options: undefined,
      },
      {
        method: "post",
        path: "/auth/onboarding/invitations/accept",
        body: { invite_token: "invite-123" },
        options: undefined,
      },
      {
        method: "post",
        path: "/auth/session/exchange",
        body: { provider_token: "provider-token", provider: "neon" },
        options: undefined,
      },
    ]);
  });

  test("maps meeting endpoints and encodes dynamic path segments", async () => {
    const transport = createTransport();
    const client = createMeetingApiClient({ transport });

    await client.createMeeting("Planning", "whisper");
    await client.listMeetings();
    await client.getMeeting("meeting/123");
    await client.updateMeeting("meeting/123", { title: "Updated" });
    await client.deleteMeeting("meeting/123");
    await client.getTranscript("meeting/123");
    await client.generateSummary("meeting/123");
    await client.getSummary("meeting/123");
    await client.sendChatMessage("meeting/123", "hello");
    await client.getChatHistory("meeting/123");
    await client.searchTranscripts("roadmap");
    await client.exportTranscript("meeting/123", "md");

    expect(transport.calls).toEqual([
      {
        method: "post",
        path: "/meetings",
        body: { title: "Planning", engine: "whisper" },
        options: undefined,
      },
      { method: "get", path: "/meetings", options: undefined },
      { method: "get", path: "/meetings/meeting%2F123", options: undefined },
      {
        method: "put",
        path: "/meetings/meeting%2F123",
        body: { title: "Updated" },
        options: undefined,
      },
      { method: "delete", path: "/meetings/meeting%2F123", options: undefined },
      { method: "get", path: "/meetings/meeting%2F123/transcript", options: undefined },
      { method: "post", path: "/meetings/meeting%2F123/summary", body: undefined, options: undefined },
      { method: "get", path: "/meetings/meeting%2F123/summary", options: undefined },
      {
        method: "post",
        path: "/meetings/meeting%2F123/chat",
        body: { content: "hello" },
        options: undefined,
      },
      { method: "get", path: "/meetings/meeting%2F123/chat", options: undefined },
      {
        method: "get",
        path: "/meetings/search/transcripts",
        options: { params: { q: "roadmap" } },
      },
      {
        method: "get",
        path: "/meetings/meeting%2F123/export",
        options: { params: { format: "md" } },
      },
    ]);
  });

  test("preserves multipart and utility endpoint options", async () => {
    const transport = createTransport();
    const client = createMeetingApiClient({ transport });
    const transcriptForm = new FormData();
    const voiceForm = new FormData();

    await client.transcribeAudio("meeting/123", transcriptForm);
    await client.voiceChat("meeting/123", voiceForm);
    await client.translateText("hello", "en", "es");
    await client.translateMeetingTranscript("meeting/123", "fr");
    await client.listEngines();
    await client.listLanguages();
    await client.getHealth();

    expect(transport.calls[0]).toEqual({
      method: "post",
      path: "/meetings/meeting%2F123/transcribe",
      body: transcriptForm,
      options: {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 30000,
      },
    });
    expect(transport.calls[1]).toEqual({
      method: "post",
      path: "/meetings/meeting%2F123/voice-chat",
      body: voiceForm,
      options: {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 45000,
      },
    });
    expect(transport.calls[2]).toEqual({
      method: "post",
      path: "/translate",
      body: { text: "hello", source_language: "en", target_language: "es" },
      options: undefined,
    });
    expect(transport.calls[3]?.method).toBe("post");
    expect(transport.calls[3]?.path).toBe("/meetings/meeting%2F123/translate");
    expect(transport.calls[3]?.body).toBeInstanceOf(FormData);
    expect(transport.calls.slice(4)).toEqual([
      { method: "get", path: "/engines", options: undefined },
      { method: "get", path: "/languages", options: undefined },
      { method: "get", path: "/health", options: undefined },
    ]);
  });
});
