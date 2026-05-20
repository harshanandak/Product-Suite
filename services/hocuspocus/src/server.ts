import { Server } from "@hocuspocus/server";

import {
  createHocuspocusServerOptions,
  type CreateHocuspocusServerOptions,
} from "./index";

type HocuspocusServerConstructor = new (options: any) => Server;

export function createHocuspocusServer(
  options: CreateHocuspocusServerOptions,
  ServerImplementation: HocuspocusServerConstructor = Server,
): Server {
  return new ServerImplementation(createHocuspocusServerOptions(options));
}
