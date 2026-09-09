import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  edgeAnchors,
  nearestSide,
  nodeCenter,
  pointInNode,
  orthogonalPath,
  NODE_W,
  NODE_H,
} from "@/lib/geometry";
import type { Side } from "@/lib/geometry";
import {
  relationLabel,
  tableMappingStatus,
  entitiesUsingTable,
  tablesUsedByEntity,
  entityStatus,
  entityErrorReason,
  type Property,
  type TableColumn,
} from "@/lib/mock-data";
import { CreateEntityButton } from "@/components/ontology/CreateEntityButton";
import {
  CanvasControls,
  useCanvasToolShortcuts,
  type CanvasTool,
} from "@/components/ontology/CanvasControls";
import {
  SortDropdown,
  DEFAULT_SORT,
  nextSortState,
  sortByState,
  type SortState,
} from "@/components/ontology/SortDropdown";
import { SearchInput } from "@/components/ontology/SearchInput";
import type { OntologyApp } from "@/lib/app-state";
import { EntityNode } from "./EntityNode";
import { MappingStatusBadge } from "./MappingStatusBadge";
import { StatusBadge, statusBorderColor } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";

const MIN_Z = 0.4;
const MAX_Z = 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The Overview workspace: the ontology graph (pan/zoom, entity nodes, relation lines) plus a
 * side panel for Source Tables. Clicking an Entity or a Table opens Detail directly — no separate
 * confirmation step — via openDetail(), which also updates selection so the click reads as
 * "select and go" in one step. Clicking a Relation only selects it (Inspect) since Relations
 * don't have a Detail view of their own.
 */
export function OverviewCanvas({ app }: { app: OntologyApp }) {
  const {
    entities,
    relations,
    tables,
    selection,
    select,
    openDetail,
    updateEntity,
    createEntity,
    addRelation,
    deleteRelation,
    view,
    setView,
    confidenceRange,
  } = app;
  // Tables carry an optional confidence (schema discovery sometimes has no signal at all — see
  // mock-data's own note on `TableSchema.confidence`) — one with none is never excluded by this
  // filter, the same "no data renders as no opinion" rule the Confidence chip itself follows.
  const inConfidenceRange = useCallback(
    (confidence: number | undefined) => {
      if (confidence == null) return true;
      const pct = Math.round(confidence * 100);
      return pct >= confidenceRange.min && pct <= confidenceRange.max;
    },
    [confidenceRange],
  );

  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // The Data Tables panel's own resizable width — grippable at its left edge (see the resize
  // handle rendered on it below). Can only grow from its default, never shrink below it.
  const DATA_TABLES_MIN_W = 280;
  const DATA_TABLES_MAX_W = 520;
  const [dataTablesWidth, setDataTablesWidth] = useState(DATA_TABLES_MIN_W);
  const panelResize = useRef<{ startX: number; startWidth: number } | null>(null);
  const startPanelResize = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      panelResize.current = { startX: e.clientX, startWidth: dataTablesWidth };
    },
    [dataTablesWidth],
  );
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = panelResize.current;
      if (!r) return;
      // Pinned to the right edge of the screen, so dragging left (negative dx) is what grows it.
      const dx = e.clientX - r.startX;
      setDataTablesWidth(clamp(r.startWidth - dx, DATA_TABLES_MIN_W, DATA_TABLES_MAX_W));
    };
    const onUp = () => {
      panelResize.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // The Select/Pan tool switch in the canvas controls bar below — "pan" (the default, matching
  // this canvas's original always-drag-to-pan behavior) lets a background drag move the view;
  // "select" turns that off, so a background drag no longer pans (clicking still deselects and
  // clicking/dragging any node still works exactly the same in either tool).
  const [tool, setTool] = useState<CanvasTool>("pan");
  useCanvasToolShortcuts(tool, setTool);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    select(null);
    if (tool !== "pan") return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Centers and scales the pan/zoom so every entity is visible without any manual panning —
  // run once whenever this canvas mounts (including every time Detail's Back returns here, since
  // that swaps this component back in from scratch) rather than only on the very first load.
  const fitToContent = useCallback(() => {
    const el = ref.current;
    if (!el || entities.length === 0) return;
    const rect = el.getBoundingClientRect();
    const minX = Math.min(...entities.map((e) => e.x));
    const minY = Math.min(...entities.map((e) => e.y));
    const maxX = Math.max(...entities.map((e) => e.x + NODE_W));
    const maxY = Math.max(...entities.map((e) => e.y + NODE_H));
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const pad = 72;
    const availW = rect.width - pad * 2;
    const availH = rect.height - pad * 2;
    const z = clamp(Math.min(availW / contentW, availH / contentH), MIN_Z, 1);
    setView({
      z,
      x: pad + (availW - contentW * z) / 2 - minX * z,
      y: pad + (availH - contentH * z) / 2 - minY * z,
    });
  }, [entities, setView]);

  useLayoutEffect(() => {
    fitToContent();
    // Deliberately mount-only: re-fitting on every entity move/add would fight the user's own
    // pan/zoom while they're actively working the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.x) / view.z,
        y: (clientY - rect.top - view.y) / view.z,
      };
    },
    [view],
  );

  // Direct-manipulation connector drag — creates a relation by dragging from one entity node's
  // hover-revealed handle onto another. Relations can only ever be created or deleted this way,
  // never re-pointed once they exist.
  const [connectDrag, setConnectDrag] = useState<{
    sourceId: string;
    side: Side;
    origin: { x: number; y: number };
  } | null>(null);
  const [connectPos, setConnectPos] = useState<{ x: number; y: number } | null>(null);
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);

  const findEntityAt = useCallback(
    (clientX: number, clientY: number, excludeId?: string) => {
      const p = toWorld(clientX, clientY);
      let best: (typeof entities)[number] | null = null;
      let bestDist = Infinity;
      for (const en of entities) {
        if (en.id === excludeId) continue;
        if (!pointInNode(p, en)) continue;
        const c = nodeCenter(en);
        const dist = Math.hypot(p.x - c.x, p.y - c.y);
        if (dist < bestDist) {
          best = en;
          bestDist = dist;
        }
      }
      return best;
    },
    [entities, toWorld],
  );

  const startConnectFromEntity = useCallback(
    (entityId: string, side: Side, clientX: number, clientY: number) => {
      const origin = toWorld(clientX, clientY);
      setConnectDrag({ sourceId: entityId, side, origin });
      setConnectPos(origin);
    },
    [toWorld],
  );

  useEffect(() => {
    if (!connectDrag) return;
    const onMove = (e: PointerEvent) => {
      setConnectPos(toWorld(e.clientX, e.clientY));
      setConnectTargetId(findEntityAt(e.clientX, e.clientY, connectDrag.sourceId)?.id ?? null);
    };
    const onUp = (e: PointerEvent) => {
      const hit = findEntityAt(e.clientX, e.clientY, connectDrag.sourceId);
      if (hit) addRelation(connectDrag.sourceId, hit.id);
      setConnectDrag(null);
      setConnectPos(null);
      setConnectTargetId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [connectDrag, toWorld, findEntityAt, addRelation]);

  const connectTargetEntity = connectTargetId
    ? entities.find((e) => e.id === connectTargetId)
    : undefined;
  const connectTargetSide =
    connectTargetEntity && connectPos ? nearestSide(connectTargetEntity, connectPos) : null;

  // Direct-manipulation node move — dragging an entity's own body (not a connection handle)
  // repositions it, persisted as its x/y in app-state so the layout survives a re-render. Below
  // the same 6px threshold used elsewhere in the app, it resolves as a plain click (open Detail)
  // instead, exactly like the toolbox's own click-vs-drag distinction.
  const nodeDragInfo = useRef<{
    id: string;
    startX: number;
    startY: number;
    sx: number;
    sy: number;
    moved: boolean;
  } | null>(null);

  const startNodeMove = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const entity = entities.find((e) => e.id === id);
      if (!entity) return;
      nodeDragInfo.current = {
        id,
        startX: entity.x,
        startY: entity.y,
        sx: clientX,
        sy: clientY,
        moved: false,
      };
    },
    [entities],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const info = nodeDragInfo.current;
      if (!info) return;
      const dx = e.clientX - info.sx;
      const dy = e.clientY - info.sy;
      if (!info.moved && Math.hypot(dx, dy) > 6) info.moved = true;
      if (info.moved) {
        updateEntity(info.id, { x: info.startX + dx / view.z, y: info.startY + dy / view.z });
      }
    };
    const onUp = () => {
      const info = nodeDragInfo.current;
      nodeDragInfo.current = null;
      if (info && !info.moved) openDetail("entity", info.id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateEntity, openDetail, view.z]);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = rect.width / 2;
      const py = rect.height / 2;
      setView((v) => {
        const next = clamp(v.z * factor, MIN_Z, MAX_Z);
        const k = next / v.z;
        return { z: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    },
    [setView],
  );

  // "In focus" emphasis: whichever entity is hovered (falling back to the current Inspect
  // selection when nothing is hovered, e.g. right after Back returns here) — plus whichever
  // entities it's directly related to. Hover rather than click/selection drives this because a
  // click immediately opens Detail, replacing this whole canvas before the emphasis is even
  // visible; hovering is the only gesture that stays on this canvas long enough to see it.
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const highlightId = hoveredEntityId ?? (selection?.kind === "entity" ? selection.id : null);

  // Same "in focus" emphasis, but from the Data Tables entry point instead of Entity types — the
  // basis for what's highlighted just becomes "which entities map to this table" (via
  // `entitiesUsingTable`) rather than "which entities are related to this one" (via `relations`).
  // Takes priority over an entity hover/selection while active, same as an entity hover already
  // takes priority over a stale Inspect selection above.
  const [hoveredTableName, setHoveredTableName] = useState<string | null>(null);

  // Search for the two side panels below — collapsed behind a Search icon in each panel's own
  // header rather than a permanently-visible input, and scoped separately per the panel it lives
  // in: Ontology searches Entity Type / Property / Relation
  // names, Data Tables searches Table / Column names. Pure display filtering either way — it
  // narrows which rows render, never the canvas or the ontology data itself. Closing a panel's
  // search also clears its own query, so a collapsed search never leaves the list silently
  // filtered.
  const [entitySearchOpen, setEntitySearchOpen] = useState(false);
  const [tableSearchOpen, setTableSearchOpen] = useState(false);
  const [entitySearch, setEntitySearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  // Data Tables panel's own compact sort control (see SortDropdown) — Entity Types has no
  // equivalent panel here anymore (see the Ontology canvas header's on-demand search below), so
  // only this one list needs it.
  const [tableSort, setTableSort] = useState<SortState>(DEFAULT_SORT);
  const toggleEntitySearch = useCallback(() => {
    setEntitySearchOpen((open) => {
      if (open) setEntitySearch("");
      return !open;
    });
  }, []);
  const toggleTableSearch = useCallback(() => {
    setTableSearchOpen((open) => {
      if (open) setTableSearch("");
      return !open;
    });
  }, []);

  const entityQuery = entitySearch.trim().toLowerCase();
  // Hierarchical match, same "parent stays visible for a matching child" rule Detail's own panel
  // search already uses: a Property match keeps its owning Entity Type visible (and shows which
  // Property matched underneath) even when the Entity Type's own name doesn't match.
  const matchedPropertiesByEntity = useMemo(() => {
    const map = new Map<string, Property[]>();
    if (!entityQuery) return map;
    entities.forEach((e) => {
      const matches = e.properties.filter((p) => p.name.toLowerCase().includes(entityQuery));
      if (matches.length > 0) map.set(e.id, matches);
    });
    return map;
  }, [entities, entityQuery]);
  const matchedRelations = useMemo(() => {
    if (!entityQuery) return [];
    return relations.filter((r) => r.name.toLowerCase().includes(entityQuery));
  }, [relations, entityQuery]);
  const filteredEntities = useMemo(
    () =>
      entities.filter(
        (e) =>
          (e.name.toLowerCase().includes(entityQuery) || matchedPropertiesByEntity.has(e.id)) &&
          inConfidenceRange(e.confidence),
      ),
    [entities, entityQuery, matchedPropertiesByEntity, inConfidenceRange],
  );

  const tableQuery = tableSearch.trim().toLowerCase();
  const matchedColumnsByTable = useMemo(() => {
    const map = new Map<string, TableColumn[]>();
    if (!tableQuery) return map;
    tables.forEach((t) => {
      const matches = t.columns.filter((c) => c.name.toLowerCase().includes(tableQuery));
      if (matches.length > 0) map.set(t.name, matches);
    });
    return map;
  }, [tables, tableQuery]);
  const filteredTables = useMemo(
    () =>
      tables.filter(
        (t) =>
          (t.name.toLowerCase().includes(tableQuery) || matchedColumnsByTable.has(t.name)) &&
          inConfidenceRange(t.confidence),
      ),
    [tables, tableQuery, matchedColumnsByTable, inConfidenceRange],
  );
  const sortedTables = useMemo(
    () =>
      sortByState(
        filteredTables,
        tableSort,
        (t) => t.name,
        (t) => t.confidence,
      ),
    [filteredTables, tableSort],
  );
  // A hovered table's own "neighbors" are just every entity mapped to it — there's no further
  // "related" tier the way an entity's relation-neighbors form one, so this only ever produces
  // "active" or "muted", never "related". Takes priority over `highlightId` (the entity-hover
  // basis) whenever a table is actively hovered.
  const activeEntityIds = useMemo(() => {
    if (hoveredTableName)
      return new Set(entitiesUsingTable(hoveredTableName, entities).map((e) => e.id));
    if (highlightId) return new Set([highlightId]);
    return null;
  }, [hoveredTableName, highlightId, entities]);

  const neighborIds = useMemo(() => {
    if (!highlightId || hoveredTableName) return null;
    const set = new Set<string>();
    relations.forEach((r) => {
      if (r.from === highlightId) set.add(r.to);
      if (r.to === highlightId) set.add(r.from);
    });
    return set;
  }, [highlightId, relations, hoveredTableName]);

  const emphasisFor = (entityId: string) => {
    // Confidence filtering always wins — an out-of-range entity stays muted regardless of hover,
    // the same way it's simply left out of the Entity types / Data Tables lists below.
    const entity = entities.find((e) => e.id === entityId);
    if (entity && !inConfidenceRange(entity.confidence)) return "muted" as const;
    if (!activeEntityIds) return "normal" as const;
    if (activeEntityIds.has(entityId)) return "active" as const;
    if (neighborIds?.has(entityId)) return "related" as const;
    return "muted" as const;
  };

  // Relations have no Detail view of their own (see app-state's DetailAnchor), so an Ontology
  // search Relation result can't "navigate" the way an Entity/Property result does — it can only
  // select it (the same Inspect selection a canvas click already produces) and bring it into view
  // by re-centering the pan, without ever changing zoom or rearranging any node's own position.
  const focusRelation = useCallback(
    (relationId: string) => {
      const relation = relations.find((r) => r.id === relationId);
      const a = relation && entities.find((e) => e.id === relation.from);
      const b = relation && entities.find((e) => e.id === relation.to);
      const el = ref.current;
      if (a && b && el) {
        const { mid } = edgeAnchors(a, b);
        const rect = el.getBoundingClientRect();
        setView((v) => ({
          ...v,
          x: rect.width / 2 - mid.x * v.z,
          y: rect.height / 2 - mid.y * v.z,
        }));
      }
      select({ kind: "relation", id: relationId });
    },
    [relations, entities, setView, select],
  );

  // An Entity result from the on-demand ontology search stays on Overview (unlike a Property
  // result, which navigates into that Property's parent Entity's Detail view) — it only pans the
  // view to bring that Entity into frame and selects it, the same "camera moves, nothing about
  // the graph itself does" rule as focusRelation above. Selecting it also drives `highlightId`
  // (see above), which is what actually renders the "visually highlight it" requirement.
  const focusEntity = useCallback(
    (entityId: string) => {
      const entity = entities.find((e) => e.id === entityId);
      const el = ref.current;
      if (entity && el) {
        const center = nodeCenter(entity);
        const rect = el.getBoundingClientRect();
        setView((v) => ({
          ...v,
          x: rect.width / 2 - center.x * v.z,
          y: rect.height / 2 - center.y * v.z,
        }));
      }
      select({ kind: "entity", id: entityId });
    },
    [entities, setView, select],
  );

  // Creating an Entity Type from the Ontology header (there's no side panel to hold it in
  // anymore) places it at the current viewport's own center in world space, so it's immediately
  // visible without the user having to go find it — rather than app-state's own default (0, 0),
  // which Detail's panel-based creation deliberately keeps (there, the user places it themselves
  // via drag, so it's fine for it to start off-canvas).
  const handleCreateEntity = useCallback(
    (name: string) => {
      const el = ref.current;
      if (!el) {
        createEntity(name);
        return;
      }
      const rect = el.getBoundingClientRect();
      const center = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      createEntity(name, center);
    },
    [createEntity, toWorld],
  );

  // On-demand ontology search — a floating popover off the Ontology canvas header's own Search
  // toggle (see CreateEntityButton for the identical outside-click-closes pattern this mirrors).
  // Deliberately not the Data Tables panel's own inline Row-3 search row: this one floats over
  // the canvas rather than pushing it down, since there's no side panel here to expand into.
  const ontologySearchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!entitySearchOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ontologySearchRef.current && !ontologySearchRef.current.contains(e.target as Node)) {
        toggleEntitySearch();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [entitySearchOpen, toggleEntitySearch]);

  return (
    <div className="flex h-full w-full gap-3 p-3">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-node-border bg-node shadow-[var(--shadow-node)]">
        <div className="flex shrink-0 items-center justify-between border-b border-node-border px-4 py-3">
          <span className="text-[14px] font-semibold">Ontology</span>
          <div className="flex shrink-0 items-center gap-1">
            <CreateEntityButton onCreate={handleCreateEntity} />
            <button
              type="button"
              onClick={toggleEntitySearch}
              aria-pressed={entitySearchOpen}
              aria-label={entitySearchOpen ? "Close ontology search" : "Search ontology"}
              title={entitySearchOpen ? "Close search" : "Search"}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                entitySearchOpen
                  ? "bg-black/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              <Search className="size-3.5" />
            </button>
          </div>
        </div>

        {/* On-demand ontology search — a floating popover, not a persistent side panel: Entity
            Types already render directly on the canvas below, so a second always-visible list of
            them would just duplicate that. Only ever shows results for an actual query — it never
            falls back to listing everything the way the old panel's search used to. */}
        {entitySearchOpen && (
          <div
            ref={ontologySearchRef}
            className="absolute right-4 top-[52px] z-30 flex max-h-[70%] w-80 flex-col gap-2 overflow-hidden rounded-2xl border border-node-border bg-node p-3 shadow-[var(--shadow-node-lift)]"
          >
            <SearchInput
              value={entitySearch}
              onChange={setEntitySearch}
              placeholder="Search ontology..."
            />
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
              {entityQuery === "" && (
                <p className="px-1 py-2 text-center text-[11.5px] text-muted-foreground">
                  Search Entity Type, Property, or Relation names.
                </p>
              )}
              {entityQuery !== "" && (
                <>
                  {filteredEntities.map((e) => {
                    const isSelected = selection?.kind === "entity" && selection.id === e.id;
                    const matchedProperties = matchedPropertiesByEntity.get(e.id);
                    const tableCount = tablesUsedByEntity(e).length;
                    return (
                      <div key={e.id} className="flex flex-col gap-1">
                        <button
                          onClick={() => {
                            focusEntity(e.id);
                            toggleEntitySearch();
                          }}
                          className={cn(
                            "flex w-full shrink-0 items-center gap-2 rounded-[10px] border border-black/[0.08] bg-white px-3 py-2 font-normal text-left transition-colors",
                            isSelected ? "ring-2 ring-primary" : "hover:bg-accent",
                          )}
                        >
                          <StatusBadge
                            status={entityStatus(e)}
                            size={20}
                            confidence={e.confidence}
                            warningReason={e.warningReason}
                            errorReason={entityErrorReason(e)}
                          />
                          <span className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                            <span className="block w-full truncate text-[12px] font-medium leading-[16.5px] text-[#171B22]">
                              {e.name || "Untitled entity"}
                            </span>
                            <span className="block w-full truncate text-[10px] font-normal leading-[10px] text-[#909090]">
                              {e.properties.length} props · {tableCount} table
                              {tableCount === 1 ? "" : "s"}
                            </span>
                          </span>
                          <ConfidenceChip confidence={e.confidence} />
                        </button>
                        {/* A Property-name match keeps its parent Entity Type visible even when
                            the Entity Type's own name doesn't match — since a Property can only
                            be inspected inside Detail, selecting it navigates there (unlike the
                            Entity result above, which stays on Overview) with the matched
                            Property already highlighted. */}
                        {matchedProperties && (
                          <ul className="flex flex-col gap-0.5 pl-9">
                            {matchedProperties.map((p) => (
                              <li key={p.id}>
                                <button
                                  onClick={() => {
                                    openDetail("entity", e.id, p.id);
                                    toggleEntitySearch();
                                  }}
                                  className="w-full truncate rounded-md px-1 text-left text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  {p.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  {matchedRelations.map((r) => {
                    const isSelected = selection?.kind === "relation" && selection.id === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          focusRelation(r.id);
                          toggleEntitySearch();
                        }}
                        className={cn(
                          "flex w-full shrink-0 flex-col items-start gap-1 rounded-[10px] border border-black/[0.08] bg-white px-3 py-2 font-normal text-left transition-colors",
                          isSelected ? "ring-2 ring-primary" : "hover:bg-accent",
                        )}
                      >
                        <span className="flex w-full items-center gap-2">
                          <StatusBadge
                            status={r.status}
                            size={20}
                            confidence={r.confidence}
                            warningReason={r.warningReason}
                            errorReason={r.errorReason}
                          />
                          <span className="block min-w-0 flex-1 truncate text-[12px] font-medium leading-[16.5px] text-[#171B22]">
                            {relationLabel(r)}
                          </span>
                          <ConfidenceChip confidence={r.confidence} />
                        </span>
                        <span className="pl-7 text-[10.5px] text-muted-foreground">
                          {entities.find((e) => e.id === r.from)?.name || "Untitled"} →{" "}
                          {entities.find((e) => e.id === r.to)?.name || "Untitled"}
                        </span>
                      </button>
                    );
                  })}
                  {filteredEntities.length === 0 && matchedRelations.length === 0 && (
                    <p className="px-1 text-center text-[11.5px] text-muted-foreground">
                      No matches for "{entitySearch}".
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div
          ref={ref}
          className="relative min-h-0 flex-1 select-none overflow-hidden canvas-grid"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="absolute origin-top-left"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          >
            <svg className="pointer-events-none absolute overflow-visible" width={1} height={1}>
              <defs>
                {/* Arrowhead for relation lines, pointing at the relation's actual `to` entity —
                    `edgeAnchors(a, b)` always returns p1 on the `from` side and p2 on the `to`
                    side (see below), so the marker on `p2` is already correct regardless of which
                    side of the screen the `to` entity happens to be on. Same marker as Detail's
                    own relation lines, so both canvases read consistently. */}
                <marker
                  id="relation-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth={6}
                  markerHeight={6}
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" className="fill-zinc-400" />
                </marker>
              </defs>
              {relations.map((r) => {
                const a = entities.find((e) => e.id === r.from);
                const b = entities.find((e) => e.id === r.to);
                if (!a || !b) return null;
                const { p1, p2 } = edgeAnchors(a, b);
                const isSelected = selection?.kind === "relation" && selection.id === r.id;
                const isFocusEdge = activeEntityIds
                  ? activeEntityIds.has(r.from) || activeEntityIds.has(r.to)
                  : false;
                const outOfRange =
                  !inConfidenceRange(a.confidence) || !inConfidenceRange(b.confidence);
                const isMuted = outOfRange || (activeEntityIds !== null && !isFocusEdge);
                return (
                  <path
                    key={r.id}
                    d={orthogonalPath(
                      p1,
                      p2,
                      undefined,
                      Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "horizontal" : "vertical",
                    )}
                    fill="none"
                    strokeLinecap="round"
                    className={cn(
                      "transition-opacity",
                      isSelected || isFocusEdge ? "stroke-primary" : "stroke-zinc-400",
                      isMuted && "opacity-25",
                    )}
                    strokeWidth={isSelected ? 2.4 : isFocusEdge ? 2 : 1.4}
                    markerEnd="url(#relation-arrow)"
                  />
                );
              })}
              {/* live preview line while dragging a connector out to a new entity — stays anchored
                  to the exact handle that was grabbed, rather than sliding around the node to
                  chase the pointer. */}
              {connectDrag && connectPos && (
                <path
                  d={`M ${connectDrag.origin.x} ${connectDrag.origin.y} L ${connectPos.x} ${connectPos.y}`}
                  fill="none"
                  stroke="#61b2ff"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  opacity={0.9}
                />
              )}
            </svg>

            {relations.map((r) => {
              const a = entities.find((e) => e.id === r.from);
              const b = entities.find((e) => e.id === r.to);
              if (!a || !b) return null;
              const { mid } = edgeAnchors(a, b);
              const isSelected = selection?.kind === "relation" && selection.id === r.id;
              return (
                <div
                  key={r.id}
                  title={relationLabel(r)}
                  style={{ left: mid.x, top: mid.y }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    select({ kind: "relation", id: r.id });
                  }}
                  className={cn(
                    "group/relpill absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer",
                    isSelected && "ring-2 ring-primary rounded-full",
                  )}
                >
                  {/* Icon-only by default; hovering reveals the name as a labeled pill (Figma:
                      "Relation / Default / *" vs "Relation / Hover / *"). Hover-to-delete is
                      temporarily disabled — the badge no longer swaps to a delete action. */}
                  <div
                    style={{ borderColor: statusBorderColor(r.status) }}
                    className="inline-flex items-center justify-center gap-0 rounded-full border-[1.5px] bg-white p-1 shadow-[0_2.281px_1.14px_0_rgba(0,0,0,0.1)] transition-[gap,padding] group-hover/relpill:gap-1 group-hover/relpill:pr-2"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full">
                      <StatusBadge
                        status={r.status}
                        size={16}
                        confidence={r.confidence}
                        warningReason={r.warningReason}
                        errorReason={r.errorReason}
                      />
                    </span>
                    <span className="block max-w-0 overflow-hidden whitespace-nowrap text-[10.5px] font-medium leading-[15.75px] text-[#171B22] opacity-0 transition-[max-width,opacity] group-hover/relpill:max-w-[160px] group-hover/relpill:opacity-100">
                      {relationLabel(r)}
                    </span>
                    {/* Hover-revealed delete — removes only this Relation/connector, never either
                        connected Entity Type. */}
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRelation(r.id);
                      }}
                      aria-label={`Delete relation ${relationLabel(r)}`}
                      title="Delete this relation"
                      className="ml-0 flex size-0 shrink-0 items-center justify-center overflow-hidden rounded-full text-muted-foreground opacity-0 transition-[width,opacity,margin-left] hover:bg-accent hover:text-foreground group-hover/relpill:ml-0.5 group-hover/relpill:size-4 group-hover/relpill:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              );
            })}

            {entities.map((entity) => (
              <div
                key={entity.id}
                className="absolute"
                style={{ left: entity.x, top: entity.y }}
                onMouseEnter={() => setHoveredEntityId(entity.id)}
                onMouseLeave={() => setHoveredEntityId((cur) => (cur === entity.id ? null : cur))}
              >
                <EntityNode
                  entity={entity}
                  emphasis={emphasisFor(entity.id)}
                  onClick={() => openDetail("entity", entity.id)}
                  onStartMove={(clientX, clientY) => startNodeMove(entity.id, clientX, clientY)}
                  onStartConnect={(side, clientX, clientY) =>
                    startConnectFromEntity(entity.id, side, clientX, clientY)
                  }
                  connectSourceSide={connectDrag?.sourceId === entity.id ? connectDrag.side : null}
                  connectTargetSide={connectTargetId === entity.id ? connectTargetSide : null}
                />
              </div>
            ))}
          </div>

          <CanvasControls
            className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2"
            tool={tool}
            onToolChange={setTool}
            zoomPercent={Math.round(view.z * 100)}
            onZoomOut={() => zoomBy(1 / 1.2)}
            onZoomIn={() => zoomBy(1.2)}
            onFitToContent={fitToContent}
          />
        </div>
      </div>

      <div
        style={{ width: dataTablesWidth }}
        className="relative flex shrink-0 flex-col overflow-hidden rounded-2xl border border-node-border bg-node shadow-[var(--shadow-node)]"
      >
        <div
          onPointerDown={startPanelResize}
          title="Drag to resize"
          aria-hidden="true"
          className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize"
        />
        <div className="flex shrink-0 items-center justify-between border-b border-node-border px-4 py-3">
          <span className="text-[14px] font-semibold">Data Tables</span>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-node-border px-3 py-1.5">
          <div className="flex items-center justify-between">
            <SortDropdown
              sort={tableSort}
              onChange={(k) => setTableSort((s) => nextSortState(s, k))}
            />
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleTableSearch}
              aria-pressed={tableSearchOpen}
              aria-label={tableSearchOpen ? "Close data tables search" : "Search data tables"}
              title={tableSearchOpen ? "Close search" : "Search"}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                tableSearchOpen
                  ? "bg-black/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {tableSearchOpen ? <X className="size-3.5" /> : <Search className="size-3.5" />}
            </button>
          </div>
          {tableSearchOpen && (
            <SearchInput
              value={tableSearch}
              onChange={setTableSearch}
              placeholder="Search data..."
            />
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {sortedTables.map((t) => {
            const isSelected = selection?.kind === "table" && selection.id === t.name;
            const matchedColumns = matchedColumnsByTable.get(t.name);
            const entityCount = entitiesUsingTable(t.name, entities).length;
            return (
              <div key={t.name} className="flex flex-col gap-1">
                <button
                  onClick={() => openDetail("table", t.name)}
                  onMouseEnter={() => setHoveredTableName(t.name)}
                  onMouseLeave={() => setHoveredTableName((cur) => (cur === t.name ? null : cur))}
                  className={cn(
                    "flex w-full shrink-0 items-center gap-2 rounded-[10px] border border-black/[0.08] bg-white px-3 py-2 font-normal text-left transition-colors",
                    isSelected ? "ring-2 ring-primary" : "hover:bg-accent",
                  )}
                >
                  <MappingStatusBadge status={tableMappingStatus(t.name, entities)} size={20} />
                  <span className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                    <span className="block w-full truncate text-[12px] font-medium leading-[16.5px] text-[#171B22]">
                      {t.name}
                    </span>
                    <span className="block w-full truncate text-[10px] font-normal leading-[10px] text-[#909090]">
                      {t.columns.length} columns · {entityCount} entit
                      {entityCount === 1 ? "y" : "ies"}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center justify-center gap-2.5 rounded-[10px] bg-black/[0.08] px-[6px] text-center text-[10px] font-normal leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                    {t.confidence != null ? `${Math.round(t.confidence * 100)}%` : "—"}
                  </span>
                </button>
                {/* A Column-name match keeps its parent Table visible even when the Table's own
                    name doesn't match — selecting it navigates into that Table's Detail view
                    with the matched Column already highlighted. */}
                {matchedColumns && (
                  <ul className="flex flex-col gap-0.5 pl-9">
                    {matchedColumns.map((c) => (
                      <li key={c.name}>
                        <button
                          onClick={() => openDetail("table", t.name, c.name)}
                          className="w-full truncate rounded-md px-1 text-left text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {filteredTables.length === 0 && (
            <p className="px-1 text-center text-[11.5px] text-muted-foreground">
              No data tables match "{tableSearch}".
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
