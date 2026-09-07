import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Boxes, Minus, Plus, Redo2, Table2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { tableByName, tableColumnUsage, entitiesUsingTable, type Entity, type TableSchema } from "@/lib/mock-data";
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
  tableItems,
  onFocusTable,
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
  tableItems: TableSchema[];
  onFocusTable: (name: string) => void;
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
                onClick={() => onFocusEntity(e.id)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent"
              >
                <StatusDot status={e.status} />
                <span className="truncate">{e.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* CENTER — the focused mapping canvas. Same grid background / pan / zoom language as
            the Overview canvas, so entering Detail reads as zooming into one part of it. */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-node-border bg-node shadow-[var(--shadow-node)]">
          <div
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
                onClick={() => onFocusTable(t.name)}
                className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent"
              >
                <span className="truncate font-mono text-[11.5px] font-medium">{t.name}</span>
                <span className="text-[10px] text-muted-foreground">{t.columns.length} columns</span>
              </button>
            ))}
          </div>
        </div>
      </div>
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

  const columnGroups = useMemo(() => {
    const byTable = new Map<string, { propertyId: string; column: string; type: string }[]>();
    entity.properties.forEach((p) => {
      if (!p.mapping) return;
      const list = byTable.get(p.mapping.table) ?? [];
      const col = tableByName(p.mapping.table)?.columns.find((c) => c.name === p.mapping!.column);
      list.push({ propertyId: p.id, column: p.mapping.column, type: col?.type ?? "" });
      byTable.set(p.mapping.table, list);
    });
    return Array.from(byTable.entries());
  }, [entity]);

  const containerRef = useRef<HTMLDivElement>(null);
  const propsCardRef = useRef<HTMLDivElement>(null);
  const relatedRefs = useRef<Map<string, HTMLDivElement>>(new Map());
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
        const p1 = pt(propEl, "right");
        const p2 = pt(colEl, "left");
        next.push({ id: `pc-${c.propertyId}-${table}.${c.column}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      });
    });
    setLines(next);

    const nextRelated: Line[] = [];
    const cardEl = propsCardRef.current;
    if (cardEl) {
      const a = pt(cardEl, "left");
      related.forEach((other) => {
        const el = relatedRefs.current.get(other.id);
        if (!el) return;
        // Related satellites are circular EntityNodes — an 8px gap keeps the connector from
        // touching the node's own border, same as the Overview canvas's node connectors.
        const b = pt(el, "right", 8);
        nextRelated.push({ id: `rel-${other.id}`, x1: b.x, y1: b.y, x2: a.x, y2: a.y });
      });
    }
    setRelatedLines(nextRelated);
  }, [entity, columnGroups, related, zoom]);

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
      tableItems={tableItems}
      onFocusTable={onFocusTable}
      zoom={zoom}
      setZoom={setZoom}
      pan={pan}
      setPan={setPan}
    >
      <div ref={containerRef} className="relative flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-10 whitespace-nowrap">
        <svg className="pointer-events-none absolute inset-0 overflow-visible">
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
            {related.map((other) => (
              <button
                key={other.id}
                ref={(el) => {
                  if (el) relatedRefs.current.set(other.id, el);
                  else relatedRefs.current.delete(other.id);
                }}
                onClick={() => onFocusEntity(other.id)}
                className="flex flex-col items-center gap-1 opacity-70 transition-opacity hover:opacity-100"
                title={`Focus ${other.name}`}
              >
                <EntityNode entity={other} size={52} />
              </button>
            ))}
          </div>

          <div ref={propsCardRef} className="flex w-56 flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
            <span className="flex items-center gap-1.5 truncate px-1 pb-1 text-[13px] font-medium text-foreground">
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
            <span className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Columns</span>
            {columnGroups.length === 0 && (
              <p className="w-56 text-center text-[11.5px] text-muted-foreground">No properties mapped to a column yet.</p>
            )}
            {columnGroups.map(([table, cols]) => (
              <div key={table} className="flex w-56 flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
                <button
                  onClick={() => onFocusTable(table)}
                  className="truncate px-1 pb-1 text-left font-mono text-[11.5px] font-semibold text-foreground hover:text-primary"
                  title={`Focus source table ${table}`}
                >
                  {table}
                </button>
                {cols.map((c) => (
                  <div
                    key={c.column}
                    ref={(el) => {
                      if (el) columnRefs.current.set(`${table}.${c.column}`, el);
                      else columnRefs.current.delete(`${table}.${c.column}`);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-ok-soft/60 px-3 py-1.5 text-[11.5px] text-ok"
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

  const entityGroups = useMemo(
    () =>
      usingEntities.map((e) => ({
        entity: e,
        properties: e.properties.filter((p) => p.mapping?.table === table.name),
      })),
    [usingEntities, table.name],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const propertyRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [lines, setLines] = useState<Line[]>([]);

  const computeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const pt = (el: Element, side: "left" | "right" | "top" | "bottom") => {
      const r = el.getBoundingClientRect();
      const x = side === "left" ? r.left : side === "right" ? r.right : r.left + r.width / 2;
      const y = side === "top" ? r.top : side === "bottom" ? r.bottom : r.top + r.height / 2;
      return { x: (x - cRect.left) / zoom, y: (y - cRect.top) / zoom };
    };

    const anchorEl = anchorRef.current;
    const next: Line[] = [];
    if (anchorEl) {
      const a = pt(anchorEl, "bottom");
      table.columns.forEach((c) => {
        const el = columnRefs.current.get(c.name);
        if (!el) return;
        const b = pt(el, "left");
        next.push({ id: `a-${c.name}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      });
    }
    entityGroups.forEach(({ entity, properties }) => {
      properties.forEach((p) => {
        const colEl = columnRefs.current.get(p.mapping!.column);
        const propEl = propertyRefs.current.get(`${entity.id}.${p.id}`);
        if (!colEl || !propEl) return;
        const p1 = pt(colEl, "right");
        const p2 = pt(propEl, "left");
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
      tableItems={tableItems}
      onFocusTable={onFocusTable}
      zoom={zoom}
      setZoom={setZoom}
      pan={pan}
      setPan={setPan}
    >
      <div ref={containerRef} className="relative flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-10 whitespace-nowrap">
        <svg className="pointer-events-none absolute inset-0 overflow-visible">
          {lines.map((l) => (
            <path key={l.id} d={curve(l)} fill="none" strokeLinecap="round" className="stroke-zinc-400" strokeWidth={1.4} opacity={0.85} />
          ))}
        </svg>

        <div ref={anchorRef} className="relative z-10 flex flex-col items-center gap-1 rounded-xl bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
          <span className="font-mono text-[14px] font-bold">{table.name}</span>
          <span className="text-[10px] text-muted-foreground">{table.columns.length} columns</span>
        </div>

        <div className="relative z-10 flex items-start gap-20">
          <div className="flex w-56 flex-col gap-2">
            <span className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Columns</span>
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
            <span className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entity Types</span>
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
                  <StatusDot status={entity.status} />
                  <span className="truncate text-[12.5px]">{entity.name}</span>
                </button>
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
