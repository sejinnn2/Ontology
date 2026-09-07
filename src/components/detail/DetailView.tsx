import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Boxes, Minus, Plus, Redo2, Table2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { tableByName, tableColumnUsage, entitiesUsingTable, type Entity, type Property, type TableSchema } from "@/lib/mock-data";
import { orthogonalPath } from "@/lib/geometry";
import type { DetailAnchor, OntologyApp } from "@/lib/app-state";
import { EntityNode } from "@/components/overview/EntityNode";

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
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
                title={`Click to open, or drag onto the canvas to place ${t.name} here`}
                className={cn(
                  "flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent",
                  tbDrag?.kind === "table" && tbDrag.id === t.name && "opacity-30",
                )}
              >
                <span className="truncate font-mono text-[11.5px] font-medium">{t.name}</span>
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
  const { relations, entities } = app;
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

  return (
    <DetailShell
      kindLabel="Entity Type"
      name={entity.name}
      status={entity.status}
      onBack={onBack}
      entityItems={entityItems}
      onFocusEntity={onFocusEntity}
      onDropEntity={onDropEntity}
      tableItems={tableItems}
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
        </svg>

        {/* Properties <-> Columns: the central relationship. Related entities (subtle, click to
            re-focus) connect straight into the Properties card — no separate anchor circle. */}
        <div className="relative z-10 flex items-start gap-20">
          <div className="flex flex-col items-center gap-6 pt-8">
            {allRelated.map((other) => (
              <div
                key={other.id}
                ref={(el) => {
                  if (el) relatedRefs.current.set(other.id, el);
                  else relatedRefs.current.delete(other.id);
                }}
                className="flex flex-col items-center gap-1 opacity-70 transition-opacity hover:opacity-100"
                title={`Focus ${other.name}`}
              >
                <EntityNode entity={other} size={52} onClick={() => onFocusEntity(other.id)} />
              </div>
            ))}
          </div>

          <div ref={propsCardRef} className="flex w-56 flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
            <span className="flex items-center gap-1.5 truncate px-1 pb-1 text-[13px] font-medium text-foreground">
              <Boxes className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <StatusDot status={entity.status} />
              {entity.name}
            </span>
            {entity.properties.map((p) => (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) propertyRefs.current.set(p.id, el);
                  else propertyRefs.current.delete(p.id);
                }}
                className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-[12px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
              >
                <StatusDot status={p.status} />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">{p.type}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            {columnGroups.length === 0 && (
              <p className="w-56 text-center text-[11.5px] text-muted-foreground">No properties mapped to a column yet.</p>
            )}
            {columnGroups.map(([table, cols]) => (
              <div key={table} className="flex w-56 flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
                <button
                  onClick={() => onFocusTable(table)}
                  className="flex items-center gap-1.5 truncate px-1 pb-1 text-left font-mono text-[11.5px] font-semibold text-foreground hover:text-primary"
                  title={`Focus source table ${table}`}
                >
                  <Table2 className="size-3.5 shrink-0" strokeWidth={2} />
                  {table}
                </button>
                {cols.map((c) => (
                  <div
                    key={c.column}
                    ref={(el) => {
                      if (el) columnRefs.current.set(`${table}.${c.column}`, el);
                      else columnRefs.current.delete(`${table}.${c.column}`);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px]",
                      c.propertyId
                        ? "bg-ok-soft/60 text-ok"
                        : "bg-white text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
                    )}
                  >
                    <span className="truncate font-mono">{c.column}</span>
                    <span className="ml-auto shrink-0 font-mono text-[9px] opacity-60">{c.type}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DetailShell>
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
  const { entities } = app;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const usage = useMemo(() => tableColumnUsage(table.name), [table.name]);
  const usingEntities = useMemo(() => entitiesUsingTable(table.name), [table.name]);

  // Entity Types dragged in from the left toolbox — placed as an extra group with no properties
  // mapped yet (dragging one in doesn't fabricate a mapping, same as the entity-focused canvas).
  const [extraEntityIds, setExtraEntityIds] = useState<string[]>([]);
  const usingIds = useMemo(() => new Set(usingEntities.map((e) => e.id)), [usingEntities]);
  const onDropEntity = useCallback(
    (id: string) => setExtraEntityIds((ids) => (ids.includes(id) ? ids : [...ids, id])),
    [],
  );

  const entityGroups = useMemo(() => {
    const real = usingEntities.map((e) => ({
      entity: e,
      properties: e.properties.filter((p) => p.mapping?.table === table.name),
    }));
    const extra = extraEntityIds
      .filter((id) => !usingIds.has(id))
      .map((id) => entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e)
      .map((e) => ({ entity: e, properties: [] as Property[] }));
    return [...real, ...extra];
  }, [usingEntities, extraEntityIds, usingIds, entities, table.name]);

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
        const colEl = columnRefs.current.get(p.mapping!.column);
        const propEl = propertyRefs.current.get(`${entity.id}.${p.id}`);
        if (!colEl || !propEl) return;
        const p1 = pt(colEl, "right", 8);
        const p2 = pt(propEl, "left", 8);
        next.push({ id: `cp-${p.mapping!.column}-${entity.id}.${p.id}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      });
    });
    setLines(next);
  }, [table, entityGroups, zoom]);

  useLayoutEffect(() => computeLines(), [computeLines]);
  useLayoutEffect(() => {
    window.addEventListener("resize", computeLines);
    return () => window.removeEventListener("resize", computeLines);
  }, [computeLines]);

  return (
    <DetailShell
      kindLabel="Source Table"
      name={table.name}
      onBack={onBack}
      entityItems={entityItems}
      onFocusEntity={onFocusEntity}
      onDropEntity={onDropEntity}
      tableItems={tableItems}
      onFocusTable={onFocusTable}
      onDropTable={onFocusTable}
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
              return (
                <div
                  key={c.name}
                  ref={(el) => {
                    if (el) columnRefs.current.set(c.name, el);
                    else columnRefs.current.delete(c.name);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px]",
                    mapped > 0 ? "bg-ok-soft/60 text-ok" : "bg-white text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.08)]",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{c.name}</span>
                  <span className="shrink-0 font-mono text-[9.5px] opacity-70">{c.type}</span>
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
                  onClick={() => onFocusEntity(entity.id)}
                  className="flex items-center gap-1.5 px-1 pb-1 text-left font-semibold text-foreground hover:text-primary"
                  title={`Focus entity ${entity.name}`}
                >
                  <Boxes className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <StatusDot status={entity.status} />
                  <span className="truncate text-[12.5px]">{entity.name}</span>
                </button>
                {properties.length === 0 && (
                  <p className="px-1 text-[10.5px] text-muted-foreground">No properties map here yet.</p>
                )}
                {properties.map((p) => (
                  <div
                    key={p.id}
                    ref={(el) => {
                      if (el) propertyRefs.current.set(`${entity.id}.${p.id}`, el);
                      else propertyRefs.current.delete(`${entity.id}.${p.id}`);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-ok-soft/60 px-3 py-1.5 text-[11.5px] text-ok"
                  >
                    <span className="truncate">{p.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DetailShell>
  );
}
