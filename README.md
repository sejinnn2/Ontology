# Zaimler Ontology

A canvas-first prototype for reviewing an AI-generated ontology against real data tables.

- **Overview** — the whole ontology as a graph of Entity Types and their Relations, with the Data
  tables they map to.
- **Editing workspace** (open an Entity Type or a Data Table) — a graph around the selected item:
  related Entity Types and their Relations on one side, mapped Data tables on the other. Review AI
  suggestions (accept / reject), map Properties to Columns, create Relations, move Properties
  between Entity Types, and Merge / Split Entity Types.

## Development

```bash
npm install
npm run dev
```

Built with TanStack Start, React, and Tailwind CSS v4. Design-system notes for contributors are in
[`CLAUDE.md`](./CLAUDE.md).
