import { useEffect, useRef, useState } from "react";

import type { WorkItemRepository } from "./repository";
import { useRepositoryContext } from "./RepositoryProvider";
import { getDefaultRepository } from "./use-work-items";

/** A team reference derived from the work items: stable id + display name. */
export interface Team {
  id: string;
  name: string;
}

/** Options for {@link useTeams}. The repo is injectable for tests. */
export interface UseTeamsOptions {
  /** Repository to read through; defaults to the shared module singleton. */
  repository?: WorkItemRepository;
}

/** Return shape of {@link useTeams}. */
export interface UseTeamsResult {
  /** Distinct teams, deduped by id and sorted by display name. */
  teams: Team[];
  /** True while the initial load is in flight. */
  loading: boolean;
}

/**
 * `useTeams` — the distinct set of teams the work items belong to.
 *
 * Until a real `listTeams()` endpoint exists (a Phase-4 backend dependency), the
 * team display NAME rides the deprecated `department` field — the only
 * client-side name carrier — paired with the mandatory `team_id`. Pairs are
 * deduped by id and sorted by name. Follows the {@link useWorkItems} conventions:
 * the repository is resolved once (injected prop wins, else the provider's repo,
 * else the module singleton) and a mounted-flag guards the async set.
 */
export function useTeams(options: UseTeamsOptions = {}): UseTeamsResult {
  const contextRepository = useRepositoryContext();
  const [repository] = useState<WorkItemRepository>(
    () => options.repository ?? contextRepository ?? getDefaultRepository(),
  );

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    repository
      .list()
      .then((items) => {
        if (cancelled || !mountedRef.current) return;
        // First-seen name wins per team id; dedupe then sort by display name.
        const nameById = new Map<string, string>();
        for (const item of items) {
          if (!nameById.has(item.team_id)) {
            nameById.set(item.team_id, item.department);
          }
        }
        const next = [...nameById.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setTeams(next);
      })
      .catch(() => {
        // A failed team read leaves the rail team-less rather than crashing the
        // shell; the work-items surface owns surfacing the real load error.
        if (cancelled || !mountedRef.current) return;
        setTeams([]);
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repository]);

  return { teams, loading };
}
