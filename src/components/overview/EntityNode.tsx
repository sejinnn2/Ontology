import { cn } from "@/lib/utils";
import { NODE_SIZE } from "@/lib/geometry";
import type { Side } from "@/lib/geometry";
import type { Entity } from "@/lib/mock-data";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const SIDE_POSITION: Record<Side, string> = {
  top: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
  bottom: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2",
  left: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
  right: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2",
};

/** A minimal circular node for one Entity Type on the Overview canvas. Purely presentational —
 * selection/emphasis is decided by the caller (OverviewCanvas), which also owns the click
 * handler that turns a click into an Inspect selection.
 *
 * Connection handles (create a Relation) are a separate affordance layer from Status (the small
 * corner dot) and never trigger the same behavior: default = hidden, entity hover = all 4 reveal
 * hollow, per-handle hover = that one fills blue (pure CSS, no drag active), and while a connector
 * drag is in progress the active source/target handle is driven explicitly by the caller via
 * `connectSourceSide` / `connectTargetSide` so it stays correct even when the pointer has moved
 * off this node. */
export function EntityNode({
  entity,
  size = NODE_SIZE,
  emphasis = "normal",
  onClick,
  onStartConnect,
  connectSourceSide = null,
  connectTargetSide = null,
  moveTarget = false,
}: {
  entity: Entity;
  /** Diameter in px — Overview uses the default; Detail reuses this at smaller scales for the
   * anchor, related satellites, and the Entity Types toolbox. */
  size?: number;
  emphasis?: "active" | "related" | "muted" | "normal";
  /** The click event is passed through so callers can inspect modifier keys (e.g. shift-click to
   * multi-select instead of navigating). */
  onClick?: (e: React.MouseEvent) => void;
  /** Pointer-down on one of the 4 boundary handles — starts dragging a live connector out to
   * another entity to create a relation. Omit to render without handles. */
  onStartConnect?: (side: Side, clientX: number, clientY: number) => void;
  /** This entity is the active drag origin — show only this one handle (filled), hiding the
   * other 3, regardless of hover. */
  connectSourceSide?: Side | null;
  /** A connector drag from another entity is hovering this one as a valid drop target — force
   * all 4 handles visible, with this one filled as the geometrically nearest match. */
  connectTargetSide?: Side | null;
  /** A Property being dragged (moved, not connected) is hovering this entity as a valid place to
   * drop it — a distinct affordance from the connection handles above, shown as a plain ring. */
  moveTarget?: boolean;
}) {
  const dragging = connectSourceSide !== null;
  const isTarget = connectTargetSide !== null;

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      style={{ width: size, height: size }}
      className={cn(
        "group relative flex shrink-0 select-none items-center justify-center rounded-full border-2 border-background bg-node text-center shadow-[var(--shadow-node)] transition-[opacity,box-shadow]",
        emphasis === "active" && "ring-[3px] ring-primary",
        emphasis === "related" && "ring-2 ring-primary/40",
        emphasis === "muted" && "opacity-40",
        moveTarget && "ring-[4px] ring-primary",
      )}
    >
      <span
        style={{ fontSize: Math.max(9, Math.round(size * 0.14)) }}
        className="line-clamp-2 break-words px-2 font-semibold leading-tight text-foreground"
      >
        {entity.name}
      </span>
      <span
        title={entity.status === "confirmed" ? "Confirmed" : "Suggested"}
        className={cn(
          "absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background",
          entity.status === "confirmed" ? "bg-ok" : "bg-review",
        )}
      />
      {onStartConnect &&
        SIDES.map((side) => {
          if (dragging && connectSourceSide !== side) return null;
          const active = connectSourceSide === side || connectTargetSide === side;
          return (
            <ConnectionHandle
              key={side}
              active={active}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStartConnect(side, e.clientX, e.clientY);
              }}
              aria-label={`Drag to connect ${entity.name || "this entity"} to another entity`}
              title="Drag to connect to another entity"
              className={cn(
                "absolute z-10 opacity-0 transition-opacity",
                SIDE_POSITION[side],
                (dragging || isTarget || active) && "opacity-100",
                !dragging && !isTarget && "group-hover:opacity-100",
              )}
            />
          );
        })}
    </button>
  );
}
