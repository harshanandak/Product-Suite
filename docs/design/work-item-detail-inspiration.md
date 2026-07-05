# Work Item Detail — external inspiration (research)

Researched 2026-06-30 to inform the adjustable/clean redesign.

## Linear (clean-UX benchmark)
- Redesign goal: **reduce visual noise, keep visual alignment, increase hierarchy + density**. Evolve from "issue tracker" to a structured system.
- Structured layouts: a **header stores filters / display-options**; **side panels hold meta properties**; multiple display modes: **list, board, timeline, split, fullscreen**.
- 2025 trend: **less color** (monochrome black/white, very few bold accents), more density + individuality. Content-first; metadata is contextual in a side panel.
- Take-aways for us: lean header, a **quiet metadata side panel**, low-color/high-density, strict importance hierarchy, and a **split / fullscreen** display option.

## react-resizable-panels (the engine for our "adjustable" requirement)
- `PanelGroup` + `Panel` + `PanelResizeHandle`. This is the standard, a11y-built-in (ARIA + keyboard) resizable layout lib.
- **Collapse-to-icon = `collapsible` + `collapsedSize`**: a panel collapses to a *minimal visible portion* (e.g. a thin icon strip), not 0 — exactly the "collapse to a small icon" the user wants.
- **Persistence = `autoSaveId` / `defaultLayout` + `getLayout`/`setLayout` + `onLayoutChanged`** → save the user's adjusted layout to localStorage. This **matches our existing `useColumnWidths` localStorage convention** and the saved-views work — same discipline.
- Imperative API to expand/collapse programmatically; `preserve-pixel-size` vs `preserve-relative-size` on group resize.
- → **Recommendation: use react-resizable-panels as the resize/collapse engine** for the detail page panels (resize drag, collapse-to-icon via `collapsedSize`, persist via `autoSaveId`).

## react-grid-layout (full bento/dashboard rearrange — heavier option)
- Draggable + resizable widget GRID with responsive breakpoints, collision detection (Grafana/Jira-style). `isDraggable`/`isResizable`/`resizeHandles`, and a **view-mode vs edit-mode** toggle.
- → Good for a "fully rearrangeable bento" variant, but heavier + an edit-mode affordance; treat as a **stretch** beyond resizable-panels.

## Notion / Asana / Height (task detail patterns)
- Flexible **properties + blocks**; smart filtered views; clear status indicators; assignee tracking; **hierarchical sub-tasks**; kanban defaults.
- → For us: a flexible property rail, sub-tasks under Linked tasks, strong status/health clarity.

## Net recommendation for the redesign
1. **Panel engine:** react-resizable-panels — resize + collapse-to-icon (`collapsedSize`) + persist (`autoSaveId`, mirroring `useColumnWidths`). Add an `@product-suite/ui` wrapper.
2. **Aesthetic:** Linear-clean — lean header, quiet metadata side panel, low color, importance hierarchy; offer **split + fullscreen + per-panel expand** display modes.
3. **Adjustability tiers:** v1 = resizable/collapsible panels + persisted layout (resizable-panels). Stretch = full drag-rearrange bento (react-grid-layout, edit-mode).
4. Keep our **real-vs-planned** placeholder treatment + **derived health** + **action parity** principles.

## Use shadcn effectively (component mapping)
`@product-suite/ui` IS shadcn-style (Radix). Compose the page from shadcn primitives; don't hand-roll. Audit of the lib:
- **Already present — reuse:** `Sidebar` (shadcn Sidebar has a built-in `collapsible="icon"` mode → the collapse-to-icon rail for free), `Sheet` (keep as quick-edit), `Tabs`, `Card`, `HoverCard`, `Tooltip`, `ScrollArea`, `Separator`, `Command` (⌘K), `Avatar`, `Badge`, domain `*Select`/`*Badge`/pickers, `Dialog`, `Button`, `Input`, `Textarea`, `Checkbox`, `DropdownMenu`, `Sonner`.
- **Add (official shadcn, not yet in the lib):** `Resizable` (= react-resizable-panels — the panel resize/collapse engine, `autoSaveId` persistence), `Collapsible` (per-section expand/collapse), `Accordion` (optional grouped collapsibles), `Breadcrumb` (top bar). Add each to `packages/ui` following the existing component pattern (`npx shadcn add resizable collapsible accordion breadcrumb` equivalents).

Need → component:
| Need | shadcn component | status |
|---|---|---|
| Resizable panels + collapse-to-icon + persist | **Resizable** (react-resizable-panels) | ADD |
| Per-section expand/collapse | **Collapsible** / **Accordion** | ADD |
| Whole-pane icon-collapse rail | **Sidebar** (`collapsible="icon"`) | have |
| Section grouping / display modes | **Tabs** | have |
| Section panels | **Card** | have |
| Breadcrumb top bar | **Breadcrumb** | ADD |
| Health "why?" | **HoverCard** / **Tooltip** | have |
| Metadata (owner/type/etc.) | **Avatar** / **Badge** / domain `*Select` | have |
| Scroll regions | **ScrollArea** | have |
| ⌘K | **Command** (cmdk) | have |
| Quick edit | **Sheet** | have |
| Linked tasks / sub-tasks grid | **@tanstack/react-table** (sortable, expandable) | dep present |

## Registries — ready-made blocks (don't hand-roll)
shadcn supports namespaced registries: `npx shadcn add @<registry>/<name>` (add the registry to `components.json`). Review copied code before adding; pull into platform-web or `@product-suite/ui` per scope. Explorer: registry.directory · ui.shadcn.com/docs/directory.

- **shadcn core** — Resizable, Collapsible, Accordion, Breadcrumb, Sidebar (`collapsible=icon`), Tabs, Card, HoverCard, Command, Sheet.
- **Kibo UI** (`@kibo-ui`, MIT, kibo-ui.com — 41 components/1000+ variants): **Gantt**, **Kanban**, **Table** (sort/filter/paginate), **List**, **Editor** (rich text), **Dropzone**, Calendar, AI chat.
- **shadcn blocks / shadcn.io**: **Activity Feed** (created/updated/assigned/commented timeline w/ avatars), **Comment Thread**, **Chat** (Message/Bubble/Conversation/Attachment — Jun 2026 chat components).
- **Origin UI** (`@originui`): large copy-paste field/input set (Tailwind v4).

Per-section registry pick:
| Section | Registry component |
|---|---|
| Adjustable panels | shadcn **Resizable** + **Sidebar**(icon) |
| Description | Kibo **Editor** (rich text) |
| Linked tasks / sub-tasks | Kibo **Table**/**List**/**Kanban** or `@tanstack/react-table` |
| Plan — milestones/timeline | Kibo **Gantt** |
| Comments | shadcn **Comment Thread** |
| Agent conversations | shadcn **Chat** (Message/Bubble) |
| Meetings / activity | shadcn **Activity Feed** |
| Evidence / attachments | Kibo **Dropzone** + cards |

Net: most planned sections have a ready registry block — so v1 placeholders can become real with `shadcn add`, not bespoke code. Caveat: registry code is copied into our repo — review for security/quality/token-fidelity, and re-theme to our oklch tokens.

## Sources
- Linear redesign: https://linear.app/now/how-we-redesigned-the-linear-ui · display options: https://linear.app/docs/display-options
- react-resizable-panels: https://github.com/bvaughn/react-resizable-panels · examples: https://react-resizable-panels.vercel.app/examples/collapsible
- react-grid-layout: https://github.com/react-grid-layout/react-grid-layout
- Panel-layout tooling overview: https://blog.logrocket.com/essential-tools-implementing-react-panel-layouts/
