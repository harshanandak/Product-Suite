import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentThreadsAdapter } from "./agent/threads";
import {
  agentChatTransportConfig,
  createAgentChatTransport,
} from "./agent/transport";
import { createNetworkMeetingActionsRepository } from "./meeting-actions/network-repository";
import { createMemoriesAdapter } from "./memories/adapter";
import { createMemoryImpactAdapter } from "./memory-impact/adapter";
import { createNetworkProposalRepository } from "./proposals/network-repository";
import { createNetworkWorkItemRepository } from "./work-items/network-repository";

type TokenResolver = () => Promise<string | null>;

interface RequestResult {
  api?: string;
  headers?: Record<string, string>;
}

interface FactoryCase {
  name: string;
  create: (baseUrl: string, getToken: TokenResolver) => unknown;
  request: (
    baseUrl: string,
    getToken: TokenResolver,
  ) => Promise<RequestResult>;
  relativeUrl: string;
  usesFetch: boolean;
  signedOutRejects?: string;
}

const factories: FactoryCase[] = [
  {
    name: "items repository",
    create: (baseUrl, getToken) =>
      createNetworkWorkItemRepository({ baseUrl, getToken }),
    request: async (baseUrl, getToken) => {
      await createNetworkWorkItemRepository({ baseUrl, getToken }).list();
      return {};
    },
    relativeUrl: "/api/work-items",
    usesFetch: true,
  },
  {
    name: "meeting actions repository",
    create: (baseUrl, getToken) =>
      createNetworkMeetingActionsRepository({ baseUrl, getToken }),
    request: async (baseUrl, getToken) => {
      await createNetworkMeetingActionsRepository({ baseUrl, getToken }).list();
      return {};
    },
    relativeUrl: "/api/agent/meeting-candidates",
    usesFetch: true,
    signedOutRejects: "Not signed in",
  },
  {
    name: "agent threads adapter",
    create: (apiBase, getToken) =>
      createAgentThreadsAdapter({ apiBase, getToken }),
    request: async (apiBase, getToken) => {
      await createAgentThreadsAdapter({ apiBase, getToken }).list();
      return {};
    },
    relativeUrl: "/api/agent/threads",
    usesFetch: true,
  },
  {
    name: "agent chat transport",
    create: (apiBase, getToken) =>
      createAgentChatTransport({
        apiBase,
        getToken,
        getContext: () => undefined,
      }),
    request: async (apiBase, getToken) => {
      const config = agentChatTransportConfig({
        apiBase,
        getToken,
        getContext: () => undefined,
      });
      return { api: config.api, headers: await config.headers() };
    },
    relativeUrl: "/api/agent/chat",
    usesFetch: false,
  },
  {
    name: "memories adapter",
    create: (apiBase, getToken) => createMemoriesAdapter({ apiBase, getToken }),
    request: async (apiBase, getToken) => {
      await createMemoriesAdapter({ apiBase, getToken }).list();
      return {};
    },
    relativeUrl: "/api/memories",
    usesFetch: true,
  },
  {
    name: "memory impact adapter",
    create: (apiBase, getToken) =>
      createMemoryImpactAdapter({ apiBase, getToken }),
    request: async (apiBase, getToken) => {
      await createMemoryImpactAdapter({ apiBase, getToken }).get();
      return {};
    },
    relativeUrl: "/api/agent/memory-impact?window=30",
    usesFetch: true,
  },
  {
    name: "proposals repository",
    create: (baseUrl, getToken) =>
      createNetworkProposalRepository({ baseUrl, getToken }),
    request: async (baseUrl, getToken) => {
      await createNetworkProposalRepository({ baseUrl, getToken }).list();
      return {};
    },
    relativeUrl: "/api/agent/proposals",
    usesFetch: true,
  },
];

const invalidBases = [
  ["HTTP", "http://api.example.com"],
  ["HTTP localhost", "http://localhost:3000"],
  ["HTTP loopback", "http://127.0.0.1:3000"],
  ["FTP", "ftp://api.example.com"],
  ["protocol-relative", "//api.example.com"],
  ["malformed", "api.example.com"],
  ["whitespace-only", "   "],
  ["username", "https://user@api.example.com"],
  ["password", "https://:password@api.example.com"],
] as const;

const validHttpsBases = [
  "https://api.example.com",
  "https://10.0.0.2",
  "https://127.0.0.1",
] as const;

function stubSuccessfulFetch() {
  const fetchSpy = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response("[]", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(factories)("$name API base security", (factory) => {
  it.each(validHttpsBases)(
    "preserves bearer token and request behavior for HTTPS base %s",
    async (baseUrl) => {
      const fetchSpy = stubSuccessfulFetch();
      const getToken = vi.fn<() => Promise<string | null>>(
        async () => "secure-token",
      );

      const result = await factory.request(baseUrl, getToken);

      expect(getToken).toHaveBeenCalledOnce();
      if (factory.usesFetch) {
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(String(fetchSpy.mock.calls[0]![0])).toBe(
          `${baseUrl}${factory.relativeUrl}`,
        );
        const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<
          string,
          string
        >;
        expect(headers.Authorization).toBe("Bearer secure-token");
      } else {
        expect(result.api).toBe(`${baseUrl}${factory.relativeUrl}`);
        expect(result.headers).toEqual({
          Authorization: "Bearer secure-token",
        });
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    },
  );

  it("accepts exact empty and preserves the relative same-origin URL", async () => {
    const fetchSpy = stubSuccessfulFetch();
    const getToken = vi.fn<() => Promise<string | null>>(async () => "token");

    const result = await factory.request("", getToken);

    expect(getToken).toHaveBeenCalledOnce();
    if (factory.usesFetch) {
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(factory.relativeUrl);
    } else {
      expect(result.api).toBe(factory.relativeUrl);
    }
  });

  it.each(invalidBases)(
    "rejects %s before token resolution or fetch",
    (_label, baseUrl) => {
      const fetchSpy = stubSuccessfulFetch();
      const getToken = vi.fn<() => Promise<string | null>>(async () => "token");

      expect(() => factory.create(baseUrl, getToken)).toThrow();
      expect(getToken).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("preserves signed-out behavior", async () => {
    const fetchSpy = stubSuccessfulFetch();
    const getToken = vi.fn<() => Promise<string | null>>(async () => null);

    if (factory.signedOutRejects) {
      await expect(factory.request("https://api.example.com", getToken)).rejects.toThrow(
        factory.signedOutRejects,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } else {
      const result = await factory.request("https://api.example.com", getToken);
      if (factory.usesFetch) {
        const headers = fetchSpy.mock.calls[0]![1]?.headers as
          | Record<string, string>
          | undefined;
        expect(headers?.Authorization).toBeUndefined();
      } else {
        expect(result.headers).toEqual({});
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    }
    expect(getToken).toHaveBeenCalledOnce();
  });
});
