import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  fixtures: false,
  orgId: "org_1" as string | null,
  token: "secret-token",
  userId: "user_1" as string | null,
  useAuth: vi.fn(),
}));

vi.mock("@/fixtures-mode", () => ({
  get USE_FIXTURES() {
    return authState.fixtures;
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => {
    authState.useAuth();
    return {
      getToken: async () => authState.token,
      orgId: authState.orgId,
      userId: authState.userId,
    };
  },
}));

import {
  ServerStateProvider,
  useServerState,
} from ".";

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <ServerStateProvider>{children}</ServerStateProvider>;
}

describe("ServerStateProvider", () => {
  beforeEach(() => {
    authState.fixtures = false;
    authState.orgId = "org_1";
    authState.token = "secret-token";
    authState.userId = "user_1";
    authState.useAuth.mockClear();
  });

  it("provides fixture server state without reading Clerk", () => {
    authState.fixtures = true;
    const { result } = renderHook(() => useServerState(), { wrapper });

    expect(authState.useAuth).not.toHaveBeenCalled();
    expect(result.current.scope).toMatchObject({
      key: "fixtures",
      mode: "fixtures",
      orgId: "fixture-org",
      principalId: "fixture-user",
    });
  });

  it("reuses a client within one auth scope and replaces it synchronously on user or org change", () => {
    const { result, rerender } = renderHook(() => useServerState(), { wrapper });
    const firstClient = result.current.queryClient;
    firstClient.setQueryData(["probe"], "old-scope-data");

    rerender();
    expect(result.current.queryClient).toBe(firstClient);
    expect(result.current.scope.key).toBe("authenticated:user_1:org_1");

    authState.orgId = "org_2";
    rerender();
    const secondClient = result.current.queryClient;
    expect(secondClient).not.toBe(firstClient);
    expect(secondClient.getQueryData(["probe"])).toBeUndefined();
    expect(result.current.scope.key).toBe("authenticated:user_1:org_2");

    authState.userId = "user_2";
    rerender();
    expect(result.current.queryClient).not.toBe(secondClient);
    expect(result.current.scope.key).toBe("authenticated:user_2:org_2");
  });

  it("never includes the bearer token in scope or cached query keys", () => {
    const { result } = renderHook(() => useServerState(), { wrapper });
    result.current.queryClient.setQueryData(
      ["memory-impact", result.current.scope.key, 30],
      { verdict: "helps" },
    );

    expect(JSON.stringify(result.current.scope)).not.toContain(authState.token);
    expect(JSON.stringify(result.current.queryClient.getQueryCache().getAll())).not.toContain(
      authState.token,
    );
  });
});
