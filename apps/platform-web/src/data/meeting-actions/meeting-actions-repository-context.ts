import { createContext } from "react";

import type { MeetingActionsRepository } from "./repository";

/**
 * The provided {@link MeetingActionsRepository}, or `null` outside a provider (in
 * which case callers fall back to the module singleton). Lives in its own module
 * so the provider file exports only components — the `react-refresh` boundary the
 * proposals seam follows.
 */
export const MeetingActionsRepositoryContext =
  createContext<MeetingActionsRepository | null>(null);
