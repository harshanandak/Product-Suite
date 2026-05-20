import {
  resolveHocuspocusRuntimeConfig,
  type CreateHocuspocusServerOptions,
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
}

export async function startHocuspocusRuntime<TServer extends HocuspocusServerLike = HocuspocusServerLike>(
  options: StartHocuspocusRuntimeOptions<TServer> = {},
): Promise<TServer> {
  const { env = process.env, ServerImplementation, ...serviceOptions } = options;
  const runtime = resolveHocuspocusRuntimeConfig(env);
  const server = createHocuspocusServer(
    {
      runtime,
      ...serviceOptions,
    },
    ServerImplementation,
  );

  await server.listen();
  return server;
}

if (import.meta.main) {
  startHocuspocusRuntime().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
