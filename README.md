# Canvas Connect Review

Canvas Connect Review is an interactive prototype for reviewing and editing an AI-generated ontology against source data.

The product is intentionally canvas-first. Entity Types, Properties, Relations, Data Tables, Columns, and their mappings are explored in context rather than managed through a dashboard.

## What the prototype explores

### Overview

- Scan the ontology as a connected graph.
- Inspect Entity Type and Property review states independently.
- Follow Relations between Entity Types.
- Compare ontology objects with connected Data Tables.
- Filter suggestions by confidence and select items for review.
- Search across ontology and source-data objects.

### Editing Mode

- Open an Entity Type or Data Table in a focused editing workspace.
- Inspect mapped, suggested, and unmapped Properties and Columns.
- Review Property-to-Column mapping suggestions.
- Create and edit Entity Types, Properties, and Relations.
- Move Properties, split Entity Types, and merge selected Entity Types.
- Inspect reasoning, confidence, validation issues, schema, and sample values.

### Review workflow

- Accept or reject individual and multi-selected suggestions.
- Keep Entity, Property, Relation, and Mapping states independent.
- Surface validation issues on the object where they occur.
- Aggregate child issues on an Entity Type only when they affect its validity.
- Track edits in History, inspect past changes on the canvas, and restore selected changes.
- Use undo and redo across Overview and Editing Mode.

## Interaction guide

### Canvas navigation

- Use the pointer tool to select and edit objects, or the hand tool to pan the canvas.
- Press `V` for the pointer tool and `H` for the hand tool. Hold `Space` to pan temporarily.
- Zoom with the canvas controls, choose a zoom preset, or fit the graph to the viewport.
- Undo with `Cmd/Ctrl+Z` and redo with `Cmd/Ctrl+Shift+Z`; the toolbar provides the same actions.
- Search for Entity Types, Properties, Relations, Data Tables, and Columns, then jump to the result in context.

### Selection

- Click an item to make it the single selection.
- `Shift+click` adds or removes items from a multi-selection. This rule is shared across selectable object types.
- Click empty canvas space or use **Clear selection** to clear the current selection.
- Multi-selected items use the contextual control bar for the actions valid for that selection, including Merge, Split, Delete, Accept, and Reject.

### Overview graph

- Select an Entity Type or Relation to inspect it while preserving the surrounding ontology as context.
- Follow Relation connectors between Entity Types; hover and selection expose the relevant endpoints and status details.
- Entity status and the Property-status ring remain separate. Hover a compact Entity node to see the Entity status and its Property-status distribution.
- Double-click an Entity Type, or select it and use **Go to Editing Mode**, to open its focused workspace. Click a connected Data Table to open its table-focused Editing Mode.
- Use the top mapping-status counts to understand mapped coverage across Entities, Properties, Relations, Tables, and Columns.

### Editing Mode

- Explore the focused Entity Type or Data Table together with connected ontology and source-data objects.
- Expand or collapse Entity and Table cards and their Mapped/Unmapped groups. Connected rows stay coordinated where the two sides represent the same mapping context.
- Use **Only Identifier** to focus the corresponding Entity and Table views on identifier fields.
- Sort Properties and Columns by name or confidence where the control is available.
- Click an Entity, Property, Relation, Table, Column, or mapping connector to open its contextual details.
- Inspect descriptions, AI reasoning, confidence, validation information, schema, and sample values without showing all source data by default.

### Mapping and ontology editing

- Drag a Property or Column connection handle to its counterpart to create a mapping.
- Select a suggested mapping connector to review and Accept or Reject the proposed connection.
- Drag Properties between Entity Types. When a destination has a conflict, resolve it in the provided conflict flow.
- Multi-select Properties from one Entity Type and use **Split** to create a separate Entity Type.
- Multi-select Entity Types and use **Merge** to combine them and choose the resulting name.
- Create and edit Entity Types, Properties, and Relations directly from the canvas affordances.
- Delete applied objects or reject pending suggestions through the contextual selection controls.

### Suggestions and review state

- Adjust the confidence range to choose which AI suggestions are currently in review scope.
- Use the suggestion breakdown for Entities, Properties, Relations, Tables, and Columns; Table and Column counts are derived from pending mapping suggestions.
- **Select all in range** includes eligible ontology suggestions and mapping suggestions in the current confidence range.
- Accept or Reject a single suggestion or a multi-selection. Accepting warnings requires an explicit confirmation; errors remain blocked.
- Mapping acceptance changes the mapping lifecycle independently from the ontology object's own review status.

### History, Trash, and scenarios

- Open History to inspect recorded changes on the canvas and restore a selected earlier change.
- Use Undo and Redo from either Overview or Editing Mode.
- Open Trash to inspect deleted objects and restore them.
- Use **Demo Scenario** to switch between the deterministic Fresh and In Progress review states.

## Status model

Ontology review status and confidence are separate concepts.

- **Confirmed**: reviewed and accepted.
- **Suggested**: generated by AI and awaiting review.
- **Warning**: usable, but requires attention.
- **Error**: currently invalid or blocked by a validation issue.

A child issue does not automatically change its parent Entity Type. Only issues that affect whether the Entity Type is valid or usable are aggregated at the Entity level. Relation-only issues remain attached to the Relation unless they explicitly invalidate a connected Entity Type.

Mapping lifecycle is also independent from ontology status:

- **Suggested Mapping**: a proposed Property-to-Column connection awaiting review.
- **Mapped**: an accepted connection.
- **Unmapped**: no accepted connection is present.

## Data

The prototype uses synthetic data created for product exploration. It does not contain customer or production data.

The default `v2/main` fixture is the compact review scenario used for the core interaction design. Additional branches preserve larger or alternative datasets without changing this baseline.

## Repository structure

The repository uses separate Git worktrees for V1 and V2:

```text
Zaimler/
└── Ontology/
    ├── V1/   → main
    └── V2/   → v2/* branches
```

V2 branches:

| Branch | Purpose |
| --- | --- |
| `v2/main` | Stable compact prototype and current V2 baseline |
| `v2/stress-test` | Enterprise-scale synthetic fixture and large-graph performance work |
| `v2/graph-exploration` | Graph exploration experiments built on the stress-test work |
| `v2/real-data` | Separate data-fixture experiment |

These branches are preserved as distinct prototype states. They do not need to be merged into `main` to run or deploy them.

## Local development

Requirements:

- Node.js
- npm

```sh
git clone https://github.com/sejinnn2/Ontology.git
cd Ontology
npm install
npm run dev
```

To run the V2 worktree on its usual local port:

```sh
cd ~/Zaimler/Ontology/V2
git switch v2/main
npm install
npm run dev -- --host 127.0.0.1 --port 8084
```

Open [http://127.0.0.1:8084](http://127.0.0.1:8084).

## Build

```sh
npm run build
```

The production build uses TanStack Start with Nitro's Cloudflare target. Generated output is written to `.output/`.

## Deployment

`v2/main` is the production branch for the public V2 prototype. A Cloudflare Workers deployment can keep the GitHub repository private while exposing only the running application.

Recommended Cloudflare build settings:

| Setting | Value |
| --- | --- |
| Production branch | `v2/main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy --config .output/server/wrangler.json` |

## Technology

- React 19
- TanStack Start and TanStack Router
- TypeScript
- Tailwind CSS
- Vite
- Nitro / Cloudflare Workers
