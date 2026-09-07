import { useCallback, useMemo, useRef } from "react";
import { Minus, Plus, Table2, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { curvePath, edgeAnchors } from "@/lib/geometry";
import type { OntologyApp } from "@/lib/app-state";
import { EntityNode } from "./EntityNode";

const MIN_Z = 0.4;
const MAX_Z = 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The Overview workspace: the ontology graph (pan/zoom, entity nodes, relation lines) plus a
 * side panel for Source Tables. Clicking an Entity or a Table selects it AND opens Detail
 * directly — no separate confirmation step. Clicking a Relation only selects it (Inspect) since
 * Relations don't have a Detail view of their own.
 */
export function OverviewCanvas({ app }: { app: OntologyApp }) {
  const { entities, relations, tables, selection, select, openDetail, view, setView } = app;

  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    select(null);
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

  // "In focus" emphasis: the selected entity, plus whichever entities it's directly related to —
  // gives Inspect its "surrounding context" without a separate info surface on the canvas itself.
  const highlightId = selection?.kind === "entity" ? selection.id : null;
  const neighborIds = useMemo(() => {
    if (!highlightId) return null;
    const set = new Set<string>();
    relations.forEach((r) => {
      if (r.from === highlightId) set.add(r.to);
      if (r.to === highlightId) set.add(r.from);
    });
    return set;
  }, [highlightId, relations]);

  const emphasisFor = (entityId: string) => {
    if (!highlightId) return "normal" as const;
    if (entityId === highlightId) return "active" as const;
    if (neighborIds?.has(entityId)) return "related" as const;
    return "muted" as const;
  };

  return (
    <div className="flex h-full w-full gap-3 p-3">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-node-border bg-node shadow-[var(--shadow-node)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-node-border px-4 py-3">
          <Waypoints className="size-3.5" strokeWidth={2} />
          <span className="text-[14px] font-semibold">Ontology</span>
        </div>

        <div
          ref={ref}
          className="relative min-h-0 flex-1 select-none overflow-hidden canvas-grid"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="absolute origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            <svg className="pointer-events-none absolute overflow-visible" width={1} height={1}>
              {relations.map((r) => {
                const a = entities.find((e) => e.id === r.from);
                const b = entities.find((e) => e.id === r.to);
                if (!a || !b) return null;
                const { p1, p2 } = edgeAnchors(a, b);
                const isSelected = selection?.kind === "relation" && selection.id === r.id;
                const isFocusEdge = highlightId ? r.from === highlightId || r.to === highlightId : false;
                const isMuted = highlightId !== null && !isFocusEdge;
                return (
                  <path
                    key={r.id}
                    d={curvePath(p1, p2)}
                    fill="none"
                    strokeLinecap="round"
                    className={cn(
                      "transition-opacity",
                      isSelected || isFocusEdge ? "stroke-primary" : "stroke-zinc-400",
                      isMuted && "opacity-25",
                    )}
                    strokeWidth={isSelected ? 2.4 : isFocusEdge ? 2 : 1.4}
                  />
                );
              })}
            </svg>

            {relations.map((r) => {
              const a = entities.find((e) => e.id === r.from);
              const b = entities.find((e) => e.id === r.to);
              if (!a || !b) return null;
              const { mid } = edgeAnchors(a, b);
              const isSelected = selection?.kind === "relation" && selection.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  title={r.name}
                  style={{ left: mid.x, top: mid.y }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    select({ kind: "relation", id: r.id });
                  }}
                  className={cn(
                    "absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-node-border bg-node px-2 py-0.5 text-[10px] text-foreground shadow-[var(--shadow-node)]",
                    isSelected && "ring-2 ring-primary",
                  )}
                >
                  {r.name}
                </button>
              );
            })}

            {entities.map((entity) => (
              <div key={entity.id} className="absolute" style={{ left: entity.x, top: entity.y }}>
                <EntityNode
                  entity={entity}
                  emphasis={emphasisFor(entity.id)}
                  onClick={() => {
                    select({ kind: "entity", id: entity.id });
                    openDetail("entity", entity.id);
                  }}
                />
              </div>
            ))}
          </div>

          <div
            className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node)]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button className="rounded-md p-1.5 hover:bg-accent" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
              <Minus className="size-3.5" />
            </button>
            <span className="w-10 text-center font-mono text-[11px] text-muted-foreground">{Math.round(view.z * 100)}%</span>
            <button className="rounded-md p-1.5 hover:bg-accent" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border border-node-border bg-node shadow-[var(--shadow-node)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-node-border px-4 py-3">
          <Table2 className="size-3.5" strokeWidth={2} />
          <span className="text-[14px] font-semibold">Source Tables</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {tables.map((t) => {
            const isSelected = selection?.kind === "table" && selection.id === t.name;
            return (
              <button
                key={t.name}
                onClick={() => {
                  select({ kind: "table", id: t.name });
                  openDetail("table", t.name);
                }}
                className={cn(
                  "flex items-center justify-between rounded-[10px] px-3 py-2 text-left shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-colors",
                  isSelected ? "ring-2 ring-primary" : "hover:bg-accent",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] font-medium">{t.name}</span>
                  <span className="block text-[10px] text-muted-foreground">{t.columns.length} columns</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
