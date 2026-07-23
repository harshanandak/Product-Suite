import { useNavigate, useParams } from "@tanstack/react-router";

import { ProjectsScreen } from "./ProjectsScreen";

/**
 * Router binding for the Projects board.
 *
 * {@link ProjectsScreen} stays deliberately router-free — it reports the opened
 * work item through a callback — so it can be rendered in tests without standing
 * up a router. This thin wrapper is the only piece that knows about navigation,
 * and it lives outside `router.tsx` because that module also exports the router
 * itself; mixing a component into it breaks react-refresh's fast-refresh rule.
 */
export function ProjectsRoute() {
  const navigate = useNavigate();
  const { workspace } = useParams({ from: "/w/$workspace/projects" });

  return (
    <ProjectsScreen
      onOpenItem={(itemId) => {
        void navigate({
          to: "/w/$workspace/workboard/item/$itemId",
          params: { workspace, itemId },
        });
      }}
    />
  );
}
