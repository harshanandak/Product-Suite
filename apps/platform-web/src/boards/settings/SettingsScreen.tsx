import { Plug } from "lucide-react";

/**
 * The connectors that used to live on the (now-deleted) Agent board. Surfaced
 * here as honest coming-soon placeholders — the wiring is NOT implemented in this
 * phase, so these render as inert prototype cards, never as faked live data.
 */
const CONNECTORS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: "Gmail",
    description: "Draft and send email on your behalf from an approved proposal.",
  },
  {
    name: "Slack",
    description: "Post updates and digests to a channel once you approve them.",
  },
  {
    name: "Google Drive",
    description: "Read and attach documents an agent references in its work.",
  },
];

/**
 * Settings SCREEN. The first real Settings content (replacing the old BoardScreen
 * placeholder): an "Agents" section that rehomes what the deleted Agent board
 * carried — the integration Connectors (as clearly-marked coming-soon cards, not
 * live data) plus an agent-configuration placeholder. Mirrors the house style
 * from {@link InboxScreen}: a `<section>` with an `<h1>` header and bordered
 * `bg-card` panels using the shared tokens/indigo primary.
 */
export function SettingsScreen() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage how agents connect to your tools and behave in this workspace.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="settings-agents">
        <h2
          id="settings-agents"
          className="text-base font-semibold text-foreground"
        >
          Agents
        </h2>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Connectors</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Coming soon
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            The integrations agents act through. Not yet configurable — this is a
            preview of what will land here.
          </p>
          <ul className="mt-4 flex list-none flex-col gap-2.5 p-0">
            {CONNECTORS.map((connector) => (
              <li
                key={connector.name}
                className="flex items-start gap-3 rounded-md border border-border bg-background p-3"
              >
                <Plug
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {connector.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {connector.description}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Agent configuration
            </h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Coming soon
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which agents run, tune their autonomy, and set approval
            thresholds. Configuration options will appear here.
          </p>
        </div>
      </section>
    </section>
  );
}
