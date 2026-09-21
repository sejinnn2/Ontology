import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import {
  entityDisplayStatus,
  entityErrorReason,
  propertyStatus,
  relationLabel,
  mappingStatus,
  isIdentifierProperty,
  tableByName,
  tablesUsedByEntity,
  type Entity,
  type Property,
  type Relation,
  type TableSchema,
  type ColumnRef,
} from "@/lib/mock-data";
import type { OntologyApp, DetailAnchor } from "@/lib/app-state";
import { suggestionKey } from "@/lib/app-state";
import { StatusBadge, reviewStatusLabel } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import {
  ContextPanelBody,
  type ContextItem,
  contextItemKey,
} from "@/components/detail/ContextPanel";
import { edgeAnchorsForRects, orthogonalPath, type Rect } from "@/lib/geometry";
import { cn } from "@/lib/utils";

/**
 * Idea 3, revised: "Context <- Focus -> Context" as spatial CANVAS zones, sitting BETWEEN the two
 * restored inventory side panels — not a replacement for them. This is the architecture the spec
 * actually asks for:
 *
 *   [ Entity Types panel ]  [   CANVAS: Related | Focus | Data   ]  [ Data Tables panel ]
 *          inventory                    working set                       inventory
 *
 * The side panels (this file's own `EntityTypesPanel`/`DataTablesPanel`) are the complete
 * discoverable inventory — search, browse, drag/click an object into the canvas. The canvas itself
 * only ever holds a WORKING SET (`relatedEntityIds`/`dataTableNames` state below) — the Focus
 * entity plus whatever the user has explicitly brought in — never all 45 Entities or all 18
 * Tables at once, and never all of a huge Entity's Properties/Columns pre-expanded.
 *
 * Direct manipulation stays primary: dragging a Property's own connect-handle onto a visible
 * Column wires the Mapping immediately; only when no visible Column is a valid target does a
 * "Find a Column…" picker appear, anchored at the drop point, as an extension of that same drag
 * gesture (never a separate search-first workflow). Dragging a Property's row onto a visible
 * related Entity moves it there the same way. Mapping connector lines are drawn only for the
 * Property currently hovered/selected — never a permanent wall of lines.
 *
 * A completely separate component from `DetailView` (Idea 1/2) — zero changes to that file.
 */

function IdentifierIcon() {
  return (
    <span
      className="flex size-3 shrink-0 items-center justify-center text-[11px] leading-none"
      title="Identifier"
    >
      🔑
    </span>
  );
}

function statusDotColor(status: ReturnType<typeof propertyStatus>): string {
  switch (status) {
    case "confirmed":
      return "#0298b2";
    case "warning":
      return "#e6c200";
    case "error":
      return "#f15b15";
    default:
      return "#7c5eff";
  }
}

const ENTITY_DND_TYPE = "application/x-idea3-entity-id";
const TABLE_DND_TYPE = "application/x-idea3-table-name";
const PROPERTY_MOVE_DND_TYPE = "application/x-idea3-move-property-id";
const PROPERTY_MAP_DND_TYPE = "application/x-idea3-map-property-id";

/** LEFT side panel — the complete Entity Type inventory, restored. Search + browse + drag (or
 * click) an Entity into the canvas — this is discovery, never itself the working surface. */
function EntityTypesPanel({
  entities,
  focusEntityId,
  workingIds,
  onAdd,
  onFocus,
}: {
  entities: Entity[];
  focusEntityId: string | undefined;
  workingIds: Set<string>;
  onAdd: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities;
  }, [entities, query]);
  // A plain onClick/onDoubleClick pair both fire on a double-click (the first click lands before
  // the dblclick is recognized), so a bare onClick={onFocus} would navigate Main Focus away
  // *before* onAdd runs — defeating "double-click to add without focusing". Debounce the single
  // click so a following dblclick within the browser's double-click window cancels it instead.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-[rgba(28,28,24,0.08)] bg-white">
      <div className="flex items-center gap-1.5 border-b border-[rgba(28,28,24,0.08)] px-3 py-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Entity Types…"
          className="w-full min-w-0 border-none bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Entity Types · {entities.length}
        </p>
        {filtered.map((e) => {
          const inWorkingSet = workingIds.has(e.id) || e.id === focusEntityId;
          return (
            <div
              key={e.id}
              draggable
              onDragStart={(ev) => ev.dataTransfer.setData(ENTITY_DND_TYPE, e.id)}
              onClick={() => {
                if (e.id === focusEntityId) return;
                if (clickTimer.current) clearTimeout(clickTimer.current);
                clickTimer.current = setTimeout(() => {
                  clickTimer.current = null;
                  onFocus(e.id);
                }, 250);
              }}
              onDoubleClick={() => {
                if (clickTimer.current) {
                  clearTimeout(clickTimer.current);
                  clickTimer.current = null;
                }
                onAdd(e.id);
              }}
              title="Click to focus, drag onto the canvas to bring in as Related, double-click to add without focusing"
              className={cn(
                "flex cursor-grab items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent active:cursor-grabbing",
                inWorkingSet && "bg-black/[0.03]",
              )}
            >
              <StatusBadge status={entityDisplayStatus(e)} size={16} confidence={e.confidence} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                {e.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {e.properties.length}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** RIGHT side panel — the complete Data Table inventory, restored. Same discovery role as the
 * Entity Types panel on the other side. */
function DataTablesPanel({
  tables,
  workingNames,
  onAdd,
}: {
  tables: TableSchema[];
  workingNames: Set<string>;
  onAdd: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tables.filter((t) => t.name.toLowerCase().includes(q)) : tables;
  }, [tables, query]);
  return (
    <div className="flex w-64 shrink-0 flex-col overflow-hidden border-l border-[rgba(28,28,24,0.08)] bg-white">
      <div className="flex items-center gap-1.5 border-b border-[rgba(28,28,24,0.08)] px-3 py-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Data Tables…"
          className="w-full min-w-0 border-none bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Data Tables · {tables.length}
        </p>
        {filtered.map((t) => (
          <div
            key={t.name}
            draggable
            onDragStart={(ev) => ev.dataTransfer.setData(TABLE_DND_TYPE, t.name)}
            onDoubleClick={() => onAdd(t.name)}
            title="Drag onto the canvas to bring into Data Context, or double-click to add"
            className={cn(
              "flex cursor-grab items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent active:cursor-grabbing",
              workingNames.has(t.name) && "bg-black/[0.03]",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
              {t.name}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t.columns.length} cols
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The temporary, node-editor-style Mapping target picker — the "discovery" fallback ONLY shown
 * when a Property's connect-handle drag ends without landing on a visible Column. Anchored at the
 * drop point, not a permanent panel. Escape/outside-click cancels without mutating. */
function MappingPicker({
  x,
  y,
  tables,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  tables: TableSchema[];
  onPick: (table: string, column: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Skip the pointerdown that's already in flight from the drag-release that opened this.
    const raf = requestAnimationFrame(() => {
      window.addEventListener("pointerdown", onPointerDown);
    });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { table: string; column: string; type: string }[] = [];
    for (const table of tables) {
      for (const col of table.columns) {
        if (!q || col.name.toLowerCase().includes(q) || table.name.toLowerCase().includes(q)) {
          out.push({ table: table.name, column: col.name, type: col.type });
          if (out.length >= 30) return out;
        }
      }
    }
    return out;
  }, [tables, query]);
  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="fixed z-40 w-80 overflow-hidden rounded-2xl border border-[rgba(28,28,24,0.08)] bg-white shadow-[var(--shadow-node-lift)]"
    >
      <div className="flex items-center gap-1.5 border-b border-[rgba(28,28,24,0.08)] px-3 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a column…"
          className="w-full min-w-0 border-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {results.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-muted-foreground">No matching columns.</p>
        )}
        {results.map((r) => (
          <button
            key={`${r.table}.${r.column}`}
            type="button"
            onClick={() => onPick(r.table, r.column)}
            className="flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left hover:bg-accent"
          >
            <span className="text-[13px] font-medium text-foreground">{r.column}</span>
            <span className="text-[10.5px] text-muted-foreground">
              {r.table} · {r.type}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

type LineEndpoint = { el: HTMLElement; side: "left" | "right" };

export function DetailViewIdea3({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
  const { entities, relations, tables } = app;
  const focusEntity =
    anchor?.kind === "entity" ? (entities.find((e) => e.id === anchor.id) ?? null) : null;

  // --- Working set: the canvas's own contents, deliberately separate from the full inventory the
  // side panels browse. Seeded from the Focus Entity's immediate neighborhood (its own Relations,
  // its own mapped Tables) on every Focus change — a reasonable starting context, not "everything."
  const [relatedEntityIds, setRelatedEntityIds] = useState<string[]>([]);
  const [dataTableNames, setDataTableNames] = useState<string[]>([]);
  const [expandedRelatedIds, setExpandedRelatedIds] = useState<Set<string>>(new Set());
  const [expandedTableNames, setExpandedTableNames] = useState<Set<string>>(new Set());
  const [contextItem, setContextItem] = useState<ContextItem | null>(null);
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  const [draggingPropertyId, setDraggingPropertyId] = useState<string | null>(null);
  const [pickerState, setPickerState] = useState<{
    propertyId: string;
    x: number;
    y: number;
  } | null>(null);
  const [justMappedPropertyId, setJustMappedPropertyId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusEntity) return;
    const related = relations
      .filter((r) => r.from === focusEntity.id || r.to === focusEntity.id)
      .map((r) => (r.from === focusEntity.id ? r.to : r.from))
      .filter((id, i, arr) => arr.indexOf(id) === i);
    setRelatedEntityIds(related);
    setDataTableNames(tablesUsedByEntity(focusEntity));
    setExpandedRelatedIds(new Set());
    setExpandedTableNames(new Set());
    setContextItem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntity?.id]);

  const relatedEntities = relatedEntityIds
    .map((id) => entities.find((e) => e.id === id))
    .filter((e): e is Entity => !!e);
  const dataTables = dataTableNames
    .map((name) => tableByName(name))
    .filter((t): t is TableSchema => !!t);

  const relationBetween = useCallback(
    (a: string, b: string) =>
      relations.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a)) ?? null,
    [relations],
  );

  const selectedMapEndpointPropertyId = useMemo(() => {
    if (!contextItem || contextItem.kind !== "property" || !contextItem.property.mapping)
      return null;
    return contextItem.property.id;
  }, [contextItem]);
  const activeMapPropertyId = hoveredPropertyId ?? selectedMapEndpointPropertyId;

  // --- Connector line: ONE at a time, for whichever Property is currently hovered/selected AND
  // whose mapped Table is currently visible (expanded) in Data Context — on-demand, never a
  // permanent wall of lines. Recomputed only when the active property or the expanded-table set
  // changes (a hover/select is the only thing that should ever make a line appear or move).
  const canvasRef = useRef<HTMLDivElement>(null);
  const propertyRefs = useRef<Map<string, HTMLElement>>(new Map());
  const columnRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [linePath, setLinePath] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMapPropertyId || !focusEntity) {
      setLinePath(null);
      return;
    }
    const prop = focusEntity.properties.find((p) => p.id === activeMapPropertyId);
    const container = canvasRef.current;
    if (!prop?.mapping || !container) {
      setLinePath(null);
      return;
    }
    const propEl = propertyRefs.current.get(prop.id);
    const colEl = columnRefs.current.get(`${prop.mapping.table}.${prop.mapping.column}`);
    if (!propEl || !colEl) {
      setLinePath(null);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    const { p1, p2 } = edgeAnchorsForRects(rectOf(propEl), rectOf(colEl), 6);
    setLinePath(orthogonalPath(p1, p2, 10, "horizontal"));
  }, [activeMapPropertyId, focusEntity, expandedTableNames]);

  const toggleRelated = useCallback((id: string) => {
    setExpandedRelatedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleTable = useCallback((name: string) => {
    setExpandedTableNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const commitMapping = useCallback(
    (propertyId: string, table: string, column: string) => {
      if (!focusEntity) return;
      app.updateMapping(focusEntity.id, propertyId, { table, column });
      setJustMappedPropertyId(propertyId);
      window.setTimeout(() => {
        setJustMappedPropertyId((cur) => (cur === propertyId ? null : cur));
      }, 1200);
    },
    [app, focusEntity],
  );

  const addRelatedEntity = useCallback(
    (id: string) => {
      if (!focusEntity || id === focusEntity.id) return;
      setRelatedEntityIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    [focusEntity],
  );
  const addDataTable = useCallback((name: string) => {
    setDataTableNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }, []);

  if (!focusEntity) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white text-sm text-muted-foreground">
        Idea 3 currently only prototypes the Entity-focused workspace — select an Entity Type to try
        it.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <button
        type="button"
        onClick={app.closeDetail}
        className="absolute left-[248px] top-3 z-20 flex h-9 shrink-0 items-center gap-1 rounded-[4px] border border-border bg-white px-2 text-sm font-medium text-[#161919] shadow-[var(--shadow-node)] transition-colors hover:bg-accent"
      >
        <ArrowLeft className="size-4" /> Back to Ontology view
      </button>

      <EntityTypesPanel
        entities={entities}
        focusEntityId={focusEntity.id}
        workingIds={new Set(relatedEntityIds)}
        onAdd={addRelatedEntity}
        onFocus={(id) => app.openDetail("entity", id)}
      />

      {/* CANVAS — three spatial zones, one working set, never the full dataset. */}
      <div
        ref={canvasRef}
        className="relative flex min-w-0 flex-1 overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
      >
        {linePath && (
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
            <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}

        {/* LEFT canvas zone — Related Context */}
        <div
          className="flex w-72 shrink-0 flex-col gap-1.5 overflow-y-auto bg-[#F6F5FA] px-3 pb-4 pt-14"
          onDrop={(e) => {
            const id = e.dataTransfer.getData(ENTITY_DND_TYPE);
            if (id) addRelatedEntity(id);
          }}
        >
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[#7c5eff]">
            ← Related context
          </p>
          {relatedEntities.length === 0 && (
            <p className="rounded-lg border border-dashed border-[rgba(28,28,24,0.15)] px-2 py-3 text-center text-[11px] text-muted-foreground">
              Drag an Entity Type here from the left panel.
            </p>
          )}
          {relatedEntities.map((e) => {
            const relation = relationBetween(focusEntity.id, e.id);
            const expanded = expandedRelatedIds.has(e.id);
            return (
              <div
                key={e.id}
                className="rounded-xl bg-white/70 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              >
                <button
                  type="button"
                  onClick={() => toggleRelated(e.id)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-black/[0.03]"
                >
                  {expanded ? (
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <StatusBadge
                    status={entityDisplayStatus(e)}
                    size={16}
                    confidence={e.confidence}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                    {e.name}
                  </span>
                </button>
                {relation && (
                  <p className="truncate pl-7 text-[10px] text-muted-foreground">
                    {relationLabel(relation)}
                  </p>
                )}
                {expanded && (
                  <div
                    className="ml-6 mt-1 flex flex-col gap-0.5 border-l border-[rgba(28,28,24,0.1)] pl-2"
                    onDragOver={(ev) => ev.preventDefault()}
                    onDrop={(ev) => {
                      const propertyId = ev.dataTransfer.getData(PROPERTY_MOVE_DND_TYPE);
                      if (propertyId)
                        app.moveProperties(focusEntity.id, e.id, [
                          {
                            id: propertyId,
                            name:
                              focusEntity.properties.find((p) => p.id === propertyId)?.name ?? "",
                          },
                        ]);
                    }}
                  >
                    {e.properties.map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                        <span
                          className="size-1 shrink-0 rounded-full"
                          style={{ backgroundColor: statusDotColor(propertyStatus(p)) }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[#555]">{p.name}</span>
                      </div>
                    ))}
                    {e.properties.length === 0 && (
                      <p className="py-0.5 text-[10.5px] text-muted-foreground">No properties.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CENTER canvas zone — Main Focus: the origin, visually most prominent. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-[0_0_28px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-2 border-b border-[rgba(28,28,24,0.06)] px-6 py-3.5">
            <StatusBadge
              status={entityDisplayStatus(focusEntity)}
              size={26}
              confidence={focusEntity.confidence}
              warningReason={focusEntity.warningReason}
              errorReason={entityErrorReason(focusEntity)}
            />
            <button
              type="button"
              onClick={() => setContextItem({ kind: "entity", entity: focusEntity })}
              className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-foreground hover:underline"
            >
              {focusEntity.name}
            </button>
            {focusEntity.status !== "confirmed" && (
              <ConfidenceChip confidence={focusEntity.confidence} />
            )}
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {focusEntity.properties.length} properties
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
            <div className="flex flex-col gap-0.5">
              {focusEntity.properties.map((p) => {
                const mapped = !!p.mapping;
                return (
                  <div
                    key={p.id}
                    ref={(el) => {
                      if (el) propertyRefs.current.set(p.id, el);
                      else propertyRefs.current.delete(p.id);
                    }}
                    onMouseEnter={() => setHoveredPropertyId(p.id)}
                    onMouseLeave={() => setHoveredPropertyId((cur) => (cur === p.id ? null : cur))}
                    className={cn(
                      "group/prop relative flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[13px] transition-colors",
                      contextItem?.kind === "property" && contextItem.property.id === p.id
                        ? "bg-black/[0.04] shadow-[0_0_0_1px_#3b82f6]"
                        : "hover:bg-accent",
                      justMappedPropertyId === p.id && "shadow-[0_0_0_2px_#22c55e]",
                    )}
                  >
                    {/* Move handle — drag this row onto a visible Related Entity to move the Property there. */}
                    <span
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData(PROPERTY_MOVE_DND_TYPE, p.id)}
                      className="cursor-grab select-none text-muted-foreground active:cursor-grabbing"
                      title="Drag onto a Related Entity to move this property there"
                    >
                      ⠿
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setContextItem({ kind: "property", entity: focusEntity, property: p })
                      }
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        title={reviewStatusLabel(propertyStatus(p))}
                        style={{ backgroundColor: statusDotColor(propertyStatus(p)) }}
                      />
                      {isIdentifierProperty(p) && <IdentifierIcon />}
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {p.name}
                      </span>
                      {p.status !== "confirmed" && <ConfidenceChip confidence={p.confidence} />}
                    </button>
                    {mapped && (
                      <span className="shrink-0 truncate text-[10.5px] text-muted-foreground">
                        → {p.mapping!.table}.{p.mapping!.column}
                        {mappingStatus(p.mapping!) === "suggested" ? " (suggested)" : ""}
                      </span>
                    )}
                    {/* Connect handle — drag onto a visible Column to map directly; drop anywhere
                        else opens the "Find a column…" picker at the drop point, same gesture. */}
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(PROPERTY_MAP_DND_TYPE, p.id);
                        setDraggingPropertyId(p.id);
                      }}
                      onDragEnd={(e) => {
                        setDraggingPropertyId(null);
                        const target = document.elementFromPoint(e.clientX, e.clientY);
                        const overColumn = target?.closest("[data-idea3-column]");
                        if (!overColumn) {
                          setPickerState({ propertyId: p.id, x: e.clientX, y: e.clientY });
                        }
                      }}
                      className="flex size-4 shrink-0 cursor-grab items-center justify-center rounded-full border border-[rgba(28,28,24,0.2)] text-[9px] text-muted-foreground opacity-0 group-hover/prop:opacity-100 active:cursor-grabbing"
                      title="Drag onto a visible Column to map, or drop anywhere to search for one"
                    >
                      ●
                    </span>
                    {pickerState?.propertyId === p.id && (
                      <MappingPicker
                        x={pickerState.x}
                        y={pickerState.y}
                        tables={tables}
                        onPick={(table, column) => {
                          commitMapping(p.id, table, column);
                          setPickerState(null);
                        }}
                        onClose={() => setPickerState(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {contextItem && (
            <div className="flex max-h-56 items-start gap-2 border-t border-[rgba(28,28,24,0.06)] bg-[#FCFCFC] px-4 py-3">
              <div className="min-w-0 flex-1 overflow-y-auto">
                <ContextPanelBody
                  key={contextItemKey(contextItem)}
                  item={contextItem}
                  entities={entities}
                  onSwapRelation={(relationId) => {
                    const r = relations.find((x) => x.id === relationId);
                    if (r) app.updateRelation(relationId, { from: r.to, to: r.from });
                  }}
                  onRenameRelation={(relationId, name) => app.renameRelation(relationId, name)}
                  onEditRelationDescription={(relationId, description) =>
                    app.updateRelation(relationId, { description })
                  }
                  onRenameEntity={(entityId, name) => app.updateEntity(entityId, { name })}
                  onEditEntityDescription={(entityId, description) =>
                    app.updateEntity(entityId, { description })
                  }
                  onRenameProperty={(entityId, propertyId, name) =>
                    app.updateProperty(entityId, propertyId, { name })
                  }
                  onEditPropertyDescription={(entityId, propertyId, description) =>
                    app.updateProperty(entityId, propertyId, { description })
                  }
                  onDeleteContextItem={() => {
                    if (contextItem.kind === "entity") app.deleteEntity(contextItem.entity.id);
                    else if (contextItem.kind === "property")
                      app.deleteProperty(contextItem.entity.id, contextItem.property.id);
                    else if (contextItem.kind === "relation")
                      app.deleteRelation(contextItem.relation.id);
                    setContextItem(null);
                  }}
                  onAcceptContextItem={() => {
                    const key =
                      contextItem.kind === "entity"
                        ? suggestionKey({ kind: "entity", id: contextItem.entity.id })
                        : contextItem.kind === "property"
                          ? suggestionKey({
                              kind: "property",
                              entityId: contextItem.entity.id,
                              propertyId: contextItem.property.id,
                            })
                          : contextItem.kind === "relation"
                            ? suggestionKey({ kind: "relation", id: contextItem.relation.id })
                            : null;
                    if (key) app.acceptSuggestions([key]);
                  }}
                  onRejectContextItem={() => {
                    const key =
                      contextItem.kind === "entity"
                        ? suggestionKey({ kind: "entity", id: contextItem.entity.id })
                        : contextItem.kind === "property"
                          ? suggestionKey({
                              kind: "property",
                              entityId: contextItem.entity.id,
                              propertyId: contextItem.property.id,
                            })
                          : contextItem.kind === "relation"
                            ? suggestionKey({ kind: "relation", id: contextItem.relation.id })
                            : null;
                    if (key) app.declineSuggestions([key]);
                    setContextItem(null);
                  }}
                  onAcceptMapping={(entityId, propertyId) =>
                    app.confirmMapping(entityId, propertyId)
                  }
                  onRejectMapping={(entityId, propertyId) =>
                    app.updateMapping(entityId, propertyId, null)
                  }
                  onDisconnectMapping={(entityId, propertyId) =>
                    app.updateMapping(entityId, propertyId, null)
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => setContextItem(null)}
                aria-label="Close"
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT canvas zone — Data Context */}
        <div
          className="flex w-80 shrink-0 flex-col gap-1.5 overflow-y-auto bg-[#F2F8FA] px-3 pb-4 pt-14"
          onDrop={(e) => {
            const name = e.dataTransfer.getData(TABLE_DND_TYPE);
            if (name) addDataTable(name);
          }}
        >
          <p className="px-1 text-right text-[10px] font-semibold uppercase tracking-wider text-[#0298b2]">
            Data context →
          </p>
          {dataTables.length === 0 && (
            <p className="rounded-lg border border-dashed border-[rgba(28,28,24,0.15)] px-2 py-3 text-center text-[11px] text-muted-foreground">
              Drag a Table here from the right panel.
            </p>
          )}
          {dataTables.map((table) => {
            const expanded = expandedTableNames.has(table.name);
            return (
              <div
                key={table.name}
                className="rounded-xl bg-white/70 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              >
                <button
                  type="button"
                  onClick={() => toggleTable(table.name)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-black/[0.03]"
                >
                  {expanded ? (
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                    {table.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {table.columns.length} col{table.columns.length === 1 ? "" : "s"}
                  </span>
                </button>
                {expanded && (
                  <div className="ml-6 mt-1 flex max-h-56 flex-col gap-0.5 overflow-y-auto border-l border-[rgba(28,28,24,0.1)] pl-2">
                    {table.columns.map((c) => (
                      <div
                        key={c.name}
                        data-idea3-column
                        ref={(el) => {
                          const key = `${table.name}.${c.name}`;
                          if (el) columnRefs.current.set(key, el);
                          else columnRefs.current.delete(key);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          const propertyId = e.dataTransfer.getData(PROPERTY_MAP_DND_TYPE);
                          if (propertyId) commitMapping(propertyId, table.name, c.name);
                        }}
                        className={cn(
                          "flex items-center justify-between gap-1.5 rounded-md px-1 py-0.5 text-[11px]",
                          draggingPropertyId &&
                            "outline outline-1 outline-dashed outline-[#3b82f6]/40",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[#555]">{c.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{c.type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <DataTablesPanel
        tables={tables}
        workingNames={new Set(dataTableNames)}
        onAdd={addDataTable}
      />
    </div>
  );
}
