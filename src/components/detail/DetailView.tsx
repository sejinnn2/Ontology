import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Boxes, GitMerge, Minus, Plus, Redo2, Scissors, Table2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tableByName,
  tableColumnUsage,
  tableMappingStatus,
  entitiesUsingTable,
  type Entity,
  type TableSchema,
} from "@/lib/mock-data";
import { orthogonalPath, sideBetween } from "@/lib/geometry";
import type { Side } from "@/lib/geometry";
import type { DetailAnchor, OntologyApp } from "@/lib/app-state";
import { EntityNode } from "@/components/overview/EntityNode";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";
import { DraggableHandle } from "@/components/ontology/DraggableHandle";

const MIN_Z = 0.5;
const MAX_Z = 1.5;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

type Line = { id: string; x1: number; y1: number; x2: number; y2: number };
const curve = (l: Line) => orthogonalPath({ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });

function StatusDot({ status }: { status: "confirmed" | "suggested" }) {
  return <span className={cn("size-2 shrink-0 rounded-full", status === "confirmed" ? "bg-ok" : "bg-review")} />;
}

/**
 * The one reusable Detail shell: top bar (Back + anchor context), a left "Entity Types" toolbox
 * and a right "Data Tables" toolbox (both jump the whole Detail view to a different anchor,
 * without returning to Overview first), a center canvas area (pan/zoom, grid background — same
 * visual language as the Overview canvas), and bottom canvas controls. The actual mapping graph
 * is passed in as `children`, rendered inside the pannable/zoomable surface.
 */
function DetailShell({
  kindLabel,
  name,
  status,
  onBack,
  entityItems,
  onFocusEntity,
  onDropEntity,
  tableItems,
  entities,
  onFocusTable,
  onDropTable,
  zoom,
  setZoom,
  pan,
  setPan,
  children,
}: {
  kindLabel: "Entity Type" | "Source Table";
  name: string;
  status?: "confirmed" | "suggested";
  onBack: () => void;
  entityItems: Entity[];
  onFocusEntity: (id: string) => void;
  /** Dropping an Entity Type from the toolbox onto the canvas places it there instead of
   * navigating — a lightweight way to bring another item into view without leaving this one. */
  onDropEntity: (id: string) => void;
  tableItems: TableSchema[];
  /** Live entities, used only to compute each table's mapping-status badge in the toolbox. */
  entities: Entity[];
  onFocusTable: (name: string) => void;
  onDropTable: (name: string) => void;
  zoom: number;
  setZoom: (fn: (z: number) => number) => void;
  pan: { x: number; y: number };
  setPan: (fn: (p: { x: number; y: number }) => { x: number; y: number }) => void;
  children: React.ReactNode;
}) {
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPan(() => ({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const zoomBy = (factor: number) => setZoom((z) => clamp(z * factor, MIN_Z, MAX_Z));

  // Dragging a toolbox item: a plain click still navigates (see the pointerup handling below) —
  // it only becomes a "drop onto the canvas" placement once the pointer has actually moved past
  // a small threshold, so a normal click never accidentally places a duplicate.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tbDrag, setTbDrag] = useState<{ kind: "entity" | "table"; id: string; label: string } | null>(null);
  const [tbDragPos, setTbDragPos] = useState<{ x: number; y: number } | null>(null);
  const [overCanvas, setOverCanvas] = useState(false);
  const tbDragInfo = useRef<{ kind: "entity" | "table"; id: string; label: string; sx: number; sy: number; moved: boolean } | null>(null);

  // Latest callbacks in refs so the single mount-time window listener below always calls the
  // current version without needing to resubscribe on every render.
  const callbacksRef = useRef({ onFocusEntity, onDropEntity, onFocusTable, onDropTable });
  callbacksRef.current = { onFocusEntity, onDropEntity, onFocusTable, onDropTable };

  const startToolboxDrag = (kind: "entity" | "table", id: string, label: string, x: number, y: number) => {
    tbDragInfo.current = { kind, id, label, sx: x, sy: y, moved: false };
  };

  useEffect(() => {
    const isOverCanvas = (x: number, y: number) => {
      const r = canvasRef.current?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const onMove = (e: PointerEvent) => {
      const info = tbDragInfo.current;
      if (!info) return;
      if (!info.moved && Math.hypot(e.clientX - info.sx, e.clientY - info.sy) > 6) {
        info.moved = true;
        setTbDrag({ kind: info.kind, id: info.id, label: info.label });
      }
      if (info.moved) {
        setTbDragPos({ x: e.clientX, y: e.clientY });
        setOverCanvas(isOverCanvas(e.clientX, e.clientY));
      }
    };
    const onUp = (e: PointerEvent) => {
      const info = tbDragInfo.current;
      tbDragInfo.current = null;
      setTbDrag(null);
      setTbDragPos(null);
      setOverCanvas(false);
      if (!info) return;
      const cb = callbacksRef.current;
      if (info.moved) {
        if (isOverCanvas(e.clientX, e.clientY)) {
          if (info.kind === "entity") cb.onDropEntity(info.id);
          else cb.onDropTable(info.id);
        }
      } else if (info.kind === "entity") {
        cb.onFocusEntity(info.id);
      } else {
        cb.onFocusTable(info.id);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* TOP — Back to Overview + anchor context. Global review/progress controls will slot in
          here alongside Back once they exist; nothing to preserve yet in this project. */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
        <button
          onClick={onBack}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft className="size-3.5" /> Back to Overview
        </button>
        <span className="h-4 w-px shrink-0 bg-border" />
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{kindLabel}</span>
        {status && <StatusDot status={status} />}
        <h1 className="min-w-0 truncate text-[15px] font-semibold">{name}</h1>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* LEFT — Entity Types toolbox: jump the whole Detail view onto a different entity. */}
        <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-node-border bg-node shadow-[var(--shadow-node)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-node-border px-3 py-2.5">
            <Boxes className="size-3.5" strokeWidth={2} />
            <span className="text-[13px] font-semibold">Entity Types</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {entityItems.map((e) => (
              <button
                key={e.id}
                onPointerDown={(ev) => {
                  if (ev.button !== 0) return;
                  startToolboxDrag("entity", e.id, e.name, ev.clientX, ev.clientY);
                }}
                // Mouse clicks are handled by the pointerdown/pointerup drag-vs-click logic above;
                // a keyboard-activated click (Enter/Space on a focused button) never goes through
                // pointerdown at all and has event.detail === 0, so this only ever fires for that.
                onClick={(ev) => {
                  if (ev.detail === 0) onFocusEntity(e.id);
                }}
                title={`Click to open, or drag onto the canvas to place ${e.name} here`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent",
                  tbDrag?.kind === "entity" && tbDrag.id === e.id && "opacity-30",
                )}
              >
                <StatusDot status={e.status} />
                <span className="truncate">{e.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* CENTER — the focused mapping canvas. Same grid background / pan / zoom language as
            the Overview canvas, so entering Detail reads as zooming into one part of it. */}
        <div
          className={cn(
            "relative min-w-0 flex-1 overflow-hidden rounded-xl border bg-node shadow-[var(--shadow-node)] transition-colors",
            tbDrag && overCanvas ? "border-primary ring-2 ring-primary/30" : "border-node-border",
          )}
        >
          <div
            ref={canvasRef}
            className="relative h-full w-full select-none overflow-hidden canvas-grid"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div
              className="absolute left-1/2 top-1/2 origin-center"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            >
              {children}
            </div>
          </div>

          {/* BOTTOM — canvas controls: zoom + (stubbed) undo/redo. No history to wire up yet. */}
          <div
            className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node)]">
              <button className="rounded-md p-1.5 hover:bg-accent" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
                <Minus className="size-3.5" />
              </button>
              <span className="w-10 text-center font-mono text-[11px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <button className="rounded-md p-1.5 hover:bg-accent" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node)]">
              <button className="rounded-md p-1.5 text-muted-foreground opacity-30" disabled aria-label="Undo">
                <Undo2 className="size-3.5" />
              </button>
              <button className="rounded-md p-1.5 text-muted-foreground opacity-30" disabled aria-label="Redo">
                <Redo2 className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — Data Tables toolbox: jump the whole Detail view onto a different table. */}
        <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-node-border bg-node shadow-[var(--shadow-node)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-node-border px-3 py-2.5">
            <Table2 className="size-3.5" strokeWidth={2} />
            <span className="text-[13px] font-semibold">Data Tables</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {tableItems.map((t) => (
              <button
                key={t.name}
                onPointerDown={(ev) => {
                  if (ev.button !== 0) return;
                  startToolboxDrag("table", t.name, t.name, ev.clientX, ev.clientY);
                }}
                onClick={(ev) => {
                  if (ev.detail === 0) onFocusTable(t.name);
                }}
                title={`Click to open, or drag onto the canvas to place ${t.name} here`}
                className={cn(
                  "flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent",
                  tbDrag?.kind === "table" && tbDrag.id === t.name && "opacity-30",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium">{t.name}</span>
                  <MappingStatusBadge status={tableMappingStatus(t.name, entities)} size={14} />
                </span>
                <span className="text-[10px] text-muted-foreground">{t.columns.length} columns</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ghost preview following the cursor while dragging a toolbox item toward the canvas */}
      {tbDrag && tbDragPos && (
        <div
          style={{ left: tbDragPos.x, top: tbDragPos.y }}
          className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-node-border bg-node px-3 py-1.5 text-[12px] font-medium text-foreground opacity-90 shadow-[var(--shadow-node-lift)]"
        >
          {tbDrag.kind === "entity" ? <Boxes className="size-3.5 shrink-0" strokeWidth={2} /> : <Table2 className="size-3.5 shrink-0" strokeWidth={2} />}
          {tbDrag.label}
        </div>
      )}
    </div>
  );
}

export function DetailView({ app, anchor }: { app: OntologyApp; anchor: NonNullable<DetailAnchor> }) {
  const { entities, tables, closeDetail, openDetail } = app;
  const onFocusEntity = useCallback((id: string) => openDetail("entity", id), [openDetail]);
  const onFocusTable = useCallback((name: string) => openDetail("table", name), [openDetail]);

  if (anchor.kind === "entity") {
    const entity = entities.find((e) => e.id === anchor.id);
    if (!entity) return null;
    return (
      <EntityDetailCanvas
        key={entity.id}
        app={app}
        entity={entity}
        onBack={closeDetail}
        onFocusEntity={onFocusEntity}
        onFocusTable={onFocusTable}
        entityItems={entities.filter((e) => e.id !== entity.id)}
        tableItems={tables}
      />
    );
  }

  const table = tableByName(anchor.id);
  if (!table) return null;
  return (
    <TableDetailCanvas
      key={table.name}
      app={app}
      table={table}
      onBack={closeDetail}
      onFocusEntity={onFocusEntity}
      onFocusTable={onFocusTable}
      entityItems={entities}
      tableItems={tables.filter((t) => t.name !== table.name)}
    />
  );
}

/** Entity-focused Detail: the anchor Entity Type on top, its directly related entities beside it
 * (subtle — click to re-focus Detail onto one of them), and the central Properties <-> Columns
 * mapping below, columns grouped by the source table they belong to. */
function EntityDetailCanvas({
  app,
  entity,
  onBack,
  onFocusEntity,
  onFocusTable,
  entityItems,
  tableItems,
}: {
  app: OntologyApp;
  entity: Entity;
  onBack: () => void;
  onFocusEntity: (id: string) => void;
  onFocusTable: (name: string) => void;
  entityItems: Entity[];
  tableItems: TableSchema[];
}) {
  const { relations, entities, updateMapping, moveProperty, splitEntity, mergeEntities, addRelation } = app;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const related = useMemo(
    () =>
      relations
        .filter((r) => r.from === entity.id || r.to === entity.id)
        .map((r) => entities.find((e) => e.id === (r.from === entity.id ? r.to : r.from)))
        .filter((e): e is Entity => !!e),
    [relations, entities, entity.id],
  );

  // Entity Types dragged in from the left toolbox — placed as extra satellites alongside the
  // real related entities, purely so they're visible here; dragging one in doesn't fabricate a
  // relationship (that's an Edit-step action, not implemented yet).
  const [extraEntityIds, setExtraEntityIds] = useState<string[]>([]);
  const relatedIds = useMemo(() => new Set(related.map((e) => e.id)), [related]);
  const allRelated = useMemo(() => {
    const extra = extraEntityIds
      .filter((id) => id !== entity.id && !relatedIds.has(id))
      .map((id) => entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e);
    return [...related, ...extra];
  }, [related, extraEntityIds, relatedIds, entity.id, entities]);
  const onDropEntity = useCallback(
    (id: string) => setExtraEntityIds((ids) => (ids.includes(id) ? ids : [...ids, id])),
    [],
  );

  // Source Tables dragged in from the right toolbox — placed as an extra column group, all of
  // whose columns start unmapped (no property points to them yet, so no connector is drawn).
  const [extraTableNames, setExtraTableNames] = useState<string[]>([]);
  const usedTableNames = useMemo(
    () => new Set(entity.properties.filter((p) => p.mapping).map((p) => p.mapping!.table)),
    [entity],
  );
  const onDropTable = useCallback(
    (name: string) =>
      setExtraTableNames((ts) => (ts.includes(name) || usedTableNames.has(name) ? ts : [...ts, name])),
    [usedTableNames],
  );

  const columnGroups = useMemo(() => {
    const byTable = new Map<string, { propertyId: string; column: string; type: string }[]>();
    entity.properties.forEach((p) => {
      if (!p.mapping) return;
      const list = byTable.get(p.mapping.table) ?? [];
      const col = tableByName(p.mapping.table)?.columns.find((c) => c.name === p.mapping!.column);
      list.push({ propertyId: p.id, column: p.mapping.column, type: col?.type ?? "" });
      byTable.set(p.mapping.table, list);
    });
    // Show every column of the entity's own primary table (not just whichever ones already have
    // a property pointing at them) so an unmapped — or about-to-be-reconnected — property always
    // has somewhere to connect to.
    const primary = tableByName(entity.table);
    if (primary) {
      const already = byTable.get(entity.table) ?? [];
      const mappedCols = new Set(already.map((c) => c.column));
      const rest = primary.columns.filter((c) => !mappedCols.has(c.name)).map((c) => ({ propertyId: "", column: c.name, type: c.type }));
      const merged = [...already, ...rest];
      merged.sort((a, b) => primary.columns.findIndex((c) => c.name === a.column) - primary.columns.findIndex((c) => c.name === b.column));
      byTable.set(entity.table, merged);
    }
    extraTableNames.forEach((t) => {
      if (byTable.has(t)) return;
      const table = tableByName(t);
      if (table) byTable.set(t, table.columns.map((c) => ({ propertyId: "", column: c.name, type: c.type })));
    });
    return Array.from(byTable.entries());
  }, [entity, extraTableNames]);

  const containerRef = useRef<HTMLDivElement>(null);
  const propsCardRef = useRef<HTMLDivElement>(null);
  const relatedRefs = useRef<Map<string, HTMLElement>>(new Map());
  const propertyRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [lines, setLines] = useState<Line[]>([]);
  const [relatedLines, setRelatedLines] = useState<Line[]>([]);

  const computeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const pt = (el: Element, side: "left" | "right" | "top" | "bottom", gap = 0) => {
      const r = el.getBoundingClientRect();
      const x = side === "left" ? r.left - gap : side === "right" ? r.right + gap : r.left + r.width / 2;
      const y = side === "top" ? r.top - gap : side === "bottom" ? r.bottom + gap : r.top + r.height / 2;
      return { x: (x - cRect.left) / zoom, y: (y - cRect.top) / zoom };
    };

    const next: Line[] = [];
    columnGroups.forEach(([table, cols]) => {
      cols.forEach((c) => {
        const propEl = propertyRefs.current.get(c.propertyId);
        const colEl = columnRefs.current.get(`${table}.${c.column}`);
        if (!propEl || !colEl) return;
        const p1 = pt(propEl, "right", 8);
        const p2 = pt(colEl, "left", 8);
        next.push({ id: `pc-${c.propertyId}-${table}.${c.column}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      });
    });
    setLines(next);

    const nextRelated: Line[] = [];
    const cardEl = propsCardRef.current;
    if (cardEl) {
      const a = pt(cardEl, "left", 8);
      allRelated.forEach((other) => {
        const el = relatedRefs.current.get(other.id);
        if (!el) return;
        // Related satellites are circular EntityNodes — an 8px gap keeps the connector from
        // touching the node's own border, same as the Overview canvas's node connectors.
        const b = pt(el, "right", 8);
        nextRelated.push({ id: `rel-${other.id}`, x1: b.x, y1: b.y, x2: a.x, y2: a.y });
      });
    }
    setRelatedLines(nextRelated);
  }, [entity, columnGroups, allRelated, zoom]);

  useLayoutEffect(() => computeLines(), [computeLines]);
  useLayoutEffect(() => {
    window.addEventListener("resize", computeLines);
    return () => window.removeEventListener("resize", computeLines);
  }, [computeLines]);

  // --- Property <-> Column drag-to-map ------------------------------------------------------
  // Either end can start the drag (a property's own connect handle, or a column's), and it
  // always completes on whichever kind of node it's released over — connecting sets that
  // property's one mapping, so "reconnect" is just the same gesture landing on a different
  // column (or a different property, for a column-anchored drag).
  type MapDropTarget = { type: "column"; table: string; column: string } | { type: "property"; propertyId: string };
  const [dragOrigin, setDragOrigin] = useState<
    { anchor: "property"; propertyId: string; x1: number; y1: number } | { anchor: "column"; table: string; column: string; x1: number; y1: number } | null
  >(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [mapDropTarget, setMapDropTarget] = useState<MapDropTarget | null>(null);
  const mapDropTargetRef = useRef<MapDropTarget | null>(null);

  useEffect(() => {
    if (!dragOrigin) return;
    const container = containerRef.current;
    const onMove = (e: MouseEvent) => {
      if (container) {
        const r = container.getBoundingClientRect();
        setDragPos({ x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom });
      }
      let hit: MapDropTarget | null = null;
      columnRefs.current.forEach((el, key) => {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          const idx = key.lastIndexOf(".");
          hit = { type: "column", table: key.slice(0, idx), column: key.slice(idx + 1) };
        }
      });
      if (!hit) {
        propertyRefs.current.forEach((el, propertyId) => {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            hit = { type: "property", propertyId };
          }
        });
      }
      mapDropTargetRef.current = hit;
      setMapDropTarget(hit);
    };
    const onUp = () => {
      const target = mapDropTargetRef.current;
      const origin = dragOrigin;
      if (target) {
        if (origin.anchor === "property" && target.type === "column") {
          updateMapping(entity.id, origin.propertyId, { table: target.table, column: target.column });
        } else if (origin.anchor === "column" && target.type === "property") {
          updateMapping(entity.id, target.propertyId, { table: origin.table, column: origin.column });
        }
      }
      mapDropTargetRef.current = null;
      setMapDropTarget(null);
      setDragOrigin(null);
      setDragPos(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragOrigin, updateMapping, zoom, entity.id]);

  // --- Move: drag a property row onto a related satellite to move it onto that entity. A plain
  // click (no movement) falls through to the shift/cmd-select handling below, same drag-vs-click
  // threshold as the toolbox drag. -----------------------------------------------------------
  const movePropertyInfo = useRef<{ propertyId: string; sx: number; sy: number; moved: boolean } | null>(null);
  const [movePropertyDrag, setMovePropertyDrag] = useState<{ propertyId: string; name: string } | null>(null);
  const [movePropertyPos, setMovePropertyPos] = useState<{ x: number; y: number } | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);

  const startMoveProperty = (propertyId: string, x: number, y: number) => {
    movePropertyInfo.current = { propertyId, sx: x, sy: y, moved: false };
  };

  useEffect(() => {
    const findRelatedAt = (x: number, y: number) => {
      let hit: string | null = null;
      relatedRefs.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = id;
      });
      return hit;
    };
    const onMove = (e: PointerEvent) => {
      const info = movePropertyInfo.current;
      if (!info) return;
      if (!info.moved && Math.hypot(e.clientX - info.sx, e.clientY - info.sy) > 6) {
        info.moved = true;
        const prop = entity.properties.find((p) => p.id === info.propertyId);
        setMovePropertyDrag({ propertyId: info.propertyId, name: prop?.name ?? "" });
      }
      if (info.moved) {
        setMovePropertyPos({ x: e.clientX, y: e.clientY });
        setMoveTargetId(findRelatedAt(e.clientX, e.clientY));
      }
    };
    const onUp = (e: PointerEvent) => {
      const info = movePropertyInfo.current;
      movePropertyInfo.current = null;
      setMovePropertyDrag(null);
      setMovePropertyPos(null);
      setMoveTargetId(null);
      if (!info || !info.moved) return;
      const hit = findRelatedAt(e.clientX, e.clientY);
      if (hit) moveProperty(info.propertyId, entity.id, hit);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [entity.id, entity.properties, moveProperty]);

  // --- Entity connect: drag from a related satellite's boundary handle onto another satellite to
  // create a Relation between them — the same grammar and the same addRelation/duplicate-guard
  // logic as the Overview canvas, just scoped to the satellites visible here. ------------------
  const [entityConnectDrag, setEntityConnectDrag] = useState<{ sourceId: string; side: Side; origin: { x: number; y: number } } | null>(null);
  const [entityConnectPos, setEntityConnectPos] = useState<{ x: number; y: number } | null>(null);
  const [entityConnectTargetId, setEntityConnectTargetId] = useState<string | null>(null);

  const toContainerPos = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const r = container.getBoundingClientRect();
      return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
    },
    [zoom],
  );

  const startEntityConnect = useCallback(
    (otherId: string, side: Side, clientX: number, clientY: number) => {
      setEntityConnectDrag({ sourceId: otherId, side, origin: toContainerPos(clientX, clientY) });
      setEntityConnectPos(toContainerPos(clientX, clientY));
    },
    [toContainerPos],
  );

  useEffect(() => {
    if (!entityConnectDrag) return;
    const findRelatedAt = (x: number, y: number, excludeId: string) => {
      let hit: string | null = null;
      relatedRefs.current.forEach((el, id) => {
        if (id === excludeId) return;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = id;
      });
      return hit;
    };
    const onMove = (e: PointerEvent) => {
      setEntityConnectPos(toContainerPos(e.clientX, e.clientY));
      setEntityConnectTargetId(findRelatedAt(e.clientX, e.clientY, entityConnectDrag.sourceId));
    };
    const onUp = (e: PointerEvent) => {
      const hit = findRelatedAt(e.clientX, e.clientY, entityConnectDrag.sourceId);
      if (hit) addRelation(entityConnectDrag.sourceId, hit);
      setEntityConnectDrag(null);
      setEntityConnectPos(null);
      setEntityConnectTargetId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [entityConnectDrag, toContainerPos, addRelation]);

  const entityConnectTargetSide = useMemo(() => {
    if (!entityConnectTargetId || !entityConnectPos) return null;
    const el = relatedRefs.current.get(entityConnectTargetId);
    const container = containerRef.current;
    if (!el || !container) return null;
    const r = el.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const center = { x: (r.left + r.width / 2 - c.left) / zoom, y: (r.top + r.height / 2 - c.top) / zoom };
    return sideBetween(center, entityConnectPos);
  }, [entityConnectTargetId, entityConnectPos, zoom]);

  // --- Split: shift/cmd-click property rows to select them, then Split moves that subset onto a
  // brand-new entity, and Detail jumps to it. ------------------------------------------------
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(new Set());
  const togglePropertySelected = useCallback((id: string) => {
    setSelectedPropertyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleSplit = () => {
    const newId = splitEntity(entity.id, Array.from(selectedPropertyIds));
    setSelectedPropertyIds(new Set());
    if (newId) onFocusEntity(newId);
  };

  // --- Merge: shift/cmd-click 1+ related satellites to select them, then Merge combines them
  // with the anchor entity into a brand-new one, and Detail jumps to it. ---------------------
  const [selectedRelatedIds, setSelectedRelatedIds] = useState<Set<string>>(new Set());
  const toggleRelatedSelected = useCallback((id: string) => {
    setSelectedRelatedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const mergeCandidates = useMemo(
    () => allRelated.filter((e) => selectedRelatedIds.has(e.id)),
    [allRelated, selectedRelatedIds],
  );
  const handleMerge = () => {
    if (!mergeName.trim()) return;
    const ids = [entity.id, ...mergeCandidates.map((e) => e.id)];
    const newId = mergeEntities(ids, mergeName.trim());
    setSelectedRelatedIds(new Set());
    setMergePanelOpen(false);
    setMergeName("");
    if (newId) onFocusEntity(newId);
  };

  return (
    <>
    <DetailShell
      kindLabel="Entity Type"
      name={entity.name}
      status={entity.status}
      onBack={onBack}
      entityItems={entityItems}
      onFocusEntity={onFocusEntity}
      onDropEntity={onDropEntity}
      tableItems={tableItems}
      entities={entities}
      onFocusTable={onFocusTable}
      onDropTable={onDropTable}
      zoom={zoom}
      setZoom={setZoom}
      pan={pan}
      setPan={setPan}
    >
      <div ref={containerRef} className="relative flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-10 whitespace-nowrap">
        <svg className="pointer-events-none absolute inset-0 z-20 overflow-visible">
          {relatedLines.map((l) => (
            <path key={l.id} d={curve(l)} fill="none" strokeLinecap="round" className="stroke-zinc-400" strokeWidth={1.3} opacity={0.7} />
          ))}
          {lines.map((l) => (
            <path key={l.id} d={curve(l)} fill="none" strokeLinecap="round" className="stroke-zinc-400" strokeWidth={1.4} opacity={0.85} />
          ))}
          {dragOrigin && dragPos && (
            <path d={`M ${dragOrigin.x1} ${dragOrigin.y1} L ${dragPos.x} ${dragPos.y}`} fill="none" stroke="#61b2ff" strokeWidth={2} strokeDasharray="4 3" opacity={0.9} />
          )}
          {entityConnectDrag && entityConnectPos && (
            <path
              d={`M ${entityConnectDrag.origin.x} ${entityConnectDrag.origin.y} L ${entityConnectPos.x} ${entityConnectPos.y}`}
              fill="none"
              stroke="#61b2ff"
              strokeWidth={2}
              strokeDasharray="4 3"
              opacity={0.9}
            />
          )}
        </svg>

        {/* Properties <-> Columns: the central relationship. Related entities (subtle, click to
            re-focus, shift/cmd-click to select for Merge) connect straight into the Properties
            card — no separate anchor circle. */}
        <div className="relative z-10 flex items-start gap-20">
          <div className="flex flex-col items-center gap-6 pt-8">
            {allRelated.map((other) => (
              <div
                key={other.id}
                ref={(el) => {
                  if (el) relatedRefs.current.set(other.id, el);
                  else relatedRefs.current.delete(other.id);
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-full opacity-70 transition-opacity hover:opacity-100",
                  selectedRelatedIds.has(other.id) && "opacity-100 ring-2 ring-primary ring-offset-2",
                )}
                title={
                  selectedRelatedIds.has(other.id)
                    ? "Selected for merge — click to deselect"
                    : "Click to focus, shift-click to select for merge, or drop a dragged property here to move it"
                }
              >
                <EntityNode
                  entity={other}
                  size={52}
                  moveTarget={moveTargetId === other.id}
                  onClick={(e) => {
                    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleRelatedSelected(other.id);
                    else onFocusEntity(other.id);
                  }}
                  onStartConnect={(side, clientX, clientY) => startEntityConnect(other.id, side, clientX, clientY)}
                  connectSourceSide={entityConnectDrag?.sourceId === other.id ? entityConnectDrag.side : null}
                  connectTargetSide={entityConnectTargetId === other.id ? entityConnectTargetSide : null}
                />
              </div>
            ))}
          </div>

          <div ref={propsCardRef} className="flex w-56 flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
            <span className="flex items-center gap-1.5 truncate px-1 pb-1 text-[13px] font-medium text-foreground">
              <Boxes className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <StatusDot status={entity.status} />
              {entity.name}
            </span>
            {entity.properties.map((p) => {
              const isDropTarget = mapDropTarget?.type === "property" && mapDropTarget.propertyId === p.id;
              const isSelected = selectedPropertyIds.has(p.id);
              return (
                <div
                  key={p.id}
                  ref={(el) => {
                    if (el) propertyRefs.current.set(p.id, el);
                    else propertyRefs.current.delete(p.id);
                  }}
                  onClick={(e) => {
                    if (e.shiftKey || e.metaKey || e.ctrlKey) togglePropertySelected(p.id);
                  }}
                  title="Shift-click to select for split"
                  className={cn(
                    "group/prop relative flex items-center gap-2 rounded-full bg-white px-3 py-2 text-[12px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-shadow",
                    isSelected && "shadow-[0_0_0_2px_#60a5fa]",
                    isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                    movePropertyDrag?.propertyId === p.id && "opacity-40",
                  )}
                >
                  {/* STATUS — left, ~20px reserved, never triggers dragging or connecting. */}
                  <span className="flex w-5 shrink-0 items-center justify-center">
                    <StatusDot status={p.status} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">{p.type}</span>
                  {/* DRAGGABLE — right, moves the Property itself onto another Entity. Never
                      creates a connection. */}
                  <DraggableHandle
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      startMoveProperty(p.id, e.clientX, e.clientY);
                    }}
                    aria-label={`Drag to move ${p.name} to another entity`}
                    title="Drag to move to another entity"
                  />
                  {p.mapping && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateMapping(entity.id, p.id, null);
                      }}
                      title="Clear this property's mapping"
                      aria-label={`Clear mapping for ${p.name}`}
                      className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-[var(--shadow-node)] transition-opacity group-hover/prop:opacity-100"
                    >
                      <X className="size-3" strokeWidth={2.5} />
                    </button>
                  )}
                  {/* CONNECTION HANDLE — boundary, separate from Draggable. Hover-revealed; drag
                      onto a column to connect (or reconnect) this property's one mapping. Never
                      moves the Property. */}
                  <ConnectionHandle
                    active={isDropTarget}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const container = containerRef.current;
                      const pos = container ? { x: (e.clientX - container.getBoundingClientRect().left) / zoom, y: (e.clientY - container.getBoundingClientRect().top) / zoom } : { x: 0, y: 0 };
                      setDragOrigin({ anchor: "property", propertyId: p.id, x1: pos.x, y1: pos.y });
                      setDragPos(pos);
                    }}
                    aria-label={`Drag to connect ${p.name} to a column`}
                    title="Drag to connect to a column"
                    className="absolute -right-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/prop:opacity-100"
                  />
                </div>
              );
            })}
            {selectedPropertyIds.size > 0 && (
              <button
                onClick={handleSplit}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90"
              >
                <Scissors className="size-3.5" /> Split ({selectedPropertyIds.size})
              </button>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {columnGroups.length === 0 && (
              <p className="w-56 text-center text-[11.5px] text-muted-foreground">No properties mapped to a column yet.</p>
            )}
            {columnGroups.map(([table, cols]) => (
              <div key={table} className="flex w-56 flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onFocusTable(table)}
                  className="flex items-center gap-1.5 truncate px-1 pb-1 text-left font-mono text-[11.5px] font-semibold text-foreground hover:text-primary"
                  title={`Focus source table ${table}`}
                >
                  <Table2 className="size-3.5 shrink-0" strokeWidth={2} />
                  {table}
                </button>
                {cols.map((c) => {
                  const key = `${table}.${c.column}`;
                  const isDropTarget = mapDropTarget?.type === "column" && mapDropTarget.table === table && mapDropTarget.column === c.column;
                  return (
                    <div
                      key={c.column}
                      ref={(el) => {
                        if (el) columnRefs.current.set(key, el);
                        else columnRefs.current.delete(key);
                      }}
                      className={cn(
                        "group/col relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] transition-shadow",
                        c.propertyId ? "bg-ok-soft/60 text-ok" : "bg-white text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
                        isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                      )}
                    >
                      <span className="truncate font-mono">{c.column}</span>
                      <span className="ml-auto shrink-0 font-mono text-[9px] opacity-60">{c.type}</span>
                      {/* CONNECTION HANDLE — hover-revealed; drag onto a property to connect it
                          here. Columns have no Draggable affordance — they can't be moved. */}
                      <ConnectionHandle
                        active={isDropTarget}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const container = containerRef.current;
                          const pos = container ? { x: (e.clientX - container.getBoundingClientRect().left) / zoom, y: (e.clientY - container.getBoundingClientRect().top) / zoom } : { x: 0, y: 0 };
                          setDragOrigin({ anchor: "column", table, column: c.column, x1: pos.x, y1: pos.y });
                          setDragPos(pos);
                        }}
                        aria-label={`Drag to connect ${c.column} to a property`}
                        title="Drag to connect to a property"
                        className="absolute -left-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/col:opacity-100"
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* floating Merge entry point — shift/cmd-click 1+ related satellites to select them */}
        {selectedRelatedIds.size > 0 && (
          <button
            onClick={() => setMergePanelOpen(true)}
            className="absolute left-1/2 top-0 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-[var(--shadow-node-lift)] transition-opacity hover:opacity-90"
          >
            <GitMerge className="size-3.5" /> Merge
          </button>
        )}
        {mergePanelOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute left-1/2 top-10 z-30 flex w-[320px] -translate-x-1/2 flex-col gap-2.5 rounded-lg border border-node-border bg-node p-3 shadow-[var(--shadow-node-lift)]"
          >
            <div className="flex items-center gap-1.5 text-[12px] font-medium">
              <GitMerge className="size-3.5 text-primary" />
              Merge {selectedRelatedIds.size + 1} entities into one
            </div>
            <p className="text-[10.5px] text-muted-foreground">
              All properties from {entity.name}
              {mergeCandidates.map((e) => `, ${e.name || "Untitled"}`).join("")} will be combined. Name the resulting entity:
            </p>
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
      </div>
    </DetailShell>

    {/* ghost preview following the cursor while dragging a property row toward a related entity —
        rendered outside DetailShell's pan/zoom transform so "fixed" tracks the viewport, not the
        canvas's own coordinate space. */}
    {movePropertyDrag && movePropertyPos && (
      <div
        style={{ left: movePropertyPos.x, top: movePropertyPos.y }}
        className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-node-border bg-node px-3 py-1.5 text-[12px] font-medium text-foreground opacity-90 shadow-[var(--shadow-node-lift)]"
      >
        {movePropertyDrag.name}
      </div>
    )}
    </>
  );
}

/** Table-focused Detail: the mirror of the entity-focused canvas — the anchor Source Table on
 * top, its own Columns directly below it, and each column's mapped Entity/Property on the other
 * side, grouped by entity. No "related tables" concept, so no satellite row here. */
function TableDetailCanvas({
  app,
  table,
  onBack,
  onFocusEntity,
  onFocusTable,
  entityItems,
  tableItems,
}: {
  app: OntologyApp;
  table: TableSchema;
  onBack: () => void;
  onFocusEntity: (id: string) => void;
  onFocusTable: (name: string) => void;
  entityItems: Entity[];
  tableItems: TableSchema[];
}) {
  const { entities, updateMapping } = app;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const usage = useMemo(() => tableColumnUsage(table.name, entities), [table.name, entities]);
  const usingEntities = useMemo(() => entitiesUsingTable(table.name, entities), [table.name, entities]);

  // Entity Types dragged in from the left toolbox — placed as an extra group with no properties
  // mapped yet (dragging one in doesn't fabricate a mapping, same as the entity-focused canvas).
  const [extraEntityIds, setExtraEntityIds] = useState<string[]>([]);
  const usingIds = useMemo(() => new Set(usingEntities.map((e) => e.id)), [usingEntities]);
  const onDropEntity = useCallback(
    (id: string) => setExtraEntityIds((ids) => (ids.includes(id) ? ids : [...ids, id])),
    [],
  );

  // Every property of a related entity is shown (not just the ones already mapped here) so an
  // unmapped — or about-to-be-reconnected — property always has somewhere to connect to, mirroring
  // how the entity-focused canvas shows every column of its primary table.
  const entityGroups = useMemo(() => {
    const real = usingEntities.map((e) => ({ entity: e, properties: e.properties }));
    const extra = extraEntityIds
      .filter((id) => !usingIds.has(id))
      .map((id) => entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e)
      .map((e) => ({ entity: e, properties: e.properties }));
    return [...real, ...extra];
  }, [usingEntities, extraEntityIds, usingIds, entities]);

  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const propertyRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [lines, setLines] = useState<Line[]>([]);

  const computeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const pt = (el: Element, side: "left" | "right" | "top" | "bottom", gap = 0) => {
      const r = el.getBoundingClientRect();
      const x = side === "left" ? r.left - gap : side === "right" ? r.right + gap : r.left + r.width / 2;
      const y = side === "top" ? r.top - gap : side === "bottom" ? r.bottom + gap : r.top + r.height / 2;
      return { x: (x - cRect.left) / zoom, y: (y - cRect.top) / zoom };
    };

    const anchorEl = anchorRef.current;
    const next: Line[] = [];
    if (anchorEl) {
      const a = pt(anchorEl, "bottom", 8);
      table.columns.forEach((c) => {
        const el = columnRefs.current.get(c.name);
        if (!el) return;
        const b = pt(el, "left", 8);
        next.push({ id: `a-${c.name}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      });
    }
    entityGroups.forEach(({ entity, properties }) => {
      properties.forEach((p) => {
        if (p.mapping?.table !== table.name) return;
        const colEl = columnRefs.current.get(p.mapping.column);
        const propEl = propertyRefs.current.get(`${entity.id}.${p.id}`);
        if (!colEl || !propEl) return;
        const p1 = pt(colEl, "right", 8);
        const p2 = pt(propEl, "left", 8);
        next.push({ id: `cp-${p.mapping.column}-${entity.id}.${p.id}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      });
    });
    setLines(next);
  }, [table, entityGroups, zoom]);

  useLayoutEffect(() => computeLines(), [computeLines]);
  useLayoutEffect(() => {
    window.addEventListener("resize", computeLines);
    return () => window.removeEventListener("resize", computeLines);
  }, [computeLines]);

  // --- Column <-> Property drag-to-map, mirroring the entity-focused canvas — either end can
  // start the drag, and it completes on whichever kind of node it's released over. -------------
  type MapDropTarget = { type: "column"; column: string } | { type: "property"; entityId: string; propertyId: string };
  const [dragOrigin, setDragOrigin] = useState<
    | { anchor: "column"; column: string; x1: number; y1: number }
    | { anchor: "property"; entityId: string; propertyId: string; x1: number; y1: number }
    | null
  >(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [mapDropTarget, setMapDropTarget] = useState<MapDropTarget | null>(null);
  const mapDropTargetRef = useRef<MapDropTarget | null>(null);

  useEffect(() => {
    if (!dragOrigin) return;
    const container = containerRef.current;
    const onMove = (e: MouseEvent) => {
      if (container) {
        const r = container.getBoundingClientRect();
        setDragPos({ x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom });
      }
      let hit: MapDropTarget | null = null;
      columnRefs.current.forEach((el, column) => {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          hit = { type: "column", column };
        }
      });
      if (!hit) {
        propertyRefs.current.forEach((el, key) => {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            const idx = key.indexOf(".");
            hit = { type: "property", entityId: key.slice(0, idx), propertyId: key.slice(idx + 1) };
          }
        });
      }
      mapDropTargetRef.current = hit;
      setMapDropTarget(hit);
    };
    const onUp = () => {
      const target = mapDropTargetRef.current;
      const origin = dragOrigin;
      if (target) {
        if (origin.anchor === "column" && target.type === "property") {
          updateMapping(target.entityId, target.propertyId, { table: table.name, column: origin.column });
        } else if (origin.anchor === "property" && target.type === "column") {
          updateMapping(origin.entityId, origin.propertyId, { table: table.name, column: target.column });
        }
      }
      mapDropTargetRef.current = null;
      setMapDropTarget(null);
      setDragOrigin(null);
      setDragPos(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragOrigin, updateMapping, zoom, table.name]);

  return (
    <DetailShell
      kindLabel="Source Table"
      name={table.name}
      onBack={onBack}
      entityItems={entityItems}
      onFocusEntity={onFocusEntity}
      onDropEntity={onDropEntity}
      tableItems={tableItems}
      entities={entities}
      onFocusTable={onFocusTable}
      // This canvas has no second slot to render another table into (unlike Entity Detail's
      // Columns area) — a drag-release should place something or do nothing, never silently
      // navigate away as a side effect, so dropping a table here is a no-op rather than wired to
      // onFocusTable.
      onDropTable={() => {}}
      zoom={zoom}
      setZoom={setZoom}
      pan={pan}
      setPan={setPan}
    >
      <div ref={containerRef} className="relative flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-10 whitespace-nowrap">
        <svg className="pointer-events-none absolute inset-0 z-20 overflow-visible">
          {lines.map((l) => (
            <path key={l.id} d={curve(l)} fill="none" strokeLinecap="round" className="stroke-zinc-400" strokeWidth={1.4} opacity={0.85} />
          ))}
          {dragOrigin && dragPos && (
            <path d={`M ${dragOrigin.x1} ${dragOrigin.y1} L ${dragPos.x} ${dragPos.y}`} fill="none" stroke="#61b2ff" strokeWidth={2} strokeDasharray="4 3" opacity={0.9} />
          )}
        </svg>

        <div ref={anchorRef} className="relative z-10 flex flex-col items-center gap-1 rounded-xl bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
          <span className="flex items-center gap-1.5 font-mono text-[14px] font-bold">
            <Table2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
            {table.name}
          </span>
          <span className="text-[10px] text-muted-foreground">{table.columns.length} columns</span>
        </div>

        <div className="relative z-10 flex items-start gap-20">
          <div className="flex w-56 flex-col gap-2">
            {table.columns.map((c) => {
              const mapped = usage.find((u) => u.name === c.name)?.mappedBy.length ?? 0;
              const isDropTarget = mapDropTarget?.type === "column" && mapDropTarget.column === c.name;
              return (
                <div
                  key={c.name}
                  ref={(el) => {
                    if (el) columnRefs.current.set(c.name, el);
                    else columnRefs.current.delete(c.name);
                  }}
                  className={cn(
                    "group/col relative flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] transition-shadow",
                    mapped > 0 ? "bg-ok-soft/60 text-ok" : "bg-white text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
                    isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{c.name}</span>
                  <span className="shrink-0 font-mono text-[9.5px] opacity-70">{c.type}</span>
                  {/* CONNECTION HANDLE — hover-revealed; drag onto a property to connect (or
                      reconnect) it here. No Draggable affordance — columns can't be moved. */}
                  <ConnectionHandle
                    active={isDropTarget}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const container = containerRef.current;
                      const pos = container ? { x: (e.clientX - container.getBoundingClientRect().left) / zoom, y: (e.clientY - container.getBoundingClientRect().top) / zoom } : { x: 0, y: 0 };
                      setDragOrigin({ anchor: "column", column: c.name, x1: pos.x, y1: pos.y });
                      setDragPos(pos);
                    }}
                    aria-label={`Drag to connect ${c.name} to a property`}
                    title="Drag to connect to a property"
                    className="absolute -right-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/col:opacity-100"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-4">
            {entityGroups.length === 0 && (
              <p className="w-56 text-center text-[11.5px] text-muted-foreground">No entity maps to this table yet.</p>
            )}
            {entityGroups.map(({ entity, properties }) => (
              <div key={entity.id} className="flex w-56 flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onFocusEntity(entity.id)}
                  className="flex items-center gap-1.5 px-1 pb-1 text-left font-semibold text-foreground hover:text-primary"
                  title={`Focus entity ${entity.name}`}
                >
                  <Boxes className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <StatusDot status={entity.status} />
                  <span className="truncate text-[12.5px]">{entity.name}</span>
                </button>
                {properties.length === 0 && (
                  <p className="px-1 text-[10.5px] text-muted-foreground">No properties on this entity yet.</p>
                )}
                {properties.map((p) => {
                  const mappedHere = p.mapping?.table === table.name;
                  const isDropTarget =
                    mapDropTarget?.type === "property" && mapDropTarget.entityId === entity.id && mapDropTarget.propertyId === p.id;
                  return (
                    <div
                      key={p.id}
                      ref={(el) => {
                        if (el) propertyRefs.current.set(`${entity.id}.${p.id}`, el);
                        else propertyRefs.current.delete(`${entity.id}.${p.id}`);
                      }}
                      className={cn(
                        "group/prop relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] transition-shadow",
                        mappedHere ? "bg-ok-soft/60 text-ok" : "bg-white text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
                        isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                      )}
                    >
                      {/* STATUS — left, ~20px reserved, consistent with the entity-focused
                          canvas's property rows. */}
                      <span className="flex w-5 shrink-0 items-center justify-center">
                        <StatusDot status={p.status} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {mappedHere && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateMapping(entity.id, p.id, null);
                          }}
                          title="Clear this property's mapping"
                          aria-label={`Clear mapping for ${p.name}`}
                          className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-[var(--shadow-node)] transition-opacity group-hover/prop:opacity-100"
                        >
                          <X className="size-3" strokeWidth={2.5} />
                        </button>
                      )}
                      {/* CONNECTION HANDLE — hover-revealed; drag onto a column to connect (or
                          reconnect) this property's one mapping. No Draggable affordance here —
                          moving a Property between Entities isn't supported from this view. */}
                      <ConnectionHandle
                        active={isDropTarget}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const container = containerRef.current;
                          const pos = container ? { x: (e.clientX - container.getBoundingClientRect().left) / zoom, y: (e.clientY - container.getBoundingClientRect().top) / zoom } : { x: 0, y: 0 };
                          setDragOrigin({ anchor: "property", entityId: entity.id, propertyId: p.id, x1: pos.x, y1: pos.y });
                          setDragPos(pos);
                        }}
                        aria-label={`Drag to connect ${p.name} to a column`}
                        title="Drag to connect to a column"
                        className="absolute -left-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/prop:opacity-100"
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DetailShell>
  );
}
