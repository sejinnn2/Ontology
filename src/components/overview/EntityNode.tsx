import { cn } from "@/lib/utils";
import { NODE_W, NODE_H } from "@/lib/geometry";
import type { Side } from "@/lib/geometry";
import { entityStatus, entityErrorReason, tablesUsedByEntity, type Entity } from "@/lib/mock-data";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";
import { StatusBadge, statusBorderColor } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const SIDE_POSITION: Record<Side, string> = {
  top: "left-1/2 -top-[6px] -translate-x-1/2",
  bottom: "left-1/2 -bottom-[6px] -translate-x-1/2",
  left: "-left-[6px] top-1/2 -translate-y-1/2",
  right: "-right-[6px] top-1/2 -translate-y-1/2",
};

/** The pill-shaped node for one Entity Type — on the Overview canvas, as a Detail related
 * satellite, and (at full scale) as a toolbox drag-ghost. Purely presentational — selection/
 * emphasis is decided by the caller, which also owns the click handler.
 *
 * The Status badge (`entity.status`, a `ReviewStatus`) and the 4 Connection handles are separate
 * affordance layers that never trigger the same behavior: Status only colors the badge and never
 * starts a drag or a connection; handles default hidden, reveal hollow on entity hover, fill blue
 * on their own hover (pure CSS, no drag active), and while a connector drag is in progress the
 * active source/target handle is driven explicitly by the caller via `connectSourceSide` /
 * `connectTargetSide` so it stays correct even when the pointer has moved off this node. */
export function EntityNode({
  entity,
  scale = 1,
  emphasis = "normal",
  onClick,
  onStartMove,
  onStartConnect,
  connectSourceSide = null,
  connectTargetSide = null,
  moveTarget = false,
}: {
  entity: Entity;
  /** Size multiplier against the base 140x44 pill — Overview and the toolbox drag-ghost use the
   * default (1); Detail reuses this at a smaller scale for related satellites. */
  scale?: number;
  emphasis?: "active" | "related" | "muted" | "normal";
  /** The click event is passed through so callers can inspect modifier keys (e.g. shift-click to
   * multi-select instead of navigating). */
  onClick?: (e: React.MouseEvent) => void;
  /** Pointer-down on the node body itself (not a handle) — the caller owns the actual
   * click-vs-drag threshold and repositioning; once provided, this node's own `onClick` only
   * fires for keyboard activation, since a real mouse click is resolved by the caller's own
   * pointerup logic once it knows whether the pointer actually moved. */
  onStartMove?: (clientX: number, clientY: number) => void;
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
  const tableCount = tablesUsedByEntity(entity).length;

  const width = Math.round(NODE_W * scale);
  const height = Math.round(NODE_H * scale);
  const badgeSize = Math.max(14, Math.round(24 * scale));
  const nameSize = Math.max(9, Math.round(12 * scale));
  const subSize = Math.max(7, Math.round(10 * scale));

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onStartMove?.(e.clientX, e.clientY);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!onStartMove || e.detail === 0) onClick?.(e);
      }}
      style={{ width, height, borderColor: statusBorderColor(entityStatus(entity)) }}
      className={cn(
        "group relative flex shrink-0 select-none items-center justify-center gap-2 rounded-full border-[1.5px] bg-white py-1.5 pl-1.5 pr-3 font-normal text-left shadow-[0_2px_2px_rgba(0,0,0,0.1)] transition-[opacity,box-shadow]",
        onStartMove && "cursor-grab active:cursor-grabbing",
        emphasis === "active" && "ring-[3px] ring-primary",
        emphasis === "related" && "ring-2 ring-primary/40",
        emphasis === "muted" && "opacity-40",
        moveTarget && "ring-[4px] ring-primary",
      )}
    >
      <StatusBadge
        status={entityStatus(entity)}
        size={badgeSize}
        confidence={entity.confidence}
        warningReason={entity.warningReason}
        errorReason={entityErrorReason(entity)}
      />
      <span className="flex w-[66px] shrink-0 flex-col items-start justify-center gap-1">
        <span
          style={{ fontSize: nameSize }}
          className="block w-full truncate font-medium leading-[14px] tracking-[-0.3px] text-[#171B22]"
        >
          {entity.name}
        </span>
        <span
          style={{ fontSize: subSize }}
          className="block w-full truncate font-normal leading-[10px] text-[#909090]"
        >
          {entity.properties.length} props · {tableCount} table{tableCount === 1 ? "" : "s"}
        </span>
      </span>
      <ConfidenceChip confidence={entity.confidence} />
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
