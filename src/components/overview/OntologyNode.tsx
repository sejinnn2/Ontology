import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Side } from "@/lib/geometry";
import {
  entityDisplayStatus,
  entityErrorReason,
  tablesUsedByEntity,
  type Entity,
} from "@/lib/mock-data";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";
import { StatusBadge, statusBorderColor } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";

/** Overview's own fixed canvas-node footprint (Figma: node 246:63476 / 246:63464) — the circle
 * connectors and hit-testing anchor to, regardless of the `detailed` text below it. */
export const ONTOLOGY_NODE_SIZE = 44;
/** The OUTER positioned wrapper below (`w-[100px]`) is wider than the 44px circle itself and
 * horizontally centers it (`items-center`) — so the circle's own true left edge sits
 * `(ONTOLOGY_NODE_WRAPPER_W - ONTOLOGY_NODE_SIZE) / 2` = 28px in from the wrapper's own `x`
 * position, not flush with it. `OverviewCanvas`'s connector geometry anchors to the circle itself
 * (never the wrapper, its name label, or its wide invisible hover-catcher — see this component's
 * own first child), so it needs this exact offset too; keep this in sync with the `w-[100px]` below
 * if that ever changes, since nothing enforces the two staying equal automatically. Vertically
 * there is NO such offset — the circle is the wrapper's first flowed child, flush with its own
 * top. */
export const ONTOLOGY_NODE_WRAPPER_W = 100;

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const SIDE_POSITION: Record<Side, string> = {
  top: "left-1/2 -top-[6px] -translate-x-1/2",
  bottom: "left-1/2 -bottom-[6px] -translate-x-1/2",
  left: "-left-[6px] top-1/2 -translate-y-1/2",
  right: "-right-[6px] top-1/2 -translate-y-1/2",
};

const TABLE_CHIP_RADIUS = 60;

/** Fans mapped-table-name chips out in an arc centered on top-dead-center of the node, so they
 * never collide with the name label rendered directly below the circle. */
function radialOffset(index: number, count: number): { dx: number; dy: number } {
  const spread = Math.min(150, count * 40);
  const start = -90 - spread / 2;
  const step = count > 1 ? spread / (count - 1) : 0;
  const angleDeg = count === 1 ? -90 : start + step * index;
  const angle = (angleDeg * Math.PI) / 180;
  return { dx: Math.cos(angle) * TABLE_CHIP_RADIUS, dy: Math.sin(angle) * TABLE_CHIP_RADIUS };
}

/**
 * Overview canvas's own Entity node — a 40px circular status badge with the entity's name below
 * it (Figma: "Button" 246:63476 at rest, 246:63464 once zoomed past 100%). Deliberately a
 * separate component from `EntityNode` (the pill still used for Detail's related-entity
 * satellites, which this never touches) since the two shapes share no layout.
 *
 * `detailed` toggles in the confidence chip next to the name and the props/table count below it —
 * the same two fields Figma's own zoomed-in variant hides at rest, per its own hidden sibling
 * layers. The circle itself never resizes between the two states; only this extra text needs the
 * room a deeper zoom provides.
 *
 * Hovering the node (its existing affordance for revealing the 4 connection handles, unchanged)
 * also fans out the entity's mapped Data Table names in a small arc above the circle. Each name
 * is a real entry point into that table's own Detail view (`onOpenTable`) — an invisible hover
 * catcher, well beyond the circle's own small hit-box, keeps the arc visible while the pointer
 * travels out to it, so reaching and clicking a name doesn't require re-hovering the node itself
 * partway there.
 */
export function OntologyNode({
  entity,
  detailed,
  emphasis = "normal",
  onClick,
  onStartMove,
  onStartConnect,
  onOpenTable,
  connectSourceSide = null,
  connectTargetSide = null,
  moveTarget = false,
  showMappedTables = true,
}: {
  entity: Entity;
  /** Show confidence + props/table count below the name — Overview passes `view.z > 1` (zoomed
   * past 100%), matching Figma's own zoomed-in variant. */
  detailed: boolean;
  emphasis?: "active" | "related" | "muted" | "normal";
  /** Explicitly `| undefined` (not just optional) so a caller can switch these off conditionally —
   * e.g. Overview disables all three for the duration of History Inspection Mode, since editing
   * the canvas while previewing a historical point would otherwise silently apply to Current
   * Ontology underneath it. */
  onClick?: ((e: React.MouseEvent) => void) | undefined;
  onStartMove?: ((clientX: number, clientY: number) => void) | undefined;
  /** Starts a connector drag from one of this node's 4 boundary handles — the SAME drag now
   * resolves to one of two outcomes purely by where it's dropped (see the handle-rendering block
   * below and `OverviewCanvas`'s own `connectDrag` pointer-up handler): dropped on an existing
   * Entity, it creates a Relation between the two (unchanged); dropped on empty canvas, it opens
   * the creation wizard for a brand-new, connected Entity Type, placed at the drop point. There is
   * no longer a separate "+" control — a single handle carries both outcomes now. */
  onStartConnect?: ((side: Side, clientX: number, clientY: number) => void) | undefined;
  /** Opens a mapped Data Table's own Detail view — called with the table's name when one of the
   * hover-revealed chips is clicked. */
  onOpenTable?: ((tableName: string) => void) | undefined;
  connectSourceSide?: Side | null;
  connectTargetSide?: Side | null;
  /** A Property being dragged (moved, not connected) is hovering this entity as a valid place to
   * drop it — Detail's own related-satellite usage only; Overview has no such drag today. A
   * distinct affordance from the connection handles, shown as a plain ring around the circle. */
  moveTarget?: boolean;
  /** The hover-revealed arc of this Entity's mapped Data Table names — Overview's own shortcut
   * into a table's Detail view, on by default. Detail's own related-satellite usage turns it off:
   * a satellite there is already sitting next to the very Table cards it maps into (rendered in
   * full, right on the same canvas), so the same chip would be pure redundant hover noise. */
  showMappedTables?: boolean;
}) {
  const dragging = connectSourceSide !== null;
  const isTarget = connectTargetSide !== null;
  const tableNames = tablesUsedByEntity(entity);
  const status = entityDisplayStatus(entity);
  // Which of the 4 handles the pointer is directly over right now — drives the "enlarge + show a
  // plus" progressive-reveal step described on `ConnectionHandle`'s own `enlarged`/`showPlus`
  // props. Purely local, per-node UI state; never touches app-state.
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);

  return (
    <div className="group relative flex w-[100px] shrink-0 flex-col items-center gap-2 text-center">
      {/* Invisible, well beyond the circle's own 40px hit-box, purely so the pointer can travel
          from the node out to a table chip without the hover state dropping partway there. */}
      <div aria-hidden="true" className="absolute -inset-x-16 -top-16 -bottom-2" />

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
        className={cn(
          "relative flex select-none flex-col items-center gap-1 bg-transparent text-center",
          onStartMove && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span
          style={{ borderColor: statusBorderColor(status) }}
          className={cn(
            "relative flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-white shadow-[0px_1px_1.5px_rgba(0,0,0,0.1),0px_1px_1px_rgba(0,0,0,0.1)] transition-[opacity,box-shadow]",
            emphasis === "active" && "ring-[3px] ring-[#3b82f6]",
            emphasis === "muted" && "opacity-20",
            moveTarget && "ring-[4px] ring-primary",
          )}
        >
          <StatusBadge
            status={status}
            size={35}
            confidence={entity.confidence}
            warningReason={entity.warningReason}
            errorReason={entityErrorReason(entity)}
          />
          {onStartConnect &&
            SIDES.map((side) => {
              if (dragging && connectSourceSide !== side) return null;
              const isSource = connectSourceSide === side;
              const isTargetSide = connectTargetSide === side;
              const active = isSource || isTargetSide;
              const hovered = hoveredSide === side;
              return (
                <ConnectionHandle
                  key={side}
                  active={active}
                  // Enlarge + show the "+" the moment this specific handle is hovered, and keep
                  // both up for the rest of a drag that started from it (even once the pointer has
                  // moved well past the handle itself) — the progressive hover→drag reveal this
                  // node's own doc comment on `onStartConnect` describes. Driven entirely from this
                  // component's own hover/drag state, not a CSS `:hover`, hence `hoverFill={false}`.
                  enlarged={hovered || isSource}
                  showPlus={hovered || isSource}
                  hoverFill={false}
                  onPointerEnter={() => setHoveredSide(side)}
                  onPointerLeave={() =>
                    setHoveredSide((current) => (current === side ? null : current))
                  }
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onStartConnect(side, e.clientX, e.clientY);
                  }}
                  aria-label={`Drag from ${entity.name || "this entity"} to connect to another entity, or drop on empty canvas to create a new connected one`}
                  title="Drag to connect — drop on empty canvas to create a new connected Entity Type"
                  className={cn(
                    "absolute z-10 opacity-0 transition-opacity",
                    SIDE_POSITION[side],
                    (dragging || isTarget || active || hovered) && "opacity-100",
                    !dragging && !isTarget && "group-hover:opacity-100",
                  )}
                />
              );
            })}
        </span>

        <span className="flex flex-col items-center gap-1">
          <span className="flex max-w-[100px] items-center gap-1">
            <span
              data-morph-label
              className="truncate bg-[#fafafa] px-0.5 text-sm font-medium leading-4 text-foreground"
            >
              {entity.name}
            </span>
            {detailed && <ConfidenceChip confidence={entity.confidence} />}
          </span>
          {detailed && (
            <span className="whitespace-nowrap text-[10px] font-normal leading-[10px] text-[#909090]">
              {entity.properties.length} props · {tableNames.length} table
              {tableNames.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </button>

      {showMappedTables && tableNames.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {tableNames.map((name, i) => {
            const { dx, dy } = radialOffset(i, tableNames.length);
            return (
              <button
                key={name}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTable?.(name);
                }}
                title={`Open ${name}`}
                style={{ transform: `translate(${dx}px, ${dy}px)` }}
                className="pointer-events-auto absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-black/[0.08] bg-white px-2 py-0.5 text-[10px] font-medium text-[#171B22] shadow-[0_2px_2px_rgba(0,0,0,0.1)] transition-colors hover:border-primary/40 hover:bg-accent"
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
