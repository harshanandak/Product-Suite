import type { AgentLinkedObject } from "@/data/agent/transport";

import { normalize, resolveScreen } from "@/shell/boards";

/**
 * Extract the work-item id when the path is the item-detail route
 * (`/w/<workspace>/workboard/item/<id>`), else `null`. Used to decide whether
 * the linked object is a concrete `work_item` or a generic `screen`.
 */
export function workItemIdFromPath(
  pathname: string,
  workspace: string,
): string | null {
  const path = normalize(pathname);
  const prefix = `/w/${workspace}/workboard/item/`;
  if (!path.startsWith(prefix)) return null;
  const id = path.slice(prefix.length).split("/")[0];
  return id && id.length > 0 ? id : null;
}

/**
 * Derive the object a chat thread is scoped to from the current screen
 * (grounding decision): `type: "work_item"` on the item-detail route, else
 * `type: "screen"`. The display title comes from {@link resolveScreen} so the
 * chip and the server context line stay consistent with the rest of the shell.
 * Captured at panel-open time so later navigation never rewrites the thread.
 */
export function resolveLinkedObject(
  pathname: string,
  workspace: string,
): AgentLinkedObject {
  const { title } = resolveScreen(pathname, workspace);
  const itemId = workItemIdFromPath(pathname, workspace);
  if (itemId) return { type: "work_item", id: itemId, title };
  return { type: "screen", id: normalize(pathname), title };
}
