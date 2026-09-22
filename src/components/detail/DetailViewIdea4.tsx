import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  Link2,
  Search,
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
  tablesUsedByEntity,
  type Entity,
  type Property,
  type Relation,
  type TableSchema,
} from "@/lib/mock-data";
import { StatusBadge } from "@/components/ontology/StatusBadge";
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

// A Property<->Column mapping line's own color: purple while it's still a Suggested mapping
// (nobody has reviewed it yet — same purple as the "Suggested" review status elsewhere), fading to
// this plain default gray once it's Mapped/confirmed — a mapping that's already settled shouldn't
// keep drawing the eye the way an outstanding suggestion should.
const MAPPING_SUGGESTED_COLOR = "#7c5eff";
const MAPPING_DEFAULT_COLOR = "#a1a1aa";

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

function Idea4EntityMode({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
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

  // --- Filter/Sort/Search for every Property list (Current Entity's own, and each Connected
  // Entity's own expanded one) and every Column list (each expanded Table's own) — one Record
  // entry per Entity/Table id, exactly the same "keyed by whichever card it belongs to" shape
  // `DetailView.tsx`'s own `propertySortByEntity`/`columnSortByTable` already use, so switching
  // which card is expanded never resets another card's own settings. -----------------------------
  const [propertySortByEntity, setPropertySortByEntity] = useState<Record<string, SortState>>({});
  const [onlyIdentifierByEntity, setOnlyIdentifierByEntity] = useState<Record<string, boolean>>({});
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
  const toggleOnlyIdentifierForEntity = useCallback((entityId: string) => {
    setOnlyIdentifierByEntity((prev) => ({ ...prev, [entityId]: !prev[entityId] }));
  }, []);
  const propertySearchFor = useCallback(
    (entityId: string) => propertySearchByEntity[entityId] ?? "",
    [propertySearchByEntity],
  );
  const setPropertySearchFor = useCallback((entityId: string, value: string) => {
    setPropertySearchByEntity((prev) => ({ ...prev, [entityId]: value }));
  }, []);
  // Original property order is kept until the reviewer explicitly picks a Sort — same
  // "never touched" vs. "explicitly set" distinction `hasExplicitPropertySort` draws in
  // DetailView.tsx, just folded directly into this one lookup instead of a separate check.
  const visiblePropertiesFor = useCallback(
    (entity: Entity) => {
      let list = entity.properties;
      if (onlyIdentifierByEntity[entity.id]) list = list.filter((p) => isIdentifierProperty(p));
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
    [onlyIdentifierByEntity, propertySearchByEntity, propertySortByEntity],
  );

  const [columnSortByTable, setColumnSortByTable] = useState<Record<string, SortState>>({});
  const [onlyIdentifierByTable, setOnlyIdentifierByTable] = useState<Record<string, boolean>>({});
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
  const toggleOnlyIdentifierForTable = useCallback((tableName: string) => {
    setOnlyIdentifierByTable((prev) => ({ ...prev, [tableName]: !prev[tableName] }));
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

  const relationBetween = useCallback(
    (otherId: string) =>
      focusEntity
        ? (app.relations.find(
            (r) =>
              (r.from === focusEntity.id && r.to === otherId) ||
              (r.to === focusEntity.id && r.from === otherId),
          ) ?? null)
        : null,
    [app.relations, focusEntity],
  );

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
  const currentBodyRef = useRef<HTMLDivElement>(null);
  const dataBodyRef = useRef<HTMLDivElement>(null);
  const entityTitleRefs = useRef<Map<string, HTMLElement>>(new Map());
  const currentTitleRef = useRef<HTMLButtonElement>(null);
  const currentFooterRef = useRef<HTMLElement | null>(null);
  const propertyRefs = useRef<Map<string, HTMLElement>>(new Map());
  const tableCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const tableFooterRefs = useRef<Map<string, HTMLElement>>(new Map());
  const columnRefs = useRef<Map<string, HTMLElement>>(new Map());

  const [relationLines, setRelationLines] = useState<
    { id: string; path: string; mid: { x: number; y: number }; relation: Relation }[]
  >([]);
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  const [mappingLines, setMappingLines] = useState<
    { id: string; path: string; suggested: boolean }[]
  >([]);
  // Which way each footer's own redirect currently points — "up" once its off-screen target has
  // scrolled above the visible area, "down" while it's still below — `null` when there's nothing
  // off-screen to redirect to at all (nothing mapped into the expanded Table, or every mapped row
  // is already visible).
  const [morePropsDirection, setMorePropsDirection] = useState<"up" | "down" | null>(null);
  const [mappedColumnsDirection, setMappedColumnsDirection] = useState<"up" | "down" | null>(null);

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
    if (!container || !title || !connectedBody || !focusEntity) {
      setRelationLines([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const rectOf = (el: HTMLElement): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, width: r.width, height: r.height };
    };
    const titleRect = rectOf(title);
    const next: { id: string; path: string; mid: { x: number; y: number }; relation: Relation }[] =
      [];
    // Once a Connected Entity is expanded, its own relation is the only one still worth drawing —
    // the rest are already legible from their own (collapsed) rows, and keeping every one of them
    // on screen while the user is focused on just one just adds noise.
    const visibleRelatedEntities =
      expandedContext?.kind === "entity"
        ? relatedEntities.filter((entity) => entity.id === expandedContext.id)
        : relatedEntities;
    visibleRelatedEntities.forEach((entity) => {
      const row = entityTitleRefs.current.get(entity.id);
      const relation = relationBetween(entity.id);
      if (!row || !relation) return;
      if (!withinViewport(row, connectedBody)) return;
      // Always the row's own RIGHT edge -> the title's own LEFT edge — never the adaptive
      // top/bottom anchoring `edgeAnchorsForRects` falls back to for a row far above/below the
      // title, which made a line look like it emerged from underneath its row instead of its side.
      const rowRect = rectOf(row);
      const { p1, p2 } = rightToLeftAnchors(rowRect, titleRect, 6);
      // The pill sits right next to its own root Connected Entity row, not at the connector's
      // literal geometric midpoint — that midpoint averages every row's own Y against Current
      // Entity's single, fixed title Y, which drags every pill toward that one Y and collapses rows
      // far from it into an overlapping cluster instead of each one reading as "this entity's own
      // relation". Biased mostly toward p1 on X too, so it reads as attached to the row it names.
      const mid = { x: p1.x + (p2.x - p1.x) * 0.2, y: p1.y };
      // An angular elbow (one rounded 90-degree bend at a shared X), not a smooth curve — every
      // row's own anchor sits at nearly the same X (all Connected Entities cards share one width,
      // and Current Entity's title is one fixed point), so every line bends at that same shared X
      // by design: it reads as a clean bus feeding into Current Entity, exactly the "parallel
      // connections share a bend" case `orthogonalPath` documents itself for.
      next.push({ id: entity.id, path: orthogonalPath(p1, p2, 10, "horizontal"), mid, relation });
    });
    setRelationLines(next);
  }, [relatedEntities, relationBetween, focusEntity, expandedContext]);

  useEffect(() => {
    recomputeRelationLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedEntities, mappedTables, expandedContext]);

  // Property <-> Column ladder: every one of Current Entity's own mapped Properties whose Table is
  // currently the one expanded in Data Tables gets its own persistent line — not just whichever
  // Property happens to be hovered — so the 1:1 shape of the mapping is visible at a glance. A
  // Property whose Column has scrolled outside the expanded Table's own (660px-capped) visible
  // area redirects to that Table's "Mapped columns" footer instead of pointing at nothing.
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
      // Same off-screen redirect as the Column side below, just mirrored: a Property that's
      // scrolled outside Current Entity's own visible list redirects to Current Entity's own
      // "More props" footer instead of vanishing — see that footer's own doc comment.
      const source = propVisible ? propEl! : currentFooterRef.current;
      if (!source) return;
      const colEl = columnRefs.current.get(`${prop.mapping.table}.${prop.mapping.column}`);
      const colVisible = !!colEl && withinViewport(colEl, tableCard);
      if (!colVisible && colEl && mappedColumnsDir === null) {
        mappedColumnsDir = directionOf(colEl, tableCard);
      }
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
  }, [focusEntity, expandedContext]);

  useEffect(() => {
    recomputeMappingLines();
    // `recomputeMappingLines` itself already depends on `focusEntity` (and so picks up a fresh
    // mapping status right after Accept/Reject), so including it here — rather than re-listing
    // `focusEntity` a second time — is what actually makes that recompute fire on that change.
  }, [hoveredPropertyId, expandedContext, recomputeMappingLines]);

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
        <div className="flex h-10 shrink-0 items-center border-b border-black/[0.08] px-3">
          <button
            type="button"
            onClick={app.closeDetail}
            className="flex items-center gap-1 text-[12px] font-medium text-[#1c1c18] hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Back to Ontology
          </button>
        </div>

        <div
          ref={workspaceRef}
          // Each lane's own section fills the full height down to `<main>`'s own bottom edge — the
          // reserved 24px clearance for the AI review bar (see `Idea4Surface`'s own body padding)
          // lives INSIDE each section as padding, not as a margin out here, so that strip still
          // shows each lane's own background rather than a plain gap. Columns stay a fixed 1:1:1
          // split regardless of what's expanded — only the content within a lane changes, never
          // the 3 lanes' own widths relative to each other.
          className="relative grid min-h-0 flex-1 grid-cols-3 gap-[3px] overflow-hidden"
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
              {orderByExpanded(
                relatedEntities,
                (entity) => expandedContext?.kind === "entity" && expandedContext.id === entity.id,
              ).map((entity) => {
                const selected = suggestionSelection.has(
                  suggestionKey({ kind: "entity", id: entity.id }),
                );
                const titleRef = (el: HTMLElement | null) => {
                  if (el) entityTitleRefs.current.set(entity.id, el);
                  else entityTitleRefs.current.delete(entity.id);
                };
                return expandedContext?.kind === "entity" && expandedContext.id === entity.id ? (
                  <ExpandedEntity
                    key={entity.id}
                    entity={entity}
                    visibleProperties={visiblePropertiesFor(entity)}
                    selected={selected}
                    onClose={() => setExpandedContext(null)}
                    onSelect={(mods) => selectOnClick({ kind: "entity", id: entity.id }, mods)}
                    onDropProperties={(e) => movePropertiesOnDrop(e, entity.id)}
                    suggestionSelection={suggestionSelection}
                    onSelectProperty={(propertyId, mods) =>
                      selectOnClick({ kind: "property", entityId: entity.id, propertyId }, mods)
                    }
                    selectedPropertyIdsFor={selectedPropertyIdsFor}
                    titleRef={titleRef}
                    sort={propertySortFor(entity.id)}
                    onSortChange={(key) => setPropertySortFor(entity.id, key)}
                    onlyIdentifier={!!onlyIdentifierByEntity[entity.id]}
                    onToggleOnlyIdentifier={() => toggleOnlyIdentifierForEntity(entity.id)}
                    search={propertySearchFor(entity.id)}
                    onSearchChange={(value) => setPropertySearchFor(entity.id, value)}
                  />
                ) : (
                  <CompactEntity
                    key={entity.id}
                    entity={entity}
                    compact={expandedContext?.kind === "table"}
                    selected={selected}
                    onOpen={() => setExpandedContext({ kind: "entity", id: entity.id })}
                    onSelect={(mods) => selectOnClick({ kind: "entity", id: entity.id }, mods)}
                    onDropProperties={(e) => movePropertiesOnDrop(e, entity.id)}
                    rowRef={titleRef}
                  />
                );
              })}
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
              onlyIdentifier={!!onlyIdentifierByEntity[focusEntity.id]}
              onToggleOnlyIdentifier={() => toggleOnlyIdentifierForEntity(focusEntity.id)}
              search={propertySearchFor(focusEntity.id)}
              onSearchChange={(value) => setPropertySearchFor(focusEntity.id, value)}
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
              {orderByExpanded(
                mappedTables,
                (table) => expandedContext?.kind === "table" && expandedContext.name === table.name,
              ).map((table) => {
                return expandedContext?.kind === "table" && expandedContext.name === table.name ? (
                  <ExpandedTable
                    key={table.name}
                    table={table}
                    onClose={() => setExpandedContext(null)}
                    cardRef={(el) => {
                      if (el) tableCardRefs.current.set(table.name, el);
                      else tableCardRefs.current.delete(table.name);
                    }}
                    footerRef={(el) => {
                      if (el) tableFooterRefs.current.set(table.name, el);
                      else tableFooterRefs.current.delete(table.name);
                    }}
                    onFooterClick={() => scrollToMappedColumn(table.name)}
                    footerDirection={mappedColumnsDirection}
                    onColumnListScroll={onAnyLaneScroll}
                    columnOrderHint={expandedTableColumnOrderHint}
                    columnMappings={expandedTableColumnMappings}
                    onAcceptMapping={(propertyId) => app.confirmMapping(focusEntity.id, propertyId)}
                    onRejectMapping={(propertyId) =>
                      app.updateMapping(focusEntity.id, propertyId, null)
                    }
                    sort={columnSortFor(table.name)}
                    onSortChange={(key) => setColumnSortFor(table.name, key)}
                    hasExplicitSort={table.name in columnSortByTable}
                    onlyIdentifier={!!onlyIdentifierByTable[table.name]}
                    onToggleOnlyIdentifier={() => toggleOnlyIdentifierForTable(table.name)}
                    search={columnSearchFor(table.name)}
                    onSearchChange={(value) => setColumnSearchFor(table.name, value)}
                    onSetColumnRef={(key, el) => {
                      if (el) columnRefs.current.set(key, el);
                      else columnRefs.current.delete(key);
                    }}
                  />
                ) : (
                  <CompactTable
                    key={table.name}
                    table={table}
                    onOpen={() => setExpandedContext({ kind: "table", name: table.name })}
                  />
                );
              })}
            </div>
          </Idea4Surface>

          {/* Connector overlay — spans the whole 3-lane grid, above the lanes' own content but
              below the floating AI review bar (z-20). Relation lines are persistent (for whichever
              related Entity rows are currently visible); the property<->column ladder is
              persistent too, but only for whichever ONE Table is currently expanded — a Property
              whose Column has scrolled out of that Table's own view redirects to its "Mapped
              columns" footer instead of pointing at nothing. There's no Entity<->Table connector —
              which Tables an Entity uses is already legible from the Data Tables lane's own
              contents, without needing its own line. */}
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
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            ))}
          </svg>
          {relationLines.map((line) => (
            <div
              key={line.id}
              style={{ left: line.mid.x, top: line.mid.y }}
              className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-[rgba(28,28,24,0.08)] bg-white px-2 py-1 text-[11px] font-medium text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
            >
              <RelationStatusIcon relation={line.relation} entities={app.entities} />
              {relationLabel(line.relation)}
            </div>
          ))}

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
  const [onlyIdentifier, setOnlyIdentifier] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const visibleProperties = useMemo(() => {
    const entity = usingEntities.find((e) => e.id === expandedEntityId);
    if (!entity) return [];
    let list = entity.properties;
    if (onlyIdentifier) list = list.filter((p) => isIdentifierProperty(p));
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
    onlyIdentifier,
    propertySearch,
    propertySortTouched,
    propertySort,
  ]);
  // Columns has no per-Entity ownership the way Properties does — every Entity using this Table
  // shares the exact same column list, so one plain slot per control suffices here too. No "Only
  // Identifier" here: with several Entities potentially mapped into this one Table, "identifier"
  // is a fact about a Property's own mapping, not about a bare Column in isolation — see
  // `ListControls`'s own optional Filter props.
  const [columnSort, setColumnSort] = useState<SortState>(DEFAULT_SORT);
  const [columnSortTouched, setColumnSortTouched] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const visibleTableColumns = useMemo(() => {
    let list = table.columns;
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
  }, [table.columns, columnSearch, columnSortTouched, columnSort]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      <Idea4EntityPanel app={app} workingIds={new Set(usingEntities.map((e) => e.id))} />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="flex h-10 shrink-0 items-center border-b border-black/[0.08] px-3">
          <button
            type="button"
            onClick={app.closeDetail}
            className="flex items-center gap-1 text-[12px] font-medium text-[#1c1c18] hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Back to Ontology
          </button>
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
                    onlyIdentifier={onlyIdentifier}
                    onToggleOnlyIdentifier={() => setOnlyIdentifier((v) => !v)}
                    search={propertySearch}
                    onSearchChange={setPropertySearch}
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
              visibleColumns={visibleTableColumns}
              sort={columnSort}
              onSortChange={(key) => {
                setColumnSort((prev) => nextSortState(prev, key));
                setColumnSortTouched(true);
              }}
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
  visibleColumns,
  titleRef,
  sort,
  onSortChange,
  search,
  onSearchChange,
}: {
  table: TableSchema;
  // See `ExpandedEntity`'s own `visibleProperties` doc comment — same rationale, mirrored for a
  // plain Column list with no per-Entity mapping context (see `Idea4TableMode`'s own state).
  visibleColumns: TableSchema["columns"];
  titleRef?: React.RefObject<HTMLButtonElement | null>;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
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
        <span className="flex size-7 items-center justify-center rounded-full bg-[#dff8e9] text-[#27b86a]">
          <Link2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{table.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{table.columns.length} columns</p>
        </div>
      </button>
      <ListControls
        sort={sort}
        onSortChange={onSortChange}
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
            <span className="size-1.5 shrink-0 rounded-full bg-[#7c5eff]" />
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
  onlyIdentifier,
  onToggleOnlyIdentifier,
  search,
  onSearchChange,
}: {
  entity: Entity;
  // The rendered rows, already filtered (Only Identifier / search) and, once explicitly sorted,
  // reordered — see `visiblePropertiesFor` in `Idea4EntityMode`. `entity.properties` itself stays
  // the full, unfiltered list, since the header's own "N props" count should never shrink to
  // match a temporary Filter/Search.
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
  onlyIdentifier: boolean;
  onToggleOnlyIdentifier: () => void;
  search: string;
  onSearchChange: (value: string) => void;
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
        onlyIdentifier={onlyIdentifier}
        onToggleOnlyIdentifier={onToggleOnlyIdentifier}
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
  onlyIdentifier,
  onToggleOnlyIdentifier,
  search,
  onSearchChange,
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
  onlyIdentifier: boolean;
  onToggleOnlyIdentifier: () => void;
  search: string;
  onSearchChange: (value: string) => void;
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
        onlyIdentifier={onlyIdentifier}
        onToggleOnlyIdentifier={onToggleOnlyIdentifier}
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
          />
        ))}
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
function ListControls({
  onlyIdentifier,
  onToggleOnlyIdentifier,
  sort,
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder,
}: {
  // Both omitted entirely hides the Filter control — "Only Identifier" is a fact about a
  // Property's own mapping, which not every list this appears above has enough context for (see
  // `Idea4TableMode`'s own Column list, shared across however many Entities map into it).
  onlyIdentifier?: boolean;
  onToggleOnlyIdentifier?: () => void;
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
          {onToggleOnlyIdentifier && (
            <button
              type="button"
              onClick={onToggleOnlyIdentifier}
              title="Show only the Identifier"
              aria-pressed={onlyIdentifier}
              className={cn(
                "-mx-1 rounded px-1 transition-colors",
                onlyIdentifier ? "font-semibold text-foreground" : "hover:text-foreground",
              )}
            >
              Filter ⇅
            </button>
          )}
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

function PropertyListRow({
  property,
  entityId,
  hovered,
  onHoverChange,
  setRef,
  selected,
  onSelect,
  draggablePropertyIds,
}: {
  property: Entity["properties"][number];
  entityId: string;
  hovered?: boolean;
  onHoverChange?: (hovering: boolean) => void;
  setRef?: (el: HTMLElement | null) => void;
  selected?: boolean;
  onSelect: (mods: SelectMods) => void;
  draggablePropertyIds?: (entityId: string) => Set<string>;
}) {
  const mapped = !!property.mapping;
  return (
    <div
      ref={setRef}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
        }
      }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cn(
        "flex h-[30px] items-center gap-2 px-3 text-[11px]",
        selected
          ? "bg-[#00ded8]/10 shadow-[0_0_0_1px_#00ded8]"
          : hovered && mapped
            ? "bg-[#00ded8]/10"
            : "hover:bg-black/[0.035]",
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
    </div>
  );
}

function CompactTable({
  table,
  onOpen,
  rowRef,
}: {
  table: TableSchema;
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
      <span className="flex size-5 items-center justify-center rounded-full bg-[#dff8e9] text-[#27b86a]">
        <Link2 className="size-3" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{table.name}</span>
    </button>
  );
}

function ExpandedTable({
  table,
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
  onlyIdentifier,
  onToggleOnlyIdentifier,
  search,
  onSearchChange,
}: {
  table: TableSchema;
  onClose: () => void;
  onSetColumnRef?: (key: string, el: HTMLElement | null) => void;
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
  onlyIdentifier?: boolean;
  onToggleOnlyIdentifier?: () => void;
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
    if (onlyIdentifier) {
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
  }, [
    table.columns,
    columnOrderHint,
    hasExplicitSort,
    sort,
    onlyIdentifier,
    search,
    columnMappings,
  ]);
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
        <span className="flex size-5 items-center justify-center rounded-full bg-[#dff8e9] text-[#27b86a]">
          <Link2 className="size-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{table.name}</span>
          <span className="block text-[10px] text-muted-foreground">
            {table.columns.length} columns
          </span>
        </span>
      </button>
      <ListControls
        onlyIdentifier={!!onlyIdentifier}
        onToggleOnlyIdentifier={() => onToggleOnlyIdentifier?.()}
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
              className="flex h-[30px] items-center gap-2 px-3 text-[11px] hover:bg-black/[0.035]"
            >
              {isSuggested && mappedProperty ? (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onAcceptMapping?.(mappedProperty.id)}
                    title="Accept this suggested mapping"
                    aria-label="Accept this suggested mapping"
                    className="flex size-4 items-center justify-center rounded-full text-[#0298b2] hover:bg-[#0298b2]/10"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectMapping?.(mappedProperty.id)}
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
              <span className="size-1.5 shrink-0 rounded-full bg-[#7c5eff]" />
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
            <span className="flex size-4 items-center justify-center rounded-full bg-[#dff8e9] text-[#27b86a]">
              <Link2 className="size-2.5" />
            </span>
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
