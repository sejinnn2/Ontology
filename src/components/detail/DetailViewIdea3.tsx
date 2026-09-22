import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, GitMerge, Search, X } from "lucide-react";
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
} from "@/lib/mock-data";
import type { OntologyApp, DetailAnchor } from "@/lib/app-state";
import { suggestionKey, parseSuggestionKey, type SuggestionRef } from "@/lib/app-state";
import { StatusBadge, reviewStatusLabel } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import {
  ContextPanelBody,
  type ContextItem,
  contextItemKey,
} from "@/components/detail/ContextPanel";
import { SelectionControlBar } from "@/components/detail/SelectionControlBar";
import { edgeAnchorsForRects, orthogonalPath, type Rect } from "@/lib/geometry";
import { cn } from "@/lib/utils";

/**
 * Idea 3, lane layout revision: same "Context <- Focus -> Context" idea as before, but the middle
 * workspace is now a bounded, Kanban-like set of 3 lanes — Connected Entities | Current Entity |
 * Data Tables — each with its OWN vertical scroll, instead of one tall canvas. The two outer
 * inventory panels (`EntityTypesPanel`/`DataTablesPanel`) are unchanged in role: complete
 * discovery/search surfaces, never the working surface itself.
 *
 *   [ Entity Types panel ]  [ Connected | CURRENT | Data ]  [ Data Tables panel ]
 *          inventory              bounded lane workspace           inventory
 *
 * The 3 lanes split the workspace evenly (1:1:1 — each `flex-1 basis-0`), a deliberately simple
 * starting layout rather than the earlier adaptive-width version. "Expanding" a related Entity or a
 * Data Table only affects content WITHIN its own lane (revealing its properties/columns in an
 * accordion section), never the lane's own width. Only one SIDE lane's items are ever expanded at a
 * time — expanding a related Entity collapses any expanded Data Table back to compact, and vice
 * versa (see `toggleRelated`/`toggleTable`). Within whichever side IS active, more than one item can
 * be expanded at once (each its own accordion section, stacked vertically) — expanded items sort to
 * the top of their lane, collapsed ones sort below.
 *
 * Merge/Split/multi-select are ported from `DetailView.tsx` (Idea 1/2) onto the same underlying
 * `app.suggestionSelection` Set and `app.splitEntity`/`app.mergeEntities` mutators, reusing the
 * shared `SelectionControlBar` component rather than re-deriving that logic — single selection still
 * means "inspect" (the bottom `ContextPanelBody`), 2+ means "act" (this bar), exactly as in Idea 1/2.
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
// Payload is JSON `{ sourceEntityId, propertyIds }` rather than a bare id — a move can carry the
// whole active multi-selection (see `startPropertyMoveDrag`), and the drop side needs to know which
// entity to remove the properties FROM regardless of which direction (Related -> Current or Current
// -> Related) the drag went, since a move-handle now exists on both sides.
const PROPERTY_MOVE_DND_TYPE = "application/x-idea3-move-properties";
const PROPERTY_MAP_DND_TYPE = "application/x-idea3-map-property-id";

/** Expanded items float to the top of their lane, collapsed ones sort below — so "what's expanded"
 * stays scannable at a glance without hunting through a long compact list. */
function orderByExpanded<T>(items: T[], isExpanded: (item: T) => boolean): T[] {
  const expanded = items.filter(isExpanded);
  const collapsed = items.filter((item) => !isExpanded(item));
  return [...expanded, ...collapsed];
}

/** LEFT side panel — the complete Entity Type inventory, restored. Search + browse + drag (or
 * click) an Entity into the workspace — this is discovery, never itself the working surface. */
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
              title="Click to focus, drag onto the workspace to bring in as Related, double-click to add without focusing"
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
            title="Drag onto the workspace to bring into the Data Tables lane, or double-click to add"
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

/** One Property row — used both for the Current Entity's own list and for an expanded Related
 * Entity's property list. `canMap` gates the connect-handle (mapping is Current-Entity-only, since
 * mapping only ever needs to reach the Data Tables lane, and the two side lanes are mutually
 * exclusive — see this file's own doc comment). `onMoveDrop` is only wired on the Current Entity
 * side (the one cross-lane move-drop target every Related property's move-handle can reach; the
 * reverse direction — Current -> a Related entity — drops onto that entity's own expanded list,
 * wired where it renders below). */
function PropertyRow({
  entity,
  property,
  selected,
  multiSelected,
  justMapped,
  canMap,
  onSelect,
  onSetPropRef,
  onHoverChange,
  onStartMove,
  onStartMap,
  onEndMap,
  onPick,
  pickerOpen,
  tables,
}: {
  entity: Entity;
  property: Property;
  selected: boolean;
  multiSelected: boolean;
  justMapped: boolean;
  canMap: boolean;
  onSelect: (mods: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  onSetPropRef: (el: HTMLElement | null) => void;
  onHoverChange: (hovering: boolean) => void;
  onStartMove: () => void;
  onStartMap?: (() => void) | undefined;
  onEndMap?: ((clientX: number, clientY: number) => void) | undefined;
  onPick?: ((table: string, column: string) => void) | undefined;
  pickerOpen?: { x: number; y: number } | undefined;
  tables: TableSchema[];
}) {
  const mapped = !!property.mapping;
  return (
    <div
      ref={(el) => onSetPropRef(el)}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      className={cn(
        "group/prop relative flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[13px] transition-colors",
        multiSelected
          ? "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8]"
          : selected
            ? "bg-black/[0.04] shadow-[0_0_0_1px_#00ded8]"
            : "hover:bg-accent",
        justMapped && "shadow-[0_0_0_2px_#22c55e]",
      )}
    >
      {/* Move handle — drag this row onto a visible Related Entity (or, from a Related Entity's
          own list, onto the Current Entity) to move the Property there. */}
      <span
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            PROPERTY_MOVE_DND_TYPE,
            JSON.stringify({ sourceEntityId: entity.id, propertyIds: [property.id] }),
          );
          onStartMove();
        }}
        className="cursor-grab select-none text-muted-foreground active:cursor-grabbing"
        title="Drag onto another visible Entity to move this property there"
      >
        ⠿
      </span>
      <button
        type="button"
        onClick={(e) => onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span
          className="size-1.5 shrink-0 rounded-full"
          title={reviewStatusLabel(propertyStatus(property))}
          style={{ backgroundColor: statusDotColor(propertyStatus(property)) }}
        />
        {isIdentifierProperty(property) && <IdentifierIcon />}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{property.name}</span>
        {property.status !== "confirmed" && <ConfidenceChip confidence={property.confidence} />}
      </button>
      {mapped && (
        <span className="shrink-0 truncate text-[10.5px] text-muted-foreground">
          → {property.mapping!.table}.{property.mapping!.column}
          {mappingStatus(property.mapping!) === "suggested" ? " (suggested)" : ""}
        </span>
      )}
      {/* Connect handle — Current Entity only. Drag onto a visible Column to map directly; drop
          anywhere else opens the "Find a column…" picker at the drop point, same gesture. */}
      {canMap && onStartMap && onEndMap && (
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(PROPERTY_MAP_DND_TYPE, property.id);
            onStartMap();
          }}
          onDragEnd={(e) => onEndMap(e.clientX, e.clientY)}
          className="flex size-4 shrink-0 cursor-grab items-center justify-center rounded-full border border-[rgba(28,28,24,0.2)] text-[9px] text-muted-foreground opacity-0 group-hover/prop:opacity-100 active:cursor-grabbing"
          title="Drag onto a visible Column to map, or drop anywhere to search for one"
        >
          ●
        </span>
      )}
      {pickerOpen && onPick && (
        <MappingPicker
          x={pickerOpen.x}
          y={pickerOpen.y}
          tables={tables}
          onPick={onPick}
          onClose={() => onEndMap?.(-1, -1) /* handled by caller clearing pickerState */}
        />
      )}
    </div>
  );
}

export function DetailViewIdea3({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
  const { entities, relations, tables } = app;
  const focusEntity =
    anchor?.kind === "entity" ? (entities.find((e) => e.id === anchor.id) ?? null) : null;

  // --- Working set: the lane workspace's own contents, deliberately separate from the full
  // inventory the side panels browse. Seeded from the Focus Entity's immediate neighborhood (its
  // own Relations, its own mapped Tables) on every Focus change.
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

  // --- Unified selection, ported from DetailView.tsx (Idea 1/2): one Set spanning Entity/
  // Property/Relation, single = inspect (contextItem below), 2+ = act (SelectionControlBar). ----
  const suggestionSelection = app.suggestionSelection;
  const selectedRefs = useMemo(() => {
    const refs: SuggestionRef[] = [];
    suggestionSelection.forEach((key) => {
      const ref = parseSuggestionKey(key);
      if (ref) refs.push(ref);
    });
    return refs;
  }, [suggestionSelection]);
  const selectedEntities = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "entity" }> => r.kind === "entity")
        .map((r) => entities.find((e) => e.id === r.id))
        .filter((e): e is Entity => !!e),
    [selectedRefs, entities],
  );
  const selectedProperties = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "property" }> => r.kind === "property")
        .map((r) => {
          const owner = entities.find((e) => e.id === r.entityId);
          const p = owner?.properties.find((x) => x.id === r.propertyId);
          return owner && p ? { entity: owner, property: p } : null;
        })
        .filter((v): v is { entity: Entity; property: Property } => !!v),
    [selectedRefs, entities],
  );
  const selectedRelations = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "relation" }> => r.kind === "relation")
        .map((r) => relations.find((x) => x.id === r.id))
        .filter((r): r is Relation => !!r),
    [selectedRefs, relations],
  );
  const deletableKeys = useMemo(
    () => [
      ...selectedEntities
        .filter((e) => e.status === "confirmed")
        .map((e) => suggestionKey({ kind: "entity", id: e.id })),
      ...selectedProperties
        .filter(({ property }) => property.status === "confirmed")
        .map(({ entity, property }) =>
          suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
        ),
      ...selectedRelations
        .filter((r) => r.status === "confirmed")
        .map((r) => suggestionKey({ kind: "relation", id: r.id })),
    ],
    [selectedEntities, selectedProperties, selectedRelations],
  );
  const rejectableKeys = useMemo(
    () => [
      ...selectedEntities
        .filter((e) => e.status !== "confirmed")
        .map((e) => suggestionKey({ kind: "entity", id: e.id })),
      ...selectedProperties
        .filter(({ property }) => property.status !== "confirmed")
        .map(({ entity, property }) =>
          suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
        ),
      ...selectedRelations
        .filter((r) => r.status !== "confirmed")
        .map((r) => suggestionKey({ kind: "relation", id: r.id })),
    ],
    [selectedEntities, selectedProperties, selectedRelations],
  );
  const acceptableKeys = useMemo(
    () => [
      ...selectedEntities
        .filter((e) => e.status !== "confirmed" && e.status !== "error")
        .map((e) => suggestionKey({ kind: "entity", id: e.id })),
      ...selectedProperties
        .filter(
          ({ entity, property }) =>
            property.status !== "confirmed" &&
            property.status !== "error" &&
            (entity.status === "confirmed" || selectedEntities.some((e) => e.id === entity.id)),
        )
        .map(({ entity, property }) =>
          suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
        ),
      ...selectedRelations
        .filter((r) => r.status !== "confirmed" && r.status !== "error")
        .map((r) => suggestionKey({ kind: "relation", id: r.id })),
    ],
    [selectedEntities, selectedProperties, selectedRelations],
  );
  const handleDeleteSelection = useCallback(() => {
    const entityIds = selectedEntities.filter((e) => e.status === "confirmed").map((e) => e.id);
    const propertyItems = selectedProperties
      .filter(({ property }) => property.status === "confirmed")
      .map(({ entity, property }) => ({ entityId: entity.id, propertyId: property.id }));
    const relationIds = selectedRelations.filter((r) => r.status === "confirmed").map((r) => r.id);
    if (entityIds.length > 0) app.deleteEntities(entityIds);
    if (propertyItems.length > 0) app.deleteProperties(propertyItems);
    if (relationIds.length > 0) app.deleteRelations(relationIds);
    app.clearSuggestionSelection();
    setContextItem(null);
  }, [selectedEntities, selectedProperties, selectedRelations, app]);
  const handleAcceptSelection = useCallback(() => {
    if (acceptableKeys.length > 0) app.acceptSuggestions(acceptableKeys);
  }, [acceptableKeys, app]);
  const handleRejectSelection = useCallback(() => {
    if (rejectableKeys.length > 0) app.declineSuggestions(rejectableKeys);
  }, [rejectableKeys, app]);

  // Split only when every selected Property belongs to the SAME Entity and doing so wouldn't empty
  // that Entity out entirely — mirrors `splitEntity`'s own rule. Works for the Current Entity's own
  // properties OR an expanded Related Entity's, whichever owns the current property selection.
  const splitEligibleEntityId = useMemo(() => {
    if (selectedEntities.length > 0 || selectedRelations.length > 0) return null;
    if (selectedProperties.length === 0) return null;
    const entityId = selectedProperties[0]!.entity.id;
    if (selectedProperties.some(({ entity }) => entity.id !== entityId)) return null;
    const owner = selectedProperties[0]!.entity;
    if (selectedProperties.length >= owner.properties.length) return null;
    return entityId;
  }, [selectedEntities, selectedProperties, selectedRelations]);

  const selectedPropertyIdsFor = useCallback(
    (entityId: string) => {
      const ids = new Set<string>();
      suggestionSelection.forEach((key) => {
        const ref = parseSuggestionKey(key);
        if (ref?.kind === "property" && ref.entityId === entityId) ids.add(ref.propertyId);
      });
      return ids;
    },
    [suggestionSelection],
  );
  const clearPropertySelection = useCallback(
    (entityId: string) => {
      app.selectSuggestionKeys(
        Array.from(suggestionSelection).filter((key) => {
          const ref = parseSuggestionKey(key);
          return !(ref?.kind === "property" && ref.entityId === entityId);
        }),
      );
    },
    [suggestionSelection, app],
  );

  // Splitting stays in this same workspace — the new entity is added into the Related Context lane
  // (right after the entity it split from, or at the front if it split from Current Entity itself),
  // expanded, with its Inspector opened immediately so the blank name receives focus. `app.entities`
  // hasn't re-rendered with the new entity yet at the point `app.splitEntity` returns (React state
  // updates are async), so opening its Inspector can't happen synchronously here — `pendingSplitId`
  // + the effect below resolve it the moment `entities` actually contains it, same pattern
  // `DetailView.tsx`'s own `pendingSplitEntityId` uses for the identical race.
  const [pendingSplitId, setPendingSplitId] = useState<string | null>(null);
  const handleSplit = useCallback(
    (entityId: string) => {
      const newId = app.splitEntity(entityId, Array.from(selectedPropertyIdsFor(entityId)));
      clearPropertySelection(entityId);
      if (!newId) return;
      setRelatedEntityIds((ids) => {
        if (entityId === focusEntity?.id) return [newId, ...ids];
        const idx = ids.indexOf(entityId);
        if (idx === -1) return [...ids, newId];
        return [...ids.slice(0, idx + 1), newId, ...ids.slice(idx + 1)];
      });
      setExpandedRelatedIds((prev) => new Set(prev).add(newId));
      setExpandedTableNames(new Set());
      setPendingSplitId(newId);
    },
    [app, selectedPropertyIdsFor, clearPropertySelection, focusEntity?.id],
  );
  useEffect(() => {
    if (!pendingSplitId) return;
    const newEntity = entities.find((e) => e.id === pendingSplitId);
    if (!newEntity) return;
    setContextItem({ kind: "entity", entity: newEntity });
    setPendingSplitId(null);
  }, [entities, pendingSplitId]);

  // --- Merge: shift/cmd-click 1+ Entity headers (Current Entity's own, or a Related Entity's) to
  // select them via the same unified selection, then Merge combines them into a brand-new entity
  // and Focus jumps to it. ------------------------------------------------------------------
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const mergeCandidates = selectedEntities;
  const mergeAiSuggestions = useMemo(() => {
    if (mergeCandidates.length < 2) return [];
    const names = mergeCandidates.map((e) => e.name || "Entity");
    const joined = names.join(" ");
    const camel = names.join("");
    return Array.from(new Set([joined, camel].filter((s) => s.trim().length > 0)));
  }, [mergeCandidates]);
  const handleMerge = useCallback(() => {
    if (!mergeName.trim()) return;
    const ids = mergeCandidates.map((e) => e.id);
    const newId = app.mergeEntities(ids, mergeName.trim());
    app.clearSuggestionSelection();
    setMergePanelOpen(false);
    setMergeName("");
    if (newId) app.openDetail("entity", newId);
  }, [mergeName, mergeCandidates, app]);

  const selectOnClick = useCallback(
    (
      ref: SuggestionRef,
      item: ContextItem | null,
      mods?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    ) => {
      const key = suggestionKey(ref);
      if (!mods?.shiftKey && !mods?.metaKey && !mods?.ctrlKey) {
        app.selectSuggestionKeys([key]);
        setContextItem(item);
        return;
      }
      app.toggleSuggestionSelected(ref);
      const next = new Set(suggestionSelection);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size <= 1) setContextItem(next.size === 1 ? item : null);
    },
    [app, suggestionSelection],
  );

  const selectedMapEndpointPropertyId = useMemo(() => {
    if (!contextItem || contextItem.kind !== "property" || !contextItem.property.mapping)
      return null;
    return contextItem.property.id;
  }, [contextItem]);
  const activeMapPropertyId = hoveredPropertyId ?? selectedMapEndpointPropertyId;

  // --- Connector line: ONE at a time, for whichever Property is currently hovered/selected AND
  // whose mapped Table is currently visible (expanded) in the Data Tables lane — on-demand, never a
  // permanent wall of lines. Recomputed on hover/select change, on either lane's own scroll, and
  // when the Data Tables lane's expanded set changes; hides (without touching the underlying
  // mapping) if either endpoint scrolls outside its own lane's visible viewport. ----------------
  const workspaceRef = useRef<HTMLDivElement>(null);
  const currentBodyRef = useRef<HTMLDivElement>(null);
  const dataBodyRef = useRef<HTMLDivElement>(null);
  const propertyRefs = useRef<Map<string, HTMLElement>>(new Map());
  const columnRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [linePath, setLinePath] = useState<string | null>(null);

  const recomputeLine = useCallback(() => {
    const container = workspaceRef.current;
    const currentBody = currentBodyRef.current;
    const dataBody = dataBodyRef.current;
    if (!activeMapPropertyId || !focusEntity || !container || !currentBody || !dataBody) {
      setLinePath(null);
      return;
    }
    const prop = focusEntity.properties.find((p) => p.id === activeMapPropertyId);
    if (!prop?.mapping) {
      setLinePath(null);
      return;
    }
    const propEl = propertyRefs.current.get(prop.id);
    const colEl = columnRefs.current.get(`${prop.mapping.table}.${prop.mapping.column}`);
    if (!propEl || !colEl) {
      setLinePath(null);
      return;
    }
    const withinViewport = (el: HTMLElement, lane: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const c = lane.getBoundingClientRect();
      return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right;
    };
    if (!withinViewport(propEl, currentBody) || !withinViewport(colEl, dataBody)) {
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
  }, [activeMapPropertyId, focusEntity]);

  useEffect(() => {
    recomputeLine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMapPropertyId, focusEntity, expandedTableNames]);

  // rAF-throttled scroll handling — either lane scrolling can move an endpoint in or out of view.
  const scrollRaf = useRef<number | null>(null);
  const onLaneScroll = useCallback(() => {
    if (scrollRaf.current != null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      recomputeLine();
    });
  }, [recomputeLine]);

  // Mutual exclusion between the two side lanes' expansion, decided at the click site (which knows
  // whether this particular click is expanding or collapsing) rather than inside the toggle itself.
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
  const onRelatedHeaderClick = useCallback(
    (e: Entity, mods: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      if (mods.shiftKey || mods.metaKey || mods.ctrlKey) {
        selectOnClick({ kind: "entity", id: e.id }, { kind: "entity", entity: e }, mods);
        return;
      }
      const expanding = !expandedRelatedIds.has(e.id);
      if (expanding && expandedTableNames.size > 0) setExpandedTableNames(new Set());
      toggleRelated(e.id);
    },
    [expandedRelatedIds, expandedTableNames, selectOnClick, toggleRelated],
  );
  const onTableHeaderClick = useCallback(
    (t: TableSchema) => {
      const expanding = !expandedTableNames.has(t.name);
      if (expanding && expandedRelatedIds.size > 0) setExpandedRelatedIds(new Set());
      toggleTable(t.name);
    },
    [expandedTableNames, expandedRelatedIds, toggleTable],
  );

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

  // Move a Property (or, if it's part of the active multi-selection, the whole selection) from
  // `sourceEntityId` onto `targetEntityId` — the one operation both move-drop targets below share.
  const movePropertiesOnDrop = useCallback(
    (e: React.DragEvent, targetEntityId: string) => {
      const raw = e.dataTransfer.getData(PROPERTY_MOVE_DND_TYPE);
      if (!raw) return;
      try {
        const payload = JSON.parse(raw) as { sourceEntityId: string; propertyIds: string[] };
        if (!payload.sourceEntityId || payload.sourceEntityId === targetEntityId) return;
        const source = entities.find((x) => x.id === payload.sourceEntityId);
        if (!source) return;
        const items = payload.propertyIds
          .map((id) => source.properties.find((p) => p.id === id))
          .filter((p): p is Property => !!p)
          .map((p) => ({ id: p.id, name: p.name }));
        if (items.length === 0) return;
        app.moveProperties(payload.sourceEntityId, targetEntityId, items);
        clearPropertySelection(payload.sourceEntityId);
      } catch {
        /* malformed payload — ignore */
      }
    },
    [entities, app, clearPropertySelection],
  );

  const [newPropertyDraft, setNewPropertyDraft] = useState("");
  const [newEntityDraftOpen, setNewEntityDraftOpen] = useState(false);

  if (!focusEntity) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white text-sm text-muted-foreground">
        Idea 3 currently only prototypes the Entity-focused workspace — select an Entity Type to try
        it.
      </div>
    );
  }

  const orderedRelated = orderByExpanded(relatedEntities, (e) => expandedRelatedIds.has(e.id));
  const orderedTables = orderByExpanded(dataTables, (t) => expandedTableNames.has(t.name));
  const focusSelected = suggestionSelection.has(
    suggestionKey({ kind: "entity", id: focusEntity.id }),
  );

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

      {/* WORKSPACE — 3 bounded lanes, each independently scrollable, none of them growing the page. */}
      <div ref={workspaceRef} className="relative flex min-w-0 flex-1 overflow-hidden bg-[#FAFAFA]">
        {linePath && (
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
            <path d={linePath} fill="none" stroke="#00ded8" strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}

        {/* LANE 1 — Connected Entities */}
        <div className="flex min-w-0 flex-1 basis-0 flex-col overflow-hidden border-r border-[rgba(28,28,24,0.06)] bg-[#F6F5FA] pt-12">
          <div className="flex shrink-0 items-center justify-between px-3 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7c5eff]">
              Connected Entities
            </p>
            <span className="text-[10px] text-muted-foreground">{relatedEntities.length}</span>
          </div>
          <div
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(ENTITY_DND_TYPE);
              if (id) addRelatedEntity(id);
              else movePropertiesOnDrop(e, focusEntity.id);
            }}
          >
            {relatedEntities.length === 0 && (
              <p className="rounded-lg border border-dashed border-[rgba(28,28,24,0.15)] px-2 py-3 text-center text-[11px] text-muted-foreground">
                Drag an Entity Type here from the left panel.
              </p>
            )}
            {orderedRelated.map((e) => {
              const relation = relationBetween(focusEntity.id, e.id);
              const expanded = expandedRelatedIds.has(e.id);
              const entitySelected = suggestionSelection.has(
                suggestionKey({ kind: "entity", id: e.id }),
              );
              return (
                <div
                  key={e.id}
                  className={cn(
                    "rounded-xl bg-white/70 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
                    entitySelected && "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8]",
                  )}
                  onDragOver={(ev) => ev.preventDefault()}
                  onDrop={(ev) => movePropertiesOnDrop(ev, e.id)}
                >
                  <button
                    type="button"
                    onClick={(ev) =>
                      onRelatedHeaderClick(e, {
                        shiftKey: ev.shiftKey,
                        metaKey: ev.metaKey,
                        ctrlKey: ev.ctrlKey,
                      })
                    }
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
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {e.properties.length}
                    </span>
                  </button>
                  {relation && (
                    <button
                      type="button"
                      onClick={(ev) =>
                        selectOnClick(
                          { kind: "relation", id: relation.id },
                          { kind: "relation", relation },
                          { shiftKey: ev.shiftKey, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey },
                        )
                      }
                      className={cn(
                        "ml-7 truncate rounded px-1 text-left text-[10px] text-muted-foreground hover:bg-black/[0.04] hover:text-foreground",
                        contextItem?.kind === "relation" &&
                          contextItem.relation.id === relation.id &&
                          "bg-black/[0.04] text-foreground",
                      )}
                    >
                      {relationLabel(relation)}
                    </button>
                  )}
                  {expanded && (
                    <div className="ml-6 mt-1 flex flex-col gap-0.5 border-l border-[rgba(28,28,24,0.1)] pl-2">
                      {e.properties.map((p) => (
                        <PropertyRow
                          key={p.id}
                          entity={e}
                          property={p}
                          canMap={false}
                          selected={
                            contextItem?.kind === "property" && contextItem.property.id === p.id
                          }
                          multiSelected={
                            suggestionSelection.size > 1 &&
                            suggestionSelection.has(
                              suggestionKey({ kind: "property", entityId: e.id, propertyId: p.id }),
                            )
                          }
                          justMapped={false}
                          tables={tables}
                          onSetPropRef={() => {}}
                          onHoverChange={() => {}}
                          onStartMove={() => {}}
                          onSelect={(mods) =>
                            selectOnClick(
                              { kind: "property", entityId: e.id, propertyId: p.id },
                              { kind: "property", entity: e, property: p },
                              mods,
                            )
                          }
                        />
                      ))}
                      {e.properties.length === 0 && (
                        <p className="py-0.5 text-[10.5px] text-muted-foreground">No properties.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {newEntityDraftOpen ? (
              <div className="flex items-center gap-1.5 rounded-xl bg-white/70 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                <input
                  autoFocus
                  placeholder="New entity name…"
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[12px] outline-none focus:border-primary"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setNewEntityDraftOpen(false);
                    if (e.key === "Enter") {
                      const name = e.currentTarget.value.trim();
                      if (name) {
                        const newId = app.createEntityWithProperties({
                          name,
                          position: { x: focusEntity.x + 200, y: focusEntity.y + 200 },
                          properties: [],
                        });
                        setRelatedEntityIds((ids) => [...ids, newId]);
                        setExpandedRelatedIds((prev) => new Set(prev).add(newId));
                      }
                      setNewEntityDraftOpen(false);
                    }
                  }}
                  onBlur={() => setNewEntityDraftOpen(false)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNewEntityDraftOpen(true)}
                className="rounded-lg border border-dashed border-[rgba(28,28,24,0.15)] px-2 py-1.5 text-center text-[11px] text-muted-foreground hover:bg-black/[0.03] hover:text-foreground"
              >
                + Create Entity
              </button>
            )}
          </div>
        </div>

        {/* LANE 2 — Current Entity: the origin, visually most prominent. */}
        <div className="flex min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-white shadow-[0_0_28px_rgba(0,0,0,0.05)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(28,28,24,0.06)] px-6 py-3.5">
            <StatusBadge
              status={entityDisplayStatus(focusEntity)}
              size={26}
              confidence={focusEntity.confidence}
              warningReason={focusEntity.warningReason}
              errorReason={entityErrorReason(focusEntity)}
            />
            <button
              type="button"
              onClick={(e) =>
                selectOnClick(
                  { kind: "entity", id: focusEntity.id },
                  { kind: "entity", entity: focusEntity },
                  { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey },
                )
              }
              className={cn(
                "min-w-0 flex-1 truncate rounded-md px-1 -mx-1 text-left text-[15px] font-semibold text-foreground hover:underline",
                focusSelected && "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8]",
              )}
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
          <div
            ref={currentBodyRef}
            onScroll={onLaneScroll}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => movePropertiesOnDrop(e, focusEntity.id)}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5"
          >
            <div className="flex flex-col gap-0.5">
              {focusEntity.properties.map((p) => (
                <PropertyRow
                  key={p.id}
                  entity={focusEntity}
                  property={p}
                  canMap
                  selected={contextItem?.kind === "property" && contextItem.property.id === p.id}
                  multiSelected={
                    suggestionSelection.size > 1 &&
                    suggestionSelection.has(
                      suggestionKey({
                        kind: "property",
                        entityId: focusEntity.id,
                        propertyId: p.id,
                      }),
                    )
                  }
                  justMapped={justMappedPropertyId === p.id}
                  tables={tables}
                  onSetPropRef={(el) => {
                    if (el) propertyRefs.current.set(p.id, el);
                    else propertyRefs.current.delete(p.id);
                  }}
                  onHoverChange={(hovering) =>
                    setHoveredPropertyId((cur) => {
                      if (hovering) return p.id;
                      return cur === p.id ? null : cur;
                    })
                  }
                  onStartMove={() => {}}
                  onSelect={(mods) =>
                    selectOnClick(
                      { kind: "property", entityId: focusEntity.id, propertyId: p.id },
                      { kind: "property", entity: focusEntity, property: p },
                      mods,
                    )
                  }
                  onStartMap={() => setDraggingPropertyId(p.id)}
                  onEndMap={(clientX, clientY) => {
                    setDraggingPropertyId(null);
                    if (clientX < 0 && clientY < 0) {
                      // MappingPicker's own onClose calling back through here — just close it.
                      setPickerState(null);
                      return;
                    }
                    const target = document.elementFromPoint(clientX, clientY);
                    const overColumn = target?.closest("[data-idea3-column]");
                    if (!overColumn) setPickerState({ propertyId: p.id, x: clientX, y: clientY });
                  }}
                  pickerOpen={
                    pickerState?.propertyId === p.id
                      ? { x: pickerState.x, y: pickerState.y }
                      : undefined
                  }
                  onPick={(table, column) => {
                    commitMapping(p.id, table, column);
                    setPickerState(null);
                  }}
                />
              ))}
              <div className="flex items-center gap-1.5 px-2.5 py-1">
                <span className="text-muted-foreground">＋</span>
                <input
                  value={newPropertyDraft}
                  onChange={(e) => setNewPropertyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPropertyDraft.trim()) {
                      app.createProperty(focusEntity.id, newPropertyDraft.trim());
                      setNewPropertyDraft("");
                    }
                  }}
                  placeholder="Add property…"
                  className="min-w-0 flex-1 border-none bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          </div>
          {contextItem && suggestionSelection.size <= 1 && (
            <div className="flex max-h-56 shrink-0 items-start gap-2 border-t border-[rgba(28,28,24,0.06)] bg-[#FCFCFC] px-4 py-3">
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

        {/* LANE 3 — Data Tables (working set) */}
        <div className="flex min-w-0 flex-1 basis-0 flex-col overflow-hidden border-l border-[rgba(28,28,24,0.06)] bg-[#F2F8FA] pt-12">
          <div className="flex shrink-0 items-center justify-between px-3 pb-2">
            <span className="text-[10px] text-muted-foreground">{dataTables.length}</span>
            <p className="text-right text-[10px] font-semibold uppercase tracking-wider text-[#0298b2]">
              Data Tables
            </p>
          </div>
          <div
            ref={dataBodyRef}
            onScroll={onLaneScroll}
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const name = e.dataTransfer.getData(TABLE_DND_TYPE);
              if (name) addDataTable(name);
            }}
          >
            {dataTables.length === 0 && (
              <p className="rounded-lg border border-dashed border-[rgba(28,28,24,0.15)] px-2 py-3 text-center text-[11px] text-muted-foreground">
                Drag a Table here from the right panel.
              </p>
            )}
            {orderedTables.map((table) => {
              const expanded = expandedTableNames.has(table.name);
              return (
                <div
                  key={table.name}
                  className="rounded-xl bg-white/70 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                >
                  <button
                    type="button"
                    onClick={() => onTableHeaderClick(table)}
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
                    <div className="ml-6 mt-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto border-l border-[rgba(28,28,24,0.1)] pl-2">
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
                              "outline outline-1 outline-dashed outline-[#00ded8]/50",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[#555]">{c.name}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {c.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Multi-select action bar — floats over the workspace, bottom-center, only while 2+
            objects are selected (single selection keeps the ordinary Inspector above instead). */}
        {suggestionSelection.size >= 2 && (
          <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
            {mergePanelOpen && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="flex w-[320px] flex-col gap-2.5 rounded-lg border border-node-border bg-node p-3 shadow-[var(--shadow-node-lift)]"
              >
                <div className="flex items-center gap-1.5 text-[12px] font-medium">
                  <GitMerge className="size-3.5 text-primary" />
                  Merge {mergeCandidates.length} entities into one
                </div>
                <p className="text-[10.5px] text-muted-foreground">
                  All properties from {mergeCandidates.map((e) => e.name || "Untitled").join(", ")}{" "}
                  will be combined. Name the resulting entity:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {mergeCandidates.map((e) => (
                    <button
                      key={e.id}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={() => setMergeName(e.name)}
                      className={cn(
                        "rounded-full border px-2 py-1 text-[10.5px] transition-colors",
                        mergeName === e.name
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {e.name || "Untitled"}
                    </button>
                  ))}
                  {mergeAiSuggestions.map((name) => (
                    <button
                      key={name}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={() => setMergeName(name)}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-1 text-[10.5px] transition-colors",
                        mergeName === name
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-data/40 bg-data-soft text-data hover:bg-data-soft/70",
                      )}
                    >
                      {name}
                      <span className="text-[8.5px] uppercase tracking-wide opacity-70">AI</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={mergeName}
                    onChange={(e) => setMergeName(e.target.value)}
                    placeholder="Custom name"
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11.5px] outline-none focus:border-primary"
                  />
                  <button
                    onClick={handleMerge}
                    disabled={!mergeName.trim()}
                    className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Merge
                  </button>
                  <button
                    onClick={() => {
                      setMergePanelOpen(false);
                      setMergeName("");
                    }}
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
                    aria-label="Cancel merge"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
            <SelectionControlBar
              entities={selectedEntities}
              properties={selectedProperties}
              relations={selectedRelations}
              mappingCount={0}
              onClear={() => {
                app.clearSuggestionSelection();
                setContextItem(null);
              }}
              onMerge={selectedEntities.length >= 2 ? () => setMergePanelOpen(true) : undefined}
              onSplit={splitEligibleEntityId ? () => handleSplit(splitEligibleEntityId) : undefined}
              onDelete={deletableKeys.length > 0 ? handleDeleteSelection : undefined}
              deleteCount={deletableKeys.length}
              onAccept={acceptableKeys.length > 0 ? handleAcceptSelection : undefined}
              acceptCount={acceptableKeys.length}
              onReject={rejectableKeys.length > 0 ? handleRejectSelection : undefined}
              rejectCount={rejectableKeys.length}
            />
          </div>
        )}
      </div>

      <DataTablesPanel
        tables={tables}
        workingNames={new Set(dataTableNames)}
        onAdd={addDataTable}
      />
    </div>
  );
}
