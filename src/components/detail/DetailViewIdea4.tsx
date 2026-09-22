import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  Link2,
  Plus,
  Redo2,
  Search,
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
  tableMappingCompleteness,
  tableMappingStatus,
  tablesUsedByEntity,
  type Entity,
  type Property,
  type Relation,
  type TableSchema,
} from "@/lib/mock-data";
import { StatusBadge } from "@/components/ontology/StatusBadge";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import { AiReviewBar } from "@/components/ontology/AiReviewBar";
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
import { EntitiesIcon, TablesIcon } from "@/components/nav/nav-icons";
import { orthogonalPath, rightToLeftAnchors, type Rect } from "@/lib/geometry";
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
/** Expanded items float to the top of their lane, collapsed ones stack below — so whichever card
 * is currently open stays easy to find without hunting through the rest of the list. */
function orderByExpanded<T>(items: T[], isExpanded: (item: T) => boolean): T[] {
  const expanded = items.filter(isExpanded);
  const collapsed = items.filter((item) => !isExpanded(item));
  return [...expanded, ...collapsed];
}

// The one Filter control every Property/Column list in this workspace shares — "All" (no-op),
// "Mapped"/"Unmapped" (has vs. lacks a Property<->Column mapping at all, regardless of its own
// Suggested/Mapped review state), and "Only Identifier" (isIdentifierProperty). A single enum
// rather than 3 separate booleans since exactly one of them applies at a time.
type ListFilter = "all" | "mapped" | "unmapped" | "identifier";
const LIST_FILTER_LABEL: Record<ListFilter, string> = {
  all: "Filter",
  mapped: "Mapped",
  unmapped: "Unmapped",
  identifier: "Only Identifier",
};

// A Property<->Column mapping line's own color: purple while it's still a Suggested mapping
// (nobody has reviewed it yet — same purple as the "Suggested" review status elsewhere), fading to
// this plain default gray once it's Mapped/confirmed — a mapping that's already settled shouldn't
// keep drawing the eye the way an outstanding suggestion should.
const MAPPING_SUGGESTED_COLOR = "#7c5eff";
const MAPPING_DEFAULT_COLOR = "#a1a1aa";

// A Column row's own status dot — same 3 states as the mapping line above, just as a small dot
// instead of a connector: unmapped columns get a hollow neutral dot (nothing to say about them
// yet), a confirmed/settled mapping gets the same plain gray as its line, and only a still-
// Suggested mapping gets purple. Previously every Column row's dot was hardcoded to this same
// purple regardless of its actual state, which read as "every column has an outstanding
// suggestion" even for an Unmapped-filtered list — purple is reserved for Suggested everywhere
// else in the app (see `propertyDot` below), so this brings the Column dot in line with that.
type ColumnMapState = "unmapped" | "mapped" | "suggested";
const COLUMN_DOT_COLOR: Record<ColumnMapState, string> = {
  unmapped: "#d4d4d8",
  mapped: MAPPING_DEFAULT_COLOR,
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
    <div className="flex items-center gap-1 rounded-[6px] border border-node-border bg-node p-[3px] shadow-[var(--shadow-node)]">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-accent",
          !canUndo && "pointer-events-none opacity-30",
        )}
      >
        <Undo2 className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-accent",
          !canRedo && "pointer-events-none opacity-30",
        )}
      >
        <Redo2 className="size-3.5" />
      </button>
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
    return app.entities.filter((entity) => ids.has(entity.id));
  }, [app.entities, app.relations, focusEntity]);

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
      if (filter === "mapped") list = list.filter((p) => !!p.mapping);
      else if (filter === "unmapped") list = list.filter((p) => !p.mapping);
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
    return focusEntity.properties
      .filter((p) => p.mapping?.table === tableName)
      .map((p) => p.mapping!.column);
  }, [focusEntity, expandedContext]);

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
      if (!focusEntity || !id || id === focusEntity.id) return;
      e.preventDefault();
      // Already a real Connected Entity — dropping it again would only create a redundant second
      // Relation between the same pair.
      if (relatedEntities.some((entity) => entity.id === id)) return;
      app.createPlaceholderRelation(focusEntity.id, id);
    },
    [app, focusEntity, relatedEntities],
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
    ],
    [selectedEntities, selectedProperties],
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
    ],
    [selectedEntities, selectedProperties],
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
    ],
    [selectedEntities, selectedProperties],
  );
  const handleDeleteSelection = useCallback(() => {
    const entityIds = selectedEntities.filter((e) => e.status === "confirmed").map((e) => e.id);
    const propertyItems = selectedProperties
      .filter(({ property }) => property.status === "confirmed")
      .map(({ entity, property }) => ({ entityId: entity.id, propertyId: property.id }));
    if (entityIds.length > 0) app.deleteEntities(entityIds);
    if (propertyItems.length > 0) app.deleteProperties(propertyItems);
    app.clearSuggestionSelection();
  }, [selectedEntities, selectedProperties, app]);
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
  const [relationLines, setRelationLines] = useState<{ id: string; path: string }[]>([]);
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  // The Column-side mirror of `hoveredPropertyId` — keyed `${table}.${column}` (same key shape as
  // `columnRefs`) since a Column, unlike a Property, has no ID of its own. Hovering EITHER end of
  // a mapping now reveals its line, not just the Property side.
  const [hoveredColumnKey, setHoveredColumnKey] = useState<string | null>(null);
  const [mappingLines, setMappingLines] = useState<
    { id: string; path: string; suggested: boolean }[]
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
    const title = currentTitleRef.current;
    const connectedBody = connectedBodyRef.current;
    const relationsBody = relationsBodyRef.current;
    if (!container || !title || !connectedBody || !relationsBody || !focusEntity) {
      setRelationLines([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    const titleRect = rectOf(title);
    const next: { id: string; path: string }[] = [];
    // No line at all until a Connected Entity is actually expanded — with every Relation drawn at
    // once (the old default), the shared trunk reads as visual noise rather than pointing at
    // anything in particular. Expanding one (by clicking its own card, or its own Relations-lane
    // pill) is what makes its one relation worth drawing.
    const visibleFocusRelations =
      expandedContext?.kind === "entity"
        ? focusRelations.filter(({ counterpart }) => counterpart.id === expandedContext.id)
        : [];
    visibleFocusRelations.forEach(({ relation, counterpart }) => {
      const row = entityTitleRefs.current.get(counterpart.id);
      const pill = relationCardRefs.current.get(relation.id);
      if (!row || !pill) return;
      if (!withinViewport(row, connectedBody) || !withinViewport(pill, relationsBody)) return;
      // Always the row's own RIGHT edge -> the pill's own LEFT edge, and the pill's own RIGHT
      // edge -> the title's own LEFT edge — never the adaptive top/bottom anchoring
      // `edgeAnchorsForRects` falls back to for a row far above/below its target, which made a
      // line look like it emerged from underneath its row instead of its side.
      const rowRect = rectOf(row);
      const pillRect = rectOf(pill);
      const toPill = rightToLeftAnchors(rowRect, pillRect, 6);
      const fromPill = rightToLeftAnchors(pillRect, titleRect, 6);
      // Two angular elbows (one rounded 90-degree bend at a shared X, not a smooth curve) joined
      // into one path — the connector now visibly threads straight through the Relations lane's
      // own pill instead of just floating near it, same "parallel connections share a bend" case
      // `orthogonalPath` documents itself for.
      const path = [
        orthogonalPath(toPill.p1, toPill.p2, 10, "horizontal"),
        orthogonalPath(fromPill.p1, fromPill.p2, 10, "horizontal"),
      ].join(" ");
      next.push({ id: relation.id, path });
    });
    setRelationLines(next);
  }, [focusRelations, focusEntity, expandedContext]);

  useEffect(() => {
    recomputeRelationLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRelations, mappedTables, expandedContext]);

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
    const next: { id: string; path: string; suggested: boolean }[] = [];
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
      // The footer arrows above still scan every mapped Property regardless of hover — they're a
      // "there's more, come look" prompt, not a per-item highlight — but the line itself only
      // draws for whichever one Property OR Column end of it is actually hovered right now.
      if (prop.id !== hoveredPropertyId && mappingKey !== hoveredColumnKey) return;
      // Same off-screen redirect as the Column side above, just mirrored: a Property that's
      // scrolled outside Current Entity's own visible list redirects to Current Entity's own
      // "More props" footer instead of vanishing — see that footer's own doc comment.
      const source = propVisible ? propEl! : currentFooterRef.current;
      if (!source) return;
      const target = colVisible ? colEl! : footer;
      if (!target) return;
      const { p1, p2 } = rightToLeftAnchors(rectOf(source), rectOf(target), 6);
      next.push({
        id: prop.id,
        path: orthogonalPath(p1, p2, 10, "horizontal"),
        suggested: mappingStatus(prop.mapping) === "suggested",
      });
    });
    setMappingLines(next);
    setMorePropsDirection(morePropsDir);
    setMappedColumnsDirection(mappedColumnsDir);
  }, [focusEntity, expandedContext, hoveredPropertyId, hoveredColumnKey]);

  useEffect(() => {
    recomputeMappingLines();
    // `recomputeMappingLines` itself already depends on `focusEntity` (and so picks up a fresh
    // mapping status right after Accept/Reject), so including it here — rather than re-listing
    // `focusEntity` a second time — is what actually makes that recompute fire on that change.
  }, [hoveredPropertyId, hoveredColumnKey, expandedContext, recomputeMappingLines]);

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

  // rAF-throttled scroll handling shared by both remaining connector systems — either lane
  // scrolling can move a row/property/column in or out of view.
  const scrollRaf = useRef<number | null>(null);
  const onAnyLaneScroll = useCallback(() => {
    if (scrollRaf.current != null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      recomputeRelationLines();
      recomputeMappingLines();
    });
  }, [recomputeRelationLines, recomputeMappingLines]);

  if (!focusEntity) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an Entity Type with mapped data to open Idea 4.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <Idea4EntityPanel
        app={app}
        focusEntityId={focusEntity.id}
        workingIds={new Set(relatedEntities.map((entity) => entity.id))}
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-black/[0.08] px-3">
          <button
            type="button"
            onClick={app.closeDetail}
            className="flex items-center gap-1 text-[12px] font-medium text-[#1c1c18] hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Back to Ontology
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
          className="relative grid min-h-0 flex-1 grid-cols-[1fr_0.55fr_1fr_1fr] gap-[3px] overflow-hidden"
        >
          <Idea4Surface
            label="Connected Entities"
            count={relatedEntities.length}
            bodyRef={connectedBodyRef}
            onBodyScroll={onAnyLaneScroll}
          >
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(ENTITY_PANEL_DND_TYPE)) e.preventDefault();
              }}
              onDrop={handleEntityPanelDrop}
              className="mx-auto flex w-full max-w-[360px] flex-col gap-2 py-4 transition-[width] duration-300"
            >
              {expandedConnectedEntity ? (
                <>
                  <ExpandedEntity
                    key={expandedConnectedEntity.id}
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
                  />
                  {relatedEntities.length > 1 && (
                    <CollapsedCardsStack
                      count={relatedEntities.length - 1}
                      noun="Entity Type"
                      nounPlural="Entity Types"
                      laneLabel="Connected Entities"
                      onOpen={() => setExpandedContext(null)}
                    />
                  )}
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
                      compact={expandedContext?.kind === "table"}
                      selected={suggestionSelection.has(
                        suggestionKey({ kind: "entity", id: entity.id }),
                      )}
                      onOpen={() => setExpandedContext({ kind: "entity", id: entity.id })}
                      onSelect={(mods) => selectOnClick({ kind: "entity", id: entity.id }, mods)}
                      onDropProperties={(e) => movePropertiesOnDrop(e, entity.id)}
                      rowRef={titleRef}
                    />
                  );
                })
              )}
              <button
                type="button"
                onClick={() => setCreatingEntity(true)}
                className="mt-1 flex h-12 items-center gap-1 rounded-xl bg-black/[0.04] px-4 text-[12px] text-muted-foreground hover:bg-black/[0.07]"
              >
                <span className="text-base">＋</span> Create Entity
              </button>
            </div>
          </Idea4Surface>

          <Idea4Surface
            label="Relations"
            count={focusRelations.length}
            bodyRef={relationsBodyRef}
            onBodyScroll={onAnyLaneScroll}
          >
            <div className="mx-auto flex w-full max-w-[300px] flex-col gap-2 py-4">
              {focusRelations.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                  No Relations touch this Entity Type yet.
                </p>
              )}
              {focusRelations.map(({ relation, counterpart, outgoing }) => (
                <RelationCard
                  key={relation.id}
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
                    app.acceptSuggestions([suggestionKey({ kind: "relation", id: relation.id })])
                  }
                  onReject={() =>
                    app.declineSuggestions([suggestionKey({ kind: "relation", id: relation.id })])
                  }
                  cardRef={(el) => {
                    if (el) relationCardRefs.current.set(relation.id, el);
                    else relationCardRefs.current.delete(relation.id);
                  }}
                />
              ))}
            </div>
          </Idea4Surface>

          <Idea4Surface
            label="Current Entity"
            active
            bodyRef={currentBodyRef}
            onBodyScroll={onAnyLaneScroll}
          >
            <CurrentEntityCard
              entity={focusEntity}
              visibleProperties={visiblePropertiesFor(focusEntity)}
              titleRef={currentTitleRef}
              hoveredPropertyId={hoveredPropertyId}
              onPropertyHoverChange={(id, hovering) =>
                setHoveredPropertyId((cur) => {
                  if (hovering) return id;
                  return cur === id ? null : cur;
                })
              }
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
          </Idea4Surface>

          <Idea4Surface
            label="Data Tables"
            count={mappedTables.length}
            bodyRef={dataBodyRef}
            onBodyScroll={onAnyLaneScroll}
          >
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(TABLE_PANEL_DND_TYPE)) e.preventDefault();
              }}
              onDrop={handleTablePanelDrop}
              className="mx-auto flex w-full max-w-[360px] flex-col gap-2 py-4 transition-[width] duration-300"
            >
              {expandedMappedTable ? (
                <>
                  <ExpandedTable
                    key={expandedMappedTable.name}
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
                    onAcceptMapping={(propertyId) => app.confirmMapping(focusEntity.id, propertyId)}
                    onRejectMapping={(propertyId) =>
                      app.updateMapping(focusEntity.id, propertyId, null)
                    }
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
                  {mappedTables.length > 1 && (
                    <CollapsedCardsStack
                      count={mappedTables.length - 1}
                      noun="Data Table"
                      nounPlural="Data Tables"
                      laneLabel="Data Tables"
                      onOpen={() => setExpandedContext(null)}
                    />
                  )}
                </>
              ) : (
                mappedTables.map((table) => (
                  <CompactTable
                    key={table.name}
                    table={table}
                    entities={app.entities}
                    onOpen={() => setExpandedContext({ kind: "table", name: table.name })}
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
              redirects to its "Mapped columns" footer instead of pointing at nothing. There's no
              Entity<->Table connector — which Tables an Entity uses is already legible from the
              Data Tables lane's own contents, without needing its own line. */}
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
            {relationLines.map((line) => (
              <path
                key={`rel-${line.id}`}
                d={line.path}
                fill="none"
                stroke="#7c5eff"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.6}
              />
            ))}
            {mappingLines.map((line) => (
              <path
                key={`map-${line.id}`}
                d={line.path}
                fill="none"
                stroke={line.suggested ? MAPPING_SUGGESTED_COLOR : MAPPING_DEFAULT_COLOR}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.6}
              />
            ))}
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
                relations={[]}
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
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  const usingEntities = useMemo(
    () => entitiesUsingTable(table.name, app.entities),
    [table.name, app.entities],
  );

  // A much smaller mirror of `Idea4EntityMode`'s own Filter/Sort/Search state — this mode never
  // has more than one Entity expanded at once, so one plain (non-keyed) slot per control is
  // enough; Merge/Split/the ladder are still intentionally not wired up here (see this file's own
  // doc comment above), so this stays scoped to just the one expanded Property list.
  const [propertySort, setPropertySort] = useState<SortState>(DEFAULT_SORT);
  const [propertySortTouched, setPropertySortTouched] = useState(false);
  const [propertyFilter, setPropertyFilter] = useState<ListFilter>("all");
  const [propertySearch, setPropertySearch] = useState("");
  // Only one Entity is ever expanded at once here, so a plain boolean (not keyed by entity id like
  // `Idea4EntityMode`'s own `addingPropertyEntityId`) suffices for "Add property" too.
  const [addingProperty, setAddingProperty] = useState(false);
  const handleCreateProperty = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed && expandedEntityId) app.createProperty(expandedEntityId, trimmed);
      setAddingProperty(false);
    },
    [app, expandedEntityId],
  );
  const visibleProperties = useMemo(() => {
    const entity = usingEntities.find((e) => e.id === expandedEntityId);
    if (!entity) return [];
    let list = entity.properties;
    if (propertyFilter === "mapped") list = list.filter((p) => !!p.mapping);
    else if (propertyFilter === "unmapped") list = list.filter((p) => !p.mapping);
    else if (propertyFilter === "identifier") list = list.filter((p) => isIdentifierProperty(p));
    const search = propertySearch.trim().toLowerCase();
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search));
    if (propertySortTouched)
      list = sortByState(
        list,
        propertySort,
        (p) => p.name,
        (p) => p.confidence,
      );
    return list;
  }, [
    usingEntities,
    expandedEntityId,
    propertyFilter,
    propertySearch,
    propertySortTouched,
    propertySort,
  ]);
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
  // Same "does ANY Entity's mapping into this Column still say Suggested" aggregation as
  // `mappedColumnNames` above, so `CurrentDataTableCard`'s own dot can tell a still-pending
  // mapping apart from an already-settled one — see `COLUMN_DOT_COLOR`'s own doc comment.
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
  const [columnSort, setColumnSort] = useState<SortState>(DEFAULT_SORT);
  const [columnSortTouched, setColumnSortTouched] = useState(false);
  const [columnFilter, setColumnFilter] = useState<ListFilter>("all");
  const [columnSearch, setColumnSearch] = useState("");
  const visibleTableColumns = useMemo(() => {
    let list = table.columns;
    if (columnFilter === "mapped") list = list.filter((c) => mappedColumnNames.has(c.name));
    else if (columnFilter === "unmapped") {
      list = list.filter((c) => !mappedColumnNames.has(c.name));
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
    mappedColumnNames,
    identifierColumnNames,
    columnSearch,
    columnSortTouched,
    columnSort,
  ]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <Idea4EntityPanel app={app} workingIds={new Set(usingEntities.map((e) => e.id))} />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-black/[0.08] px-3">
          <button
            type="button"
            onClick={app.closeDetail}
            className="flex items-center gap-1 text-[12px] font-medium text-[#1c1c18] hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Back to Ontology
          </button>
          <UndoRedoPill
            onUndo={app.undo}
            onRedo={app.redo}
            canUndo={app.canUndo}
            canRedo={app.canRedo}
          />
        </div>

        <div className="relative grid min-h-0 flex-1 grid-cols-3 gap-[3px] overflow-hidden">
          <Idea4Surface label="Connected Entities" count={usingEntities.length}>
            <div className="mx-auto flex w-full max-w-[360px] flex-col gap-2 py-4">
              {orderByExpanded(usingEntities, (e) => e.id === expandedEntityId).map((entity) =>
                expandedEntityId === entity.id ? (
                  <ExpandedEntity
                    key={entity.id}
                    entity={entity}
                    visibleProperties={visibleProperties}
                    onClose={() => setExpandedEntityId(null)}
                    onSelect={() => {}}
                    onDropProperties={() => {}}
                    suggestionSelection={app.suggestionSelection}
                    onSelectProperty={() => {}}
                    selectedPropertyIdsFor={() => new Set()}
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
                    onSubmitAddProperty={handleCreateProperty}
                    onCancelAddProperty={() => setAddingProperty(false)}
                  />
                ) : (
                  <CompactEntity
                    key={entity.id}
                    entity={entity}
                    onOpen={() => setExpandedEntityId(entity.id)}
                    onSelect={() => {}}
                    onDropProperties={() => {}}
                  />
                ),
              )}
            </div>
          </Idea4Surface>

          <Idea4Surface label="Current Entity" count={usingEntities.length}>
            <div className="mx-auto flex w-full max-w-[360px] flex-col gap-1.5 py-4">
              {usingEntities.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                  No Entity Types map into this table yet.
                </p>
              )}
              {usingEntities.map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() => app.openDetail("entity", entity.id)}
                  className="flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#7c5eff]/40"
                  title="Open this Entity Type as the Focus"
                >
                  <StatusBadge
                    status={entityDisplayStatus(entity)}
                    size={16}
                    confidence={entity.confidence}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
                    {entity.name}
                  </span>
                </button>
              ))}
            </div>
          </Idea4Surface>

          <Idea4Surface label="Current Data Table" active>
            <CurrentDataTableCard
              table={table}
              entities={app.entities}
              visibleColumns={visibleTableColumns}
              mappedColumnNames={mappedColumnNames}
              suggestedColumnNames={suggestedColumnNames}
              sort={columnSort}
              onSortChange={(key) => {
                setColumnSort((prev) => nextSortState(prev, key));
                setColumnSortTouched(true);
              }}
              filter={columnFilter}
              onFilterChange={setColumnFilter}
              search={columnSearch}
              onSearchChange={setColumnSearch}
            />
          </Idea4Surface>
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
            />
          </div>
        </div>
      </main>

      <Idea4TablePanel app={app} activeNames={new Set([table.name])} />
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
  sort,
  onSortChange,
  filter,
  onFilterChange,
  search,
  onSearchChange,
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
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  filter: ListFilter;
  onFilterChange: (next: ListFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="mx-auto mt-4 flex h-[calc(100%-16px)] w-full max-w-[360px] flex-col overflow-hidden rounded-[14px] border border-[#7c5eff] bg-white shadow-[0_4px_14px_rgba(46,35,110,0.12)]">
      <button
        ref={titleRef}
        type="button"
        className="flex h-[62px] shrink-0 items-center gap-3 bg-[#f1edff] px-3 text-left"
      >
        <MappingStatusBadge
          status={tableMappingStatus(table.name, entities)}
          {...tableMappingCompleteness(table.name, entities)}
          size={24}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{table.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{table.columns.length} columns</p>
        </div>
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5">
        {visibleColumns.map((column) => (
          <div
            key={column.name}
            className="flex h-[30px] items-center gap-2 px-3 text-[11px] hover:bg-black/[0.035]"
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
            <span className="min-w-0 flex-1 truncate font-medium">{column.name}</span>
            <span className="max-w-12 truncate font-mono text-[10px] text-muted-foreground">
              {column.type}
            </span>
          </div>
        ))}
      </div>
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
function RelationStatusIcon({ relation, entities }: { relation: Relation; entities: Entity[] }) {
  const status = relationStatus(relation, entities);
  const bg =
    status === "confirmed"
      ? "#c7eef5"
      : status === "warning"
        ? "#faebb0"
        : status === "error"
          ? "#ffe6db"
          : "#e1daff";
  const fg =
    status === "confirmed"
      ? "#007287"
      : status === "warning"
        ? "#967700"
        : status === "error"
          ? "#9c461e"
          : "#553eb7";
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-full"
      style={{ background: bg, color: fg }}
    >
      <Check className="size-2" strokeWidth={3} />
    </span>
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
function RelationCard({
  relation,
  counterpart,
  outgoing,
  entities,
  onOpenCounterpart,
  onAccept,
  onReject,
  cardRef,
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
}) {
  const status = relationStatus(relation, entities);
  const canAccept = status !== "confirmed" && status !== "error";
  const canReject = status !== "confirmed";
  const counterpartName = counterpart.name || "Untitled entity";
  return (
    // A plain `div` acting as the click target, not a `button` — the Accept/Reject controls
    // inside are real buttons of their own, and nesting a `<button>` inside a `<button>` is
    // invalid HTML (React warns on it, and click/focus behavior for the inner ones becomes
    // unreliable in some browsers). Same "row is a div, its actions are real buttons" shape
    // `PropertyListRow`'s own click-to-select row already uses.
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={onOpenCounterpart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenCounterpart();
        }
      }}
      title={`${outgoing ? "→" : "←"} ${counterpartName} — click to view in Connected Entities`}
      className="group/relcard flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgba(28,28,24,0.08)] bg-white px-3 py-1.5 text-left text-[11px] font-medium text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none hover:border-[#7c5eff]/40 focus-visible:ring-2 focus-visible:ring-[#00DED8]"
    >
      <RelationStatusIcon relation={relation} entities={entities} />
      <span className="min-w-0 flex-1 truncate">{relationLabel(relation)}</span>
      {(canAccept || canReject) && (
        <span
          className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/relcard:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {canAccept && (
            <button
              type="button"
              onClick={onAccept}
              title="Accept this suggested relation"
              aria-label="Accept this suggested relation"
              className="flex size-4 items-center justify-center rounded-full text-[#0298b2] hover:bg-[#0298b2]/10"
            >
              <Check className="size-2.5" strokeWidth={3} />
            </button>
          )}
          {canReject && (
            <button
              type="button"
              onClick={onReject}
              title="Reject this suggested relation"
              aria-label="Reject this suggested relation"
              className="flex size-4 items-center justify-center rounded-full text-[#f15b15] hover:bg-[#f15b15]/10"
            >
              <X className="size-2.5" strokeWidth={3} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function Idea4Surface({
  label,
  count,
  active = false,
  bodyRef,
  onBodyScroll,
  children,
}: {
  label: string;
  count?: number;
  active?: boolean;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  onBodyScroll?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(28,28,24,0.075)_1.5px,transparent_1.6px)] bg-[size:32px_32px]",
        active ? "bg-[#F2F5F5]" : "bg-[#FAFAFA]",
      )}
    >
      <header
        className={cn(
          "flex h-8 shrink-0 items-center justify-between px-3 font-mono text-[11px] text-[#687274]",
          active ? "bg-[#ECF3F2]" : "bg-[#F4F4F4]",
        )}
      >
        <span>{label}</span>
        {count != null && <span>{count}</span>}
      </header>
      {/* Bottom padding clears the floating AI review bar (bottom-3, 48px tall — a 60px footprint
          from `<main>`'s own bottom edge) by exactly 24px, so scrolled-to-the-end content in any
          lane, and `CurrentEntityCard`'s own `h-full` sizing, both land the same fixed 24px above
          it rather than lining up against an arbitrary reserved margin. */}
      <div
        ref={bodyRef}
        onScroll={onBodyScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pb-[84px]"
      >
        {children}
      </div>
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
        className="absolute inset-x-3 bottom-0 h-9 rounded-b-xl border border-black/[0.06] bg-black/[0.015]"
      />
      <div
        aria-hidden
        className="absolute inset-x-1.5 bottom-0.5 h-9 rounded-b-xl border border-black/[0.07] bg-black/[0.03]"
      />
      <button
        type="button"
        onClick={onOpen}
        title={`Close this ${noun} and show all ${laneLabel} again`}
        className="relative z-10 flex h-12 w-full items-center gap-3 rounded-xl border border-black/[0.08] bg-white px-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#7c5eff]/40"
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
}: {
  entity: Entity;
  compact?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onSelect: (mods: SelectMods) => void;
  onDropProperties: (e: React.DragEvent) => void;
  rowRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <button
      ref={rowRef}
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
      className={cn(
        "flex min-h-12 w-full items-center gap-3 overflow-hidden rounded-xl border border-black/[0.08] bg-white px-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#7c5eff]/40",
        selected && "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8]",
      )}
    >
      <StatusBadge status={entityDisplayStatus(entity)} size={20} confidence={entity.confidence} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{entity.name}</span>
      {!compact && entity.status !== "confirmed" && (
        <ConfidenceChip confidence={entity.confidence} />
      )}
    </button>
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
}) {
  return (
    <div
      className={cn(
        "flex max-h-[660px] flex-col overflow-hidden rounded-[14px] border border-[#7c5eff] bg-white shadow-[0_4px_14px_rgba(46,35,110,0.12)]",
        selected && "shadow-[0_0_0_1.5px_#00ded8]",
      )}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropProperties}
    >
      <button
        ref={titleRef}
        type="button"
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
            return;
          }
          onClose();
        }}
        className={cn(
          "flex h-[50px] shrink-0 items-center gap-3 bg-[#f1edff] px-3 text-left",
          selected && "bg-[#00ded8]/10",
        )}
      >
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={22}
          confidence={entity.confidence}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{entity.name}</span>
          <span className="block text-[10px] text-muted-foreground">
            {entity.properties.length} props · {tablesUsedByEntity(entity).length} table
          </span>
        </span>
        {entity.status !== "confirmed" && <ConfidenceChip confidence={entity.confidence} />}
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
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {visibleProperties.map((property) => (
          <PropertyListRow
            key={property.id}
            property={property}
            entityId={entity.id}
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
  );
}

function CurrentEntityCard({
  entity,
  visibleProperties,
  titleRef,
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
}: {
  entity: Entity;
  // See `ExpandedEntity`'s own `visibleProperties` doc comment — same rationale, same mirrored
  // shape, just for the Current Entity card instead of a Connected Entity's own expanded one.
  visibleProperties: Property[];
  titleRef?: React.RefObject<HTMLButtonElement | null>;
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
}) {
  return (
    <div
      className={cn(
        "mx-auto mt-4 flex h-[calc(100%-16px)] w-full max-w-[360px] flex-col overflow-hidden rounded-[14px] border border-[#7c5eff] bg-white shadow-[0_4px_14px_rgba(46,35,110,0.12)]",
        selected && "shadow-[0_0_0_1.5px_#00ded8]",
      )}
    >
      <button
        ref={titleRef}
        type="button"
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
          }
        }}
        className={cn(
          "flex h-[62px] shrink-0 items-center gap-3 bg-[#f1edff] px-3 text-left",
          selected && "bg-[#00ded8]/10",
        )}
      >
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={22}
          confidence={entity.confidence}
          warningReason={entity.warningReason}
          errorReason={entityErrorReason(entity)}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{entity.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {entity.properties.length} props · {tablesUsedByEntity(entity).length} table
          </p>
        </div>
        {entity.status !== "confirmed" && <ConfidenceChip confidence={entity.confidence} />}
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
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropProperties}
        onScroll={onPropertyListScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5"
      >
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
          />
        ))}
        <AddPropertyRow
          isAdding={isAddingProperty}
          onStartAdd={onStartAddProperty}
          onSubmit={onSubmitAddProperty}
          onCancel={onCancelAddProperty}
        />
      </div>
      <button
        ref={footerRef}
        type="button"
        onClick={onFooterClick}
        className="flex h-9 shrink-0 items-center border-t border-black/[0.05] px-4 py-2 text-left text-[10px] text-muted-foreground hover:bg-black/[0.03]"
      >
        {footerDirection === "up" ? "↑" : "↓"} More props
      </button>
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
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-black/[0.06] px-3 text-[11px] text-muted-foreground">
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
        title={searchOpen ? "Close search" : "Search"}
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
        className="mt-1 flex w-full items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent"
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
      className="mt-1 w-full rounded-[10px] border border-dashed border-input bg-background px-3 py-2 text-[11px] outline-none focus:border-primary"
    />
  );
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
}) {
  const mapped = !!property.mapping;
  return (
    <div
      ref={setRef}
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
        "group/prop relative flex h-[30px] items-center gap-2 px-3 text-[11px]",
        selected
          ? "bg-[#00ded8]/10 shadow-[0_0_0_1px_#00ded8]"
          : hovered && mapped
            ? "bg-[#00ded8]/10"
            : "hover:bg-black/[0.035]",
        mapped && onNavigateToMapping && "cursor-pointer",
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
        title="Drag onto another visible Entity to move this property there"
      >
        ⠿
      </span>
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: propertyDot(propertyStatus(property)) }}
      />
      {isIdentifierProperty(property) && <span title="Identifier">🔑</span>}
      <span className="min-w-0 flex-1 truncate font-medium">{property.name}</span>
      <span className="max-w-12 truncate font-mono text-[10px] text-muted-foreground">
        {property.type}
      </span>
      {property.status !== "confirmed" && <ConfidenceChip confidence={property.confidence} />}
      {onStartMapDrag && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onStartMapDrag(property.id, e.clientX, e.clientY);
          }}
          title={mapped ? "Drag onto a column to remap" : "Drag onto a column to map"}
          className="ml-0.5 flex size-4 shrink-0 cursor-grab items-center justify-center rounded-full text-black/25 opacity-0 outline-none transition-opacity hover:text-[#00ded8] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#00DED8] group-hover/prop:opacity-100 active:cursor-grabbing"
        >
          <Link2 className="size-3" />
        </button>
      )}
    </div>
  );
}

function CompactTable({
  table,
  entities,
  onOpen,
  rowRef,
}: {
  table: TableSchema;
  entities: Entity[];
  onOpen: () => void;
  rowRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onOpen}
      className="flex h-12 w-full items-center gap-3 rounded-xl border border-black/[0.08] bg-white px-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#24bd72]/40"
    >
      <MappingStatusBadge
        status={tableMappingStatus(table.name, entities)}
        {...tableMappingCompleteness(table.name, entities)}
        size={20}
      />
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{table.name}</span>
    </button>
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
  onAcceptMapping,
  onRejectMapping,
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
  columnOrderHint?: string[] | undefined;
  // Column name -> whichever of Current Entity's own Properties maps into it, so a column backed
  // by a still-Suggested mapping can show its own Accept/Reject control (see below) — a Column
  // can't be dragged (it isn't moveable the way a Property is), so this replaces that slot instead
  // of sharing it.
  columnMappings?: Map<string, Property>;
  onAcceptMapping?: (propertyId: string) => void;
  onRejectMapping?: (propertyId: string) => void;
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
        const orderIndex = new Map(columnOrderHint.map((name, i) => [name, i]));
        const mapped = list
          .filter((c) => orderIndex.has(c.name))
          .sort((a, b) => orderIndex.get(a.name)! - orderIndex.get(b.name)!);
        const unmapped = list.filter((c) => !orderIndex.has(c.name));
        list = [...mapped, ...unmapped];
      }
    } else if (sort) {
      list = sortByState(
        list,
        sort,
        (c) => c.name,
        (c) => columnMappings?.get(c.name)?.confidence,
      );
    }
    if (filter === "mapped") list = list.filter((c) => !!columnMappings?.get(c.name));
    else if (filter === "unmapped") list = list.filter((c) => !columnMappings?.get(c.name));
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
  return (
    <div
      ref={cardRef}
      className="flex max-h-[660px] flex-col overflow-hidden rounded-[14px] border border-[#b9dfca] bg-white shadow-[0_4px_14px_rgba(20,92,56,0.1)]"
    >
      <button
        ref={titleRef}
        type="button"
        onClick={onClose}
        className="flex h-[50px] shrink-0 items-center gap-3 bg-[#edf6f1] px-3 text-left"
      >
        <MappingStatusBadge
          status={tableMappingStatus(table.name, entities)}
          {...tableMappingCompleteness(table.name, entities)}
          size={20}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{table.name}</span>
          <span className="block text-[10px] text-muted-foreground">
            {table.columns.length} columns
          </span>
        </span>
      </button>
      <ListControls
        filter={filter ?? "all"}
        onFilterChange={(next) => onFilterChange?.(next)}
        sort={sort ?? DEFAULT_SORT}
        onSortChange={(key) => onSortChange?.(key)}
        search={search ?? ""}
        onSearchChange={(value) => onSearchChange?.(value)}
        searchPlaceholder="Search columns…"
      />
      <div onScroll={onColumnListScroll} className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {orderedColumns.map((column) => {
          const key = `${table.name}.${column.name}`;
          const mappedProperty = columnMappings?.get(column.name);
          const isSuggested =
            !!mappedProperty?.mapping && mappingStatus(mappedProperty.mapping) === "suggested";
          return (
            <div
              key={column.name}
              ref={(el) => onSetColumnRef?.(key, el)}
              onMouseEnter={() => onColumnHoverChange?.(key, true)}
              onMouseLeave={() => onColumnHoverChange?.(key, false)}
              onClick={() => mappedProperty && onNavigateToProperty?.(mappedProperty.id)}
              className={cn(
                "flex h-[30px] items-center gap-2 px-3 text-[11px]",
                dropTargetColumn === column.name
                  ? "bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8] hover:bg-[#00ded8]/10"
                  : hoveredColumnKey === key && mappedProperty
                    ? "bg-[#00ded8]/10"
                    : "hover:bg-black/[0.035]",
                mappedProperty && onNavigateToProperty && "cursor-pointer",
              )}
            >
              {isSuggested && mappedProperty ? (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAcceptMapping?.(mappedProperty.id);
                    }}
                    title="Accept this suggested mapping"
                    aria-label="Accept this suggested mapping"
                    className="flex size-4 items-center justify-center rounded-full text-[#0298b2] hover:bg-[#0298b2]/10"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRejectMapping?.(mappedProperty.id);
                    }}
                    title="Reject this suggested mapping"
                    aria-label="Reject this suggested mapping"
                    className="flex size-4 items-center justify-center rounded-full text-[#f15b15] hover:bg-[#f15b15]/10"
                  >
                    <X className="size-2.5" strokeWidth={3} />
                  </button>
                </span>
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    COLUMN_DOT_COLOR[
                      !mappedProperty ? "unmapped" : isSuggested ? "suggested" : "mapped"
                    ],
                }}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{column.name}</span>
              <span className="max-w-12 truncate font-mono text-[10px] text-muted-foreground">
                {column.type}
              </span>
            </div>
          );
        })}
      </div>
      <button
        ref={footerRef}
        type="button"
        onClick={onFooterClick}
        className="flex h-9 shrink-0 items-center border-t border-black/[0.05] px-4 py-2 text-left text-[10px] text-muted-foreground hover:bg-black/[0.03]"
      >
        {footerDirection === "up" ? "↑" : "↓"} Mapped columns
      </button>
    </div>
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
  const [query, setQuery] = useState("");
  const rows = app.entities.filter((entity) =>
    entity.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-black/[0.08] bg-white">
      <div className="flex h-10 items-center justify-between border-b border-black/[0.08] px-4 text-[14px] font-medium leading-none">
        <span className="flex items-center gap-1.5">
          <span className="size-[14px] shrink-0 text-muted-foreground">
            <EntitiesIcon />
          </span>
          Entity types
        </span>
        <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="flex h-9 items-center gap-2 border-b border-black/[0.06] px-4 text-[11px] text-muted-foreground">
        <span>Name ⇅</span>
        <Search className="ml-auto size-3.5" />
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Filter entity types"
        className="sr-only"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((entity) => (
          <button
            key={entity.id}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ENTITY_PANEL_DND_TYPE, entity.id);
            }}
            onClick={() => app.openDetail("entity", entity.id)}
            title="Click to open, or drag onto Connected Entities to relate it to the current Focus"
            className={cn(
              "flex w-full items-center gap-2 border-b border-white px-4 py-2 text-left hover:bg-[#eef6f5]",
              (entity.id === focusEntityId || workingIds.has(entity.id)) && "bg-[#F1F9FF]",
            )}
          >
            <span className="cursor-grab text-black/25 active:cursor-grabbing">⠿</span>
            <StatusBadge
              status={entityDisplayStatus(entity)}
              size={18}
              confidence={entity.confidence}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold">{entity.name}</span>
              <span className="block text-[10px] text-muted-foreground">
                {entity.properties.length} props · {tablesUsedByEntity(entity).length} table
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Idea4TablePanel({ app, activeNames }: { app: OntologyApp; activeNames: Set<string> }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-l border-black/[0.08] bg-white">
      <div className="flex h-10 items-center gap-3 border-b border-black/[0.08] px-4 text-[14px] font-medium leading-none">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex items-center gap-1.5">
          <span className="size-[14px] shrink-0 text-muted-foreground">
            <TablesIcon />
          </span>
          Data tables
        </span>
      </div>
      <div className="flex h-9 items-center gap-2 border-b border-black/[0.06] px-4 text-[11px] text-muted-foreground">
        <span>Name ⇅</span>
        <Search className="ml-auto size-3.5" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {app.tables.map((table) => (
          <button
            key={table.name}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TABLE_PANEL_DND_TYPE, table.name);
            }}
            onClick={() => app.openDetail("table", table.name)}
            title="Click to open, or drag onto Data Tables to add it to the current workspace"
            className={cn(
              "flex w-full items-center gap-2 border-b border-white px-4 py-2 text-left hover:bg-[#eef6f5]",
              activeNames.has(table.name) && "bg-[#F1F9FF]",
            )}
          >
            <span className="cursor-grab text-black/25 active:cursor-grabbing">⠿</span>
            <MappingStatusBadge
              status={tableMappingStatus(table.name, app.entities)}
              {...tableMappingCompleteness(table.name, app.entities)}
              size={16}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold">{table.name}</span>
              <span className="block text-[10px] text-muted-foreground">
                {table.columns.length} columns
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function propertyDot(status: ReturnType<typeof propertyStatus>) {
  if (status === "confirmed") return "#0298b2";
  if (status === "warning") return "#e6c200";
  if (status === "error") return "#f15b15";
  return "#7c5eff";
}
