# User Flows And Perception Map — Product Suite

> **Superseded in part (2026-06-12):** `DESIGN.md` is the canonical contract. Where this doc conflicts (e.g. "Plan/Docs/Insights" app names, "5 groups", module-first framing), DESIGN.md wins: four boards (Workboard, Meeting board, Canvas board, Agent board) + Home as meta-view, the object ladder (project → work item → task), and the universal Plan→Do→Review→Done loop. The flows (§4) and personas (§5) remain valid.

Date: 2026-06-11 (revised same day with founder decisions — see §7)
Companion to: `plan-evaluation-2026-06-11.md`
Grounded in: roadmap-web route tree (`(dashboard)/workspaces/[id]/*`), meeting-web pages, PR17 platform shell plan.

## 1. The perception problem: three competing mental models

The suite currently asks users to hold three different models of "where am I?":

| Model | Where it lives | The container is... |
| --- | --- | --- |
| Workspace-centric | roadmap-web | a **workspace**; everything (timeline, work items, canvas, AI, analytics) is a view inside it |
| Object-centric | meeting-web | a **meeting**; you go to a meeting and work inside it |
| Module-centric | planned PR21 shell (`/meetings`, `/roadmap`, `/canvas`, `/agents`) | a **product module**; you switch apps like Zoho |

If PR21 ships the module-centric shell *on top of* the workspace-centric roadmap, the user gets three nesting levels: **module switcher → workspace picker → sub-tab**, and the same noun appears at two levels (`/canvas` as a module AND `workspaces/[id]/canvas` as a sub-app). That is the single biggest perception risk in the current plan.

**Recommendation: make the workspace the one container; modules are views into it.**

```text
/w/[workspace]/meetings
/w/[workspace]/roadmap
/w/[workspace]/docs        (canvas)
/w/[workspace]/agents
/w/[workspace]/settings
/settings                  (account-level only)
```

- One workspace switcher (top-left, like Slack/Linear/Notion), one module nav. Never both as peers.
- This also answers a question the module-centric shell can't: "/meetings shows meetings from *which* workspace?" Cross-workspace aggregate views can come later as a "Home" surface; they should not be the foundation.
- Agents benefit equally: every API/tool call is workspace-scoped by URL shape, which matches the permission model (workspace membership) one-to-one.

## 2. The sub-app sprawl inside Roadmap

A user inside one workspace currently sees up to 13 sibling surfaces: `work-items`, `timeline`, `execution`, `canvas`, `ai`, `analytics`, `insights`, `review`, `research`, `strategies`, `collaboration`, `onboarding`, `settings`. Nobody can form a mental model of 13 siblings, and several names are indistinguishable from the outside:

- `analytics` vs `insights` vs `review` vs `research` — four surfaces a user will perceive as "the place with charts about my stuff."
- `work-items` vs `timeline` vs `execution` — three surfaces that all mean "my plan."
- `collaboration` vs the fact that everything is collaborative.
- `strategies` vs `roadmap` itself.

**Recommendation: collapse to at most 5 user-facing groups per workspace:**

| Group | Absorbs | User verb |
| --- | --- | --- |
| **Plan** | work-items, timeline, execution, strategies, dependencies | "decide and schedule" |
| **Meetings** | meeting-web surfaces | "capture what happened" |
| **Docs** | canvas (rename: users know "docs/whiteboard", not "canvas") | "think and write" |
| **Insights** | analytics, insights, review, research | "see how it's going" |
| **Agents** | ai, agent runs/audit | "delegate and supervise" |

Keep the existing routes as deep links if needed, but navigation shows 5 items, not 13. This is also the cheapest possible change with the highest perceived-quality gain — it's nav and naming, not data.

## 3. Agents: ambient capability, not a destination

Users don't "go to the agents app" to get work done — they do work and delegate from where they are. The `/agents` module should be the **management surface** (configure, audit runs, review pending approvals), while the actual agent interaction is ambient:

- An "ask/delegate" affordance present in every module (the existing chat threads are this).
- Agent-produced changes appear *in the module they affect* (a drafted work item shows up in Plan, flagged as agent-proposed, with accept/reject).
- The agents page answers: what ran, what did it touch, what does it want approval for, what did it cost.

This matches the perception people already have from Claude/Copilot: assistant is everywhere, audit is one place. It also defines the agent-API shape: agents act *on module resources*, and write attribution + approval state are first-class fields (reinforces the Agent Access Surface PR from the plan evaluation).

## 4. The flows to actually develop

Ordered by priority. Each has a success event so PR23 analytics can measure it.

### Flow 1 — First value (the make-or-break flow)
Sign up → create/join workspace → **upload or record a meeting → summary + extracted decisions appear**. Target: under 5 minutes, zero configuration.
- Today this is impossible without visiting two products with two auth systems. Post-PR21b it must be one shell.
- There are currently *three* onboarding surfaces (`(dashboard)/onboarding`, `workspaces/[id]/onboarding`, meeting-web's DashboardHome). Define one first-run path; the other two become contextual empty-states, not destinations.
- Success event: `first_value` (first summary viewed).

### Flow 2 — The core loop: Capture → Decide → Plan → Track
1. Meeting happens → transcript + summary (Meetings)
2. Summary surfaces decisions/action items → one click converts to work items (Meetings → Plan)
3. Work items get scheduled on the timeline (Plan)
4. Next meeting's prep shows progress on those items (Plan → Meetings, closing the loop)

This loop is the *reason* the suite exists as one product — it's what neither a standalone meeting tool nor a standalone roadmap tool can do. Step 2 is the golden seam; it should be the product acceptance gate for PR21. Without it, the shell is just a shared nav bar.
- Success events: `meeting_to_workitem_created`, `workitem_completed_with_meeting_origin`.

### Flow 3 — Delegate to an agent
From any module: "draft a roadmap from this meeting" / "summarize this quarter's progress" → agent proposes → user reviews diff → accept/reject → audit trail records actor + on-behalf-of.
- The review/approval surface is the trust-building UX. Agents that silently mutate data destroy trust; agents whose every action is reviewable build it.
- Success events: `agent_task_delegated`, `agent_proposal_accepted`.

### Flow 4 — Invite and collaborate
Invite teammate → email → they land **in the inviting workspace, on the object that prompted the invite** (not on a generic dashboard). Realtime presence on docs/canvas makes the suite feel alive.
- Success events: `invite_sent`, `invite_activated_in_workspace`.

### Flow 5 — Return visit
Open the suite next morning → land on a workspace **Home**: what changed since you left (new meeting summaries, agent runs completed, items that moved). This is the retention flow and currently doesn't exist anywhere — `dashboard` is a list, not a digest.
- Success event: `return_visit_engaged`.

## 5. What each persona perceives

- **Founder/PM (primary buyer):** wants Flow 1 fast and Flow 2 reliable. Perceives quality through: one login, one workspace concept, decisions never lost between meeting and plan. Will churn on: 13-tab navigation, two sign-ins, "where did that action item go?"
- **Teammate (invited, lighter use):** mostly consumes — reads summaries, updates own items, joins docs. Perceives quality through Flow 4 landing precision and not being forced through founder-grade onboarding. Needs a *reader-grade* UI, not 13 tabs.
- **Agent (programmatic user):** perceives the product through the SDK/API only. Needs: workspace-scoped resources (URL model in §1 maps directly), stable typed contracts, idempotent writes, explicit approval states. If the human IA is clean, the agent API falls out of it almost for free — another argument for fixing §1/§2 before PR21.

## 6. Concrete changes this implies for the PR plan

1. **PR21's route model should be workspace-first** (`/w/[id]/<module>`), not module-first (`/meetings`, `/roadmap` as top-level). This contradicts the current PR17/PR21 route reservation and should be re-decided before any shell code. Top-level module paths can 302 into the user's active workspace.
2. **Add a nav-consolidation slice** (cheap, high impact): collapse the 13 workspace sub-apps into the 5 groups above. Pure UI/naming; no schema changes.
3. **Flow 2 step 2 (meeting → work items) is the PR21 product gate**, replacing "user can navigate between modules" as the merge gate. Navigation is plumbing; the conversion seam is the product.
4. **Rename `canvas` → `docs`** in user-facing nav (keep internal package names). "Canvas" describes the technology; "Docs" describes what users come to do. Also resolves the BlockSuite question's blast radius — a "Docs" group can swap editors later without renaming the product.
5. **`/agents` becomes supervise/audit; delegation is ambient** via the existing chat affordance in each module.
6. **Build the workspace Home digest** (Flow 5) before broad launch — it's the retention surface and gives agent runs a natural reporting place.

## 7. Founder decisions (2026-06-11) — locked direction

These decisions supersede anything above that conflicts.

### 7.1 Unified shell with two-level sidebar — full UI overhaul accepted

- Meeting stops being a separate application in every sense: one shell, one sidebar, one auth, one design system. Rebuild the UI from scratch if needed.
- Navigation model: an **app switcher** (the 4–5 apps: Meetings, Plan/Roadmap, Docs, Agents, Settings) lives persistently in the sidebar (top of sidebar or bottom bar — to be decided in design). Entering an app swaps the rest of the sidebar to **that app's own options** (its sub-views).
- This gives users constant answers to "which app am I in?" and "what can I do here?", and makes cross-app switching one click. It is the Linear/Slack/Notion pattern and is compatible with the workspace-first URL model in §1: workspace switcher above the app switcher.
- Implication for the PR plan: PR21 is no longer "mount Meeting in a shell" — it is "build the new platform shell IA" with the app-switcher + contextual-sidebar pattern, and the Meeting UI is rebuilt into it (consuming `meeting-api` via the SDK; `meeting-web` retires).

### 7.2 Meeting → tasks is the core product seam (deep integration)

The reason Meeting was brought into the suite: a standalone meeting tool has little value. The integrated loop:

1. Meeting summary extracts decisions and action items.
2. Action items are **automatically converted into tasks** (work items in Plan).
3. Tasks are **auto-assigned to the right user**, based on member skills/roles and who exists in the workspace.
4. The assignee just reviews and accepts — work appears in their queue without anyone transcribing notes into a tracker.

Design constraints learned from this:
- Auto-assignment needs a member skill/role profile (lightweight: role + tags), and a confidence threshold — below it, the task lands unassigned in a triage queue rather than guessing.
- Everything auto-created must be **reviewable and reversible** (accept/edit/reject), with provenance back to the exact transcript segment. Provenance is the trust feature.
- **Action items and work items are one record, not a sync** (founder confirmation, 2026-06-11): accepting a proposed action item creates a Plan-owned work item; the meeting's action-item list is a provenance-filtered view of those same work items. No duplicate tables, no sync job. See DESIGN.md §3 principle 4.
- This makes Flow 2 (Capture → Decide → Plan → Track) the PR21 product gate, now with auto-assignment as part of the seam.

### 7.3 Agent vision clarified: from chat-assistant to autonomous worker

Current state: the chat option acts as an in-app assistant (reads app data, makes changes when asked). Target state: an agent that **independently works on tasks** — running multiple sessions in parallel, launching multiple researchers at once, thinking through ideas, planning, and executing structures — surfaced natively in the app.

What this requires (feeds the "Agent Access Surface" PR):
- **Agent runs as first-class workspace objects** (`agent.runs` / `agent.tasks` schema already reserved in PR19): status, progress, cost, artifacts produced.
- **A run dashboard** in the Agents app: parallel sessions visible, each inspectable — this is the §3 supervision surface, now load-bearing.
- **An approval queue**: autonomous work products (research docs, proposed plans, drafted tasks) arrive as proposals to accept/reject, same review pattern as meeting auto-tasks — one consistent "review what was done for you" UX across the whole suite.
- **Machine credentials and attribution**: long-running parallel sessions cannot ride on a browser session token; they need service credentials scoped to the workspace, and every write tagged with run ID + on-behalf-of user.
- **Backend-mediated data access** (see plan-evaluation §2) becomes even more clearly correct: agents and humans call the same APIs; there is one permission model to secure.

### 7.4 Flow list update

- Flow 2 upgraded: auto task creation + skill-based auto-assignment + review queue (was: one-click conversion).
- Flow 3 upgraded: delegation can spawn multi-session autonomous runs; the review/approval surface covers both agent proposals and meeting auto-tasks.
- New Flow 6 — **Supervise autonomous work**: open Agents app → see running/finished sessions → inspect artifacts → approve into the workspace. Success events: `agent_run_started`, `agent_run_artifact_approved`, parallel-session count per workspace.
