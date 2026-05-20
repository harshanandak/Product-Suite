import { Server } from "@hocuspocus/server";

import {
  createHocuspocusServerOptions,
  type CreateHocuspocusServerOptions,
} from "./index";

export interface HocuspocusServerLike {
  listen(): unknown;
}

export type HocuspocusServerConstructor<TServer extends HocuspocusServerLike = Server> = new (
  options: any,
) => TServer;

export function createHocuspocusServer<TServer extends HocuspocusServerLike = Server>(
  options: CreateHocuspocusServerOptions,
  ServerImplementation: HocuspocusServerConstructor<TServer> = Server as HocuspocusServerConstructor<TServer>,
): TServer {
  return new ServerImplementation(createHocuspocusServerOptions(options));
}
