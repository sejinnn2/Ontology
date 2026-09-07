import { ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { entityMappingCompleteness, tableMappingCompleteness } from "@/lib/mock-data";
import type { OntologyApp } from "@/lib/app-state";

/**
 * The Inspect step: a lightweight, floating look at whatever is currently selected on the
 * Overview canvas — enough to decide whether to go deeper, without leaving Overview. Entities
 * and Tables get an explicit "Open Detail" action; Relations don't have a Detail view yet, so
 * this is as deep as inspecting one goes for now.
 */
export function InspectPanel({ app }: { app: OntologyApp }) {
  const { selection, select, entities, relations, tables, openDetail } = app;
  if (!selection) return null;

  let title: string;
  let subtitle: string;
  let status: "confirmed" | "suggested" | null = null;
  let confidence: number | null = null;
  let onOpenDetail: (() => void) | null = null;

  if (selection.kind === "entity") {
    const entity = entities.find((e) => e.id === selection.id);
    if (!entity) return null;
    const { mapped, total } = entityMappingCompleteness(entity);
    title = entity.name;
    subtitle = `Entity Type · ${entity.table} · ${mapped}/${total} properties mapped`;
    status = entity.status;
    confidence = entity.confidence;
    onOpenDetail = () => openDetail("entity", entity.id);
  } else if (selection.kind === "table") {
    const table = tables.find((t) => t.name === selection.id);
    if (!table) return null;
    const { mapped, total } = tableMappingCompleteness(table.name);
    title = table.name;
    subtitle = `Source Table · ${mapped}/${total} columns mapped`;
    onOpenDetail = () => openDetail("table", table.name);
  } else {
    const relation = relations.find((r) => r.id === selection.id);
    if (!relation) return null;
    const from = entities.find((e) => e.id === relation.from);
    const to = entities.find((e) => e.id === relation.to);
    title = relation.name;
    subtitle = `Relation · ${from?.name ?? "?"} → ${to?.name ?? "?"}`;
    status = relation.status;
    confidence = relation.confidence;
  }

  return (
    <div className="absolute bottom-20 left-1/2 z-30 flex w-[380px] -translate-x-1/2 items-center gap-3 rounded-xl border border-node-border bg-node px-4 py-3 shadow-[var(--shadow-node-lift)]">
      {status && (
        <span
          className={cn("size-2.5 shrink-0 rounded-full", status === "confirmed" ? "bg-ok" : "bg-review")}
          title={status === "confirmed" ? "Confirmed" : "Suggested"}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-foreground">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      {confidence !== null && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {Math.round(confidence * 100)}%
        </span>
      )}
      {onOpenDetail && (
        <button
          onClick={onOpenDetail}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Open Detail <ArrowRight className="size-3.5" />
        </button>
      )}
      <button
        onClick={() => select(null)}
        aria-label="Close"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
