import {
  HOCUSPOCUS_SERVICE_NAME,
  resolveHocuspocusRuntimeConfig,
  type CreateHocuspocusServerOptions,
  type HocuspocusRuntimeConfig,
} from "./index";
import {
  createHocuspocusServer,
  type HocuspocusServerConstructor,
  type HocuspocusServerLike,
} from "./server";

export interface StartHocuspocusRuntimeOptions<TServer extends HocuspocusServerLike = HocuspocusServerLike>
  extends Omit<CreateHocuspocusServerOptions, "runtime"> {
  env?: Record<string, string | undefined>;
  ServerImplementation?: HocuspocusServerConstructor<TServer>;
  onReadinessChange?: (status: HocuspocusReadinessStatus) => void;
}

export interface HocuspocusReadinessStatus {
  service: typeof HOCUSPOCUS_SERVICE_NAME;
  ready: boolean;
  status: "starting" | "ready";
  runtime: {
    port: number;
    address: string;
  };
}

export function createHocuspocusReadinessStatus(
  runtime: HocuspocusRuntimeConfig,
  ready: boolean,
): HocuspocusReadinessStatus {
  return {
    service: HOCUSPOCUS_SERVICE_NAME,
    ready,
    status: ready ? "ready" : "starting",
    runtime: {
      port: runtime.port,
      address: runtime.address ?? "0.0.0.0",
    },
  };
}

export async function startHocuspocusRuntime<TServer extends HocuspocusServerLike = HocuspocusServerLike>(
  options: StartHocuspocusRuntimeOptions<TServer> = {},
): Promise<TServer> {
  const { env = process.env, ServerImplementation, onReadinessChange, ...serviceOptions } = options;
  const runtime = resolveHocuspocusRuntimeConfig(env);
  onReadinessChange?.(createHocuspocusReadinessStatus(runtime, false));
  const server = createHocuspocusServer(
    {
      runtime,
      ...serviceOptions,
    },
    ServerImplementation,
  );

  await server.listen();
  onReadinessChange?.(createHocuspocusReadinessStatus(runtime, true));
  return server;
}

if (import.meta.main) {
  startHocuspocusRuntime().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
