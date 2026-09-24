import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  ChevronDown,
  Fingerprint,
  GitMerge,
  Hash,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Search,
  ToggleLeft,
  Type as TypeIcon,
  Undo2,
  X,
} from "lucide-react";
import type { DetailAnchor, OntologyApp } from "@/lib/app-state";
import { suggestionKey, parseSuggestionKey, type SuggestionRef } from "@/lib/app-state";
import {
  entitiesUsingTable,
  entityDisplayStatus,
  entityErrorReason,
  isIdentifierProperty,
  mappingStatus,
  propertyStatus,
  relationLabel,
  relationStatus,
  tableByName,
  tableHighestMappingConfidence,
  tableMappingCompleteness,
  tableMappingStatus,
  tablesUsedByEntity,
  type Entity,
  type Property,
  type Relation,
  type ReviewStatus,
  type TableSchema,
} from "@/lib/mock-data";
import { StatusBadge } from "@/components/ontology/StatusBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import {
  EntityConfidenceChip,
  MappingConfidenceChip,
  PropertyConfidenceChip,
  RelationConfidenceChip,
} from "@/components/ontology/ConfidenceChip";
import { AiReviewBar, type SuggestionScope } from "@/components/ontology/AiReviewBar";
import {
  CreateEntityWizard,
  type CreateEntityDraft,
} from "@/components/ontology/CreateEntityWizard";
import {
  DEFAULT_SORT,
  nextSortState,
  sortByState,
  SortDropdown,
  type SortKey,
  type SortState,
} from "@/components/ontology/SortDropdown";
import { SelectionControlBar } from "@/components/detail/SelectionControlBar";
import { isTypingTarget } from "@/components/ontology/CanvasControls";
import type { Rect } from "@/lib/geometry";
import { cn } from "@/lib/utils";

/**
 * Idea 4 is intentionally a layout-only workspace. Its bounded three-surface composition is
 * independent from Ideas 1-3 so interaction experiments can be added incrementally later.
 *
 * Three connector systems, all anchored on each card's own TITLE bar (never its full height), so
 * a fan of lines to/from a tall expanded card still converges on one legible point:
 *  - Relation lines (Connected Entities <-> Current Entity): PERSISTENT, one dashed line + pill
 *    per visible related Entity — relations are a stable structural fact worth always showing,
 *    same reasoning `DetailView.tsx`'s own satellite lines use for their "always visible"
 *    connectors.
 *  - Entity<->Table lines (Current Entity <-> its own mapped Tables): PERSISTENT too, one coarse
 *    line per visible (compact) Table — mirrors the relation lines onto the Data Tables side.
 *  - Property<->Column ladder: once ONE Table is expanded (only one Entity/Table can ever be
 *    expanded at a time in this workspace), every one of Current Entity's own Properties mapped
 *    into that Table gets its own persistent 1:1 line, replacing that Table's single coarse line.
 *    A Property whose Column has scrolled outside the expanded Table's own capped view redirects
 *    to that Table's "Mapped columns" footer instead of pointing at nothing — clicking the footer
 *    scrolls the nearest such Column into view.
 * All three recompute on scroll (each lane scrolls independently) and hide a line entirely rather
 * than pointing at nothing once its row/card scrolls outside its own lane's visible viewport.
 * Collapsed cards sort below whichever one Entity/Table is currently expanded in their own lane,
 * so the open card never has to be hunted for once the list scrolls.
 *
 * Merge / Split / Move-properties are ported from Idea 3 onto the same `app.suggestionSelection`
 * Set and `app.splitEntity`/`app.mergeEntities`/`app.moveProperties` mutators, reusing the shared
 * `SelectionControlBar`. Idea 4 has no Inspector panel yet, so a plain click keeps its existing
 * job (expand/collapse a card) — only shift/cmd-click toggles an Entity or Property into the
 * multi-selection; the action bar itself only appears once 2+ things are selected.
 */
// The one Filter control every Property/Column list in this workspace shares — "All" (no-op),
// "Mapped" (has a confirmed Property<->Column mapping), "Unmapped" (no mapping, or only a still-
// Suggested one — see `hasConfirmedMapping`), and "Only Identifier" (isIdentifierProperty). A
// single enum rather than 3 separate booleans since exactly one of them applies at a time.
type ListFilter = "all" | "mapped" | "unmapped" | "identifier";
const LIST_FILTER_LABEL: Record<ListFilter, string> = {
  all: "Filter",
  mapped: "Mapped",
  unmapped: "Unmapped",
  identifier: "Only Identifier",
};

/** A Suggested mapping hasn't been reviewed yet, so the Mapped/Unmapped filters treat it as
 * Unmapped — only a confirmed ("mapped") connector counts as Mapped. */
function hasConfirmedMapping(property: Property): boolean {
  return !!property.mapping && mappingStatus(property.mapping) === "mapped";
}

// A Property<->Column mapping line's own color: purple while it's still a Suggested mapping
// (nobody has reviewed it yet — same purple as the "Suggested" review status elsewhere), fading to
// this plain default gray once it's Mapped/confirmed — a mapping that's already settled shouldn't
// keep drawing the eye the way an outstanding suggestion should.
const MAPPING_SUGGESTED_COLOR = "#A855F7";
const MAPPING_DEFAULT_COLOR = "#9EA3A2";
const CONNECTOR_BEND_GAP = 18;
const CONNECTOR_RADIUS = 28;

type ConnectorPoint = { x: number; y: number };

/**
 * Routes a connector through the gutter between lanes: short horizontal exit, vertical travel in
 * the reserved gutter, then horizontal entry into the target. This keeps paths out of pill columns
 * while retaining soft 28px corners.
 */
function gutterConnectorPath(
  start: ConnectorPoint,
  end: ConnectorPoint,
  bendX: number,
  radius = CONNECTOR_RADIUS,
) {
  if (Math.abs(start.y - end.y) < 0.5) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

  const firstDirection = Math.sign(bendX - start.x) || 1;
  const verticalDirection = Math.sign(end.y - start.y) || 1;
  const lastDirection = Math.sign(end.x - bendX) || 1;
  const fittedRadius = Math.max(
    0,
    Math.min(
      radius,
      Math.abs(bendX - start.x),
      Math.abs(end.x - bendX),
      Math.abs(end.y - start.y) / 2,
    ),
  );

  if (fittedRadius < 0.5) {
    return `M ${start.x} ${start.y} L ${bendX} ${start.y} L ${bendX} ${end.y} L ${end.x} ${end.y}`;
  }

  return [
    `M ${start.x} ${start.y}`,
    `L ${bendX - firstDirection * fittedRadius} ${start.y}`,
    `Q ${bendX} ${start.y} ${bendX} ${start.y + verticalDirection * fittedRadius}`,
    `L ${bendX} ${end.y - verticalDirection * fittedRadius}`,
    `Q ${bendX} ${end.y} ${bendX + lastDirection * fittedRadius} ${end.y}`,
    `L ${end.x} ${end.y}`,
  ].join(" ");
}

function horizontalCenters(source: Rect, target: Rect) {
  return {
    start: { x: source.x + source.width, y: source.y + source.height / 2 },
    end: { x: target.x, y: target.y + target.height / 2 },
  };
}

// A Column row's own status dot — same 3 states as the mapping line above, just as a small dot
// instead of a connector: unmapped columns get a hollow neutral dot (nothing to say about them
// yet), a confirmed/settled mapping gets the mapped cyan, and only a still-Suggested mapping
// gets purple. Previously every Column row's dot was hardcoded to this same
// purple regardless of its actual state, which read as "every column has an outstanding
// suggestion" even for an Unmapped-filtered list — purple is reserved for Suggested everywhere
// else in the app (see `reviewStatusDot` below), so this brings the Column dot in line with that.
type ColumnMapState = "unmapped" | "mapped" | "suggested";
const COLUMN_DOT_COLOR: Record<ColumnMapState, string> = {
  unmapped: "#d4d4d8",
  mapped: "#22D3EE",
  suggested: MAPPING_SUGGESTED_COLOR,
};

// A Table-entry (clicking a Data Table rather than an Entity Type) is a genuinely different
// workspace shape — the Table itself becomes the prominent card, not an Entity — so it's its own
// component with its own hooks (`Idea4TableMode` below) rather than a conditional branch inside
// `Idea4EntityMode`'s hook-heavy body. This dispatcher has no hooks of its own, so switching
// between the two (a different anchor kind) is just an ordinary unmount/remount of two unrelated
// component subtrees, never a Rules-of-Hooks violation.
export function DetailViewIdea4({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
  if (anchor?.kind === "table") {
    const table = tableByName(anchor.id);
    if (!table) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Select an Entity Type with mapped data to open Idea 4.
        </div>
      );
    }
    return <Idea4TableMode app={app} table={table} />;
  }
  return <Idea4EntityMode app={app} anchor={anchor} />;
}

// Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z for the app-wide undo/redo stack (see `useOntologyApp`'s own
// `undo`/`redo`) — Idea 1 has no canvas tool-switch or zoom of its own, so this only borrows
// `CanvasToolStack`'s own "not while typing" guard (`isTypingTarget`) rather than the whole
// `useCanvasToolShortcuts` hook, which also carries Select/Pan-tool shortcuts this lane workspace
// doesn't have a use for.
function useUndoRedoShortcuts(onUndo: () => void, onRedo: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo, onRedo]);
}

// The header bar's own compact Undo/Redo pill — same visual language as `CanvasToolStack`
// (`rounded-[6px] border border-node-border bg-node shadow-[var(--shadow-node)]`, `size-7`
// buttons, `opacity-30` when that direction's stack is empty), just without the tool-switch/zoom
// groups a lane workspace has no equivalent for.
function UndoRedoPill({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  return (
    // Rebuilt off the Figma "topNavBar" node (406:5746, fetched in full): Undo/Redo are bare 28px
    // icon buttons directly in the row — no enclosing bordered/shadowed pill like the prototype's
    // original — followed by a 1px divider and a static "100%" zoom readout. That readout is
    // chrome only, not wired to a real zoom handler: this bounded workspace (unlike the Overview
    // canvas, which already has a real Zoom menu in `CanvasControls.tsx`) isn't actually
    // zoomable, so this preserves existing behavior (nothing to zoom) rather than fabricating a
    // new feature — same "static chrome, no invented behavior" call as the Entity types panel's
    // own "Name" sort control.
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded text-[#080a09] hover:bg-accent",
          !canUndo && "pointer-events-none opacity-30",
        )}
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded text-[#080a09] hover:bg-accent",
          !canRedo && "pointer-events-none opacity-30",
        )}
      >
        <Redo2 className="size-4" />
      </button>
      <div className="h-4 w-px shrink-0 bg-[#e3e5e4]" aria-hidden />
      <span className="flex h-7 shrink-0 items-center gap-1 rounded pl-2 pr-1 text-[12px] text-[#080a09]">
        100%
        <ChevronDown className="size-4 text-[#6d7472]" />
      </span>
    </div>
  );
}

function Idea4EntityMode({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
  useUndoRedoShortcuts(app.undo, app.redo);
  const [expandedContext, setExpandedContext] = useState<
    { kind: "entity"; id: string } | { kind: "table"; name: string } | null
  >(null);
  const focusEntity = useMemo(() => {
    if (!anchor) return null;
    if (anchor.kind === "entity")
      return app.entities.find((entity) => entity.id === anchor.id) ?? null;
    const table = tableByName(anchor.id);
    return table ? (entitiesUsingTable(table.name, app.entities)[0] ?? null) : null;
  }, [anchor, app.entities]);

  const relatedEntities = useMemo(() => {
    if (!focusEntity) return [];
    const ids = new Set(
      app.relations
        .filter((relation) => relation.from === focusEntity.id || relation.to === focusEntity.id)
        .map((relation) => (relation.from === focusEntity.id ? relation.to : relation.from)),
    );
    return app.entities.filter((entity) => ids.has(entity.id) && entity.id !== focusEntity.id);
  }, [app.entities, app.relations, focusEntity]);

  const hasSelfRelation = useMemo(
    () =>
      !!focusEntity &&
      app.relations.some(
        (relation) => relation.from === focusEntity.id && relation.to === focusEntity.id,
      ),
    [app.relations, focusEntity],
  );

  // Whichever ONE Connected Entity is currently expanded, if any — the Connected Entities lane
  // below uses this to render just that one `ExpandedEntity` plus a single collapsed "N more"
  // stack for the rest, instead of a full compact row per remaining Entity (see
  // `CollapsedCardsStack`'s own doc comment for why: with a dozen-plus Connected Entities, a
  // full stack of compact rows below the expanded card meant scrolling past all of them just to
  // get back to the top).
  const expandedConnectedEntity = useMemo(() => {
    if (expandedContext?.kind !== "entity") return null;
    return relatedEntities.find((entity) => entity.id === expandedContext.id) ?? null;
  }, [relatedEntities, expandedContext]);

  // Every Relation touching Focus Entity, as its own browsable row — a different job from the
  // connector pill floating over its line above (that pill is the line's own on-canvas label;
  // this is a plain list to scan/accept/reject/jump from, same as Connected Entities is to the
  // relation lines themselves). `outgoing` is whether Focus Entity is the Relation's own `from`
  // side, purely for which arrow direction to draw — never mutated.
  const focusRelations = useMemo(() => {
    if (!focusEntity) return [];
    return app.relations
      .filter((relation) => relation.from === focusEntity.id || relation.to === focusEntity.id)
      .map((relation) => {
        const outgoing = relation.from === focusEntity.id;
        const counterpartId = outgoing ? relation.to : relation.from;
        const counterpart = app.entities.find((entity) => entity.id === counterpartId);
        return counterpart ? { relation, counterpart, outgoing } : null;
      })
      .filter((v): v is { relation: Relation; counterpart: Entity; outgoing: boolean } => !!v);
  }, [focusEntity, app.relations, app.entities]);

  const displayedFocusRelations = useMemo(() => {
    if (expandedConnectedEntity) {
      return focusRelations.filter(
        ({ counterpart }) => counterpart.id === expandedConnectedEntity.id,
      );
    }
    const entityOrder = new Map(relatedEntities.map((entity, index) => [entity.id, index]));
    return [...focusRelations].sort((a, b) => {
      const aIndex =
        a.counterpart.id === focusEntity?.id ? -1 : (entityOrder.get(a.counterpart.id) ?? 0);
      const bIndex =
        b.counterpart.id === focusEntity?.id ? -1 : (entityOrder.get(b.counterpart.id) ?? 0);
      return aIndex - bIndex;
    });
  }, [focusRelations, expandedConnectedEntity, relatedEntities, focusEntity]);

  // Data Tables has no Relation-like fact to drive "is this Table showing" the way Connected
  // Entities does — a Table only ever appears once a Property actually maps into it. Dragging one
  // in from the toolbox ahead of any mapping needs its own small bit of state to keep it visible
  // in the meantime; reset whenever Focus itself changes, so a Table added while looking at one
  // Entity doesn't linger once you've moved on to another.
  const [manuallyAddedTableNames, setManuallyAddedTableNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    setManuallyAddedTableNames(new Set());
  }, [focusEntity?.id]);

  const mappedTables = useMemo(() => {
    if (!focusEntity) return [];
    const names = new Set([...tablesUsedByEntity(focusEntity), ...manuallyAddedTableNames]);
    return Array.from(names)
      .map((name) => tableByName(name))
      .filter((table): table is TableSchema => !!table);
  }, [focusEntity, manuallyAddedTableNames]);

  // Whichever ONE Data Table is currently expanded, if any — same "one expanded card + a single
  // collapsed 'N more' stack for the rest" restructuring as `expandedConnectedEntity` above, for
  // the same reason: a dozen-plus compact Table rows below the expanded one meant scrolling past
  // all of them just to get back to the top of Data Tables too.
  const expandedMappedTable = useMemo(() => {
    if (expandedContext?.kind !== "table") return null;
    return mappedTables.find((table) => table.name === expandedContext.name) ?? null;
  }, [mappedTables, expandedContext]);

  // Suggestions bar counts only what the lanes show: Focus + Entities lane, the Relations lane,
  // the Property list(s) on canvas (Focus's, plus an expanded Connected Entity's), and mappings
  // from those Properties into the Data Tables lane.
  const suggestionScope = useMemo<SuggestionScope>(() => {
    const entityIds = new Set(relatedEntities.map((entity) => entity.id));
    if (focusEntity) entityIds.add(focusEntity.id);
    const propertyOwnerIds = new Set<string>();
    if (focusEntity) propertyOwnerIds.add(focusEntity.id);
    if (expandedConnectedEntity) propertyOwnerIds.add(expandedConnectedEntity.id);
    const relationIds = new Set(focusRelations.map(({ relation }) => relation.id));
    const tableNames = new Set(mappedTables.map((table) => table.name));
    return {
      entity: (entity) => entityIds.has(entity.id),
      property: (owner) => propertyOwnerIds.has(owner.id),
      relation: (relation) => relationIds.has(relation.id),
      mapping: (owner, property) =>
        propertyOwnerIds.has(owner.id) &&
        !!property.mapping &&
        tableNames.has(property.mapping.table),
    };
  }, [relatedEntities, focusEntity, expandedConnectedEntity, focusRelations, mappedTables]);

  // --- Filter/Sort/Search for every Property list (Current Entity's own, and each Connected
  // Entity's own expanded one) and every Column list (each expanded Table's own) — one Record
  // entry per Entity/Table id, exactly the same "keyed by whichever card it belongs to" shape
  // `DetailView.tsx`'s own `propertySortByEntity`/`columnSortByTable` already use, so switching
  // which card is expanded never resets another card's own settings. -----------------------------
  const [propertySortByEntity, setPropertySortByEntity] = useState<Record<string, SortState>>({});
  const [propertyFilterByEntity, setPropertyFilterByEntity] = useState<Record<string, ListFilter>>(
    {},
  );
  const [propertySearchByEntity, setPropertySearchByEntity] = useState<Record<string, string>>({});
  const propertySortFor = useCallback(
    (entityId: string) => propertySortByEntity[entityId] ?? DEFAULT_SORT,
    [propertySortByEntity],
  );
  const setPropertySortFor = useCallback((entityId: string, key: SortKey) => {
    setPropertySortByEntity((prev) => ({
      ...prev,
      [entityId]: nextSortState(prev[entityId] ?? DEFAULT_SORT, key),
    }));
  }, []);
  const propertyFilterFor = useCallback(
    (entityId: string) => propertyFilterByEntity[entityId] ?? "all",
    [propertyFilterByEntity],
  );
  const setPropertyFilterFor = useCallback((entityId: string, next: ListFilter) => {
    setPropertyFilterByEntity((prev) => ({ ...prev, [entityId]: next }));
  }, []);
  const propertySearchFor = useCallback(
    (entityId: string) => propertySearchByEntity[entityId] ?? "",
    [propertySearchByEntity],
  );
  const setPropertySearchFor = useCallback((entityId: string, value: string) => {
    setPropertySearchByEntity((prev) => ({ ...prev, [entityId]: value }));
  }, []);

  // "+ Add property" — at most one Entity's own list has its input open at a time, matching
  // `DetailView.tsx`'s own single `addingPropertyEntityId`, since only one Property list can
  // plausibly be mid-edit at once.
  const [addingPropertyEntityId, setAddingPropertyEntityId] = useState<string | null>(null);
  const handleCreateProperty = useCallback(
    (entityId: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed) app.createProperty(entityId, trimmed);
      setAddingPropertyEntityId(null);
    },
    [app],
  );

  // Original property order is kept until the reviewer explicitly picks a Sort — same
  // "never touched" vs. "explicitly set" distinction `hasExplicitPropertySort` draws in
  // DetailView.tsx, just folded directly into this one lookup instead of a separate check.
  const visiblePropertiesFor = useCallback(
    (entity: Entity) => {
      let list = entity.properties;
      const filter = propertyFilterByEntity[entity.id] ?? "all";
      if (filter === "mapped") list = list.filter(hasConfirmedMapping);
      else if (filter === "unmapped") list = list.filter((p) => !hasConfirmedMapping(p));
      else if (filter === "identifier") list = list.filter((p) => isIdentifierProperty(p));
      const search = propertySearchByEntity[entity.id]?.trim().toLowerCase();
      if (search) list = list.filter((p) => p.name.toLowerCase().includes(search));
      if (entity.id in propertySortByEntity) {
        list = sortByState(
          list,
          propertySortByEntity[entity.id]!,
          (p) => p.name,
          (p) => p.confidence,
        );
      }
      return list;
    },
    [propertyFilterByEntity, propertySearchByEntity, propertySortByEntity],
  );

  const [columnSortByTable, setColumnSortByTable] = useState<Record<string, SortState>>({});
  const [columnFilterByTable, setColumnFilterByTable] = useState<Record<string, ListFilter>>({});
  const [columnSearchByTable, setColumnSearchByTable] = useState<Record<string, string>>({});
  const columnSortFor = useCallback(
    (tableName: string) => columnSortByTable[tableName] ?? DEFAULT_SORT,
    [columnSortByTable],
  );
  const setColumnSortFor = useCallback((tableName: string, key: SortKey) => {
    setColumnSortByTable((prev) => ({
      ...prev,
      [tableName]: nextSortState(prev[tableName] ?? DEFAULT_SORT, key),
    }));
  }, []);
  const columnFilterFor = useCallback(
    (tableName: string) => columnFilterByTable[tableName] ?? "all",
    [columnFilterByTable],
  );
  const setColumnFilterFor = useCallback((tableName: string, next: ListFilter) => {
    setColumnFilterByTable((prev) => ({ ...prev, [tableName]: next }));
  }, []);
  const columnSearchFor = useCallback(
    (tableName: string) => columnSearchByTable[tableName] ?? "",
    [columnSearchByTable],
  );
  const setColumnSearchFor = useCallback((tableName: string, value: string) => {
    setColumnSearchByTable((prev) => ({ ...prev, [tableName]: value }));
  }, []);

  // The currently-expanded Table's own mapped Columns, in the SAME order as their corresponding
  // Properties in Current Entity — see `ExpandedTable`'s own `columnOrderHint` doc comment.
  const expandedTableColumnOrderHint = useMemo(() => {
    if (!focusEntity || expandedContext?.kind !== "table") return undefined;
    const tableName = expandedContext.name;
    return visiblePropertiesFor(focusEntity).map((property) =>
      property.mapping?.table === tableName ? property.mapping.column : null,
    );
  }, [focusEntity, expandedContext, visiblePropertiesFor]);

  // The currently-expanded Table's own mapped Columns, keyed by column name, to whichever of
  // Current Entity's Properties maps into it — lets `ExpandedTable` show an Accept/Reject control
  // on a column backed by a still-Suggested mapping, without needing to know about Entities/
  // Properties itself.
  const expandedTableColumnMappings = useMemo(() => {
    const map = new Map<string, Property>();
    if (!focusEntity || expandedContext?.kind !== "table") return map;
    const tableName = expandedContext.name;
    focusEntity.properties.forEach((p) => {
      if (p.mapping?.table === tableName) map.set(p.mapping.column, p);
    });
    return map;
  }, [focusEntity, expandedContext]);

  // --- Unified selection, ported from Idea 3 / DetailView.tsx (Idea 1/2): one Set spanning
  // Entity/Property, shift/cmd-click toggles membership, the action bar appears once 2+ are
  // selected. -------------------------------------------------------------------------------
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
        .map((r) => app.entities.find((e) => e.id === r.id))
        .filter((e): e is Entity => !!e),
    [selectedRefs, app.entities],
  );
  const selectedProperties = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "property" }> => r.kind === "property")
        .map((r) => {
          const owner = app.entities.find((e) => e.id === r.entityId);
          const p = owner?.properties.find((x) => x.id === r.propertyId);
          return owner && p ? { entity: owner, property: p } : null;
        })
        .filter((v): v is { entity: Entity; property: Property } => !!v),
    [selectedRefs, app.entities],
  );
  const selectedRelations = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "relation" }> => r.kind === "relation")
        .map((r) => app.relations.find((relation) => relation.id === r.id))
        .filter((relation): relation is Relation => !!relation),
    [selectedRefs, app.relations],
  );
  const splitEligibleEntityId = useMemo(() => {
    if (selectedEntities.length > 0) return null;
    if (selectedProperties.length === 0) return null;
    const entityId = selectedProperties[0]!.entity.id;
    if (selectedProperties.some(({ entity }) => entity.id !== entityId)) return null;
    const owner = selectedProperties[0]!.entity;
    if (selectedProperties.length >= owner.properties.length) return null;
    return entityId;
  }, [selectedEntities, selectedProperties]);
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
  const selectOnClick = useCallback(
    (ref: SuggestionRef, mods: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      app.toggleSuggestionSelected(ref);
    },
    [app],
  );

  // Idea 4 has no working-set state to insert a split-off Entity into (Connected Entities is
  // always exactly whichever Entities have a real Relation to the Focus Entity) — Focus simply
  // moves to the new Entity, same as Merge already does below.
  const handleSplit = useCallback(
    (entityId: string) => {
      const newId = app.splitEntity(entityId, Array.from(selectedPropertyIdsFor(entityId)));
      clearPropertySelection(entityId);
      if (newId) app.openDetail("entity", newId);
    },
    [app, selectedPropertyIdsFor, clearPropertySelection],
  );

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

  // --- Create Entity (wizard), and drag-in from the left/right toolbox panels — both add to
  // Connected Entities / Data Tables the same way everything else there already shows up:
  // Connected Entities is always exactly whichever Entities have a real Relation to Focus Entity,
  // so a newly created or dragged-in Entity only appears once one actually exists — never a
  // separate "extra rows stacked below Current Entity" list the way DetailView.tsx's Idea 2 does
  // it, which this workspace deliberately has no equivalent of. ---------------------------------
  const [creatingEntity, setCreatingEntity] = useState(false);
  const handleCreateEntity = useCallback(
    (draft: CreateEntityDraft) => {
      if (!focusEntity) return;
      app.createEntityWithProperties({
        name: draft.name,
        position: { x: 0, y: 0 },
        properties: draft.properties,
        connection: {
          sourceEntityId: focusEntity.id,
          relationName: draft.relationName,
          direction: draft.direction,
        },
      });
      setCreatingEntity(false);
    },
    [app, focusEntity],
  );

  const handleEntityPanelDrop = useCallback(
    (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(ENTITY_PANEL_DND_TYPE);
      if (!focusEntity || !id) return;
      e.preventDefault();
      // Always adds an unnamed Relation: dropping an Entity already in the lane adds another one
      // to its `RelationGroup`, and dropping Focus itself adds a self-Relation (which shows Focus
      // as the lane's "self" row).
      app.createPlaceholderRelation(focusEntity.id, id);
    },
    [app, focusEntity],
  );

  const handleTablePanelDrop = useCallback((e: React.DragEvent) => {
    const name = e.dataTransfer.getData(TABLE_PANEL_DND_TYPE);
    if (!name) return;
    e.preventDefault();
    setManuallyAddedTableNames((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);

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
        .filter((r) => {
          const status = relationStatus(r, app.entities);
          return status !== "confirmed" && status !== "error";
        })
        .map((r) => suggestionKey({ kind: "relation", id: r.id })),
    ],
    [selectedEntities, selectedProperties, selectedRelations, app.entities],
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
  }, [selectedEntities, selectedProperties, selectedRelations, app]);
  const handleAcceptSelection = useCallback(() => {
    if (acceptableKeys.length > 0) app.acceptSuggestions(acceptableKeys);
  }, [acceptableKeys, app]);
  const handleRejectSelection = useCallback(() => {
    if (rejectableKeys.length > 0) app.declineSuggestions(rejectableKeys);
  }, [rejectableKeys, app]);

  // Drag a Property (or, if it's part of the active multi-selection, the whole selection) from
  // `sourceEntityId` onto `targetEntityId` — the one operation every move-drop target below
  // shares, regardless of which direction (Connected -> Current or Current -> Connected) it went.
  const movePropertiesOnDrop = useCallback(
    (e: React.DragEvent, targetEntityId: string) => {
      const raw = e.dataTransfer.getData(PROPERTY_MOVE_DND_TYPE);
      if (!raw) return;
      e.preventDefault();
      try {
        const payload = JSON.parse(raw) as { sourceEntityId: string; propertyIds: string[] };
        if (!payload.sourceEntityId || payload.sourceEntityId === targetEntityId) return;
        const source = app.entities.find((x) => x.id === payload.sourceEntityId);
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
    [app, clearPropertySelection],
  );

  // --- Connector geometry: one shared workspace coordinate frame (the grid), refs to whichever
  // rows/cards currently exist, and the two scrollable lane bodies whose scrolling can move a row
  // in or out of view. Every anchor is the TITLE/header bar of whichever card it's on (never the
  // whole card), so a fan of lines to/from a tall expanded card all still meet at one legible
  // point rather than spreading across its full height. ---------------------------------------
  const workspaceRef = useRef<HTMLDivElement>(null);
  const connectedBodyRef = useRef<HTMLDivElement>(null);
  const relationsBodyRef = useRef<HTMLDivElement>(null);
  const currentBodyRef = useRef<HTMLDivElement>(null);
  const dataBodyRef = useRef<HTMLDivElement>(null);
  const entityTitleRefs = useRef<Map<string, HTMLElement>>(new Map());
  const relationCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const currentTitleRef = useRef<HTMLButtonElement>(null);
  const currentFooterRef = useRef<HTMLElement | null>(null);
  const propertyRefs = useRef<Map<string, HTMLElement>>(new Map());
  const tableCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const tableFooterRefs = useRef<Map<string, HTMLElement>>(new Map());
  const columnRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Each line is now two elbow segments concatenated into one `d` (Connected Entity row -> its
  // own Relations-lane pill, then that same pill -> Current Entity's title) — the pill itself is
  // a real row in the Relations lane, not a floating label, so the connector visibly threads
  // through it instead of just pointing near it.
  const [relationLines, setRelationLines] = useState<
    { id: string; path: string; suggested: boolean; counterpartId: string }[]
  >([]);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  // The Column-side mirror of `hoveredPropertyId` — keyed `${table}.${column}` (same key shape as
  // `columnRefs`) since a Column, unlike a Property, has no ID of its own. Hovering EITHER end of
  // a mapping now reveals its line, not just the Property side.
  const [hoveredColumnKey, setHoveredColumnKey] = useState<string | null>(null);
  // Which Table (by name) is the current cross-lane highlight target — set by hovering EITHER a
  // mapped Property row in Current Entity or that Table's own compact row in Data Tables, so
  // hovering either end highlights both: the Table's row gets a solid border (see `CompactTable`),
  // every Property mapped into it gets a shaded background (see `PropertyListRow`), AND every one
  // of those shaded Properties draws its own line to that Table's row (see `familyLines`/
  // `recomputeFamilyLines` below) — matching Figma nodes 407:6393/407:6938's dashed connectors,
  // which all bend at roughly the same X and so read as one shared trunk even though each is its
  // own independent path (same "parallel connections share a bend" `orthogonalPath` already gives
  // for free). Deliberately separate from `hoveredColumnKey` above, which only drives the mapping
  // ladder line and only applies once a Table is actually expanded — this is the compact-list
  // equivalent.
  const [hoveredTableName, setHoveredTableName] = useState<string | null>(null);
  const clearConnectorHover = useCallback(() => {
    setHoveredEntityId(null);
    setHoveredRelationId(null);
    setHoveredPropertyId(null);
    setHoveredColumnKey(null);
    setHoveredTableName(null);
  }, []);
  // The Entity<->Table connector for the compact (unexpanded) case above — every Property mapped
  // into whichever Table is `hoveredTableName` gets its own line to that Table's compact row.
  const [familyLines, setFamilyLines] = useState<
    { id: string; path: string; suggested: boolean; propertyId: string; tableName: string }[]
  >([]);
  const [compactTableDirections, setCompactTableDirections] = useState<
    Record<string, "up" | "down">
  >({});
  const [mappingLines, setMappingLines] = useState<
    {
      id: string;
      path: string;
      suggested: boolean;
      propertyId: string;
      tableName: string;
      columnKey: string;
    }[]
  >([]);
  // Which way each footer's own redirect currently points — "up" once its off-screen target has
  // scrolled above the visible area, "down" while it's still below — `null` when there's nothing
  // off-screen to redirect to at all (nothing mapped into the expanded Table, or every mapped row
  // is already visible).
  const [morePropsDirection, setMorePropsDirection] = useState<"up" | "down" | null>(null);
  const [mappedColumnsDirection, setMappedColumnsDirection] = useState<"up" | "down" | null>(null);

  // --- Drag a Property's own connection handle onto a Column to (re)map it — same pointer-drag
  // gesture `DetailView.tsx` already has (`dragOrigin`/`mapDropTarget`), scoped here to just
  // Current Entity's own Properties and whichever ONE Table is currently expanded, matching the
  // existing hover-ladder's own scope. ---------------------------------------------------------
  const [mapDragOrigin, setMapDragOrigin] = useState<{
    propertyId: string;
    x1: number;
    y1: number;
  } | null>(null);
  const [mapDragPos, setMapDragPos] = useState<{ x: number; y: number } | null>(null);
  const [mapDropTarget, setMapDropTarget] = useState<{ table: string; column: string } | null>(
    null,
  );
  const startMapDrag = useCallback((propertyId: string, clientX: number, clientY: number) => {
    const container = workspaceRef.current;
    const r = container?.getBoundingClientRect();
    const pos = { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
    setMapDragOrigin({ propertyId, x1: pos.x, y1: pos.y });
    setMapDragPos(pos);
  }, []);
  useEffect(() => {
    if (!mapDragOrigin) return;
    const container = workspaceRef.current;
    const toContainerPos = (clientX: number, clientY: number) => {
      const r = container?.getBoundingClientRect();
      return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
    };
    const findColumnAt = (
      clientX: number,
      clientY: number,
    ): { table: string; column: string } | null => {
      for (const [key, el] of columnRefs.current) {
        const rect = el.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          const sep = key.indexOf(".");
          return { table: key.slice(0, sep), column: key.slice(sep + 1) };
        }
      }
      return null;
    };
    const onMove = (e: PointerEvent) => {
      setMapDragPos(toContainerPos(e.clientX, e.clientY));
      setMapDropTarget(findColumnAt(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const hit = findColumnAt(e.clientX, e.clientY);
      if (hit && focusEntity) {
        app.updateMapping(focusEntity.id, mapDragOrigin.propertyId, {
          table: hit.table,
          column: hit.column,
          status: "mapped",
        });
      }
      setMapDragOrigin(null);
      setMapDragPos(null);
      setMapDropTarget(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [mapDragOrigin, app, focusEntity]);

  const withinViewport = (el: HTMLElement, lane: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const c = lane.getBoundingClientRect();
    return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right;
  };

  // Which way an off-screen row has scrolled relative to its own lane — "up" (above the visible
  // area, so scrolled past going down) or "down" (below it, still further down the list) — so a
  // redirect footer can point the direction that's actually true instead of a fixed arrow.
  const directionOf = (el: HTMLElement, lane: HTMLElement): "up" | "down" => {
    const r = el.getBoundingClientRect();
    const c = lane.getBoundingClientRect();
    return r.top < c.top ? "up" : "down";
  };

  const recomputeRelationLines = useCallback(() => {
    const container = workspaceRef.current;
    const currentLane = currentBodyRef.current;
    const connectedBody = connectedBodyRef.current;
    const relationsBody = relationsBodyRef.current;
    if (!container || !currentLane || !connectedBody || !relationsBody || !focusEntity) {
      setRelationLines([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    const currentLaneRect = rectOf(currentLane);
    const connectedLaneRect = rectOf(connectedBody);
    const next: {
      id: string;
      path: string;
      suggested: boolean;
      counterpartId: string;
    }[] = [];
    // Every currently visible connected Entity/Relation pair is rendered by default. When one
    // Entity is expanded, the other compact rows are intentionally replaced by the collapsed
    // stack, so only pairs with a real on-screen row receive a path.
    const visibleFocusRelations = displayedFocusRelations;
    visibleFocusRelations.forEach(({ relation, counterpart }, index) => {
      const row = entityTitleRefs.current.get(counterpart.id);
      const pill = relationCardRefs.current.get(relation.id);
      if (!row || !pill) return;
      if (!withinViewport(row, connectedBody) || !withinViewport(pill, relationsBody)) return;

      const rowRect = rectOf(row);
      const pillRect = rectOf(pill);
      const laneOffset = Math.max(
        -12,
        Math.min(12, (index - (visibleFocusRelations.length - 1) / 2) * 4),
      );
      const toPill = expandedConnectedEntity
        ? {
            start: {
              x: rowRect.x + rowRect.width,
              y: connectedLaneRect.y + connectedLaneRect.height / 2 + laneOffset,
            },
            end: { x: pillRect.x, y: pillRect.y + pillRect.height / 2 },
          }
        : horizontalCenters(rowRect, pillRect);
      const laneAnchor = {
        x: currentLaneRect.x,
        y: currentLaneRect.y + currentLaneRect.height / 2,
      };
      const fromPill = {
        x: pillRect.x + pillRect.width,
        y: pillRect.y + pillRect.height / 2,
      };
      const path = [
        gutterConnectorPath(toPill.start, toPill.end, pillRect.x - CONNECTOR_BEND_GAP),
        gutterConnectorPath(fromPill, laneAnchor, fromPill.x + CONNECTOR_BEND_GAP),
      ].join(" ");
      next.push({
        id: relation.id,
        path,
        suggested: relation.status === "suggested",
        counterpartId: counterpart.id,
      });
    });
    setRelationLines(next);
  }, [displayedFocusRelations, focusEntity, expandedConnectedEntity]);

  useEffect(() => {
    recomputeRelationLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedFocusRelations, mappedTables, expandedContext]);

  // Property <-> Column ladder: same "nothing selected, nothing drawn" rule the Relations lane's
  // own connector follows — only the Property currently being hovered gets its own line, not
  // every mapped Property in the expanded Table at once (which just reads as noise once a Table
  // has more than a couple of mappings). A Property whose Column has scrolled outside the
  // expanded Table's own (660px-capped) visible area redirects to that Table's "Mapped columns"
  // footer instead of pointing at nothing.
  const recomputeMappingLines = useCallback(() => {
    const container = workspaceRef.current;
    const currentBody = currentBodyRef.current;
    if (
      !container ||
      !currentBody ||
      !focusEntity ||
      expandedContext?.kind !== "table" ||
      tableCardRefs.current.get(expandedContext.name) == null
    ) {
      setMappingLines([]);
      setMorePropsDirection(null);
      setMappedColumnsDirection(null);
      return;
    }
    const tableName = expandedContext.name;
    const tableCard = tableCardRefs.current.get(tableName)!;
    const footer = tableFooterRefs.current.get(tableName);
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    const next: {
      id: string;
      path: string;
      suggested: boolean;
      propertyId: string;
      tableName: string;
      columnKey: string;
    }[] = [];
    // Whichever off-screen Property/Column is found FIRST (in the same order `scrollToMoreProps`/
    // `scrollToMappedColumn` themselves search) decides that footer's own arrow direction — so the
    // arrow always points the way clicking it actually jumps.
    let morePropsDir: "up" | "down" | null = null;
    let mappedColumnsDir: "up" | "down" | null = null;
    focusEntity.properties.forEach((prop) => {
      if (!prop.mapping || prop.mapping.table !== tableName) return;
      const propEl = propertyRefs.current.get(prop.id);
      const propVisible = !!propEl && withinViewport(propEl, currentBody);
      if (!propVisible && propEl && morePropsDir === null) {
        morePropsDir = directionOf(propEl, currentBody);
      }
      const mappingKey = `${prop.mapping.table}.${prop.mapping.column}`;
      const colEl = columnRefs.current.get(mappingKey);
      const colVisible = !!colEl && withinViewport(colEl, tableCard);
      if (!colVisible && colEl && mappedColumnsDir === null) {
        mappedColumnsDir = directionOf(colEl, tableCard);
      }
      // Same off-screen redirect as the Column side above, just mirrored: a Property that's
      // scrolled outside Current Entity's own visible list redirects to Current Entity's own
      // "More props" footer instead of vanishing — see that footer's own doc comment.
      const source = propVisible ? propEl! : currentFooterRef.current;
      if (!source) return;
      const target = colVisible ? colEl! : footer;
      if (!target) return;
      const sourceRect = rectOf(source);
      const targetRect = rectOf(target);
      const anchors = horizontalCenters(sourceRect, targetRect);
      next.push({
        id: prop.id,
        path: gutterConnectorPath(anchors.start, anchors.end, targetRect.x - CONNECTOR_BEND_GAP),
        suggested: mappingStatus(prop.mapping) === "suggested",
        propertyId: prop.id,
        tableName,
        columnKey: mappingKey,
      });
    });
    setMappingLines(next);
    setMorePropsDirection(morePropsDir);
    setMappedColumnsDirection(mappedColumnsDir);
  }, [focusEntity, expandedContext]);

  useEffect(() => {
    recomputeMappingLines();
    // `recomputeMappingLines` itself already depends on `focusEntity` (and so picks up a fresh
    // mapping status right after Accept/Reject), so including it here — rather than re-listing
    // `focusEntity` a second time — is what actually makes that recompute fire on that change.
  }, [expandedContext, recomputeMappingLines]);

  // The compact-list mirror of `recomputeMappingLines` above: every visible mapped Property is
  // connected to its visible compact Table by default. Interaction-specific emphasis can be
  // layered on later without making topology discovery depend on hover.
  const recomputeFamilyLines = useCallback(() => {
    const container = workspaceRef.current;
    const currentBody = currentBodyRef.current;
    const dataBody = dataBodyRef.current;
    if (!container || !currentBody || !dataBody || !focusEntity) {
      setFamilyLines([]);
      setCompactTableDirections({});
      return;
    }
    if (expandedContext?.kind === "table") {
      setFamilyLines([]);
      setCompactTableDirections({});
      return;
    }
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    const next: {
      id: string;
      path: string;
      suggested: boolean;
      propertyId: string;
      tableName: string;
    }[] = [];
    const directions: Record<string, "up" | "down"> = {};
    const bodyRect = rectOf(currentBody);
    mappedTables.forEach((table) => {
      const tableEl = tableCardRefs.current.get(table.name);
      if (!tableEl || !withinViewport(tableEl, dataBody)) return;
      const targetRect = rectOf(tableEl);
      const mappedProperties = focusEntity.properties.filter(
        (prop) => prop.mapping?.table === table.name,
      );
      let visibleCount = 0;
      let firstOffscreen: {
        prop: Property;
        element: HTMLElement;
        direction: "up" | "down";
      } | null = null;
      for (const prop of mappedProperties) {
        const propEl = propertyRefs.current.get(prop.id);
        if (!propEl) continue;
        if (!withinViewport(propEl, currentBody)) {
          firstOffscreen ??= { prop, element: propEl, direction: directionOf(propEl, currentBody) };
          continue;
        }
        visibleCount += 1;
        const anchors = horizontalCenters(rectOf(propEl), targetRect);
        next.push({
          id: `${table.name}-${prop.id}`,
          path: gutterConnectorPath(anchors.start, anchors.end, targetRect.x - CONNECTOR_BEND_GAP),
          suggested: mappingStatus(prop.mapping!) === "suggested",
          propertyId: prop.id,
          tableName: table.name,
        });
      }
      if (firstOffscreen) directions[table.name] = firstOffscreen.direction;
      if (visibleCount === 0 && firstOffscreen) {
        const source = {
          x: bodyRect.x + bodyRect.width,
          y:
            firstOffscreen.direction === "up" ? bodyRect.y + 12 : bodyRect.y + bodyRect.height - 12,
        };
        const end = { x: targetRect.x, y: targetRect.y + targetRect.height / 2 };
        next.push({
          id: `${table.name}-${firstOffscreen.prop.id}-offscreen`,
          path: gutterConnectorPath(source, end, targetRect.x - CONNECTOR_BEND_GAP),
          suggested: mappingStatus(firstOffscreen.prop.mapping!) === "suggested",
          propertyId: firstOffscreen.prop.id,
          tableName: table.name,
        });
      }
    });
    setFamilyLines(next);
    setCompactTableDirections(directions);
  }, [focusEntity, mappedTables, expandedContext]);

  useEffect(() => {
    recomputeFamilyLines();
  }, [mappedTables, expandedContext, recomputeFamilyLines]);

  const scrollToMappedPropertyForTable = useCallback(
    (tableName: string) => {
      if (!focusEntity) return;
      const body = currentBodyRef.current;
      if (!body) return;
      const candidates = focusEntity.properties
        .filter((prop) => prop.mapping?.table === tableName)
        .map((prop) => ({ prop, element: propertyRefs.current.get(prop.id) }))
        .filter(
          (item): item is { prop: Property; element: HTMLElement } =>
            !!item.element && !withinViewport(item.element, body),
        );
      if (candidates.length === 0) return;
      const bodyRect = body.getBoundingClientRect();
      const nearest = candidates.reduce((best, item) => {
        const rect = item.element.getBoundingClientRect();
        const distance =
          rect.bottom < bodyRect.top ? bodyRect.top - rect.bottom : rect.top - bodyRect.bottom;
        const bestRect = best.element.getBoundingClientRect();
        const bestDistance =
          bestRect.bottom < bodyRect.top
            ? bodyRect.top - bestRect.bottom
            : bestRect.top - bodyRect.bottom;
        return distance < bestDistance ? item : best;
      });
      nearest.element.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [focusEntity],
  );

  const scrollToMappedColumn = useCallback(
    (tableName: string) => {
      if (!focusEntity) return;
      const tableCard = tableCardRefs.current.get(tableName);
      const offscreen = focusEntity.properties.find((prop) => {
        if (!prop.mapping || prop.mapping.table !== tableName || !tableCard) return false;
        const colEl = columnRefs.current.get(`${prop.mapping.table}.${prop.mapping.column}`);
        return colEl && !withinViewport(colEl, tableCard);
      });
      if (!offscreen?.mapping) return;
      const colEl = columnRefs.current.get(
        `${offscreen.mapping.table}.${offscreen.mapping.column}`,
      );
      colEl?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [focusEntity],
  );

  // Mirror of `scrollToMappedColumn` above, for Current Entity's own "More props" footer: finds
  // whichever mapped Property (into the currently-expanded Table) has scrolled outside Current
  // Entity's own visible list, and scrolls it back into view.
  const scrollToMoreProps = useCallback(() => {
    if (!focusEntity || expandedContext?.kind !== "table") return;
    const currentBody = currentBodyRef.current;
    if (!currentBody) return;
    const tableName = expandedContext.name;
    const offscreen = focusEntity.properties.find((prop) => {
      if (!prop.mapping || prop.mapping.table !== tableName) return false;
      const propEl = propertyRefs.current.get(prop.id);
      return !!propEl && !withinViewport(propEl, currentBody);
    });
    if (!offscreen) return;
    propertyRefs.current.get(offscreen.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusEntity, expandedContext]);

  // Clicking a specific Property/Column jumps straight to ITS OWN counterpart — unlike the two
  // footer functions above (which just find "whichever mapped one happens to be off-screen
  // first"), these two navigate for the exact row that was actually clicked, so clicking a
  // Property whose Column is still visible re-centers on it too rather than doing nothing. Wired
  // from `PropertyListRow`'s own `onNavigateToMapping` (only from `CurrentEntityCard`'s usage) and
  // `ExpandedTable`'s own `onNavigateToProperty`.
  const scrollToColumnForProperty = useCallback(
    (propertyId: string) => {
      const property = focusEntity?.properties.find((p) => p.id === propertyId);
      if (!property?.mapping) return;
      columnRefs.current
        .get(`${property.mapping.table}.${property.mapping.column}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [focusEntity],
  );
  const scrollToPropertyById = useCallback((propertyId: string) => {
    propertyRefs.current.get(propertyId)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  // rAF-throttled scroll handling shared by every connector system — any lane scrolling can move a
  // row/property/column/table in or out of view.
  const scrollRaf = useRef<number | null>(null);
  const onAnyLaneScroll = useCallback(() => {
    if (scrollRaf.current != null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      recomputeRelationLines();
      recomputeMappingLines();
      recomputeFamilyLines();
    });
  }, [recomputeRelationLines, recomputeMappingLines, recomputeFamilyLines]);

  // Connector paths use DOM coordinates, so viewport/lane resizing must invalidate them just like
  // scrolling does. Observe the workspace and every independently-sized lane; the window listener
  // also catches browser zoom/resize cases where ResizeObserver delivery can be delayed a frame.
  useEffect(() => {
    const observed = [
      workspaceRef.current,
      connectedBodyRef.current,
      relationsBodyRef.current,
      currentBodyRef.current,
      dataBodyRef.current,
    ].filter((element): element is NonNullable<typeof element> => element != null);
    const observer = new ResizeObserver(onAnyLaneScroll);
    observed.forEach((element) => observer.observe(element));
    window.addEventListener("resize", onAnyLaneScroll);
    onAnyLaneScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onAnyLaneScroll);
    };
  }, [onAnyLaneScroll]);

  // Filtering/searching/sorting changes which row DOM nodes exist without necessarily changing a
  // lane's outer size. Recompute after React commits those new rows so paths never keep stale
  // coordinates or point to rows that have disappeared.
  useEffect(() => {
    onAnyLaneScroll();
  }, [
    propertyFilterByEntity,
    propertySearchByEntity,
    propertySortByEntity,
    columnFilterByTable,
    columnSearchByTable,
    columnSortByTable,
    expandedContext,
    onAnyLaneScroll,
  ]);

  if (!focusEntity) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an Entity Type with mapped data to open Idea 4.
      </div>
    );
  }

  const connectorHoverActive =
    hoveredEntityId != null ||
    hoveredRelationId != null ||
    hoveredPropertyId != null ||
    hoveredColumnKey != null ||
    hoveredTableName != null;

  // While a pill is hovered, every pill not directly connected to it fades — the same connections
  // the connector lines draw, so pills and lines always dim together.
  // Plain calculation (not `useMemo`) — this runs after the early return above.
  const hoverRelated = (() => {
    if (!connectorHoverActive || !focusEntity) return null;
    const entities = new Set<string>();
    const relations = new Set<string>();
    const properties = new Set<string>();
    const tables = new Set<string>();
    const columns = new Set<string>();
    if (hoveredEntityId) {
      entities.add(hoveredEntityId);
      focusRelations.forEach(({ relation, counterpart }) => {
        if (counterpart.id === hoveredEntityId) relations.add(relation.id);
      });
    }
    if (hoveredRelationId) {
      relations.add(hoveredRelationId);
      const match = focusRelations.find(({ relation }) => relation.id === hoveredRelationId);
      if (match) entities.add(match.counterpart.id);
    }
    if (hoveredPropertyId) {
      properties.add(hoveredPropertyId);
      const property = focusEntity.properties.find((p) => p.id === hoveredPropertyId);
      if (property?.mapping) {
        tables.add(property.mapping.table);
        columns.add(`${property.mapping.table}.${property.mapping.column}`);
      }
    }
    if (hoveredTableName) {
      tables.add(hoveredTableName);
      focusEntity.properties.forEach((p) => {
        if (p.mapping?.table === hoveredTableName) properties.add(p.id);
      });
    }
    if (hoveredColumnKey) {
      columns.add(hoveredColumnKey);
      tables.add(hoveredColumnKey.slice(0, hoveredColumnKey.indexOf(".")));
      focusEntity.properties.forEach((p) => {
        if (p.mapping && `${p.mapping.table}.${p.mapping.column}` === hoveredColumnKey) {
          properties.add(p.id);
        }
      });
    }
    return { entities, relations, properties, tables, columns };
  })();
  const dimmedIn = (kind: keyof NonNullable<typeof hoverRelated>, id: string) =>
    hoverRelated != null && !hoverRelated[kind].has(id);

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <Idea4EntityPanel
        app={app}
        focusEntityId={focusEntity.id}
        workingIds={new Set(relatedEntities.map((entity) => entity.id))}
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {/* "topNavBar", Figma node 406:5746 — height/padding/text corrected to match (was h-10,
            12px text, and missing "view" from the label). */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e3e5e4] bg-white pl-3 pr-2">
          <button
            type="button"
            onClick={app.closeDetail}
            className="flex items-center gap-2 text-[14px] font-medium text-[#161919] hover:underline"
          >
            <ArrowLeft className="size-4" /> Back to Ontology view
          </button>
          <UndoRedoPill
            onUndo={app.undo}
            onRedo={app.redo}
            canUndo={app.canUndo}
            canRedo={app.canRedo}
          />
        </div>

        <div
          ref={workspaceRef}
          onPointerMove={(event) => {
            const target = event.target;
            const pill =
              target instanceof Element
                ? target.closest<HTMLElement>("[data-connector-hover]")
                : null;
            if (!pill) {
              clearConnectorHover();
              return;
            }
            setHoveredEntityId(pill.dataset["connectorEntityId"] ?? null);
            setHoveredRelationId(pill.dataset["connectorRelationId"] ?? null);
            setHoveredPropertyId(pill.dataset["connectorPropertyId"] ?? null);
            setHoveredColumnKey(pill.dataset["connectorColumnKey"] ?? null);
            setHoveredTableName(pill.dataset["connectorTableName"] ?? null);
          }}
          onMouseLeave={clearConnectorHover}
          // Each lane's own section fills the full height down to `<main>`'s own bottom edge — the
          // reserved 24px clearance for the AI review bar (see `Idea4Surface`'s own body padding)
          // lives INSIDE each section as padding, not as a margin out here, so that strip still
          // shows each lane's own background rather than a plain gap. Connected Entities/Current
          // Entity/Data Tables stay a fixed 1:1:1 split regardless of what's expanded — only the
          // content within a lane changes, never those 3 lanes' own widths relative to each
          // other. Relations sits between Connected Entities and Current Entity, deliberately
          // narrower than the rest (its own rows are a single compact pill, not a full card, so
          // it never needs a full share) — the relation lines/pills still cross straight through
          // it on their way to Current Entity's title, unchanged; this lane is a separate, plain
          // browsable list of the same underlying Relations, not a replacement.
          className="relative grid min-h-0 flex-1 grid-cols-[1fr_0.8fr_1fr_1fr] gap-[3px] overflow-hidden bg-[#E3E5E4]"
        >
          <Idea4Surface
            // Label matches Figma's exact header copy ("Entities", not "Connected Entities" or
            // this port's own earlier "Related Entities" — this app's own internal naming for the
            // concept, e.g. `relatedEntities`, is left as-is, only the displayed string changes).
            // Count includes the pinned self row below, same as Figma's own count (5 = 1 self + 4
            // related, in its sample data).
            label="Entities"
            count={relatedEntities.length + (hasSelfRelation ? 1 : 0)}
            bodyRef={connectedBodyRef}
            onBodyScroll={onAnyLaneScroll}
            flush={!!expandedConnectedEntity}
          >
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(ENTITY_PANEL_DND_TYPE)) e.preventDefault();
              }}
              onDrop={handleEntityPanelDrop}
              className={cn(
                "flex w-full min-h-full flex-col transition-[width] duration-300",
                expandedConnectedEntity
                  ? "h-full items-stretch gap-0 p-0"
                  : "items-center justify-center-safe gap-3 px-4 pt-4",
              )}
            >
              {focusEntity && hasSelfRelation && (
                <SelfEntityRow
                  entity={focusEntity}
                  dimmed={dimmedIn("entities", focusEntity.id)}
                  rowRef={(element) => {
                    if (element) entityTitleRefs.current.set(focusEntity.id, element);
                    else entityTitleRefs.current.delete(focusEntity.id);
                  }}
                />
              )}
              {expandedConnectedEntity ? (
                <>
                  <ExpandedEntity
                    key={expandedConnectedEntity.id}
                    isPropertyDimmed={(id) => dimmedIn("properties", id)}
                    entity={expandedConnectedEntity}
                    visibleProperties={visiblePropertiesFor(expandedConnectedEntity)}
                    selected={suggestionSelection.has(
                      suggestionKey({ kind: "entity", id: expandedConnectedEntity.id }),
                    )}
                    onClose={() => setExpandedContext(null)}
                    onSelect={(mods) =>
                      selectOnClick({ kind: "entity", id: expandedConnectedEntity.id }, mods)
                    }
                    onDropProperties={(e) => movePropertiesOnDrop(e, expandedConnectedEntity.id)}
                    suggestionSelection={suggestionSelection}
                    onSelectProperty={(propertyId, mods) =>
                      selectOnClick(
                        { kind: "property", entityId: expandedConnectedEntity.id, propertyId },
                        mods,
                      )
                    }
                    selectedPropertyIdsFor={selectedPropertyIdsFor}
                    titleRef={(el) => {
                      if (el) entityTitleRefs.current.set(expandedConnectedEntity.id, el);
                      else entityTitleRefs.current.delete(expandedConnectedEntity.id);
                    }}
                    sort={propertySortFor(expandedConnectedEntity.id)}
                    onSortChange={(key) => setPropertySortFor(expandedConnectedEntity.id, key)}
                    filter={propertyFilterFor(expandedConnectedEntity.id)}
                    onFilterChange={(next) =>
                      setPropertyFilterFor(expandedConnectedEntity.id, next)
                    }
                    search={propertySearchFor(expandedConnectedEntity.id)}
                    onSearchChange={(value) =>
                      setPropertySearchFor(expandedConnectedEntity.id, value)
                    }
                    isAddingProperty={addingPropertyEntityId === expandedConnectedEntity.id}
                    onStartAddProperty={() => setAddingPropertyEntityId(expandedConnectedEntity.id)}
                    onSubmitAddProperty={(name) =>
                      handleCreateProperty(expandedConnectedEntity.id, name)
                    }
                    onCancelAddProperty={() => setAddingPropertyEntityId(null)}
                    onBodyScroll={onAnyLaneScroll}
                  />
                </>
              ) : (
                relatedEntities.map((entity) => {
                  const titleRef = (el: HTMLElement | null) => {
                    if (el) entityTitleRefs.current.set(entity.id, el);
                    else entityTitleRefs.current.delete(entity.id);
                  };
                  return (
                    <CompactEntity
                      key={entity.id}
                      entity={entity}
                      dimmed={dimmedIn("entities", entity.id)}
                      compact={expandedContext?.kind === "table"}
                      selected={suggestionSelection.has(
                        suggestionKey({ kind: "entity", id: entity.id }),
                      )}
                      onOpen={() => setExpandedContext({ kind: "entity", id: entity.id })}
                      onSelect={(mods) => selectOnClick({ kind: "entity", id: entity.id }, mods)}
                      onDropProperties={(e) => movePropertiesOnDrop(e, entity.id)}
                      rowRef={titleRef}
                      onHoverChange={(hovering) =>
                        setHoveredEntityId((current) =>
                          hovering ? entity.id : current === entity.id ? null : current,
                        )
                      }
                    />
                  );
                })
              )}
            </div>
          </Idea4Surface>

          <Idea4Surface
            label="Relations"
            count={displayedFocusRelations.length}
            bodyRef={relationsBodyRef}
            onBodyScroll={onAnyLaneScroll}
          >
            <div className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-2 pt-4">
              {displayedFocusRelations.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                  No Relations touch this Entity Type yet.
                </p>
              )}
              {groupRelationsByCounterpart(displayedFocusRelations).map((group) => (
                <RelationGroup key={group.counterpartId}>
                  {group.items.map(({ relation, counterpart, outgoing }) => (
                    <RelationCard
                      key={relation.id}
                      selected={suggestionSelection.has(
                        suggestionKey({ kind: "relation", id: relation.id }),
                      )}
                      onSelect={(mods) =>
                        selectOnClick({ kind: "relation", id: relation.id }, mods)
                      }
                      dimmed={dimmedIn("relations", relation.id)}
                      relation={relation}
                      counterpart={counterpart}
                      outgoing={outgoing}
                      entities={app.entities}
                      // Expands the counterpart's own card in Connected Entities (same effect as
                      // clicking that card directly) — deliberately NOT `app.openDetail`, which would
                      // move Focus (Current Entity) onto the counterpart instead of just pointing at
                      // it from where you already are.
                      onOpenCounterpart={() =>
                        setExpandedContext({ kind: "entity", id: counterpart.id })
                      }
                      onAccept={() =>
                        app.acceptSuggestions([
                          suggestionKey({ kind: "relation", id: relation.id }),
                        ])
                      }
                      onReject={() =>
                        app.declineSuggestions([
                          suggestionKey({ kind: "relation", id: relation.id }),
                        ])
                      }
                      cardRef={(el) => {
                        if (el) relationCardRefs.current.set(relation.id, el);
                        else relationCardRefs.current.delete(relation.id);
                      }}
                      onHoverChange={(hovering) =>
                        setHoveredRelationId((current) =>
                          hovering ? relation.id : current === relation.id ? null : current,
                        )
                      }
                    />
                  ))}
                </RelationGroup>
              ))}
            </div>
          </Idea4Surface>

          {/* No `Idea4Surface` wrapper here — `CurrentEntityCard` is self-contained (see its own
              top-of-function comment) since Figma's "Category" card (node 407:5561) is one flush
              panel, not a floating card inside generic lane chrome. `onBodyScroll` doesn't need
              separately wiring here: `onPropertyListScroll` below already carries the identical
              `onAnyLaneScroll` handler onto this lane's own (now only) scroll container. */}
          <CurrentEntityCard
            entity={focusEntity}
            isPropertyDimmed={(id) => dimmedIn("properties", id)}
            visibleProperties={visiblePropertiesFor(focusEntity)}
            titleRef={currentTitleRef}
            bodyRef={currentBodyRef}
            hoveredPropertyId={hoveredPropertyId}
            onPropertyHoverChange={(id, hovering) => {
              setHoveredPropertyId((cur) => {
                if (hovering) return id;
                return cur === id ? null : cur;
              });
            }}
            onSetPropertyRef={(id, el) => {
              if (el) propertyRefs.current.set(id, el);
              else propertyRefs.current.delete(id);
            }}
            selected={suggestionSelection.has(
              suggestionKey({ kind: "entity", id: focusEntity.id }),
            )}
            onSelect={(mods) => selectOnClick({ kind: "entity", id: focusEntity.id }, mods)}
            onDropProperties={(e) => movePropertiesOnDrop(e, focusEntity.id)}
            suggestionSelection={suggestionSelection}
            onSelectProperty={(propertyId, mods) =>
              selectOnClick({ kind: "property", entityId: focusEntity.id, propertyId }, mods)
            }
            footerRef={(el) => {
              currentFooterRef.current = el;
            }}
            onFooterClick={scrollToMoreProps}
            footerDirection={morePropsDirection}
            onPropertyListScroll={onAnyLaneScroll}
            sort={propertySortFor(focusEntity.id)}
            onSortChange={(key) => setPropertySortFor(focusEntity.id, key)}
            filter={propertyFilterFor(focusEntity.id)}
            onFilterChange={(next) => setPropertyFilterFor(focusEntity.id, next)}
            search={propertySearchFor(focusEntity.id)}
            onSearchChange={(value) => setPropertySearchFor(focusEntity.id, value)}
            isAddingProperty={addingPropertyEntityId === focusEntity.id}
            onStartAddProperty={() => setAddingPropertyEntityId(focusEntity.id)}
            onSubmitAddProperty={(name) => handleCreateProperty(focusEntity.id, name)}
            onCancelAddProperty={() => setAddingPropertyEntityId(null)}
            onStartMapDrag={startMapDrag}
            onNavigateToMapping={scrollToColumnForProperty}
          />

          <Idea4Surface
            label="Data Tables"
            count={mappedTables.length}
            bodyRef={dataBodyRef}
            onBodyScroll={onAnyLaneScroll}
            flush={!!expandedMappedTable}
          >
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(TABLE_PANEL_DND_TYPE)) e.preventDefault();
              }}
              onDrop={handleTablePanelDrop}
              className={cn(
                "flex w-full min-h-full flex-col transition-[width] duration-300",
                expandedMappedTable
                  ? "h-full items-stretch gap-0 p-0"
                  : "items-center justify-center-safe gap-3 px-4 pt-4",
              )}
            >
              {expandedMappedTable ? (
                <>
                  <ExpandedTable
                    key={expandedMappedTable.name}
                    isColumnDimmed={(key) => dimmedIn("columns", key)}
                    table={expandedMappedTable}
                    entities={app.entities}
                    onClose={() => setExpandedContext(null)}
                    cardRef={(el) => {
                      if (el) tableCardRefs.current.set(expandedMappedTable.name, el);
                      else tableCardRefs.current.delete(expandedMappedTable.name);
                    }}
                    footerRef={(el) => {
                      if (el) tableFooterRefs.current.set(expandedMappedTable.name, el);
                      else tableFooterRefs.current.delete(expandedMappedTable.name);
                    }}
                    onFooterClick={() => scrollToMappedColumn(expandedMappedTable.name)}
                    footerDirection={mappedColumnsDirection}
                    onColumnListScroll={onAnyLaneScroll}
                    columnOrderHint={expandedTableColumnOrderHint}
                    columnMappings={expandedTableColumnMappings}
                    sort={columnSortFor(expandedMappedTable.name)}
                    onSortChange={(key) => setColumnSortFor(expandedMappedTable.name, key)}
                    hasExplicitSort={expandedMappedTable.name in columnSortByTable}
                    filter={columnFilterFor(expandedMappedTable.name)}
                    onFilterChange={(next) => setColumnFilterFor(expandedMappedTable.name, next)}
                    search={columnSearchFor(expandedMappedTable.name)}
                    onSearchChange={(value) => setColumnSearchFor(expandedMappedTable.name, value)}
                    onSetColumnRef={(key, el) => {
                      if (el) columnRefs.current.set(key, el);
                      else columnRefs.current.delete(key);
                    }}
                    dropTargetColumn={
                      mapDropTarget?.table === expandedMappedTable.name
                        ? mapDropTarget.column
                        : null
                    }
                    hoveredColumnKey={hoveredColumnKey}
                    onColumnHoverChange={(key, hovering) =>
                      setHoveredColumnKey((cur) => {
                        if (hovering) return key;
                        return cur === key ? null : cur;
                      })
                    }
                    onNavigateToProperty={scrollToPropertyById}
                  />
                </>
              ) : (
                mappedTables.map((table) => (
                  <CompactTable
                    key={table.name}
                    dimmed={dimmedIn("tables", table.name)}
                    table={table}
                    entities={app.entities}
                    onOpen={() => setExpandedContext({ kind: "table", name: table.name })}
                    rowRef={(el) => {
                      if (el) tableCardRefs.current.set(table.name, el);
                      else tableCardRefs.current.delete(table.name);
                    }}
                    highlighted={hoveredTableName === table.name}
                    onHoverChange={(hovering) =>
                      setHoveredTableName((cur) => {
                        if (hovering) return table.name;
                        return cur === table.name ? null : cur;
                      })
                    }
                    offscreenDirection={compactTableDirections[table.name]}
                    onNavigateToOffscreen={() => scrollToMappedPropertyForTable(table.name)}
                  />
                ))
              )}
            </div>
          </Idea4Surface>

          {/* Connector overlay — spans the whole 4-lane grid, above the lanes' own content but
              below the floating AI review bar (z-20). Relation lines are persistent (for whichever
              related Entity rows are currently visible), each threading straight through its own
              Relations-lane pill on the way to Current Entity's title rather than floating its own
              separate label — see `recomputeRelationLines`'s own doc comment. The property<->
              column ladder is persistent too, but only for whichever ONE Table is currently
              expanded — a Property whose Column has scrolled out of that Table's own view
              redirects to its "Mapped columns" footer instead of pointing at nothing. The compact
              Entity<->Table case (no Table expanded) gets its own lines too, but only for whichever
              ONE Table is currently cross-lane-highlighted (`hoveredTableName`) — see
              `recomputeFamilyLines`'s own doc comment, matching Figma nodes 407:6393/407:6938. */}
          <svg
            className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
            style={{ clipPath: "inset(68px 0 0 0)" }}
          >
            {relationLines.map((line) => {
              const related =
                hoveredEntityId === line.counterpartId || hoveredRelationId === line.id;
              return (
                <path
                  key={`rel-${line.id}`}
                  d={line.path}
                  fill="none"
                  stroke={line.suggested ? MAPPING_SUGGESTED_COLOR : MAPPING_DEFAULT_COLOR}
                  strokeWidth={connectorHoverActive && related ? 2 : 1.5}
                  opacity={connectorHoverActive && !related ? 0.16 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-[opacity,stroke-width] duration-150"
                />
              );
            })}
            {mappingLines.map((line) => {
              const related =
                hoveredPropertyId === line.propertyId ||
                hoveredColumnKey === line.columnKey ||
                hoveredTableName === line.tableName;
              return (
                <path
                  key={`map-${line.id}`}
                  d={line.path}
                  fill="none"
                  stroke={line.suggested ? MAPPING_SUGGESTED_COLOR : MAPPING_DEFAULT_COLOR}
                  strokeWidth={connectorHoverActive && related ? 2 : 1.5}
                  opacity={connectorHoverActive && !related ? 0.16 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-[opacity,stroke-width] duration-150"
                />
              );
            })}
            {familyLines.map((line) => {
              const related =
                hoveredPropertyId === line.propertyId || hoveredTableName === line.tableName;
              return (
                <path
                  key={`family-${line.id}`}
                  d={line.path}
                  fill="none"
                  stroke={line.suggested ? MAPPING_SUGGESTED_COLOR : MAPPING_DEFAULT_COLOR}
                  strokeWidth={connectorHoverActive && related ? 2 : 1.5}
                  opacity={connectorHoverActive && !related ? 0.16 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-[opacity,stroke-width] duration-150"
                />
              );
            })}
            {/* Live drag-in-progress line — follows the pointer from wherever the drag started
                (see `startMapDrag`/`mapDragOrigin`) until it's dropped, so dragging a Property's
                handle toward a Column reads as a real connection being drawn rather than a bare
                cursor move. Solid (not dashed) and a touch bolder than the resting lines above, to
                read as "live" rather than an already-committed mapping. */}
            {mapDragOrigin && mapDragPos && (
              <path
                d={`M ${mapDragOrigin.x1} ${mapDragOrigin.y1} L ${mapDragPos.x} ${mapDragPos.y}`}
                fill="none"
                stroke="#00ded8"
                strokeWidth={2}
                opacity={0.8}
              />
            )}
          </svg>

          {/* Diffuse foreground layer from the Figma composition: connector and item layers pass
              beneath it near the fixed review controls, so the workspace ends softly instead of
              being cut off by the toolbar. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] h-24 backdrop-blur-[1px]"
            style={{
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.88) 58%, rgba(255,255,255,0.98))",
            }}
          />

          {/* Multi-select action bar — floats over the workspace, bottom-center, only while 2+
              objects are selected. */}
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
                    All properties from{" "}
                    {mergeCandidates.map((e) => e.name || "Untitled").join(", ")} will be combined.
                    Name the resulting entity:
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
                onClear={() => app.clearSuggestionSelection()}
                onMerge={selectedEntities.length >= 2 ? () => setMergePanelOpen(true) : undefined}
                onSplit={
                  splitEligibleEntityId ? () => handleSplit(splitEligibleEntityId) : undefined
                }
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

        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto">
            <AiReviewBar
              entities={app.entities}
              relations={app.relations}
              tables={app.tables}
              confidenceRange={app.confidenceRange}
              onConfidenceRangeChange={app.setConfidenceRange}
              onSelectSuggestionsInRange={app.selectSuggestionKeys}
              scope={suggestionScope}
            />
          </div>
        </div>
      </main>

      {creatingEntity && (
        <CreateEntityWizard
          sourceEntity={focusEntity}
          onCancel={() => setCreatingEntity(false)}
          onCreate={handleCreateEntity}
        />
      )}

      <Idea4TablePanel app={app} activeNames={new Set(mappedTables.map((table) => table.name))} />
    </div>
  );
}

/**
 * Table-entry mode: the Data Table itself is the prominent card (mirroring how Current Entity is
 * prominent in Entity-entry mode) rather than an arbitrarily-picked Entity. Connected Entities
 * shows every Entity Type mapped into this Table (using the same Compact/ExpandedEntity cards, so
 * expand/drag-props-in still work); "Current Entity" is a lighter secondary list of those same
 * Entities — click one to actually switch Focus onto it, leaving this Table-entry view. A single
 * persistent dashed line (no relation pill — there's no Relation object backing an Entity<->Table
 * fact) connects each visible Entity row to the Table's own title, the same title-anchor technique
 * `Idea4EntityMode` uses. Merge/Split/the Property<->Column ladder are intentionally NOT wired up
 * here yet — this first pass covers the layout shape only.
 */
function Idea4TableMode({ app, table }: { app: OntologyApp; table: TableSchema }) {
  useUndoRedoShortcuts(app.undo, app.redo);
  const usingEntities = useMemo(
    () => entitiesUsingTable(table.name, app.entities),
    [table.name, app.entities],
  );

  // Which Mapped Entity drives the Entities/Relations lanes: an expanded (clicked) one, otherwise
  // whichever row is hovered — held while the pointer stays anywhere in the Mapped Entities lane,
  // so moving between rows doesn't flicker. With neither, those two lanes stay empty. Both reset
  // when the anchor Table changes.
  const [previewEntityId, setPreviewEntityId] = useState<string | null>(null);
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  useEffect(() => {
    setPreviewEntityId(null);
    setExpandedEntityId(null);
  }, [table.name]);
  const expandedEntity = usingEntities.find((entity) => entity.id === expandedEntityId) ?? null;
  const laneEntityId = expandedEntity?.id ?? previewEntityId;
  const laneEntity = usingEntities.find((entity) => entity.id === laneEntityId) ?? null;

  // Transient hover targets — they only emphasize connector lines and reveal scroll arrows.
  const [hoveredMappedRowId, setHoveredMappedRowId] = useState<string | null>(null);
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  const [hoveredColumnName, setHoveredColumnName] = useState<string | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);

  const relatedEntities = useMemo(() => {
    if (!laneEntity) return [];
    const ids = new Set(
      app.relations
        .filter((relation) => relation.from === laneEntity.id || relation.to === laneEntity.id)
        .map((relation) => (relation.from === laneEntity.id ? relation.to : relation.from)),
    );
    return app.entities.filter((entity) => ids.has(entity.id) && entity.id !== laneEntity.id);
  }, [app.entities, app.relations, laneEntity]);

  const hasSelfRelation =
    !!laneEntity &&
    app.relations.some(
      (relation) => relation.from === laneEntity.id && relation.to === laneEntity.id,
    );

  const laneRelations = useMemo(() => {
    if (!laneEntity) return [];
    return app.relations
      .filter((relation) => relation.from === laneEntity.id || relation.to === laneEntity.id)
      .map((relation) => {
        const outgoing = relation.from === laneEntity.id;
        const counterpartId = outgoing ? relation.to : relation.from;
        const counterpart = app.entities.find((entity) => entity.id === counterpartId);
        return counterpart ? { relation, counterpart, outgoing } : null;
      })
      .filter((v): v is { relation: Relation; counterpart: Entity; outgoing: boolean } => !!v);
  }, [laneEntity, app.relations, app.entities]);

  // Suggestions bar counts what the lanes show for an expanded (clicked) Mapped Entity — not a
  // hover preview, so the number doesn't jump around while the pointer passes over rows.
  const suggestionScope = useMemo<SuggestionScope>(() => {
    const entityIds = new Set(usingEntities.map((entity) => entity.id));
    const relationIds = new Set<string>();
    const expandedId = expandedEntity?.id;
    if (expandedId) {
      app.relations.forEach((relation) => {
        if (relation.from !== expandedId && relation.to !== expandedId) return;
        relationIds.add(relation.id);
        entityIds.add(relation.from);
        entityIds.add(relation.to);
      });
    }
    return {
      entity: (entity) => entityIds.has(entity.id),
      property: (owner) => owner.id === expandedId,
      relation: (relation) => relationIds.has(relation.id),
      mapping: (_owner, property) => property.mapping?.table === table.name,
    };
  }, [usingEntities, app.relations, expandedEntity, table.name]);

  // Opening a Related Entity or a Relation's counterpart expands it here IF it's also a Mapped
  // Entity — otherwise it isn't part of this Table's Mapped Entities at all, so this navigates there.
  const openCounterpart = useCallback(
    (entityId: string) => {
      if (usingEntities.some((entity) => entity.id === entityId)) {
        setPreviewEntityId(null);
        setExpandedEntityId(entityId);
      } else {
        app.openDetail("entity", entityId);
      }
    },
    [usingEntities, app],
  );

  // Columns has no per-Entity ownership the way Properties does — every Entity using this Table
  // shares the exact same column list, so one plain slot per control suffices here too. Mapped/
  // Unmapped/Identifier all read "does ANY Entity currently using this Table map a Property (an
  // Identifier Property, for that last one) into it" — a fact about the Column across every using
  // Entity at once, not any one of them in particular.
  const mappedColumnNames = useMemo(() => {
    const names = new Set<string>();
    usingEntities.forEach((entity) => {
      entity.properties.forEach((p) => {
        if (p.mapping?.table === table.name) names.add(p.mapping.column);
      });
    });
    return names;
  }, [usingEntities, table.name]);
  // Mapped/Unmapped filter only — a Column counts as Mapped once any Entity's mapping into it is
  // confirmed; the status dot keeps using `mappedColumnNames`/`suggestedColumnNames`.
  const confirmedColumnNames = useMemo(() => {
    const names = new Set<string>();
    usingEntities.forEach((entity) => {
      entity.properties.forEach((p) => {
        if (p.mapping?.table === table.name && hasConfirmedMapping(p)) names.add(p.mapping.column);
      });
    });
    return names;
  }, [usingEntities, table.name]);
  const suggestedColumnNames = useMemo(() => {
    const names = new Set<string>();
    usingEntities.forEach((entity) => {
      entity.properties.forEach((p) => {
        if (p.mapping?.table === table.name && mappingStatus(p.mapping) === "suggested") {
          names.add(p.mapping.column);
        }
      });
    });
    return names;
  }, [usingEntities, table.name]);
  const identifierColumnNames = useMemo(() => {
    const names = new Set<string>();
    usingEntities.forEach((entity) => {
      entity.properties.forEach((p) => {
        if (p.mapping?.table === table.name && isIdentifierProperty(p)) names.add(p.mapping.column);
      });
    });
    return names;
  }, [usingEntities, table.name]);
  // A column's confidence is its mapping's — shown only while that mapping is still Suggested,
  // taking the strongest one when several Entities suggest a mapping into the same column.
  const suggestedColumnMapping = useMemo(() => {
    const byColumn = new Map<string, { entity: Entity; property: Property }>();
    usingEntities.forEach((entity) => {
      entity.properties.forEach((p) => {
        if (p.mapping?.table !== table.name || mappingStatus(p.mapping) !== "suggested") return;
        const current = byColumn.get(p.mapping.column);
        if (!current || p.confidence > current.property.confidence) {
          byColumn.set(p.mapping.column, { entity, property: p });
        }
      });
    });
    return byColumn;
  }, [usingEntities, table.name]);
  const [columnSort, setColumnSort] = useState<SortState>(DEFAULT_SORT);
  const [columnSortTouched, setColumnSortTouched] = useState(false);
  const [columnFilter, setColumnFilter] = useState<ListFilter>("all");
  const [columnSearch, setColumnSearch] = useState("");
  const visibleTableColumns = useMemo(() => {
    let list = table.columns;
    if (columnFilter === "mapped") list = list.filter((c) => confirmedColumnNames.has(c.name));
    else if (columnFilter === "unmapped") {
      list = list.filter((c) => !confirmedColumnNames.has(c.name));
    } else if (columnFilter === "identifier") {
      list = list.filter((c) => identifierColumnNames.has(c.name));
    }
    const search = columnSearch.trim().toLowerCase();
    if (search) list = list.filter((c) => c.name.toLowerCase().includes(search));
    if (columnSortTouched) {
      list = sortByState(
        list,
        columnSort,
        (c) => c.name,
        () => undefined,
      );
    }
    return list;
  }, [
    table.columns,
    columnFilter,
    confirmedColumnNames,
    identifierColumnNames,
    columnSearch,
    columnSortTouched,
    columnSort,
  ]);

  // The expanded Mapped Entity's own Property list — Filter/Sort/Search/Add, same rules as
  // `Idea4EntityMode`'s `visiblePropertiesFor`, reset whenever a different Entity is expanded.
  const [propertySort, setPropertySort] = useState<SortState>(DEFAULT_SORT);
  const [propertySortTouched, setPropertySortTouched] = useState(false);
  const [propertyFilter, setPropertyFilter] = useState<ListFilter>("all");
  const [propertySearch, setPropertySearch] = useState("");
  const [addingProperty, setAddingProperty] = useState(false);
  useEffect(() => {
    setPropertySort(DEFAULT_SORT);
    setPropertySortTouched(false);
    setPropertyFilter("all");
    setPropertySearch("");
    setAddingProperty(false);
    setHoveredPropertyId(null);
  }, [expandedEntityId]);
  const visibleExpandedProperties = useMemo(() => {
    if (!expandedEntity) return [];
    let list = expandedEntity.properties;
    if (propertyFilter === "mapped") list = list.filter(hasConfirmedMapping);
    else if (propertyFilter === "unmapped") list = list.filter((p) => !hasConfirmedMapping(p));
    else if (propertyFilter === "identifier") list = list.filter((p) => isIdentifierProperty(p));
    const search = propertySearch.trim().toLowerCase();
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search));
    if (propertySortTouched) {
      list = sortByState(
        list,
        propertySort,
        (p) => p.name,
        (p) => p.confidence,
      );
    }
    return list;
  }, [expandedEntity, propertyFilter, propertySearch, propertySortTouched, propertySort]);

  const suggestionSelection = app.suggestionSelection;
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

  // --- Connectors: Entities -> Relations -> the lane Entity's Mapped Entities row (relation
  // lines), and Mapped Entity (or, once expanded, each of its Properties) -> Column (column lines).
  const workspaceRef = useRef<HTMLDivElement>(null);
  const relatedBodyRef = useRef<HTMLDivElement>(null);
  const relationsBodyRef = useRef<HTMLDivElement>(null);
  const mappedBodyRef = useRef<HTMLDivElement>(null);
  const expandedBodyRef = useRef<HTMLDivElement>(null);
  const dataBodyRef = useRef<HTMLDivElement>(null);
  const entityRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const relationCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Holds each compact Mapped Entity row, or the expanded card's title while one is expanded.
  const mappedEntityRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const propertyRefs = useRef<Map<string, HTMLElement>>(new Map());
  const columnRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [relationLines, setRelationLines] = useState<
    { id: string; path: string; suggested: boolean }[]
  >([]);
  const [columnLines, setColumnLines] = useState<
    {
      id: string;
      path: string;
      suggested: boolean;
      entityId: string;
      propertyId: string | null;
      columnName: string;
    }[]
  >([]);
  const [entityOffscreen, setEntityOffscreen] = useState<Record<string, "up" | "down">>({});
  const [propertyOffscreen, setPropertyOffscreen] = useState<Record<string, "up" | "down">>({});
  const [columnOffscreen, setColumnOffscreen] = useState<Record<string, "up" | "down">>({});

  const withinViewport = (el: HTMLElement, lane: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const c = lane.getBoundingClientRect();
    return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right;
  };
  const directionOf = (el: HTMLElement, lane: HTMLElement): "up" | "down" =>
    el.getBoundingClientRect().top < lane.getBoundingClientRect().top ? "up" : "down";

  const recomputeRelationLines = useCallback(() => {
    const container = workspaceRef.current;
    const relatedBody = relatedBodyRef.current;
    const relationsBody = relationsBodyRef.current;
    const mappedBody = mappedBodyRef.current;
    const laneRow = laneEntityId ? mappedEntityRowRefs.current.get(laneEntityId) : null;
    if (!container || !relatedBody || !relationsBody || !mappedBody || !laneRow) {
      setRelationLines([]);
      return;
    }
    if (!withinViewport(laneRow, mappedBody)) {
      setRelationLines([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    // An expanded card's title sits under the clipped header strip, so aim at the middle of the
    // Mapped Entities lane's left edge instead — the same anchor `Idea4EntityMode` uses.
    const mappedRect = rectOf(mappedBody);
    const laneRect: Rect = expandedEntity
      ? { x: mappedRect.x, y: mappedRect.y + mappedRect.height / 2, width: 0, height: 0 }
      : rectOf(laneRow);
    const next: { id: string; path: string; suggested: boolean }[] = [];
    laneRelations.forEach(({ relation, counterpart }) => {
      const row = entityRowRefs.current.get(counterpart.id);
      const pill = relationCardRefs.current.get(relation.id);
      if (!row || !pill) return;
      if (!withinViewport(row, relatedBody) || !withinViewport(pill, relationsBody)) return;
      const rowRect = rectOf(row);
      const pillRect = rectOf(pill);
      const toPill = horizontalCenters(rowRect, pillRect);
      const fromPill = horizontalCenters(pillRect, laneRect);
      const path = [
        gutterConnectorPath(toPill.start, toPill.end, pillRect.x - CONNECTOR_BEND_GAP),
        gutterConnectorPath(fromPill.start, fromPill.end, fromPill.start.x + CONNECTOR_BEND_GAP),
      ].join(" ");
      next.push({ id: relation.id, path, suggested: relation.status === "suggested" });
    });
    setRelationLines(next);
  }, [laneRelations, laneEntityId, expandedEntity]);

  // Every visible left item (a compact Mapped Entity row, or an expanded Entity's Property) gets a
  // line to every visible Column it maps into. When one side is scrolled out of view, the visible
  // side gets a scroll arrow (on hover) and — only if it has no visible counterpart at all — a stub
  // line pointing at the edge of the other lane, the same rules `Idea4EntityMode` uses for Data
  // Tables.
  const recomputeColumnLines = useCallback(() => {
    const container = workspaceRef.current;
    const dataBody = dataBodyRef.current;
    const leftBody = expandedEntity ? expandedBodyRef.current : mappedBodyRef.current;
    if (!container || !dataBody || !leftBody) {
      setColumnLines([]);
      setEntityOffscreen({});
      setPropertyOffscreen({});
      setColumnOffscreen({});
      return;
    }
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    type LeftItem = {
      key: string;
      entityId: string;
      propertyId: string | null;
      el: HTMLElement | undefined;
      // Column name -> whether any mapping into it is still a suggestion.
      columns: Map<string, boolean>;
    };
    const leftItems: LeftItem[] = expandedEntity
      ? visibleExpandedProperties
          .filter((p) => p.mapping?.table === table.name)
          .map((p) => ({
            key: p.id,
            entityId: expandedEntity.id,
            propertyId: p.id,
            el: propertyRefs.current.get(p.id),
            columns: new Map([[p.mapping!.column, mappingStatus(p.mapping!) === "suggested"]]),
          }))
      : usingEntities.map((entity) => {
          const columns = new Map<string, boolean>();
          entity.properties.forEach((p) => {
            if (p.mapping?.table !== table.name) return;
            const suggested = mappingStatus(p.mapping) === "suggested";
            columns.set(p.mapping.column, (columns.get(p.mapping.column) ?? false) || suggested);
          });
          return {
            key: entity.id,
            entityId: entity.id,
            propertyId: null,
            el: mappedEntityRowRefs.current.get(entity.id),
            columns,
          };
        });
    const leftRect = rectOf(leftBody);
    const dataRect = rectOf(dataBody);
    const lines: typeof columnLines = [];
    const leftDirections: Record<string, "up" | "down"> = {};
    const columnDirections: Record<string, "up" | "down"> = {};
    const columnHasVisibleCounterpart = new Set<string>();
    const columnOffscreenCounterpart = new Map<
      string,
      { direction: "up" | "down"; suggested: boolean; entityId: string; propertyId: string | null }
    >();
    for (const item of leftItems) {
      if (!item.el) continue;
      const leftVisible = withinViewport(item.el, leftBody);
      const itemRect = rectOf(item.el);
      let visibleTargets = 0;
      let firstOffscreen: { direction: "up" | "down"; column: string; suggested: boolean } | null =
        null;
      for (const [column, suggested] of item.columns) {
        const columnEl = columnRefs.current.get(column);
        if (!columnEl) continue;
        const columnVisible = withinViewport(columnEl, dataBody);
        if (leftVisible && columnVisible) {
          visibleTargets += 1;
          columnHasVisibleCounterpart.add(column);
          const columnRect = rectOf(columnEl);
          const anchors = horizontalCenters(itemRect, columnRect);
          lines.push({
            id: `${item.key}-${column}`,
            path: gutterConnectorPath(
              anchors.start,
              anchors.end,
              columnRect.x - CONNECTOR_BEND_GAP,
            ),
            suggested,
            entityId: item.entityId,
            propertyId: item.propertyId,
            columnName: column,
          });
        } else if (leftVisible) {
          firstOffscreen ??= { direction: directionOf(columnEl, dataBody), column, suggested };
        } else if (columnVisible && !columnOffscreenCounterpart.has(column)) {
          columnOffscreenCounterpart.set(column, {
            direction: directionOf(item.el, leftBody),
            suggested,
            entityId: item.entityId,
            propertyId: item.propertyId,
          });
        }
      }
      if (!firstOffscreen) continue;
      leftDirections[item.key] = firstOffscreen.direction;
      if (visibleTargets > 0) continue;
      const start = { x: itemRect.x + itemRect.width, y: itemRect.y + itemRect.height / 2 };
      const end = {
        x: dataRect.x,
        y: firstOffscreen.direction === "up" ? dataRect.y + 12 : dataRect.y + dataRect.height - 12,
      };
      lines.push({
        id: `${item.key}-offscreen`,
        path: gutterConnectorPath(start, end, dataRect.x - CONNECTOR_BEND_GAP),
        suggested: firstOffscreen.suggested,
        entityId: item.entityId,
        propertyId: item.propertyId,
        columnName: firstOffscreen.column,
      });
    }
    for (const [column, offscreen] of columnOffscreenCounterpart) {
      columnDirections[column] = offscreen.direction;
      if (columnHasVisibleCounterpart.has(column)) continue;
      const columnRect = rectOf(columnRefs.current.get(column)!);
      const start = {
        x: leftRect.x + leftRect.width,
        y: offscreen.direction === "up" ? leftRect.y + 12 : leftRect.y + leftRect.height - 12,
      };
      const end = { x: columnRect.x, y: columnRect.y + columnRect.height / 2 };
      lines.push({
        id: `column-${column}-offscreen`,
        path: gutterConnectorPath(start, end, columnRect.x - CONNECTOR_BEND_GAP),
        suggested: offscreen.suggested,
        entityId: offscreen.entityId,
        propertyId: offscreen.propertyId,
        columnName: column,
      });
    }
    setColumnLines(lines);
    if (expandedEntity) {
      setEntityOffscreen({});
      setPropertyOffscreen(leftDirections);
    } else {
      setEntityOffscreen(leftDirections);
      setPropertyOffscreen({});
    }
    setColumnOffscreen(columnDirections);
  }, [expandedEntity, visibleExpandedProperties, usingEntities, table.name]);

  // Scrolls `lane` (not the page) so whichever of `elements` is nearest outside its visible area
  // lands centered — `scrollIntoView` can also move overflow-hidden ancestors like the workspace.
  const scrollNearestIntoView = useCallback((elements: HTMLElement[], lane: HTMLElement) => {
    const laneRect = lane.getBoundingClientRect();
    const distance = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.bottom < laneRect.top ? laneRect.top - r.bottom : r.top - laneRect.bottom;
    };
    const offscreen = elements.filter((el) => distance(el) > 0);
    if (offscreen.length === 0) return;
    const nearest = offscreen.reduce((best, el) => (distance(el) < distance(best) ? el : best));
    const r = nearest.getBoundingClientRect();
    lane.scrollBy({
      top: r.top + r.height / 2 - (laneRect.top + laneRect.height / 2),
      behavior: "smooth",
    });
  }, []);
  const columnElementsFor = (columnNames: Iterable<string>) =>
    Array.from(columnNames)
      .map((name) => columnRefs.current.get(name))
      .filter((el): el is HTMLElement => !!el);
  const scrollToColumnsForEntity = (entityId: string) => {
    const entity = usingEntities.find((e) => e.id === entityId);
    const dataBody = dataBodyRef.current;
    if (!entity || !dataBody) return;
    const names = entity.properties
      .filter((p) => p.mapping?.table === table.name)
      .map((p) => p.mapping!.column);
    scrollNearestIntoView(columnElementsFor(names), dataBody);
  };
  const scrollToColumnForProperty = (propertyId: string) => {
    const property = expandedEntity?.properties.find((p) => p.id === propertyId);
    const dataBody = dataBodyRef.current;
    if (!property?.mapping || !dataBody) return;
    scrollNearestIntoView(columnElementsFor([property.mapping.column]), dataBody);
  };
  const scrollToCounterpartsForColumn = (columnName: string) => {
    if (expandedEntity) {
      const lane = expandedBodyRef.current;
      if (!lane) return;
      const elements = expandedEntity.properties
        .filter((p) => p.mapping?.table === table.name && p.mapping.column === columnName)
        .map((p) => propertyRefs.current.get(p.id))
        .filter((el): el is HTMLElement => !!el);
      scrollNearestIntoView(elements, lane);
      return;
    }
    const lane = mappedBodyRef.current;
    if (!lane) return;
    const elements = usingEntities
      .filter((entity) =>
        entity.properties.some(
          (p) => p.mapping?.table === table.name && p.mapping.column === columnName,
        ),
      )
      .map((entity) => mappedEntityRowRefs.current.get(entity.id))
      .filter((el): el is HTMLElement => !!el);
    scrollNearestIntoView(elements, lane);
  };

  const scrollRaf = useRef<number | null>(null);
  const onAnyLaneScroll = useCallback(() => {
    if (scrollRaf.current != null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      recomputeRelationLines();
      recomputeColumnLines();
    });
  }, [recomputeRelationLines, recomputeColumnLines]);

  useEffect(() => {
    const observed = [
      workspaceRef.current,
      relatedBodyRef.current,
      relationsBodyRef.current,
      mappedBodyRef.current,
      dataBodyRef.current,
    ].filter((element): element is NonNullable<typeof element> => element != null);
    const observer = new ResizeObserver(onAnyLaneScroll);
    observed.forEach((element) => observer.observe(element));
    window.addEventListener("resize", onAnyLaneScroll);
    onAnyLaneScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onAnyLaneScroll);
    };
  }, [onAnyLaneScroll]);

  // Rows appear/disappear (filter, search, sort, expand, lane Entity switch) and hover arrows
  // shift row widths without resizing a lane, so recompute after React commits those changes.
  useEffect(() => {
    onAnyLaneScroll();
  }, [
    columnFilter,
    columnSearch,
    columnSort,
    laneEntityId,
    expandedEntityId,
    visibleExpandedProperties,
    visibleTableColumns,
    hoveredMappedRowId,
    hoveredPropertyId,
    hoveredColumnName,
    onAnyLaneScroll,
  ]);

  const columnHoverActive =
    hoveredMappedRowId != null ||
    hoveredPropertyId != null ||
    hoveredColumnName != null ||
    hoveredEntityId != null ||
    hoveredRelationId != null;

  // While a pill is hovered, every pill not directly connected to it fades — the same connections
  // the connector lines draw (see `Idea4EntityMode`'s own `hoverRelated`).
  const hoverRelated = useMemo(() => {
    if (!columnHoverActive) return null;
    const mapped = new Set<string>();
    const entities = new Set<string>();
    const relations = new Set<string>();
    const properties = new Set<string>();
    const columns = new Set<string>();
    if (hoveredMappedRowId) {
      mapped.add(hoveredMappedRowId);
      // The Entities/Relations lanes are showing exactly this Entity's own neighbourhood.
      entities.add(hoveredMappedRowId);
      relatedEntities.forEach((entity) => entities.add(entity.id));
      laneRelations.forEach(({ relation }) => relations.add(relation.id));
      usingEntities
        .find((entity) => entity.id === hoveredMappedRowId)
        ?.properties.forEach((p) => {
          if (p.mapping?.table === table.name) columns.add(p.mapping.column);
        });
    }
    if (hoveredColumnName) {
      columns.add(hoveredColumnName);
      usingEntities.forEach((entity) => {
        if (
          entity.properties.some(
            (p) => p.mapping?.table === table.name && p.mapping.column === hoveredColumnName,
          )
        ) {
          mapped.add(entity.id);
        }
      });
      expandedEntity?.properties.forEach((p) => {
        if (p.mapping?.table === table.name && p.mapping.column === hoveredColumnName) {
          properties.add(p.id);
        }
      });
    }
    if (hoveredPropertyId) {
      properties.add(hoveredPropertyId);
      const property = expandedEntity?.properties.find((p) => p.id === hoveredPropertyId);
      if (property?.mapping?.table === table.name) columns.add(property.mapping.column);
    }
    if (hoveredRelationId) {
      relations.add(hoveredRelationId);
      const match = laneRelations.find(({ relation }) => relation.id === hoveredRelationId);
      if (match) entities.add(match.counterpart.id);
    }
    if (hoveredEntityId) {
      entities.add(hoveredEntityId);
      laneRelations.forEach(({ relation, counterpart }) => {
        if (counterpart.id === hoveredEntityId) relations.add(relation.id);
      });
    }
    return { mapped, entities, relations, properties, columns };
  }, [
    columnHoverActive,
    hoveredMappedRowId,
    hoveredColumnName,
    hoveredPropertyId,
    hoveredRelationId,
    hoveredEntityId,
    relatedEntities,
    laneRelations,
    usingEntities,
    expandedEntity,
    table.name,
  ]);
  const dimmedIn = (kind: keyof NonNullable<typeof hoverRelated>, id: string) =>
    hoverRelated != null && !hoverRelated[kind].has(id);

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <Idea4EntityPanel app={app} workingIds={new Set(usingEntities.map((e) => e.id))} />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {/* "topNavBar", Figma node 406:5746 — height/padding/text corrected to match (was h-10,
            12px text, and missing "view" from the label). */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e3e5e4] bg-white pl-3 pr-2">
          <button
            type="button"
            onClick={app.closeDetail}
            className="flex items-center gap-2 text-[14px] font-medium text-[#161919] hover:underline"
          >
            <ArrowLeft className="size-4" /> Back to Ontology view
          </button>
          <UndoRedoPill
            onUndo={app.undo}
            onRedo={app.redo}
            canUndo={app.canUndo}
            canRedo={app.canRedo}
          />
        </div>

        <div
          ref={workspaceRef}
          className="relative grid min-h-0 flex-1 grid-cols-[1fr_0.8fr_1fr_1fr] gap-[3px] overflow-hidden bg-[#E3E5E4]"
        >
          <Idea4Surface
            label="Entities"
            count={relatedEntities.length + (hasSelfRelation ? 1 : 0)}
            bodyRef={relatedBodyRef}
            onBodyScroll={onAnyLaneScroll}
          >
            <div className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-4 pt-4">
              {laneEntity && hasSelfRelation && (
                <SelfEntityRow entity={laneEntity} dimmed={dimmedIn("entities", laneEntity.id)} />
              )}
              {relatedEntities.map((entity) => (
                <CompactEntity
                  key={entity.id}
                  entity={entity}
                  dimmed={dimmedIn("entities", entity.id)}
                  onHoverChange={(hovering) =>
                    setHoveredEntityId((cur) =>
                      hovering ? entity.id : cur === entity.id ? null : cur,
                    )
                  }
                  onOpen={() => openCounterpart(entity.id)}
                  onSelect={() => {}}
                  onDropProperties={() => {}}
                  rowRef={(el) => {
                    if (el) entityRowRefs.current.set(entity.id, el);
                    else entityRowRefs.current.delete(entity.id);
                  }}
                />
              ))}
            </div>
          </Idea4Surface>

          <Idea4Surface
            label="Relations"
            count={laneRelations.length}
            bodyRef={relationsBodyRef}
            onBodyScroll={onAnyLaneScroll}
          >
            <div className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-2 pt-4">
              {laneEntity && laneRelations.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                  No Relations touch this Entity Type yet.
                </p>
              )}
              {groupRelationsByCounterpart(laneRelations).map((group) => (
                <RelationGroup key={group.counterpartId}>
                  {group.items.map(({ relation, counterpart, outgoing }) => (
                    <RelationCard
                      key={relation.id}
                      dimmed={dimmedIn("relations", relation.id)}
                      onHoverChange={(hovering) =>
                        setHoveredRelationId((cur) =>
                          hovering ? relation.id : cur === relation.id ? null : cur,
                        )
                      }
                      relation={relation}
                      counterpart={counterpart}
                      outgoing={outgoing}
                      entities={app.entities}
                      onOpenCounterpart={() => openCounterpart(counterpart.id)}
                      onAccept={() =>
                        app.acceptSuggestions([
                          suggestionKey({ kind: "relation", id: relation.id }),
                        ])
                      }
                      onReject={() =>
                        app.declineSuggestions([
                          suggestionKey({ kind: "relation", id: relation.id }),
                        ])
                      }
                      cardRef={(el) => {
                        if (el) relationCardRefs.current.set(relation.id, el);
                        else relationCardRefs.current.delete(relation.id);
                      }}
                    />
                  ))}
                </RelationGroup>
              ))}
            </div>
          </Idea4Surface>

          <Idea4Surface
            label="Mapped Entities"
            count={usingEntities.length}
            bodyRef={mappedBodyRef}
            onBodyScroll={onAnyLaneScroll}
            flush={!!expandedEntity}
          >
            {expandedEntity ? (
              <ExpandedEntity
                key={expandedEntity.id}
                isPropertyDimmed={(id) => dimmedIn("properties", id)}
                entity={expandedEntity}
                visibleProperties={visibleExpandedProperties}
                selected={suggestionSelection.has(
                  suggestionKey({ kind: "entity", id: expandedEntity.id }),
                )}
                onClose={() => setExpandedEntityId(null)}
                closeLabel="Back to Mapped Entities"
                onSelect={() =>
                  app.toggleSuggestionSelected({ kind: "entity", id: expandedEntity.id })
                }
                onDropProperties={() => {}}
                suggestionSelection={suggestionSelection}
                onSelectProperty={(propertyId) =>
                  app.toggleSuggestionSelected({
                    kind: "property",
                    entityId: expandedEntity.id,
                    propertyId,
                  })
                }
                selectedPropertyIdsFor={selectedPropertyIdsFor}
                titleRef={(el) => {
                  if (el) mappedEntityRowRefs.current.set(expandedEntity.id, el);
                  else mappedEntityRowRefs.current.delete(expandedEntity.id);
                }}
                sort={propertySort}
                onSortChange={(key) => {
                  setPropertySort((prev) => nextSortState(prev, key));
                  setPropertySortTouched(true);
                }}
                filter={propertyFilter}
                onFilterChange={setPropertyFilter}
                search={propertySearch}
                onSearchChange={setPropertySearch}
                isAddingProperty={addingProperty}
                onStartAddProperty={() => setAddingProperty(true)}
                onSubmitAddProperty={(name) => {
                  const trimmed = name.trim();
                  if (trimmed) app.createProperty(expandedEntity.id, trimmed);
                  setAddingProperty(false);
                }}
                onCancelAddProperty={() => setAddingProperty(false)}
                onBodyScroll={onAnyLaneScroll}
                bodyRef={expandedBodyRef}
                hoveredPropertyId={hoveredPropertyId}
                onPropertyHoverChange={(propertyId, hovering) =>
                  setHoveredPropertyId((cur) =>
                    hovering ? propertyId : cur === propertyId ? null : cur,
                  )
                }
                onSetPropertyRef={(propertyId, el) => {
                  if (el) propertyRefs.current.set(propertyId, el);
                  else propertyRefs.current.delete(propertyId);
                }}
                propertyOffscreenDirections={propertyOffscreen}
                onNavigateToOffscreenProperty={scrollToColumnForProperty}
              />
            ) : (
              <div
                onMouseLeave={() => setPreviewEntityId(null)}
                className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-4 pt-4"
              >
                {usingEntities.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                    No Entity Types map into this table yet.
                  </p>
                )}
                {usingEntities.map((entity) => (
                  <MappedEntityRow
                    key={entity.id}
                    entity={entity}
                    dimmed={dimmedIn("mapped", entity.id)}
                    highlighted={entity.id === laneEntityId}
                    hovered={hoveredMappedRowId === entity.id}
                    onHoverChange={(hovering) => {
                      setHoveredMappedRowId((cur) =>
                        hovering ? entity.id : cur === entity.id ? null : cur,
                      );
                      if (hovering) setPreviewEntityId(entity.id);
                    }}
                    onOpen={() => {
                      setPreviewEntityId(null);
                      setHoveredMappedRowId(null);
                      setExpandedEntityId(entity.id);
                    }}
                    rowRef={(el) => {
                      if (el) mappedEntityRowRefs.current.set(entity.id, el);
                      else mappedEntityRowRefs.current.delete(entity.id);
                    }}
                    offscreenDirection={entityOffscreen[entity.id]}
                    onNavigateToOffscreen={() => scrollToColumnsForEntity(entity.id)}
                  />
                ))}
              </div>
            )}
          </Idea4Surface>

          <CurrentDataTableCard
            table={table}
            suggestedColumnMapping={suggestedColumnMapping}
            isColumnDimmed={(name) => dimmedIn("columns", name)}
            entities={app.entities}
            visibleColumns={visibleTableColumns}
            mappedColumnNames={mappedColumnNames}
            suggestedColumnNames={suggestedColumnNames}
            bodyRef={dataBodyRef}
            onBodyScroll={onAnyLaneScroll}
            sort={columnSort}
            onSortChange={(key) => {
              setColumnSort((prev) => nextSortState(prev, key));
              setColumnSortTouched(true);
            }}
            filter={columnFilter}
            onFilterChange={setColumnFilter}
            search={columnSearch}
            onSearchChange={setColumnSearch}
            setColumnRef={(columnName, el) => {
              if (el) columnRefs.current.set(columnName, el);
              else columnRefs.current.delete(columnName);
            }}
            hoveredColumnName={hoveredColumnName}
            onColumnHoverChange={(columnName, hovering) =>
              setHoveredColumnName((cur) =>
                hovering ? columnName : cur === columnName ? null : cur,
              )
            }
            columnOffscreenDirections={columnOffscreen}
            onNavigateToOffscreenColumn={scrollToCounterpartsForColumn}
          />

          {/* Connector overlay — clipped below the lane headers so lines slide under them. */}
          <svg
            className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
            style={{ clipPath: "inset(68px 0 0 0)" }}
          >
            {relationLines.map((line) => {
              const related = !hoverRelated || hoverRelated.relations.has(line.id);
              return (
                <path
                  key={`rel-${line.id}`}
                  d={line.path}
                  fill="none"
                  stroke={line.suggested ? MAPPING_SUGGESTED_COLOR : MAPPING_DEFAULT_COLOR}
                  strokeWidth={hoverRelated && related ? 2 : 1.5}
                  opacity={related ? 1 : 0.16}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-[opacity,stroke-width] duration-150"
                />
              );
            })}
            {columnLines.map((line) => {
              const related =
                line.entityId === hoveredMappedRowId ||
                (line.propertyId != null && line.propertyId === hoveredPropertyId) ||
                line.columnName === hoveredColumnName;
              return (
                <path
                  key={`col-${line.id}`}
                  d={line.path}
                  fill="none"
                  stroke={line.suggested ? MAPPING_SUGGESTED_COLOR : MAPPING_DEFAULT_COLOR}
                  strokeWidth={columnHoverActive && related ? 2 : 1.5}
                  opacity={columnHoverActive && !related ? 0.16 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-[opacity,stroke-width] duration-150"
                />
              );
            })}
          </svg>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] h-24 backdrop-blur-[1px]"
            style={{
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.88) 58%, rgba(255,255,255,0.98))",
            }}
          />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto">
            <AiReviewBar
              entities={app.entities}
              relations={app.relations}
              tables={app.tables}
              confidenceRange={app.confidenceRange}
              onConfidenceRangeChange={app.setConfidenceRange}
              onSelectSuggestionsInRange={app.selectSuggestionKeys}
              scope={suggestionScope}
            />
          </div>
        </div>
      </main>

      <Idea4TablePanel app={app} activeNames={new Set()} focusName={table.name} />
    </div>
  );
}

/** The Mapped Entities lane's own row (Figma node 407:4873) — a plain compact card, same
 * badge/name/confidence recipe as `CompactEntity`, but with a solid border highlight (not a teal
 * ring) for whichever ONE is currently pinned as this mode's own local Focus, matching
 * `CompactTable`'s own `highlighted` treatment in `Idea4EntityMode` rather than `CompactEntity`'s
 * own selected state — Figma doesn't show a hover-purple/teal-select state for this row, only
 * "pinned" vs not. */
function MappedEntityRow({
  entity,
  highlighted,
  hovered,
  onOpen,
  rowRef,
  onHoverChange,
  offscreenDirection,
  onNavigateToOffscreen,
  dimmed,
}: {
  entity: Entity;
  highlighted?: boolean;
  hovered?: boolean;
  onOpen: () => void;
  rowRef?: (el: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  // Set when some Column this Entity maps into is scrolled out of view — hovering then shows a
  // scroll arrow, same interaction as `CompactTable`'s.
  offscreenDirection?: "up" | "down" | undefined;
  onNavigateToOffscreen?: () => void;
  dimmed?: boolean;
}) {
  return (
    // The scroll arrow floats beside the pill (in the lane's side padding) instead of taking
    // width from it — this lane is often narrow, and a shrinking pill would lose the name.
    <div
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cn(
        "relative flex w-full max-w-[340px] shrink-0 transition-opacity duration-150",
        dimmed && "opacity-40",
      )}
    >
      <button
        ref={rowRef}
        type="button"
        onClick={onOpen}
        className={cn(
          "relative z-20 flex h-10 w-full items-center gap-2.5 overflow-hidden rounded-[38px] border bg-white px-3 text-left hover:!border-[#161919]",
          highlighted ? "border-[#161919]" : "border-[#e3e5e4]",
        )}
      >
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={16}
          confidence={entity.confidence}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#161919]">
          {entity.name}
        </span>
        {entityDisplayStatus(entity) === "suggested" && <EntityConfidenceChip entity={entity} />}
      </button>
      {offscreenDirection && hovered && (
        // `pl-1` bridges the gap to the pill so moving onto the arrow doesn't end the hover.
        <span className="absolute left-full top-1/2 z-20 flex -translate-y-1/2 pl-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onNavigateToOffscreen?.();
            }}
            className="flex size-6 items-center justify-center rounded-full border border-[#e3e5e4] bg-white text-[#535353] hover:border-[#161919]"
            aria-label={`Scroll to mapped column ${offscreenDirection}`}
          >
            {offscreenDirection === "up" ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
          </button>
        </span>
      )}
    </div>
  );
}

function CurrentDataTableCard({
  table,
  entities,
  visibleColumns,
  mappedColumnNames,
  suggestedColumnNames,
  titleRef,
  bodyRef,
  onBodyScroll,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  setColumnRef,
  hoveredColumnName,
  onColumnHoverChange,
  columnOffscreenDirections,
  onNavigateToOffscreenColumn,
  isColumnDimmed,
  suggestedColumnMapping,
}: {
  table: TableSchema;
  entities: Entity[];
  // See `ExpandedEntity`'s own `visibleProperties` doc comment — same rationale, mirrored for a
  // Column list shared across however many Entities map into this Table (see `Idea4TableMode`'s
  // own `mappedColumnNames`/`identifierColumnNames`).
  visibleColumns: TableSchema["columns"];
  // Which Columns are Mapped/still-Suggested across every Entity using this Table — see
  // `Idea4TableMode`'s own `mappedColumnNames`/`suggestedColumnNames` doc comments. Drives this
  // row's own status dot the same 3-way way `ExpandedTable`'s own per-column dot works.
  mappedColumnNames: Set<string>;
  suggestedColumnNames: Set<string>;
  titleRef?: React.RefObject<HTMLButtonElement | null>;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  onBodyScroll?: () => void;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  filter: ListFilter;
  onFilterChange: (next: ListFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  // Connector hooks — Table mode draws Mapped Entity / Property -> Column lines into these rows.
  setColumnRef?: (columnName: string, el: HTMLElement | null) => void;
  hoveredColumnName?: string | null;
  onColumnHoverChange?: (columnName: string, hovering: boolean) => void;
  columnOffscreenDirections?: Record<string, "up" | "down">;
  onNavigateToOffscreenColumn?: (columnName: string) => void;
  isColumnDimmed?: (columnName: string) => boolean;
  suggestedColumnMapping?: Map<string, { entity: Entity; property: Property }>;
}) {
  const [scrolledFromTop, setScrolledFromTop] = useState(false);
  return (
    // Mirrors `CurrentEntityCard` (Entity mode's selected lane) exactly — same mint surface, cyan
    // 32px title with badge/name/count, list controls, and pill rows — with Columns in place of
    // Properties. Column pills reuse `ExpandedTable`'s column pill recipe.
    <div className="relative mb-[60px] flex min-w-0 flex-col overflow-hidden bg-[#e7f1f0]">
      <button
        ref={titleRef}
        type="button"
        className="flex h-8 shrink-0 items-center gap-2 border-b border-[#e3e5e4] bg-[#0891b2] px-4 text-left"
      >
        <MappingStatusBadge
          status={tableMappingStatus(table.name, entities)}
          {...tableMappingCompleteness(table.name, entities)}
          size={16}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#fafafa]">
          {table.name}
        </span>
        <CountTooltip
          count={table.columns.length}
          singular="column"
          plural="columns"
          className="shrink-0 text-[14px] text-[#fafafa]"
        />
      </button>
      <ListControls
        sort={sort}
        onSortChange={onSortChange}
        filter={filter}
        onFilterChange={onFilterChange}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search columns…"
      />
      <div
        ref={bodyRef}
        onScroll={(event) => {
          setScrolledFromTop(event.currentTarget.scrollTop > 1);
          onBodyScroll?.();
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[72px] pt-4"
      >
        <div className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-8">
          {visibleColumns.map((column) => {
            const TypeGlyph = propertyTypeIcon(column.type);
            const hovered = hoveredColumnName === column.name;
            const offscreenDirection = columnOffscreenDirections?.[column.name];
            return (
              <div
                key={column.name}
                ref={(el) => setColumnRef?.(column.name, el)}
                onMouseEnter={() => onColumnHoverChange?.(column.name, true)}
                onMouseLeave={() => onColumnHoverChange?.(column.name, false)}
                className={cn(
                  "relative z-20 flex w-full max-w-[340px] items-center gap-2 rounded-full border bg-white py-1.5 pl-3 pr-2 text-[12px] hover:border-[#161919]",
                  hovered ? "border-[#161919]" : "border-[#e3e5e4]",
                  "transition-opacity duration-150",
                  isColumnDimmed?.(column.name) && "opacity-40",
                )}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      COLUMN_DOT_COLOR[
                        suggestedColumnNames.has(column.name)
                          ? "suggested"
                          : mappedColumnNames.has(column.name)
                            ? "mapped"
                            : "unmapped"
                      ],
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-[#161919]">{column.name}</span>
                <TypeGlyph className="size-4 shrink-0 text-[#535353]" aria-label={column.type} />
                {(() => {
                  const suggestion = suggestedColumnMapping?.get(column.name);
                  return suggestion ? (
                    <MappingConfidenceChip
                      entity={suggestion.entity}
                      property={suggestion.property}
                    />
                  ) : null;
                })()}
                {hovered && offscreenDirection && (
                  // Sits outside the pill on the side facing the lane it scrolls; `pr-1` bridges
                  // the gap so moving onto the arrow doesn't end the hover.
                  <span className="absolute right-full top-1/2 flex -translate-y-1/2 pr-1">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onNavigateToOffscreenColumn?.(column.name);
                      }}
                      className="flex size-6 items-center justify-center rounded-full border border-[#e3e5e4] bg-white text-[#535353] hover:border-[#161919]"
                      aria-label={`Scroll to mapped entity ${offscreenDirection}`}
                    >
                      {offscreenDirection === "up" ? (
                        <ArrowUp className="size-3.5" />
                      ) : (
                        <ArrowDown className="size-3.5" />
                      )}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {scrolledFromTop && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[68px] z-20 h-[72px]"
          style={{
            background: "linear-gradient(to bottom, #e7f1f0 0%, #e7f1f0 50%, #e7f1f000 100%)",
          }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px]"
        style={{ background: "linear-gradient(to bottom, #e7f1f000, #e7f1f0 50%)" }}
      />
    </div>
  );
}

const PROPERTY_MOVE_DND_TYPE = "application/x-idea4-move-properties";
// Dragging an existing row straight out of the left "Entity types"/right "Data tables" toolbox
// panels, to add it into THIS workspace — distinct from `PROPERTY_MOVE_DND_TYPE` above (which
// moves a Property between two Entities already visible here) so the two drags never collide.
const ENTITY_PANEL_DND_TYPE = "application/x-idea4-entity-from-panel";
const TABLE_PANEL_DND_TYPE = "application/x-idea4-table-from-panel";

/** The small circular status icon inside a relation pill — reuses the same confirmed/suggested
 * color language `StatusBadge` already establishes app-wide, just at pill scale. */
// A plain 6px dot, same as `reviewStatusDot` — Figma's Relations-lane pill (node 406:4970) shows
// a bare status dot, not the prototype's original 14px circle+check-glyph badge.
function RelationStatusIcon({ relation, entities }: { relation: Relation; entities: Entity[] }) {
  const status = relationStatus(relation, entities);
  return (
    <span
      className="size-1.5 shrink-0 rounded-full"
      style={{ background: reviewStatusDot(status) }}
    />
  );
}

/** One row in the Relations lane — a Relation touching Focus Entity, browsable independently of
 * its own connector line/pill (that pill is the line's own on-canvas label, positioned along the
 * connector itself; this is a separate, plain list to scan/accept/reject/jump from — see
 * `focusRelations`'s own doc comment). Deliberately styled as the SAME small pill the connector's
 * own floating label already uses (status icon + name, `rounded-full`/`border`/`shadow` trio),
 * not a bordered card — this list is a parallel way to browse the same Relations, not a
 * visually-competing new object. Clicking it points at the counterpart Entity's own card in
 * Connected Entities (expanding it, same as clicking that card directly) WITHOUT moving Focus —
 * Current Entity stays exactly what it was; this is a way to look at the counterpart from where
 * you already are, not a way to navigate to it. Accept/Reject reveal on hover and only once the
 * Relation is still an open suggestion (not yet Confirmed) — same "confirmed items get nothing,
 * not a Delete" shape `ExpandedTable`'s own inline mapping Accept/Reject uses. */
/** Groups a lane's Relations by counterpart Entity, keeping first-seen order, so every Relation
 * between the same two Entity Types renders in one `RelationGroup`. */
function groupRelationsByCounterpart<T extends { relation: Relation; counterpart: Entity }>(
  items: T[],
): { counterpartId: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const group = groups.get(item.counterpart.id);
    if (group) group.push(item);
    else groups.set(item.counterpart.id, [item]);
  });
  return Array.from(groups, ([counterpartId, groupItems]) => ({
    counterpartId,
    items: groupItems,
  }));
}

/** The Relations lane's slot (Figma "Relation-05", node 427:9363): one per counterpart Entity,
 * stacking every Relation between the same two Entity Types 8px apart. `max-w-[160px]`/`min-h-10`
 * keep each slot the same width and at least one pill-row tall. */
function RelationGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-10 w-full max-w-[160px] shrink-0 flex-col items-center justify-center gap-2">
      {children}
    </div>
  );
}

function RelationCard({
  relation,
  counterpart,
  outgoing,
  entities,
  onOpenCounterpart,
  onAccept,
  onReject,
  cardRef,
  onHoverChange,
  dimmed,
  selected,
  onSelect,
}: {
  relation: Relation;
  counterpart: Entity;
  outgoing: boolean;
  entities: Entity[];
  onOpenCounterpart: () => void;
  onAccept: () => void;
  onReject: () => void;
  // Registers this pill's own DOM node so the connector line can anchor on (and visibly thread
  // through) its actual position — see `recomputeRelationLines`'s own doc comment.
  cardRef?: (el: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  // Faded while another pill is hovered and this one isn't connected to it.
  dimmed?: boolean;
  selected?: boolean;
  // Shift/cmd/ctrl-click toggles this Relation in the multi-selection; a plain click still opens
  // the counterpart.
  onSelect?: (mods: SelectMods) => void;
}) {
  const counterpartName = counterpart.name || "Untitled entity";
  return (
    // The pill only — `RelationGroup` is the lane slot that stacks every Relation to the same
    // counterpart. A plain `div` acting as the click target, not a `button`, so the confidence
    // chip inside can hold its own focusable trigger. `cardRef` sits here since this exact node
    // is what the connector line anchors on.
    <div
      ref={cardRef}
      data-connector-hover
      data-connector-relation-id={relation.id}
      role="button"
      tabIndex={0}
      aria-pressed={onSelect ? !!selected : undefined}
      aria-label={`${relationLabel(relation)} ${outgoing ? "to" : "from"} ${counterpartName}`}
      onClick={(e) => {
        if (onSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
          return;
        }
        onOpenCounterpart();
      }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenCounterpart();
        }
      }}
      // Figma "pill" (node 427:9364): the 4px `#f3f3f3` ring (lane background) keeps connector
      // lines from touching the pill's edge; the name fills the pill after the status dot.
      className={cn(
        "group/relcard relative z-20 flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-[#e3e5e4] bg-white py-0.5 pl-[10px] pr-1.5 text-left text-[14px] font-normal leading-5 text-[#161919] shadow-[0_0_0_4px_#f3f3f3] outline-none transition-opacity duration-150 hover:!border-[#161919] hover:!bg-white focus-visible:ring-2 focus-visible:ring-[#00DED8]",
        selected && "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8,0_0_0_4px_#f3f3f3]",
        dimmed && "opacity-40",
      )}
    >
      <RelationStatusIcon relation={relation} entities={entities} />
      <span className="min-w-0 flex-1 truncate">{relationLabel(relation)}</span>
      {relationStatus(relation, entities) === "suggested" && (
        <RelationConfidenceChip relation={relation} />
      )}
    </div>
  );
}

// What each lane header's count counts, for its hover tooltip ("14 entities").
const LANE_COUNT_NOUNS: Record<string, [string, string]> = {
  Entities: ["entity", "entities"],
  "Mapped Entities": ["entity", "entities"],
  Relations: ["relation", "relations"],
  "Data Tables": ["table", "tables"],
};

function Idea4Surface({
  label,
  count,
  bodyRef,
  onBodyScroll,
  flush = false,
  children,
}: {
  label: string;
  count?: number;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  onBodyScroll?: () => void;
  flush?: boolean;
  children: ReactNode;
}) {
  const [scrolledFromTop, setScrolledFromTop] = useState(false);
  return (
    <section
      className={cn("relative flex min-w-0 flex-col overflow-hidden")}
      style={{ background: "#F3F3F3" }}
    >
      {/* Title, 32px — off Figma "Entity Triggered Editing" lane title (node 424:19587, re-checked
          — this frame's own title bars flipped from a light `#f9f9f9` chrome to a dark
          `#3c4140`/zinc-700 one since this was first ported): flat `#3c4140`, label Medium/14px,
          count Regular/14px, both the same light `#fafafa`/zinc-50 (not two different grays the
          way this header previously split them, and not the dark-on-light pairing this whole
          lane system used before this re-check). Body bg `#F3F3F3` (re-checked) — same neutral for
          Entities/Relations/Data Tables; the Selected Entity lane's own `CurrentEntityCard` uses a
          different mint `#E7F1F0` instead of this shared surface. */}
      {!flush && (
        <header className="flex h-8 shrink-0 items-center justify-between border-b border-[#e3e5e4] bg-[#3c4140] px-4 text-[14px]">
          <span className="font-medium text-[#fafafa]">{label}</span>
          {count != null &&
            (LANE_COUNT_NOUNS[label] ? (
              <CountTooltip
                count={count}
                singular={LANE_COUNT_NOUNS[label][0]}
                plural={LANE_COUNT_NOUNS[label][1]}
                className="text-[#fafafa]"
              />
            ) : (
              <span className="text-[#fafafa]">{count}</span>
            ))}
        </header>
      )}
      {/* Bottom padding clears the floating AI review bar (bottom-3, 48px tall — a 60px footprint
          from `<main>`'s own bottom edge) by exactly 24px, so scrolled-to-the-end content in any
          lane, and `CurrentEntityCard`'s own `h-full` sizing, both land the same fixed 24px above
          it rather than lining up against an arbitrary reserved margin. */}
      <div
        ref={bodyRef}
        onScroll={(event) => {
          setScrolledFromTop(event.currentTarget.scrollTop > 1);
          onBodyScroll?.();
        }}
        className={cn(
          "min-h-0 flex-1 overscroll-contain",
          flush ? "overflow-hidden p-0" : "overflow-y-auto px-4 pb-[84px]",
        )}
      >
        {children}
      </div>
      {!flush && scrolledFromTop && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-8 z-10 h-12"
          style={{ background: "linear-gradient(to bottom, #F3F3F3, #F3F3F300)" }}
        />
      )}
      {/* "scroll for more" fade (Figma node 407:3672 / 407:6084) — a fixed overlay, not part of the
          scrolling content, so it always reads as "there's more below" rather than scrolling away
          itself. `pointer-events-none` so it never intercepts clicks/drags on the list beneath it. */}
      {!flush && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px]"
          style={{ background: "linear-gradient(to bottom, #F3F3F300, #F3F3F3 50%)" }}
        />
      )}
    </section>
  );
}

type SelectMods = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };

// Stands in for every OTHER card in a lane while one is expanded — a real compact row per
// remaining item meant scrolling past a dozen-plus of them just to get back to the top (the exact
// complaint this replaces, first for Connected Entities' own Entity Types, then Data Tables' own
// Tables). This is deliberately NOT a real per-item list — just one clickable "closer" card,
// styled as a shallow stack (two faint peeking edges behind the front card) to read as "there's
// more behind this," that collapses the expanded card back to the full list on click. Clicking any
// individual item within that full list re-expands it same as before; this is purely the reverse
// direction. `noun`/`nounPlural` name whatever this lane's own cards ARE ("Entity Type"/"Entity
// Types", "Data Table"/"Data Tables") — used for the "N more ___" label; `laneLabel` names the
// LANE itself ("Connected Entities"/"Data Tables" — the same string as `nounPlural` for Data
// Tables, but not for Connected Entities) for the "show all ___ again" phrase.
function CollapsedCardsStack({
  count,
  noun,
  nounPlural,
  laneLabel,
  onOpen,
}: {
  count: number;
  noun: string;
  nounPlural: string;
  laneLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className="relative pb-1.5">
      <div
        aria-hidden
        className="absolute inset-x-3 bottom-0 h-9 rounded-b-md border border-black/[0.06] bg-black/[0.015]"
      />
      <div
        aria-hidden
        className="absolute inset-x-1.5 bottom-0.5 h-9 rounded-b-md border border-black/[0.07] bg-black/[0.03]"
      />
      <button
        type="button"
        onClick={onOpen}
        // Radius/border/shadow match the lane row card recipe below (`CompactEntity`) — same
        // Figma-sampled "lane card" family, node 406:4929.
        className="relative z-10 flex h-12 w-full items-center gap-3 rounded-md border border-[#e3e5e4] bg-white px-4 text-left hover:border-[#161919]"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[10px] font-semibold text-muted-foreground">
          {count}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-muted-foreground">
          {count === 1 ? `1 more ${noun}` : `${count} more ${nounPlural}`}
        </span>
      </button>
    </div>
  );
}

function CompactEntity({
  entity,
  compact,
  selected,
  onOpen,
  onSelect,
  onDropProperties,
  rowRef,
  onHoverChange,
  dimmed,
}: {
  entity: Entity;
  compact?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onSelect: (mods: SelectMods) => void;
  onDropProperties: (e: React.DragEvent) => void;
  rowRef?: (el: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  dimmed?: boolean;
}) {
  return (
    <button
      ref={rowRef}
      data-connector-hover
      data-connector-entity-id={entity.id}
      type="button"
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
          return;
        }
        onOpen();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropProperties}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cn(
        // Pill shape (40px tall, rounded-[38px] — a full capsule at this height) sampled directly
        // off the Figma "Entity Triggered Editing" Related Entities lane (node 424:19590, its own
        // "Entity-02"+ rows) — replaces this row's earlier rounded-md/48px card recipe. Selected/
        // hover states are unchanged (not shown in that frame's sample data) — kept as this app's
        // existing teal `--ring`/`#7c5eff` accent conventions.
        "relative z-20 flex h-10 w-full max-w-[340px] shrink-0 items-center gap-2.5 overflow-hidden rounded-[38px] border border-[#e3e5e4] bg-white px-3 text-left hover:!border-[#161919] hover:!bg-white",
        selected && "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8]",
        "transition-opacity duration-150",
        dimmed && "opacity-40",
      )}
    >
      <StatusBadge status={entityDisplayStatus(entity)} size={16} confidence={entity.confidence} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#161919]">
        {entity.name}
      </span>
      {!compact && entityDisplayStatus(entity) === "suggested" && (
        <EntityConfidenceChip entity={entity} />
      )}
    </button>
  );
}

/**
 * The Connected Entities lane's own pinned "(self)" row (Figma node 424:19591, "Entity-01") —
 * Focus Entity shown at the top of its OWN Related Entities lane, labeled "self", so the relation
 * lines drawn from this lane still have a visible anchor even though Focus Entity's full card
 * lives in the Current Entity lane instead. Same pill shape as `CompactEntity`'s own row (plain
 * white, not a teal tint — the "self" caption line underneath the name is the only thing that
 * marks this row as different, not its own background color). Non-interactive (no click/drag/
 * select) since Focus Entity is already open in its own lane right next to this one — nothing for
 * clicking "self" to do.
 */
function SelfEntityRow({
  entity,
  rowRef,
  dimmed,
}: {
  entity: Entity;
  rowRef?: (element: HTMLElement | null) => void;
  dimmed?: boolean;
}) {
  return (
    <div
      ref={rowRef}
      className={cn(
        "relative z-20 flex h-10 w-full max-w-[340px] shrink-0 items-center gap-2.5 rounded-[38px] border border-[#e3e5e4] bg-white px-3 transition-opacity duration-150",
        dimmed && "opacity-40",
      )}
    >
      <StatusBadge status={entityDisplayStatus(entity)} size={16} confidence={entity.confidence} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-[#161919]">{entity.name}</span>
        <span className="block text-[12px] text-[#6d7472]">self</span>
      </span>
      {entityDisplayStatus(entity) === "suggested" && <EntityConfidenceChip entity={entity} />}
    </div>
  );
}

function ExpandedEntity({
  entity,
  visibleProperties,
  selected,
  onClose,
  onSelect,
  onDropProperties,
  suggestionSelection,
  onSelectProperty,
  selectedPropertyIdsFor,
  titleRef,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  isAddingProperty,
  onStartAddProperty,
  onSubmitAddProperty,
  onCancelAddProperty,
  onBodyScroll,
  bodyRef,
  closeLabel = "Back to Entities",
  hoveredPropertyId,
  onPropertyHoverChange,
  onSetPropertyRef,
  propertyOffscreenDirections,
  onNavigateToOffscreenProperty,
  isPropertyDimmed,
}: {
  entity: Entity;
  // The rendered rows, already filtered (Mapped/Unmapped/Only Identifier / search) and, once
  // explicitly sorted, reordered — see `visiblePropertiesFor` in `Idea4EntityMode`.
  // `entity.properties` itself stays the full, unfiltered list, since the header's own "N props"
  // count should never shrink to match a temporary Filter/Search.
  visibleProperties: Property[];
  selected?: boolean;
  onClose: () => void;
  onSelect: (mods: SelectMods) => void;
  onDropProperties: (e: React.DragEvent) => void;
  suggestionSelection: Set<string>;
  onSelectProperty: (propertyId: string, mods: SelectMods) => void;
  selectedPropertyIdsFor: (entityId: string) => Set<string>;
  titleRef?: (el: HTMLElement | null) => void;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  filter: ListFilter;
  onFilterChange: (next: ListFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  isAddingProperty: boolean;
  onStartAddProperty: () => void;
  onSubmitAddProperty: (name: string) => void;
  onCancelAddProperty: () => void;
  onBodyScroll?: () => void;
  // Connector hooks, used by Table mode to draw Property -> Column lines from this card.
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  closeLabel?: string;
  hoveredPropertyId?: string | null;
  onPropertyHoverChange?: (propertyId: string, hovering: boolean) => void;
  onSetPropertyRef?: (propertyId: string, el: HTMLElement | null) => void;
  propertyOffscreenDirections?: Record<string, "up" | "down">;
  onNavigateToOffscreenProperty?: (propertyId: string) => void;
  isPropertyDimmed?: (propertyId: string) => boolean;
}) {
  const [scrolledFromTop, setScrolledFromTop] = useState(false);
  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f3f3]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropProperties}
    >
      <div
        ref={titleRef}
        onClick={(event) => {
          if (event.shiftKey || event.metaKey || event.ctrlKey) {
            onSelect({
              shiftKey: event.shiftKey,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
            });
          }
        }}
        className={cn(
          "relative z-20 flex h-8 shrink-0 items-center gap-2 border-b border-[#e3e5e4] bg-[#3c4140] px-4 text-left",
          selected && "ring-1 ring-inset ring-[#00ded8]",
        )}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#6d7472] text-white hover:bg-[#555b59]"
          aria-label={closeLabel}
        >
          <Undo2 className="size-4" />
        </button>
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={16}
          confidence={entity.confidence}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#fafafa]">
          {entity.name}
        </span>
        <CountTooltip
          count={entity.properties.length}
          singular="property"
          plural="properties"
          className="shrink-0 text-[14px] text-[#fafafa]"
        />
        {entityDisplayStatus(entity) === "suggested" && <EntityConfidenceChip entity={entity} />}
      </div>
      <ListControls
        filter={filter}
        onFilterChange={onFilterChange}
        sort={sort}
        onSortChange={onSortChange}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search properties…"
      />
      <div
        ref={bodyRef}
        onScroll={(event) => {
          setScrolledFromTop(event.currentTarget.scrollTop > 1);
          onBodyScroll?.();
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[72px] pt-8"
      >
        <div className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-8">
          {visibleProperties.map((property) => (
            <PropertyListRow
              key={property.id}
              property={property}
              entityId={entity.id}
              hovered={hoveredPropertyId === property.id}
              onHoverChange={(hovering) => onPropertyHoverChange?.(property.id, hovering)}
              setRef={(el) => onSetPropertyRef?.(property.id, el)}
              offscreenDirection={propertyOffscreenDirections?.[property.id]}
              onNavigateToOffscreen={() => onNavigateToOffscreenProperty?.(property.id)}
              dimmed={isPropertyDimmed?.(property.id) ?? false}
              selected={suggestionSelection.has(
                suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
              )}
              onSelect={(mods) => onSelectProperty(property.id, mods)}
              draggablePropertyIds={selectedPropertyIdsFor}
            />
          ))}
          <AddPropertyRow
            isAdding={isAddingProperty}
            onStartAdd={onStartAddProperty}
            onSubmit={onSubmitAddProperty}
            onCancel={onCancelAddProperty}
          />
        </div>
      </div>
      {scrolledFromTop && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[68px] z-20 h-[72px]"
          style={{
            background: "linear-gradient(to bottom, #f3f3f3 0%, #f3f3f3 50%, #f3f3f300 100%)",
          }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px]"
        style={{ background: "linear-gradient(to bottom, #f3f3f300, #f3f3f3 50%)" }}
      />
    </div>
  );
}

function CurrentEntityCard({
  entity,
  visibleProperties,
  titleRef,
  bodyRef,
  hoveredPropertyId,
  onPropertyHoverChange,
  onSetPropertyRef,
  selected,
  onSelect,
  onDropProperties,
  suggestionSelection,
  onSelectProperty,
  footerRef,
  onFooterClick,
  footerDirection,
  onPropertyListScroll,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  isAddingProperty,
  onStartAddProperty,
  onSubmitAddProperty,
  onCancelAddProperty,
  onStartMapDrag,
  onNavigateToMapping,
  isPropertyDimmed,
}: {
  entity: Entity;
  // See `ExpandedEntity`'s own `visibleProperties` doc comment — same rationale, same mirrored
  // shape, just for the Current Entity card instead of a Connected Entity's own expanded one.
  visibleProperties: Property[];
  titleRef?: React.RefObject<HTMLButtonElement | null>;
  // This lane's own scroll container, now that it's self-contained rather than sitting inside a
  // generic `Idea4Surface` wrapper — see this component's own top-of-function comment. Read by
  // `recomputeMappingLines`'s own visibility-clipping math the same way every other lane's scroll
  // container is.
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  hoveredPropertyId?: string | null;
  onPropertyHoverChange?: (propertyId: string, hovering: boolean) => void;
  onSetPropertyRef?: (propertyId: string, el: HTMLElement | null) => void;
  selected?: boolean;
  onSelect: (mods: SelectMods) => void;
  onDropProperties: (e: React.DragEvent) => void;
  suggestionSelection: Set<string>;
  onSelectProperty: (propertyId: string, mods: SelectMods) => void;
  // Mirror of `ExpandedTable`'s own "Mapped columns" footer, for the reverse direction: a mapped
  // Property that's scrolled outside THIS card's own visible list redirects its ladder line here
  // instead of vanishing — see `scrollToMoreProps`'s own doc comment.
  footerRef?: (el: HTMLElement | null) => void;
  onFooterClick?: () => void;
  // Which way the redirected Property has actually scrolled — "up" (above THIS list's own visible
  // area) or "down" (still further below it) — so the footer's own arrow always points the
  // direction clicking it actually jumps, rather than a fixed one. `null`/undefined reads as "down"
  // (nothing off-screen yet, or not applicable), matching the footer's original resting look.
  footerDirection?: "up" | "down" | null;
  // A native `scroll` event doesn't bubble, so the Idea4Surface lane's own onScroll (on ITS outer
  // body) never fires for scrolling THIS card's own inner property list — same gap
  // `ExpandedTable`'s own `onColumnListScroll` fixes for the Column side. Without this, the ladder
  // lines and the footer's own up/down arrow both go stale the moment this list scrolls.
  onPropertyListScroll?: () => void;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  filter: ListFilter;
  onFilterChange: (next: ListFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  isAddingProperty: boolean;
  onStartAddProperty: () => void;
  onSubmitAddProperty: (name: string) => void;
  onCancelAddProperty: () => void;
  onStartMapDrag?: (propertyId: string, clientX: number, clientY: number) => void;
  // Clicking a mapped Property row (no modifier key held, so it doesn't collide with the existing
  // shift/cmd/ctrl multi-select) scrolls that Property's own mapped Column into view instead of
  // leaving the reviewer to hunt for it — see `scrollToColumnForProperty`'s own doc comment.
  onNavigateToMapping?: (propertyId: string) => void;
  // The Table currently cross-lane-highlighted (see `hoveredTableName` in `Idea4EntityMode`) — any
  // Property here mapped into it gets a shaded background, matching Figma node 407:6393.
  hoveredTableName?: string | null;
  isPropertyDimmed?: (propertyId: string) => boolean;
}) {
  const [scrolledFromTop, setScrolledFromTop] = useState(false);
  return (
    // Rebuilt as a fully self-contained lane surface rather than a floating card wrapped inside
    // the generic `Idea4Surface` chrome — Figma's "outer container" (node 407:5561) shows ONE
    // flush panel with its own header/filter-bar/scroll/fade all merged into a single unit, edge
    // to edge in its grid cell, not a separately-bordered/margined card floating inside a plain
    // lane background. This card now reproduces that chrome directly (bg, header, scroll
    // container, gradient fade) instead of relying on `Idea4Surface` for it — see the call site
    // in `Idea4EntityMode`, which no longer wraps this in `<Idea4Surface active>`.
    <div
      className={cn(
        // No explicit height utility — same as `Idea4Surface`'s own root, this relies on the grid
        // container's default item-stretch to fill its cell, rather than a `h-full` chain that
        // isn't guaranteed to resolve the same way. `mb-[60px]` reserves the floating AI review
        // bar's own "60px footprint" (see the comment this replaces, on `Idea4Surface`'s body
        // padding) as a MARGIN on this box itself, so its `absolute bottom-0` footer/gradient
        // below land above the bar instead of underneath it — previously this fell out for free
        // because this card sized itself against an already-shrunk parent (Idea4Surface's own
        // padded scroll body); now that this card owns its own full grid cell, it has to reserve
        // that clearance itself.
        "relative mb-[60px] flex min-w-0 flex-col overflow-hidden bg-[#e7f1f0]",
        // Inset (not outset) ring so the selection indicator can't get clipped by this panel's
        // own `overflow-hidden` now that it's flush with its grid cell on every side.
        selected && "shadow-[inset_0_0_0_1.5px_#00ded8]",
      )}
    >
      {/* Title, 32px — off Figma "Entity Triggered Editing" selected-lane title (node 424:19677,
          re-checked — this frame's own title flipped from a neutral `#f3f3f3` gray to
          `#0891b2`/`--brand-color` cyan since this was first ported, with its name/count text
          going from dark to light `#fafafa` to match): a 16px `StatusBadge` (not this card's usual
          20px), the entity's own name (Medium/14px, truncated), its own property count
          (Regular/14px), and a flat confidence pill matching `Idea4EntityPanel`'s own row pill
          exactly (not the interactive `ConfidenceChip` this header used before — see that panel's
          own comment on why a dense/title context gets the plain pill instead; this pill's own
          dark-on-light coloring is unchanged since Figma still shows it that way even on the new
          cyan title). */}
      <button
        ref={titleRef}
        type="button"
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
          }
        }}
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 border-b border-[#e3e5e4] bg-[#0891b2] px-4 text-left",
          selected && "bg-[#00ded8]/10",
        )}
      >
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={16}
          confidence={entity.confidence}
          warningReason={entity.warningReason}
          errorReason={entityErrorReason(entity)}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#fafafa]">
          {entity.name}
        </span>
        <CountTooltip
          count={entity.properties.length}
          singular="property"
          plural="properties"
          className="shrink-0 text-[14px] text-[#fafafa]"
        />
        {entityDisplayStatus(entity) === "suggested" && <EntityConfidenceChip entity={entity} />}
      </button>
      <ListControls
        filter={filter}
        onFilterChange={onFilterChange}
        sort={sort}
        onSortChange={onSortChange}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search properties…"
      />
      <div
        ref={bodyRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropProperties}
        onScroll={(event) => {
          setScrolledFromTop(event.currentTarget.scrollTop > 1);
          onPropertyListScroll?.();
        }}
        // `pb-[72px]` matches Figma's own Contents padding (node 424:19685) exactly, clearing the
        // fade + footer below; `pt-4` (not that same frame's own `pt-32`) since that frame's 32px
        // exists purely to clear its OWN absolutely-positioned Filter/Sort/Search bar, which this
        // port keeps in normal document flow (`ListControls` above, already its own real height)
        // rather than as an overlay — see this file's own note on that deliberate deviation.
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[72px] pt-4"
      >
        {/* Same alignment rule as every lane: centered vertically until the pills would cross the
            top/bottom padding, then top-aligned so nothing gets cut off (`justify-center-safe`). */}
        <div className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-8">
          {visibleProperties.map((property) => (
            <PropertyListRow
              key={property.id}
              property={property}
              entityId={entity.id}
              hovered={hoveredPropertyId === property.id}
              onHoverChange={(hovering) => onPropertyHoverChange?.(property.id, hovering)}
              setRef={(el) => onSetPropertyRef?.(property.id, el)}
              selected={suggestionSelection.has(
                suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
              )}
              onSelect={(mods) => onSelectProperty(property.id, mods)}
              onStartMapDrag={onStartMapDrag}
              onNavigateToMapping={onNavigateToMapping}
              dimmed={isPropertyDimmed?.(property.id) ?? false}
            />
          ))}
        </div>
      </div>
      {scrolledFromTop && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[68px] z-20 h-[72px]"
          style={{
            background: "linear-gradient(to bottom, #e7f1f0 0%, #e7f1f0 50%, #e7f1f000 100%)",
          }}
        />
      )}
      {/* "scroll for more" fade — same recipe as `Idea4Surface`'s own (Figma nodes 407:3672/
          407:6084), tinted to this card's own mint `#e7f1f0` (re-checked) instead of a lane's
          plain `#F3F3F3` now that this card provides its own fade rather than inheriting one from
          that wrapper. The "Add property"/"More props" footer button this area used to also host
          are removed for now (per explicit request) — `footerRef`/`onFooterClick`/
          `footerDirection`/`isAddingProperty`/`onStartAddProperty`/`onSubmitAddProperty`/
          `onCancelAddProperty` stay wired in the props below since removal wasn't asked for. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px]"
        style={{ background: "linear-gradient(to bottom, #e7f1f000, #e7f1f0 50%)" }}
      />
    </div>
  );
}

/**
 * The Property/Column list header — Filter ("Only Identifier"), Sort (Name/Confidence, via the
 * same shared `SortDropdown` the Entity Types/Data Tables toolbox panels use), and a Search box
 * that filters this ONE list by name. Every one of the 4 lists this appears above (Current
 * Entity's own Properties, a Connected Entity's own expanded Properties, an expanded Table's own
 * Columns, and `CurrentDataTableCard`'s own Columns) owns its own independent state for all
 * three, keyed by whichever Entity/Table it belongs to — see `visiblePropertiesFor`/the
 * `ExpandedTable`-local column filtering for where that state is actually applied.
 */
/** The Filter control's own trigger + menu — same open/close-on-outside-click shape as
 * `SortDropdown`, just with 4 fixed options instead of Name/Confidence. Kept local to this file
 * (unlike `SortDropdown`) since nothing outside this workspace needs a Mapped/Unmapped/Identifier
 * filter today. */
function FilterDropdown({
  value,
  onChange,
}: {
  value: ListFilter;
  onChange: (next: ListFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "-mx-1 flex items-center rounded px-1 transition-colors",
          value !== "all" ? "font-semibold text-foreground" : "hover:text-foreground",
        )}
      >
        {LIST_FILTER_LABEL[value]} ⇅
      </button>
      {open && (
        <div
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-30 mt-1 flex w-36 flex-col gap-0.5 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node-lift)]"
        >
          {(["all", "mapped", "unmapped", "identifier"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={value === key}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              className={cn(
                "rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                value === key
                  ? "bg-black/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {key === "all" ? "All" : LIST_FILTER_LABEL[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ListControls({
  filter,
  onFilterChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder,
}: {
  // Both omitted entirely hides the Filter control — Mapped/Unmapped/Only Identifier are all
  // facts about a Property's own mapping, which not every list this appears above has enough
  // context for (see `Idea4TableMode`'s own Column list, shared across however many Entities map
  // into it).
  filter?: ListFilter;
  onFilterChange?: (next: ListFilter) => void;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <div className="relative z-50 flex h-9 shrink-0 items-center gap-2 bg-inherit px-3 text-[11px] text-muted-foreground">
      {searchOpen ? (
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onSearchChange("");
              setSearchOpen(false);
            }
          }}
          placeholder={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <>
          {onFilterChange && <FilterDropdown value={filter ?? "all"} onChange={onFilterChange} />}
          <SortDropdown sort={sort} onChange={onSortChange} showPrefix={false} />
        </>
      )}
      <button
        type="button"
        onClick={() => {
          if (searchOpen && search) onSearchChange("");
          setSearchOpen((open) => !open);
        }}
        aria-label={searchOpen ? "Close search" : "Search"}
        className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
      >
        {searchOpen ? <X className="size-3.5" /> : <Search className="size-3.5" />}
      </button>
    </div>
  );
}

/** "+ Add property" — a plain button until clicked, then swaps in place for a dashed-border text
 * input (never a modal, matching `DetailView.tsx`'s own `AddPropertyRow`). Enter or blur submits
 * whatever's typed (blank submits are silently dropped by the caller); Escape always cancels
 * regardless of what's been typed. */
function AddPropertyRow({
  isAdding,
  onStartAdd,
  onSubmit,
  onCancel,
}: {
  isAdding: boolean;
  onStartAdd: () => void;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  if (!isAdding) {
    return (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onStartAdd();
        }}
        // No horizontal margin of its own — both callers now provide their own container padding
        // directly (`CurrentEntityCard`'s `px-8`, `ExpandedEntity`'s `px-3`), matching whatever
        // inset `PropertyListRow`'s own pills sit at above it.
        className="mt-1 flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent"
      >
        <Plus className="size-3.5" /> Add property
      </button>
    );
  }
  return (
    <input
      key="new-property-input"
      autoFocus
      type="text"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onSubmit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit(e.currentTarget.value);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      placeholder="Property name…"
      className="mt-1 rounded-[10px] border border-dashed border-input bg-background px-3 py-2 text-[11px] outline-none focus:border-primary"
    />
  );
}

// Figma's own "type-icon" (node 426:30479 et al.) is a bare empty 16px square — a placeholder,
// not a real glyph — so this picks a real one per Property type instead of copying the empty box
// literally. Matched by loose substring on the (free-form) type string, not an exhaustive enum,
// since `Property.type` isn't a closed set; anything unrecognized falls back to the generic "Aa"
// type glyph rather than showing nothing.
function propertyTypeIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("bool")) return ToggleLeft;
  if (t.includes("date") || t.includes("time")) return Calendar;
  if (t.includes("enum")) return List;
  if (t.includes("uuid")) return Fingerprint;
  if (t.includes("int") || t.includes("decimal") || t.includes("numeric") || t.includes("float")) {
    return Hash;
  }
  return TypeIcon;
}

function PropertyListRow({
  property,
  entityId,
  hovered,
  onHoverChange,
  setRef,
  selected,
  onSelect,
  draggablePropertyIds,
  onStartMapDrag,
  onNavigateToMapping,
  offscreenDirection,
  onNavigateToOffscreen,
  dimmed,
}: {
  property: Entity["properties"][number];
  entityId: string;
  hovered?: boolean;
  onHoverChange?: (hovering: boolean) => void;
  setRef?: (el: HTMLElement | null) => void;
  selected?: boolean;
  onSelect: (mods: SelectMods) => void;
  draggablePropertyIds?: (entityId: string) => Set<string>;
  // Only wired for Current Entity's own properties (see `CurrentEntityCard`) — connected-entity
  // property rows don't map to a column, only the focus entity's own do, matching the existing
  // mapping ladder's own scope. Starts the pointer drag that lets this row's own handle be dropped
  // onto a Column row in Data Tables to (re)map it.
  onStartMapDrag?: ((propertyId: string, clientX: number, clientY: number) => void) | undefined;
  // Plain click (no modifier — see below) on a mapped row scrolls its own Column into view, same
  // scope as `onStartMapDrag` above.
  onNavigateToMapping?: ((propertyId: string) => void) | undefined;
  // Set when this row's mapped Column is scrolled out of view — hovering then shows a scroll
  // arrow, same interaction as `CompactTable`'s.
  offscreenDirection?: "up" | "down" | undefined;
  onNavigateToOffscreen?: () => void;
  dimmed?: boolean;
}) {
  const mapped = !!property.mapping;
  return (
    <div
      ref={setRef}
      data-connector-hover
      data-connector-property-id={property.id}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
        } else if (mapped) {
          onNavigateToMapping?.(property.id);
        }
      }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cn(
        // Pill shape (rounded-full, not the earlier rounded-sm card) sampled directly off the
        // Figma "Entity Triggered Editing" Selected Entity lane (node 424:19685) — same visual
        // family as the Related Entities/Relations/Data Tables pills this whole pass reskinned.
        // Selected/hovered-mapped tinting is unchanged (an existing, established app convention
        // this frame's sample data doesn't show either state for).
        "group/prop relative z-20 flex w-full max-w-[340px] items-center gap-2 rounded-full border border-[#e3e5e4] px-2 py-1.5 text-[12px] hover:!border-[#161919] hover:!bg-white",
        selected
          ? "bg-[#00ded8]/10 shadow-[0_0_0_1px_#00ded8]"
          : hovered && mapped
            ? "bg-white"
            : "bg-white",
        mapped && onNavigateToMapping && "cursor-pointer",
        "transition-opacity duration-150",
        dimmed && "opacity-40",
      )}
    >
      <span
        draggable
        onDragStart={(e) => {
          const ids = draggablePropertyIds?.(entityId);
          const propertyIds =
            ids && ids.has(property.id) && ids.size > 1 ? Array.from(ids) : [property.id];
          e.dataTransfer.setData(
            PROPERTY_MOVE_DND_TYPE,
            JSON.stringify({ sourceEntityId: entityId, propertyIds }),
          );
        }}
        className="cursor-grab text-[12px] text-black/25 active:cursor-grabbing"
      >
        ⠿
      </span>
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: reviewStatusDot(propertyStatus(property)) }}
      />
      {isIdentifierProperty(property) && (
        <span role="img" aria-label="Identifier">
          🔑
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] text-[#161919]">{property.name}</span>
      {(() => {
        const TypeGlyph = propertyTypeIcon(property.type);
        return <TypeGlyph className="size-4 shrink-0 text-[#535353]" aria-label={property.type} />;
      })()}
      {propertyStatus(property) === "suggested" && <PropertyConfidenceChip property={property} />}
      {hovered && offscreenDirection && (
        // `pl-1` bridges the gap to the pill so moving onto the arrow doesn't end the hover.
        <span className="absolute left-full top-1/2 flex -translate-y-1/2 pl-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onNavigateToOffscreen?.();
            }}
            className="flex size-6 items-center justify-center rounded-full border border-[#e3e5e4] bg-white text-[#535353] hover:border-[#161919]"
            aria-label={`Scroll to mapped column ${offscreenDirection}`}
          >
            {offscreenDirection === "up" ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
          </button>
        </span>
      )}
    </div>
  );
}

function CompactTable({
  table,
  entities,
  onOpen,
  rowRef,
  highlighted,
  onHoverChange,
  offscreenDirection,
  onNavigateToOffscreen,
  dimmed,
}: {
  table: TableSchema;
  entities: Entity[];
  onOpen: () => void;
  rowRef?: (el: HTMLElement | null) => void;
  // Cross-lane counterpart of `PropertyListRow`'s own `hoveredTableName` — true while this Table
  // is the current highlight target (hovering this row itself, or a Property mapped into it over
  // in Current Entity), per Figma node 407:6938's solid-bordered "(hover)table-01" row.
  highlighted?: boolean;
  onHoverChange?: (hovering: boolean) => void;
  offscreenDirection?: "up" | "down" | undefined;
  onNavigateToOffscreen?: () => void;
  dimmed?: boolean;
}) {
  return (
    <div
      data-connector-hover
      data-connector-table-name={table.name}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cn(
        "flex w-full max-w-[372px] items-center justify-center gap-1 transition-opacity duration-150",
        dimmed && "opacity-40",
      )}
    >
      <button
        ref={rowRef}
        data-connector-hover
        data-connector-table-name={table.name}
        type="button"
        onClick={onOpen}
        // Pill shape (rounded-full, not the earlier rounded-md/h-12 card) sampled directly off the
        // Figma "Entity Triggered Editing" Data Tables lane (node 424:20225) — same visual family as
        // the Related Entities/Relations/Selected-Entity-Properties pills this whole pass reskinned.
        className={cn(
          "relative z-20 flex h-10 w-full max-w-[340px] items-center gap-2.5 rounded-full border bg-white px-3 text-left hover:!border-[#161919] hover:!bg-white",
          highlighted ? "border-[#161919]" : "border-[#e3e5e4]",
        )}
      >
        <MappingStatusBadge
          status={tableMappingStatus(table.name, entities)}
          {...tableMappingCompleteness(table.name, entities)}
          size={20}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#161919]">
          {table.name}
        </span>
      </button>
      {offscreenDirection && highlighted && (
        <button
          type="button"
          data-connector-hover
          data-connector-table-name={table.name}
          onClick={(event) => {
            event.stopPropagation();
            onNavigateToOffscreen?.();
          }}
          className="relative z-20 flex size-8 shrink-0 items-center justify-center rounded-full border border-[#e3e5e4] bg-white text-[#535353] hover:border-[#161919]"
          aria-label={`Scroll to mapped Property ${offscreenDirection}`}
        >
          {offscreenDirection === "up" ? (
            <ArrowUp className="size-4" />
          ) : (
            <ArrowDown className="size-4" />
          )}
        </button>
      )}
    </div>
  );
}

function ExpandedTable({
  table,
  entities,
  onClose,
  onSetColumnRef,
  titleRef,
  cardRef,
  footerRef,
  onFooterClick,
  footerDirection,
  onColumnListScroll,
  columnOrderHint,
  columnMappings,
  sort,
  onSortChange,
  hasExplicitSort,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  dropTargetColumn,
  hoveredColumnKey,
  onColumnHoverChange,
  onNavigateToProperty,
  isColumnDimmed,
}: {
  table: TableSchema;
  entities: Entity[];
  onClose: () => void;
  onSetColumnRef?: (key: string, el: HTMLElement | null) => void;
  // The Column name a Property's drag-to-map handle is currently hovering over within THIS Table
  // (see `mapDropTarget` in `Idea4EntityMode`) — highlighted as the drop target while the drag is
  // live, `null`/undefined the rest of the time.
  dropTargetColumn?: string | null;
  // The `${table}.${column}` key of whichever Column row is currently hovered anywhere in Data
  // Tables — see `hoveredColumnKey` in `Idea4EntityMode`. Hovering a mapped Column now reveals its
  // ladder line the same way hovering its Property already does.
  hoveredColumnKey?: string | null;
  onColumnHoverChange?: (key: string, hovering: boolean) => void;
  // Clicking a mapped Column row scrolls its own Property into view in Current Entity — the
  // reverse direction of `PropertyListRow`'s own `onNavigateToMapping`.
  onNavigateToProperty?: (propertyId: string) => void;
  isColumnDimmed?: (columnKey: string) => boolean;
  titleRef?: (el: HTMLElement | null) => void;
  cardRef?: (el: HTMLElement | null) => void;
  footerRef?: (el: HTMLElement | null) => void;
  onFooterClick?: () => void;
  // Which way the redirected Column has actually scrolled — see `CurrentEntityCard`'s own
  // `footerDirection` doc comment for the full rationale; this is its mirror for the Column side.
  footerDirection?: "up" | "down" | null;
  // A native `scroll` event doesn't bubble, so the Data Tables lane's own onScroll (on its outer
  // body) never fires for scrolling THIS list — the Property<->Column ladder needs its own
  // listener here to recompute when a Column scrolls in or out of this Table's own capped view.
  onColumnListScroll?: () => void;
  // The mapped Columns' own names, in the SAME order as their corresponding Properties in
  // Current Entity — without this, a Property early in the (alphabetical) Properties list can map
  // to a Column far down this Table's own (schema-order) list, and the 1:1 ladder ends up as a
  // dense, crossing tangle instead of a roughly parallel one. Reordering just the MAPPED columns to
  // follow Property order (unmapped columns keep their original relative order, after) straightens
  // the ladder out without otherwise touching this Table's own column order.
  columnOrderHint?: (string | null)[] | undefined;
  // Column name -> whichever of Current Entity's own Properties maps into it, so a column backed
  // by a still-Suggested mapping can show its own Accept/Reject control (see below) — a Column
  // can't be dragged (it isn't moveable the way a Property is), so this replaces that slot instead
  // of sharing it.
  columnMappings?: Map<string, Property>;
  // Filter/Sort/Search for this Table's own Column list — see `ListControls`'s own doc comment.
  // `hasExplicitSort` distinguishes "never touched" from "explicitly set back to the default", the
  // same way `DetailView.tsx`'s own `hasExplicitColumnSort` does: only once the reviewer has
  // actually picked a Sort does it override the ladder-friendly `columnOrderHint` order above.
  sort?: SortState;
  onSortChange?: (key: SortKey) => void;
  hasExplicitSort?: boolean;
  filter?: ListFilter;
  onFilterChange?: (next: ListFilter) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
}) {
  const orderedColumns = useMemo(() => {
    let list = table.columns;
    if (!hasExplicitSort) {
      if (columnOrderHint && columnOrderHint.length > 0) {
        const mappedNames = new Set(columnOrderHint.filter((name): name is string => !!name));
        const byName = new Map(list.map((column) => [column.name, column]));
        const fillers = list.filter((column) => !mappedNames.has(column.name));
        const used = new Set<string>();
        const aligned = columnOrderHint.flatMap((name) => {
          const column = name ? byName.get(name) : fillers.shift();
          if (!column || used.has(column.name)) return [];
          used.add(column.name);
          return [column];
        });
        list = [...aligned, ...list.filter((column) => !used.has(column.name))];
      }
    } else if (sort) {
      list = sortByState(
        list,
        sort,
        (c) => c.name,
        (c) => columnMappings?.get(c.name)?.confidence,
      );
    }
    const confirmed = (c: TableSchema["columns"][number]) => {
      const property = columnMappings?.get(c.name);
      return !!property && hasConfirmedMapping(property);
    };
    if (filter === "mapped") list = list.filter(confirmed);
    else if (filter === "unmapped") list = list.filter((c) => !confirmed(c));
    else if (filter === "identifier") {
      list = list.filter((c) => {
        const property = columnMappings?.get(c.name);
        return !!property && isIdentifierProperty(property);
      });
    }
    const trimmedSearch = search?.trim().toLowerCase();
    if (trimmedSearch) {
      list = list.filter((c) => c.name.toLowerCase().includes(trimmedSearch));
    }
    return list;
  }, [table.columns, columnOrderHint, hasExplicitSort, sort, filter, search, columnMappings]);
  const [scrolledFromTop, setScrolledFromTop] = useState(false);
  return (
    <div
      ref={cardRef}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f3f3]"
    >
      <div
        ref={titleRef}
        className="relative z-20 flex h-8 shrink-0 items-center gap-2 border-b border-[#e3e5e4] bg-[#3c4140] px-4"
      >
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#6d7472] text-white hover:bg-[#555b59]"
          aria-label="Back to Data Tables"
        >
          <Undo2 className="size-4" />
        </button>
        <MappingStatusBadge
          status={tableMappingStatus(table.name, entities)}
          {...tableMappingCompleteness(table.name, entities)}
          size={16}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#fafafa]">
          {table.name}
        </span>
        <CountTooltip
          count={table.columns.length}
          singular="column"
          plural="columns"
          className="shrink-0 text-[14px] text-[#fafafa]"
        />
      </div>
      <ListControls
        filter={filter ?? "all"}
        onFilterChange={(next) => onFilterChange?.(next)}
        sort={sort ?? DEFAULT_SORT}
        onSortChange={(key) => onSortChange?.(key)}
        search={search ?? ""}
        onSearchChange={(value) => onSearchChange?.(value)}
        searchPlaceholder="Search columns…"
      />
      <div
        onScroll={(event) => {
          setScrolledFromTop(event.currentTarget.scrollTop > 1);
          onColumnListScroll?.();
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[72px] pt-8"
      >
        <div className="flex w-full min-h-full flex-col items-center justify-center-safe gap-3 px-8">
          {orderedColumns.map((column) => {
            const key = `${table.name}.${column.name}`;
            const mappedProperty = columnMappings?.get(column.name);
            const isSuggested =
              !!mappedProperty?.mapping && mappingStatus(mappedProperty.mapping) === "suggested";
            const mappedOwner = mappedProperty
              ? entities.find((entity) => entity.properties.some((p) => p.id === mappedProperty.id))
              : undefined;
            const TypeGlyph = propertyTypeIcon(column.type);
            return (
              <div
                key={column.name}
                ref={(element) => onSetColumnRef?.(key, element)}
                data-connector-hover
                data-connector-column-key={key}
                onMouseEnter={() => onColumnHoverChange?.(key, true)}
                onMouseLeave={() => onColumnHoverChange?.(key, false)}
                onClick={() => mappedProperty && onNavigateToProperty?.(mappedProperty.id)}
                className={cn(
                  "relative z-20 flex w-full max-w-[340px] items-center gap-2 rounded-full border border-[#e3e5e4] bg-white py-1.5 pl-3 pr-2 text-[12px] hover:border-[#161919]",
                  dropTargetColumn === column.name &&
                    "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8]",
                  mappedProperty && onNavigateToProperty && "cursor-pointer",
                  "transition-opacity duration-150",
                  isColumnDimmed?.(key) && "opacity-40",
                )}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      COLUMN_DOT_COLOR[
                        !mappedProperty ? "unmapped" : isSuggested ? "suggested" : "mapped"
                      ],
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-[#161919]">{column.name}</span>
                <TypeGlyph className="size-4 shrink-0 text-[#535353]" aria-label={column.type} />
                {isSuggested && mappedOwner && mappedProperty && (
                  <MappingConfidenceChip entity={mappedOwner} property={mappedProperty} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <button ref={footerRef} type="button" onClick={onFooterClick} className="sr-only">
        {footerDirection === "up" ? "Previous" : "Next"} mapped column
      </button>
      {scrolledFromTop && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[68px] z-20 h-[72px]"
          style={{
            background: "linear-gradient(to bottom, #f3f3f3 0%, #f3f3f3 50%, #f3f3f300 100%)",
          }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px]"
        style={{ background: "linear-gradient(to bottom, #f3f3f300, #f3f3f3 50%)" }}
      />
    </div>
  );
}

/** Sort + Search row shared by the Entity types / Data tables side panels — same search-toggle
 * behavior as `ListControls` (Escape or X clears and closes), restyled to the panels' own 32px
 * Figma row. */
function SidePanelListControls({
  sort,
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder,
}: {
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = () => {
    onSearchChange("");
    setSearchOpen(false);
  };
  return (
    <div className="relative z-50 flex h-8 shrink-0 items-center gap-2 border-b border-[#e3e5e4] pl-2.5 pr-3 text-[12px] text-[#6d7472]">
      {searchOpen ? (
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeSearch();
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-[12px] text-[#161919] outline-none placeholder:text-[#9ea3a2]"
        />
      ) : (
        <SortDropdown sort={sort} onChange={onSortChange} showPrefix={false} />
      )}
      <button
        type="button"
        onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        aria-label={searchOpen ? "Close search" : "Search"}
        className="ml-auto flex size-6 shrink-0 items-center justify-center rounded hover:bg-black/[0.04] hover:text-[#161919]"
      >
        {searchOpen ? <X className="size-4" /> : <Search className="size-4" />}
      </button>
    </div>
  );
}

function SidePanelEmpty({ query }: { query: string }) {
  return (
    <p className="px-4 py-3 text-[12px] text-[#6d7472]">
      {query ? `No matches for “${query}”` : "Nothing here yet"}
    </p>
  );
}

/** A side panel's collapsed state — same 44px strip + vertical label as Overview's own collapsed
 * Data tables panel, so collapsing reads the same in both views. */
function CollapsedSidePanel({
  side,
  label,
  onExpand,
}: {
  side: "left" | "right";
  label: string;
  onExpand: () => void;
}) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <aside
      className={cn(
        "flex w-11 shrink-0 flex-col items-center overflow-hidden border-[#e3e5e4] bg-white",
        side === "left" ? "border-r" : "border-l",
      )}
    >
      <div className="flex h-12 w-full shrink-0 items-center justify-center border-b border-[#e3e5e4]">
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Expand ${label} panel`}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-black/[0.04]"
        >
          <Icon className="size-5" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <span className="text-[11px] font-medium text-muted-foreground [writing-mode:vertical-rl]">
          {label}
        </span>
      </div>
    </aside>
  );
}

/** A side-panel row's count, with a "N properties"/"N columns" tooltip saying what it counts. */
function CountTooltip({
  count,
  singular,
  plural,
  className,
}: {
  count: number;
  singular: string;
  plural: string;
  className: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-default", className)}>{count}</span>
      </TooltipTrigger>
      <TooltipContent>
        {count} {count === 1 ? singular : plural}
      </TooltipContent>
    </Tooltip>
  );
}

function Idea4EntityPanel({
  app,
  focusEntityId,
  workingIds,
}: {
  app: OntologyApp;
  focusEntityId?: string;
  workingIds: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const rows = useMemo(
    () =>
      sortByState(
        app.entities.filter((entity) => entity.name.toLowerCase().includes(query.toLowerCase())),
        sort,
        (entity) => entity.name,
        (entity) => entity.confidence,
      ),
    [app.entities, query, sort],
  );
  if (!open) {
    return <CollapsedSidePanel side="left" label="Entity types" onExpand={() => setOpen(true)} />;
  }
  return (
    // Rebuilt directly off the Figma "Panel-Entity types" node (406:5388, fetched in full — not
    // just its screenshot) — see the per-element comments below for what each value is sampled
    // from.
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-[#e3e5e4] bg-white">
      {/* Title, 48px — collapse glyph is lucide's `PanelLeftClose`, the closest existing icon to
          Figma's own "IconSidebarWideLeftArrow" asset. */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e3e5e4] pl-4 pr-3">
        <span className="text-[14px] font-medium leading-none text-[#161919]">Entity types</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse Entity types panel"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-black/[0.04]"
        >
          <PanelLeftClose className="size-5" />
        </button>
      </div>
      <SidePanelListControls
        sort={sort}
        onSortChange={(key) => setSort((prev) => nextSortState(prev, key))}
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search entity types…"
      />
      {rows.length === 0 && <SidePanelEmpty query={query} />}
      {/* Row list — rebuilt off Figma "Entity Triggered Editing" (node 424:20251), which shows
          THREE distinct row states, each a genuinely different shape rather than one shared
          accent toggling color: the true focus/current entity gets a RIGHT-edge 3px `#00ded8`
          border + `#ecf3f2` bg (node 424:20761); any OTHER entity currently working in the
          workspace gets a LEFT-edge 3px `#6d7472` border with no bg tint (node 424:20796 — the
          opposite side from focus, not a mistake: it's a deliberately secondary indicator, never
          confusable with the primary one); everything else is plain white with no border at all
          (node 424:23924). Each row is a single 28px-tall line — no secondary "N props · M table"
          line, matching that frame's own row height exactly. 2px gap between rows, no dividers. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {rows.map((entity) => {
          const isFocus = entity.id === focusEntityId;
          const isRelated = !isFocus && workingIds.has(entity.id);
          return (
            <button
              key={entity.id}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ENTITY_PANEL_DND_TYPE, entity.id);
              }}
              onClick={() => app.openDetail("entity", entity.id)}
              className={cn(
                "flex w-full items-center gap-2 py-1 text-left",
                isFocus
                  ? "border-l-[3px] border-[#00ded8] bg-[#ecf3f2] pl-[13px] pr-3"
                  : isRelated
                    ? "border-l-[3px] border-[#6d7472] bg-white pl-[13px] pr-3 hover:bg-[#e3e5e4]"
                    : "bg-white pl-4 pr-3 hover:bg-[#e3e5e4]",
              )}
            >
              <span
                className="shrink-0 text-[12px] leading-none text-[#9EA3A2] active:cursor-grabbing"
                style={{ cursor: "grab" }}
              >
                ⠿
              </span>
              <StatusBadge
                status={entityDisplayStatus(entity)}
                size={16}
                confidence={entity.confidence}
                warningReason={entity.warningReason}
                errorReason={entityErrorReason(entity)}
              />
              <span className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
                <span className="min-w-0 flex-1 truncate text-[14px] font-normal text-[#161919]">
                  {entity.name}
                </span>
                <CountTooltip
                  count={entity.properties.length}
                  singular="property"
                  plural="properties"
                  className="shrink-0 text-[14px] text-[#6d7472]"
                />
              </span>
              {entityDisplayStatus(entity) === "suggested" && (
                <EntityConfidenceChip entity={entity} />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function Idea4TablePanel({
  app,
  activeNames,
  focusName,
}: {
  app: OntologyApp;
  activeNames: Set<string>;
  // The table this workspace is open on — same focus treatment as `Idea4EntityPanel`'s own focus
  // row (teal left bar + tint), distinct from the gray bar for tables merely on canvas.
  focusName?: string;
}) {
  // Rebuilt directly off the Figma "Panel-Data tables" node (417:13975) — the same reskin pass
  // `Idea4EntityPanel` above already got off its own "Panel-Entity types" node, just mirrored:
  // this panel sits on the workspace's right edge (`border-l`, not `border-r`), so its collapse
  // glyph is lucide's `PanelRightClose` (the mirror of that panel's `PanelLeftClose`) rather than
  // the same icon reused verbatim.
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  // Tables have no confidence of their own — "Confidence" sorts by the strongest mapping into
  // each table, the same proxy Overview's own Data tables panel sorts by.
  const rows = useMemo(
    () =>
      sortByState(
        app.tables.filter((table) => table.name.toLowerCase().includes(query.toLowerCase())),
        sort,
        (table) => table.name,
        (table) => tableHighestMappingConfidence(table.name, app.entities),
      ),
    [app.tables, app.entities, query, sort],
  );
  if (!open) {
    return <CollapsedSidePanel side="right" label="Data tables" onExpand={() => setOpen(true)} />;
  }
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-l border-[#e3e5e4] bg-white">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e3e5e4] pl-4 pr-3">
        <span className="text-[14px] font-medium leading-none text-[#161919]">Data tables</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse Data tables panel"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-black/[0.04]"
        >
          <PanelRightClose className="size-5" />
        </button>
      </div>
      <SidePanelListControls
        sort={sort}
        onSortChange={(key) => setSort((prev) => nextSortState(prev, key))}
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search data tables…"
      />
      {rows.length === 0 && <SidePanelEmpty query={query} />}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {rows.map((table) => {
          // A related/on-canvas table gets the same left-border-only indicator (no bg tint) as
          // every other "related but not focused" row in this file (re-checked against Figma node
          // 424:20441 — most rows in that panel's own mock data carry this exact `border-l-3
          // #6d7472`, not a background tint); `pl-[13px]` (16px minus the 3px border) keeps the
          // name text flush with the non-bordered rows instead of visibly shifting right.
          const isFocus = table.name === focusName;
          const isRelated = !isFocus && activeNames.has(table.name);
          return (
            <button
              key={table.name}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TABLE_PANEL_DND_TYPE, table.name);
              }}
              onClick={() => app.openDetail("table", table.name)}
              className={cn(
                "flex w-full items-center gap-2 py-1 pr-3 text-left",
                isFocus
                  ? "border-l-3 border-[#00ded8] bg-[#ecf3f2] pl-[13px]"
                  : isRelated
                    ? "border-l-3 border-[#6d7472] bg-white pl-[13px] hover:bg-[#e3e5e4]"
                    : "bg-white pl-4 hover:bg-[#e3e5e4]",
              )}
            >
              <span className="text-[#9EA3A2] active:cursor-grabbing" style={{ cursor: "grab" }}>
                ⠿
              </span>
              <MappingStatusBadge
                status={tableMappingStatus(table.name, app.entities)}
                {...tableMappingCompleteness(table.name, app.entities)}
                size={16}
              />
              {/* Single line (re-checked — this panel's own row no longer shows a second "N
                  columns" line, just the bare column count at 14px on the same row as the name). */}
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] leading-5 text-[#161919]">
                  {table.name}
                </span>
                <CountTooltip
                  count={table.columns.length}
                  singular="column"
                  plural="columns"
                  className="shrink-0 text-[14px] leading-5 text-[#6d7472]"
                />
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// Small 6px review-status dot — used for a Property row (see `propertyStatus` below) and for a
// Relation row in the Relations lane (see `RelationCard`/`RelationStatusIcon`), which Figma shows
// styled as the exact same plain dot rather than the prototype's original circle+glyph badge.
// Suggested/Confirmed sampled directly off Figma (`--purple/600` #9333ea from the Category card's
// own property rows, node 407:5561; `--cyan/700` #0e7490 from the Relations lane, node 406:4970 —
// also matches `StatusBadge`'s own Confirmed icon color). Warning/Error aren't shown as a dot
// anywhere in this design, so they're left as this app's existing StatusBadge-family colors.
function reviewStatusDot(status: ReviewStatus) {
  if (status === "confirmed") return "#0e7490";
  if (status === "warning") return "#e6c200";
  if (status === "error") return "#f15b15";
  return "#9333ea";
}
