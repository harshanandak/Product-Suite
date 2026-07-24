import { useSearch } from "@tanstack/react-router";

import { WorkboardScreen } from "./WorkboardScreen";

/**
 * Router binding for the work-items surface.
 *
 * {@link WorkboardScreen} stays router-free — it takes its scope as props — so it
 * can be rendered in tests without standing up a router. This wrapper is the only
 * piece that reads the URL, and it lives outside `router.tsx` because that module
 * also exports the router itself; a component there breaks fast refresh.
 *
 * `?project=<id>` is the Projects board's link into a single project's items.
 * The route validates it to a string or drops it, so an unknown value lands on
 * the unscoped board rather than an empty screen.
 */
export function WorkboardIndexRoute() {
  const { project } = useSearch({ from: "/w/$workspace/workboard" });
  return <WorkboardScreen projectId={project} />;
}
