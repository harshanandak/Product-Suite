import { QueryClient } from "@tanstack/react-query";

const STALE_TIME_MS = 30_000;
const GC_TIME_MS = 5 * 60_000;

const adapterIdentities = new WeakMap<object, number>();
let nextAdapterIdentity = 1;

/** Return a stable primitive id without serializing an adapter into a query key. */
export function getAdapterIdentity(adapter: object): number {
  const existing = adapterIdentities.get(adapter);
  if (existing !== undefined) return existing;
  const identity = nextAdapterIdentity;
  nextAdapterIdentity += 1;
  adapterIdentities.set(adapter, identity);
  return identity;
}

function structuralName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }
  return typeof error.name === "string" ? error.name : undefined;
}

function structuralStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

/** Bounded, adapter-agnostic retry classification for read-only server state. */
export function shouldRetryServerStateQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 1) return false;

  const name = structuralName(error);
  if (name === "AbortError") return false;

  const status = structuralStatus(error);
  if (status !== undefined) return status >= 500 && status <= 599;

  return name === "TypeError" || name === "TimeoutError";
}

export function createServerStateQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: GC_TIME_MS,
        refetchOnWindowFocus: true,
        retry: shouldRetryServerStateQuery,
        staleTime: STALE_TIME_MS,
      },
    },
  });
}
