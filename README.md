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

### Overview

1. **Navigate the ontology canvas**
   - Choose the pointer tool to select objects or the hand tool to pan.
   - Press `V` for the pointer, `H` for the hand, or hold `Space` to pan temporarily.
   - Use the zoom menu for a preset level or to fit the complete graph in the viewport.

2. **Select ontology objects**
   - Click an Entity Type or Relation to make it the single selection.
   - `Shift+click` additional objects to add or remove them from a multi-selection.
   - Click empty canvas space or use **Clear selection** to clear the selection.

3. **Open Editing Mode**
   - Double-click an Entity Type, or select it and choose **Go to Editing Mode**.
   - Click a Data Table in the right panel to open its table-focused Editing Mode.

4. **Inspect status and mapping coverage**
   - Hover a compact Entity Type node to see its own status and Property-status distribution.
   - Read the outer ring independently from the Entity Type's center status.
   - Use the header counts to review mapped coverage for Entities, Properties, Relations, Tables, and Columns.

5. **Review AI suggestions**
   - Drag the confidence-range handles to control which suggestions are in review scope.
   - Open the suggestion breakdown to see counts for Entities, Properties, Relations, Tables, and Columns.
   - Choose **Select all in range** to select eligible ontology and mapping suggestions in the range.
   - Accept or Reject the selection. Warnings require confirmation; errors cannot be accepted.

6. **Create an Entity Type**
   - Start from an Entity Type's `+` affordance to create a connected Entity Type.
   - Enter the Entity name, add Properties and their data types, and choose an Identifier.
   - Name the Relation and choose its direction before creating the connected Entity Type.

7. **Create a Relation between existing Entity Types**
   - Drag an Entity Type's connector handle onto another Entity Type.
   - Enter the Relation name and confirm or swap its direction.
   - Self-relations and multiple separately named Relations between the same Entity Types are supported.

8. **Search and jump to an object**
   - Search across Entity Types, Properties, Relations, Data Tables, and Columns.
   - Choose a result to focus it on the canvas or open it in the relevant context.

9. **Use History, Undo, Redo, and Trash**
   - Use `Cmd/Ctrl+Z` to undo and `Cmd/Ctrl+Shift+Z` to redo; the canvas toolbar provides the same actions.
   - Open History to inspect recorded changes on the canvas and restore a selected change.
   - Open Trash to inspect deleted objects and restore them.

10. **Switch the demo state**
    - Use **Demo Scenario** to switch between the deterministic **Fresh** and **In Progress** states.

### Editing Mode

1. **Navigate the focused workspace**
   - Use the same pointer, hand, pan, zoom, Undo, and Redo controls as Overview.
   - Click an Entity Type in the left toolbox to navigate to it as the new focus.
   - Click a Data Table in the right toolbox to navigate to its table-focused workspace.

2. **Place an Entity Type beside the focused Entity Type**
   - Drag an Entity Type from the toolbox into the compact related-entity placement area beside the focused card.
   - This placement means “related to this Entity Type.” If no Relation exists, the prototype creates an unnamed Error-state placeholder Relation for review.
   - Reorder compact related Entity Types by dragging them within that area.

3. **Place an Entity Type as a full card below**
   - Drag an Entity Type from the toolbox into the full-card column below the focused Entity Type.
   - This adds the Entity Type to the current workspace without creating a Relation; vertical order is only layout.
   - Drag an existing compact related Entity Type into this column to promote it to a full card while preserving its existing Relation.

4. **Create an Entity Type in a placement area**
   - Hover an empty placement slot and choose **Add Entity Type**.
   - Creating beside an Entity Type opens the name → Properties and Identifier → Relation flow and creates a connected Entity Type.
   - Creating in the full-card slot below opens the name → Properties and Identifier flow and creates a standalone Entity Type without a Relation.

5. **Create and edit Properties**
   - Choose **Add property** on an expanded Entity card, type a name, and press `Enter`; press `Escape` to cancel.
   - Select a Property to inspect or edit its details in the contextual panel.
   - Use the Identifier control when creating an Entity Type to designate its identifying Property.

6. **Move Properties between Entity Types**
   - Drag a Property row from one Entity card onto another Entity card.
   - If the destination has a conflicting Property, complete the conflict-resolution flow before the move is applied.
   - Multi-selected Properties can be moved together when they belong to the same source Entity Type.

7. **Split an Entity Type**
   - `Shift+click` two or more Properties from the same Entity Type.
   - Choose **Split** in the contextual selection bar and name the resulting Entity Type.
   - Split is unavailable when it would remove every Property from the source Entity Type.

8. **Merge Entity Types**
   - Click one Entity Type, then `Shift+click` one or more additional Entity Types.
   - Choose **Merge** and select or enter the resulting Entity Type name.
   - Properties from the selected Entity Types are combined into the resulting Entity Type.

9. **Create or edit Relations**
   - Drag a connector handle from one Entity Type onto another, then name the Relation and confirm its direction.
   - Select an existing Relation to inspect it, rename it, swap its direction, or review its status.
   - Creating a Relation does not require moving either Entity Type or changing the workspace layout.

10. **Create and review Property-to-Column mappings**
    - Drag a Property connection handle onto a Column, or a Column handle onto a Property.
    - Select a suggested mapping connector to inspect its reasoning and Accept or Reject it.
    - Mapping status changes independently from the Property's ontology review status.

11. **Arrange Data Tables in the workspace**
    - Drag a Data Table from the right toolbox into the Columns area to place it at the hovered position.
    - Reorder placed Table cards by dragging them within the Columns area.
    - Selecting a Table or Column reveals schema and sample-value context without showing all source data by default.

12. **Filter, sort, expand, and collapse cards**
    - Use **Only Identifier** to focus corresponding Entity and Table views on identifier fields.
    - Sort Properties and Columns by name or confidence where the control is available.
    - Expand or collapse Entity and Table cards and their Mapped/Unmapped groups.
    - Connected Property and Column groups remain coordinated where they represent the same mapping context.

13. **Select and apply bulk actions**
    - Click one object, then `Shift+click` to add Entities, Properties, Relations, or mappings to the selection.
    - Use the contextual bar for the actions valid for that selection: **Merge**, **Split**, **Delete**, **Accept**, or **Reject**.
    - Click empty canvas space or choose **Clear selection** to finish the multi-selection.

14. **Inspect object details**
    - Click an Entity Type, Property, Relation, Data Table, Column, or mapping connector.
    - Use the contextual panel to review descriptions, AI reasoning, confidence, validation issues, schema, and sample values.

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
