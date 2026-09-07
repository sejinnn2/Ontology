import { cn } from "@/lib/utils";
import { NODE_SIZE } from "@/lib/geometry";
import type { Entity } from "@/lib/mock-data";

/** A minimal circular node for one Entity Type on the Overview canvas. Purely presentational —
 * selection/emphasis is decided by the caller (OverviewCanvas), which also owns the click
 * handler that turns a click into an Inspect selection. */
export function EntityNode({
  entity,
  emphasis = "normal",
  onClick,
}: {
  entity: Entity;
  emphasis?: "active" | "related" | "muted" | "normal";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      style={{ width: NODE_SIZE, height: NODE_SIZE }}
      className={cn(
        "group relative flex shrink-0 select-none items-center justify-center rounded-full border-2 border-background bg-node text-center shadow-[var(--shadow-node)] transition-[opacity,box-shadow]",
        emphasis === "active" && "ring-[3px] ring-primary",
        emphasis === "related" && "ring-2 ring-primary/40",
        emphasis === "muted" && "opacity-40",
      )}
    >
      <span className="line-clamp-2 break-words px-2 text-[12px] font-semibold leading-tight text-foreground">
        {entity.name}
      </span>
      <span
        title={entity.status === "confirmed" ? "Confirmed" : "Suggested"}
        className={cn(
          "absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background",
          entity.status === "confirmed" ? "bg-ok" : "bg-review",
        )}
      />
    </button>
  );
}
