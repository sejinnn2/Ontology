import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Database,
  KeyRound,
  Link2,
  Search,
  Sparkles,
} from "lucide-react";
import type { OntologyApp } from "@/lib/app-state";
import {
  entityStatus,
  isIdentifierProperty,
  mappingStatus,
  propertyStatus,
  type Entity,
  type Property,
  type ReviewStatus,
  type TableColumn,
  type TableSchema,
} from "@/lib/mock-data";
import type { DetailAnchor } from "@/lib/app-state";
import { cn } from "@/lib/utils";

const MAX_PORTS = 7;

type SelectedColumn = { table: string; column: string } | null;
type LaneRow = { property: Property | null; column: TableColumn | null };

const statusDot: Record<ReviewStatus, string> = {
  confirmed: "bg-[#0797ad]",
  suggested: "bg-[#7657ff]",
  warning: "bg-[#e3b600]",
  error: "bg-[#f04b3f]",
};

function tableForAnchor(
  anchor: NonNullable<DetailAnchor>,
  entities: Entity[],
  tables: TableSchema[],
) {
  if (anchor.kind === "table") return tables.find((table) => table.name === anchor.id) ?? tables[0];
  const entity = entities.find((item) => item.id === anchor.id);
  const mappedName = entity?.properties.find((property) => property.mapping)?.mapping?.table;
  return (
    tables.find((table) => table.name === mappedName) ??
    tables.find((table) => table.name === entity?.table) ??
    tables[0]
  );
}

function entityForAnchor(anchor: NonNullable<DetailAnchor>, entities: Entity[]) {
  if (anchor.kind === "entity")
    return entities.find((item) => item.id === anchor.id) ?? entities[0];
  return (
    entities.find((entity) =>
      entity.properties.some((property) => property.mapping?.table === anchor.id),
    ) ?? entities[0]
  );
}

function propertyPriority(property: Property, selectedId: string | null, tableName: string) {
  if (property.id === selectedId) return 0;
  if (isIdentifierProperty(property)) return 1;
  const status = propertyStatus(property);
  if (status === "error") return 2;
  if (status === "warning") return 3;
  if (property.mapping?.table === tableName && mappingStatus(property.mapping) === "suggested")
    return 4;
  if (property.mapping?.table === tableName) return 5;
  return 6;
}

function buildLaneRows(
  entity: Entity,
  table: TableSchema,
  selectedPropertyId: string | null,
  selectedColumn: SelectedColumn,
): LaneRow[] {
  const relevant = [...entity.properties]
    .sort(
      (a, b) =>
        propertyPriority(a, selectedPropertyId, table.name) -
          propertyPriority(b, selectedPropertyId, table.name) || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_PORTS);

  const rows: LaneRow[] = relevant.map((property) => ({
    property,
    column:
      property.mapping?.table === table.name
        ? (table.columns.find((column) => column.name === property.mapping?.column) ?? null)
        : null,
  }));

  if (
    selectedColumn?.table === table.name &&
    !rows.some((row) => row.column?.name === selectedColumn.column)
  ) {
    const column = table.columns.find((item) => item.name === selectedColumn.column) ?? null;
    const property =
      entity.properties.find(
        (item) =>
          item.mapping?.table === table.name && item.mapping.column === selectedColumn.column,
      ) ?? null;
    rows.unshift({ property, column });
  }
  return rows.slice(0, MAX_PORTS);
}

function PanelSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-md border border-border bg-white px-2 text-muted-foreground">
      <Search className="size-3.5 shrink-0" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

function InventoryHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

export function SelectiveDetailView({
  app,
  anchor,
}: {
  app: OntologyApp;
  anchor: NonNullable<DetailAnchor>;
}) {
  const initialEntity = entityForAnchor(anchor, app.entities);
  const initialTable = tableForAnchor(anchor, app.entities, app.tables);
  const [entityId, setEntityId] = useState(initialEntity?.id ?? "");
  const [tableName, setTableName] = useState(initialTable?.name ?? "");
  const [selectedPropertyId, setSelectedPropertyId] = useState(
    anchor.kind === "entity" ? (anchor.focusPropertyId ?? null) : null,
  );
  const [selectedColumn, setSelectedColumn] = useState<SelectedColumn>(
    anchor.kind === "table" && anchor.focusColumnName
      ? { table: anchor.id, column: anchor.focusColumnName }
      : null,
  );
  const [entityQuery, setEntityQuery] = useState("");
  const [tableQuery, setTableQuery] = useState("");
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(entityId);
  const [expandedTableName, setExpandedTableName] = useState<string | null>(tableName);

  const entity = (app.entities.find((item) => item.id === entityId) ?? app.entities[0])!;
  const table = (app.tables.find((item) => item.name === tableName) ?? app.tables[0])!;

  const rows = buildLaneRows(entity, table, selectedPropertyId, selectedColumn);
  const shownPropertyIds = new Set(rows.flatMap((row) => (row.property ? [row.property.id] : [])));
  const shownColumnNames = new Set(rows.flatMap((row) => (row.column ? [row.column.name] : [])));
  const hiddenProperties = Math.max(0, entity.properties.length - shownPropertyIds.size);
  const hiddenColumns = Math.max(0, table.columns.length - shownColumnNames.size);

  const visibleEntities = useMemo(() => {
    const query = entityQuery.trim().toLowerCase();
    if (!query) return app.entities;
    return app.entities.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.properties.some((property) => property.name.toLowerCase().includes(query)),
    );
  }, [app.entities, entityQuery]);
  const visibleTables = useMemo(() => {
    const query = tableQuery.trim().toLowerCase();
    if (!query) return app.tables;
    return app.tables.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.columns.some((column) => column.name.toLowerCase().includes(query)),
    );
  }, [app.tables, tableQuery]);

  const selectProperty = (property: Property) => {
    setSelectedPropertyId(property.id);
    if (property.mapping) {
      setTableName(property.mapping.table);
      setExpandedTableName(property.mapping.table);
      setSelectedColumn({ table: property.mapping.table, column: property.mapping.column });
    }
  };

  const selectColumn = (nextTable: TableSchema, column: TableColumn) => {
    setTableName(nextTable.name);
    setSelectedColumn({ table: nextTable.name, column: column.name });
    const match = entity.properties.find(
      (property) =>
        property.mapping?.table === nextTable.name && property.mapping.column === column.name,
    );
    if (match) setSelectedPropertyId(match.id);
  };

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[#fafbfc] text-foreground">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-white">
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          <span className="text-sm font-semibold">Entity Types</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {app.entities.length}
          </span>
        </div>
        <InventoryHeader>Complete ontology inventory</InventoryHeader>
        <PanelSearch
          value={entityQuery}
          onChange={setEntityQuery}
          placeholder="Find entity or property"
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {visibleEntities.map((item) => {
            const expanded = expandedEntityId === item.id;
            const active = item.id === entity.id;
            return (
              <div
                key={item.id}
                className="mb-1 overflow-hidden rounded-lg border border-transparent"
              >
                <button
                  type="button"
                  onClick={() => {
                    setEntityId(item.id);
                    setExpandedEntityId(expanded ? null : item.id);
                    setSelectedPropertyId(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted",
                    active && "bg-[#eef6ff] text-[#1769d2]",
                  )}
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.name}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {item.properties.length}
                  </span>
                </button>
                {expanded && (
                  <div className="ml-4 border-l border-border py-1 pl-2">
                    {item.properties.map((property) => {
                      const selected = item.id === entity.id && property.id === selectedPropertyId;
                      return (
                        <button
                          key={property.id}
                          type="button"
                          onClick={() => {
                            setEntityId(item.id);
                            selectProperty(property);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                            selected && "bg-[#f1edff]",
                          )}
                        >
                          {isIdentifierProperty(property) ? (
                            <KeyRound className="size-3 text-[#d6a900]" />
                          ) : (
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                statusDot[propertyStatus(property)],
                              )}
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[11px]">
                            {property.name}
                          </span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {property.type}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-auto canvas-grid">
        <button
          type="button"
          onClick={app.closeDetail}
          className="sticky left-4 top-4 z-20 ml-4 mt-4 flex h-9 w-fit items-center gap-1 rounded-md border border-border bg-white px-3 text-xs font-medium shadow-sm hover:bg-muted"
        >
          <ArrowLeft className="size-4" /> Back to Ontology view
        </button>

        <div className="flex min-h-[calc(100%-70px)] min-w-[760px] items-center justify-center px-16 py-16">
          <section className="w-full max-w-[980px]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Selective mapping workspace
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  Reveal only the ports needed for this comparison
                </h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[#dcd6ff] bg-[#f5f2ff] px-3 py-1.5 text-[11px] font-medium text-[#6247db]">
                <Sparkles className="size-3.5" /> Idea 2 · Relevant ports
              </div>
            </div>

            <div className="grid grid-cols-[minmax(250px,1fr)_140px_minmax(250px,1fr)] items-start gap-x-0">
              <div className="rounded-xl border-2 border-[#3b82f6] bg-white shadow-sm">
                <div className="flex min-h-24 items-start gap-3 p-4">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#3b82f6] text-white">
                    E
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{entity.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entity.properties.length} Properties
                    </p>
                    <p className="mt-2 text-[11px] capitalize text-muted-foreground">
                      {entityStatus(entity)} ontology status
                    </p>
                  </div>
                </div>
              </div>
              <div />
              <div className="rounded-xl border-2 border-[#0797ad] bg-white shadow-sm">
                <div className="flex min-h-24 items-start gap-3 p-4">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0797ad] text-white">
                    <Database className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{table.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {table.columns.length} Columns
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">Source data table</p>
                  </div>
                </div>
              </div>

              {rows.map((row, index) => {
                const selected =
                  row.property?.id === selectedPropertyId ||
                  (!!row.column &&
                    selectedColumn?.table === table.name &&
                    selectedColumn.column === row.column.name);
                const mapping =
                  row.property?.mapping?.table === table.name ? row.property.mapping : null;
                return (
                  <div
                    key={`${row.property?.id ?? "none"}:${row.column?.name ?? index}`}
                    className="contents"
                  >
                    <button
                      type="button"
                      disabled={!row.property}
                      onClick={() => row.property && selectProperty(row.property)}
                      className={cn(
                        "mt-2 flex h-10 min-w-0 items-center gap-2 rounded-lg border bg-white px-3 text-left shadow-sm transition-colors",
                        selected
                          ? "border-[#7657ff] ring-1 ring-[#7657ff]"
                          : "border-border hover:border-[#9d8aff]",
                        !row.property && "invisible",
                      )}
                    >
                      {row.property &&
                        (isIdentifierProperty(row.property) ? (
                          <KeyRound className="size-3.5 shrink-0 text-[#d6a900]" />
                        ) : (
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              statusDot[propertyStatus(row.property)],
                            )}
                          />
                        ))}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {row.property?.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {row.property?.type}
                      </span>
                    </button>
                    <div className="relative mt-2 flex h-10 items-center justify-center">
                      {mapping && row.column ? (
                        <>
                          <div
                            className={cn(
                              "h-px w-full",
                              mappingStatus(mapping) === "suggested"
                                ? "border-t border-dashed border-[#9d8aff]"
                                : "bg-[#0797ad]",
                            )}
                          />
                          <div
                            className={cn(
                              "absolute flex size-6 items-center justify-center rounded-full border bg-white",
                              selected
                                ? "border-[#7657ff] text-[#7657ff]"
                                : "border-border text-muted-foreground",
                            )}
                          >
                            <Link2 className="size-3" />
                          </div>
                        </>
                      ) : (
                        <div className="h-px w-full border-t border-dashed border-border" />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!row.column}
                      onClick={() => row.column && selectColumn(table, row.column)}
                      className={cn(
                        "mt-2 flex h-10 min-w-0 items-center gap-2 rounded-lg border bg-white px-3 text-left shadow-sm transition-colors",
                        selected
                          ? "border-[#7657ff] ring-1 ring-[#7657ff]"
                          : "border-border hover:border-[#9d8aff]",
                        !row.column && "border-dashed bg-white/50 shadow-none",
                      )}
                    >
                      {row.column ? (
                        <span className="size-2 shrink-0 rounded-full bg-[#0797ad]" />
                      ) : (
                        <AlertTriangle className="size-3.5 shrink-0 text-[#c79400]" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {row.column?.name ?? "No mapped column"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{row.column?.type}</span>
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => setExpandedEntityId(entity.id)}
                className="mt-2 rounded-lg border border-dashed border-border bg-white/70 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground hover:border-[#7657ff] hover:text-[#6247db]"
              >
                +{hiddenProperties} more Properties · browse in left panel
              </button>
              <div />
              <button
                type="button"
                onClick={() => setExpandedTableName(table.name)}
                className="mt-2 rounded-lg border border-dashed border-border bg-white/70 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground hover:border-[#7657ff] hover:text-[#6247db]"
              >
                +{hiddenColumns} more Columns · browse in right panel
              </button>
            </div>
          </section>
        </div>
      </main>

      <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-white">
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          <span className="text-sm font-semibold">Data Tables</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {app.tables.length}
          </span>
        </div>
        <InventoryHeader>Complete source inventory</InventoryHeader>
        <PanelSearch
          value={tableQuery}
          onChange={setTableQuery}
          placeholder="Find table or column"
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {visibleTables.map((item) => {
            const expanded = expandedTableName === item.name;
            const active = item.name === table.name;
            return (
              <div key={item.name} className="mb-1 overflow-hidden rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setTableName(item.name);
                    setExpandedTableName(expanded ? null : item.name);
                    setSelectedColumn(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted",
                    active && "bg-[#ecfbfb] text-[#087f91]",
                  )}
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  <Database className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.name}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {item.columns.length}
                  </span>
                </button>
                {expanded && (
                  <div className="ml-4 border-l border-border py-1 pl-2">
                    {item.columns.map((column) => {
                      const selected =
                        item.name === table.name &&
                        selectedColumn?.table === item.name &&
                        selectedColumn.column === column.name;
                      const mapped = app.entities.some((candidate) =>
                        candidate.properties.some(
                          (property) =>
                            property.mapping?.table === item.name &&
                            property.mapping.column === column.name,
                        ),
                      );
                      return (
                        <button
                          key={column.name}
                          type="button"
                          onClick={() => selectColumn(item, column)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                            selected && "bg-[#e9fafa]",
                          )}
                        >
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              mapped ? "bg-[#0797ad]" : "bg-[#b9bdc5]",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[11px]">{column.name}</span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {column.type}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
