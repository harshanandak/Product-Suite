# Collapsible Rail — Hover-Flyout + Compact Board Switcher (design)

**Bead:** product-suite (Phase 1 shell) · **Increment:** rail interaction (follows the basic collapse shipped in PR #33)
**Date:** 2026-06-26 · **Branch:** stacked on `feat/l1-workboard-graph` (new branch)
**Status:** approved — validated in a throwaway smoke (`rail-smoke.tsx`) and signed off 2026-06-26

---

## 1. Goal & binding constraints

Make the **collapsed rail the comfortable default** by revealing on demand instead of showing
everything at rest, and declutter the board dock. Two behaviors, both approved live in the smoke:

1. **Hover-flyout.** While collapsed (64px), hovering — or keyboard-focusing — the rail flies it
   out to full width (220px) as an **overlay over the content** (the canvas/table underneath does
   **not** reflow). Leaving / blurring collapses it back.
2. **Board nav reveals on expand, not via a dropdown.** At rest the foot of the rail shows **only
   the active board's icon**. Once expanded it shows **all boards directly** as a clickable row —
   no dropdown (the flyout already does the "reveal" a dropdown would).

Binding constraints (DESIGN §2, §3 principle 1):

- **Orientation is the chrome's job.** Collapsed entries keep tooltips + programmatic names; the
  active screen keeps `aria-current="page"` (shipped in PR #33). The flyout must be reachable by
  keyboard, not hover-only.
- **No content reflow on hover.** The flyout is an overlay; only *pinning* reflows the grid.
- **This revises DESIGN §2** (the dock was "always visible, the same five icons"). Update the doc
  as part of the change.

## 2. Interaction model — three visual states, two persisted

| State | Width | Content | Persisted? | Trigger |
| --- | --- | --- | --- | --- |
| **Pinned-expanded** | 220px | pushes (grid reflow) | yes (`ps:sidebar-collapsed=false`) | pin toggle |
| **Collapsed (resting)** | 64px | — | yes (`=true`) | pin toggle / default |
| **Flyout** | 220px overlay | overlaid (no reflow) | no (transient) | hover or focus-within while collapsed |

- `expanded = pinned || hovering` · `overlay = !pinned && expanded`.
- The existing header toggle becomes the **pin/unpin** control (`PanelLeftClose`/`Open`),
  switching pinned-expanded ⇄ collapsed and persisting the choice (logic already in `ShellLayout`).
- Flyout open/close gets a small delay (~100ms open / ~200ms close) to avoid flicker.

## 3. Components & changes

- **`ShellLayout`** — owns persisted `pinned` (today's `collapsed`, inverted meaning) + transient
  `hovering`. Renders the rail as a `relative` spacer (`width: pinned ? 220 : 64`) containing an
  `absolute inset-y-0 left-0` panel (`width: expanded ? 220 : 64`, `z-50 shadow-2xl` when
  `overlay`). Hover (`onMouseEnter/Leave`) + focus (`onFocusCapture` / `onBlurCapture` with
  `relatedTarget` containment check) handlers live on the panel.
- **`Sidebar`** — unchanged; already supports `collapsed` + the toggle. The toggle's meaning
  becomes pin/unpin (label stays "Collapse/Expand sidebar").
- **`WorkspaceSwitcher`** — unchanged (compact when collapsed).
- **`BoardDock` → board nav** — two renderings:
  - *collapsed:* a single active-board indicator — the active board's own link (icon + `title`,
    `aria-current="page"`); the other four are revealed on expand. No collapsed dropdown.
  - *expanded:* the existing five-icon `<nav aria-label="Boards">` row (Links, real navigation),
    active board highlighted. **No dropdown.**

## 4. Accessibility

- Flyout opens on **focus-within** as well as hover; `Esc`/blur (focus leaves the rail) closes it.
- Exactly one `aria-current="page"` (exact-match active links — shipped).
- Collapsed icon-only items keep `title` + `aria-label`; the pin toggle keeps `aria-expanded`.

## 5. Mobile (follow-up, out of scope here)

DESIGN §2 maps the dock → the mobile bottom tab bar, and touch has no hover. This increment targets
the **desktop rail**; small screens keep a tap-based tab-bar board switcher, specced separately.

## 6. DESIGN.md update

§2: refine the "Collapsible rail" bullet to describe the **hover-flyout overlay** and the board nav
(active-only at rest, full clickable row when expanded); amend the dock bullet so it no longer reads
"always visible, same five icons."

## 7. Testing (RTL/vitest, jsdom)

- **Flyout:** `mouseEnter`/`focus` expands (labels appear, board row appears); `mouseLeave`/blur
  collapses. (Overlay *positioning* is CSS — not asserted in jsdom; the smoke covers visuals.)
- **Pin:** toggle switches pinned ⇄ collapsed; preference restored on mount; throw-safe read
  (tests shipped in PR #33, extend for the pinned semantics).
- **Board nav:** collapsed renders only the active board; expanded renders all five; the active one
  carries `aria-current="page"`.
- **A11y:** exactly one `aria-current="page"` on a nested screen; collapsed items keep accessible
  names; toggle exposes `aria-expanded`.

## 8. Out of scope / deferred

- Mobile tap-based switcher (separate spec).
- Spelled-out board labels in the expanded row (icons-only for now; revisit if desired).
- Motion polish beyond the width transition + flyout delay.
