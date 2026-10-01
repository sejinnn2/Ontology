import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Side } from "@/lib/geometry";
import {
  entityErrorReason,
  entityReview,
  entityStatus,
  entityWarningReason,
  propertyStatusCounts,
  type Entity,
} from "@/lib/mock-data";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";
import { StatusBadge, reviewStatusLabel, statusDotColor } from "@/components/ontology/StatusBadge";
import { EntityConfidenceChip } from "@/components/ontology/ConfidenceChip";

/** Overview's own fixed canvas-node footprint (Figma: node 246:63476 / 246:63464) — the circle
 * connectors and hit-testing anchor to, regardless of the `detailed` text below it. */
export const ONTOLOGY_NODE_SIZE = 40;
/** The OUTER positioned wrapper below (`w-[100px]`) is wider than the 40px circle itself and
 * horizontally centers it (`items-center`) — so the circle's own true left edge sits
 * `(ONTOLOGY_NODE_WRAPPER_W - ONTOLOGY_NODE_SIZE) / 2` = 30px in from the wrapper's own `x`
 * position, not flush with it. `OverviewCanvas`'s connector geometry anchors to the circle itself
 * (never the wrapper, its name label, or its wide invisible hover-catcher — see this component's
 * own first child), so it needs this exact offset too; keep this in sync with the `w-[100px]` below
 * if that ever changes, since nothing enforces the two staying equal automatically. Vertically
 * there is NO such offset — the circle is the wrapper's first flowed child, flush with its own
 * top. */
export const ONTOLOGY_NODE_WRAPPER_W = 100;

const SIDES: Side[] = ["top", "right", "bottom", "left"];

// Figma "Dot": 8px, its near edge 3px outside the circle (just past the 3px hover ring).
const SIDE_POSITION: Record<Side, string> = {
  top: "left-1/2 -top-[11px] -translate-x-1/2",
  bottom: "left-1/2 -bottom-[11px] -translate-x-1/2",
  left: "-left-[11px] top-1/2 -translate-y-1/2",
  right: "-right-[11px] top-1/2 -translate-y-1/2",
};

/**
 * Overview canvas's own Entity node (Figma "Node" 362:222226 / "NodeZoom" 362:222401) — a 40px
 * circle in its status color, ringed 1px in the status's dark color (2px translucent blue when
 * highlighted, 3px blue on hover / while active), with the entity's name below it. Deliberately a
 * separate component from `EntityNode` (the pill still used for Detail's related-entity
 * satellites, which this never touches) since the two shapes share no layout.
 *
 * `detailed` toggles in the confidence chip next to the name and the props/table count below it —
 * the same two fields Figma's own zoomed-in variant hides at rest, per its own hidden sibling
 * layers. The circle itself never resizes between the two states; only this extra text needs the
 * room a deeper zoom provides.
 *
 * Hovering the node reveals its 4 connection handles.
 */
export function OntologyNode({
  entity,
  detailed,
  nodeScale = 1,
  showLabel = true,
  showPropertySummary = false,
  emphasis = "normal",
  onClick,
  onStartMove,
  movementLocked = false,
  onStartConnect,
  connectSourceSide = null,
  connectTargetSide = null,
  moveTarget = false,
}: {
  entity: Entity;
  /** Overview hub emphasis. A transform keeps the node centered without moving its label/layout. */
  nodeScale?: number;
  /** Show confidence + props/table count below the name — Overview passes `view.z > 1` (zoomed
   * past 100%), matching Figma's own zoomed-in variant. */
  detailed: boolean;
  /** Overview semantic zoom may temporarily de-emphasize the visible name while preserving the
   * node's footprint and hit target. Defaults on so compact nodes outside Overview are unchanged. */
  showLabel?: boolean;
  /** Overview-only semantic zoom layer. Kept separate from `detailed` so the existing confidence
   * threshold and Detail View satellites remain unchanged. */
  showPropertySummary?: boolean;
  emphasis?: "active" | "related" | "muted" | "normal";
  /** Explicitly `| undefined` (not just optional) so a caller can switch these off conditionally —
   * e.g. Overview disables all three for the duration of History Inspection Mode, since editing
   * the canvas while previewing a historical point would otherwise silently apply to Current
   * Ontology underneath it. */
  onClick?: ((e: React.MouseEvent) => void) | undefined;
  onStartMove?: ((clientX: number, clientY: number) => void) | undefined;
  /** Keeps pointer-based selection active while suppressing the draggable cursor in auto-layout. */
  movementLocked?: boolean;
  /** Starts a connector drag from one of this node's 4 boundary handles — the SAME drag now
   * resolves to one of two outcomes purely by where it's dropped (see the handle-rendering block
   * below and `OverviewCanvas`'s own `connectDrag` pointer-up handler): dropped on an existing
   * Entity, it creates a Relation between the two (unchanged); dropped on empty canvas, it opens
   * the creation wizard for a brand-new, connected Entity Type, placed at the drop point. There is
   * no longer a separate "+" control — a single handle carries both outcomes now. */
  onStartConnect?: ((side: Side, clientX: number, clientY: number) => void) | undefined;
  connectSourceSide?: Side | null;
  connectTargetSide?: Side | null;
  /** A Property being dragged (moved, not connected) is hovering this entity as a valid place to
   * drop it — Detail's own related-satellite usage only; Overview has no such drag today. A
   * distinct affordance from the connection handles, shown as a plain ring around the circle. */
  moveTarget?: boolean;
}) {
  const dragging = connectSourceSide !== null;
  const isTarget = connectTargetSide !== null;
  const status = entityStatus(entity);
  const propertySummary = propertyStatusCounts(entity.properties);
  const entityStatusGlyph =
    status === "confirmed" ? "✓" : status === "suggested" ? "✦" : status === "warning" ? "!" : "!";
  const entityStatusTooltip = (
    <div className="min-w-[120px] space-y-1.5">
      <div className="flex items-center gap-1.5 font-medium text-white">
        <span style={{ color: statusDotColor(status) }}>{entityStatusGlyph}</span>
        <span>Entity {reviewStatusLabel(status).toLowerCase()}</span>
      </div>
      <div className="border-t border-white/15 pt-1.5">
        <p className="mb-1 font-medium text-white">Properties · {entity.properties.length}</p>
        <div className="space-y-0.5 text-[#D4D7DC]">
          {(["confirmed", "suggested", "warning", "error"] as const).map((propertyReviewStatus) => {
            const count = propertySummary[propertyReviewStatus];
            if (count === 0) return null;
            return (
              <div key={propertyReviewStatus} className="flex items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: statusDotColor(propertyReviewStatus) }}
                />
                <span>
                  {count} {reviewStatusLabel(propertyReviewStatus)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
  // Which of the 4 handles the pointer is directly over right now (Figma "Dot Hover": filled blue).
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);

  return (
    <div
      className={cn(
        "group relative flex w-[100px] shrink-0 flex-col items-center gap-3 text-center transition-opacity",
        emphasis === "muted" && "opacity-20",
      )}
    >
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
          "relative flex select-none flex-col items-center gap-3 bg-transparent text-center",
          onStartMove && !movementLocked && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span
          style={
            {
              transform: `scale(${nodeScale})`,
              "--node-ring": statusDotColor(status),
            } as React.CSSProperties
          }
          className={cn(
            // A 2px canvas-colored gap between the status fill and its ring (Figma 362:222226).
            "relative flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-[#f9fafb] bg-[#f9fafb] transition-[opacity,box-shadow,transform]",
            moveTarget
              ? "shadow-[0_0_0_4px_var(--color-primary)]"
              : emphasis === "active"
                ? "shadow-[0_0_0_3px_#3b82f6]"
                : emphasis === "related"
                  ? "shadow-[0_0_0_2px_rgba(59,130,246,0.5)] group-hover:shadow-[0_0_0_3px_#3b82f6]"
                  : "shadow-[0_0_0_1px_var(--node-ring)] group-hover:shadow-[0_0_0_3px_#3b82f6]",
          )}
        >
          <StatusBadge
            status={status}
            size={36}
            confidence={entity.confidence}
            warningReason={entityWarningReason(entity)}
            errorReason={entityErrorReason(entity)}
            tooltipContent={entityStatusTooltip}
          />
          {onStartConnect &&
            SIDES.map((side) => {
              // Figma "Dot Drag": every dot hides while a connection is being drawn.
              if (dragging) return null;
              const isSource = connectSourceSide === side;
              const isTargetSide = connectTargetSide === side;
              const active = isSource || isTargetSide;
              const hovered = hoveredSide === side;
              return (
                <ConnectionHandle
                  key={side}
                  active={active || hovered}
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

        <span className="flex flex-col items-center gap-0.5">
          {/* Figma NodeZoom: the name (and, zoomed in, the confidence) on a canvas-colored chip. */}
          <span
            className={cn(
              "flex max-w-[160px] items-center gap-1 rounded-[4px] bg-[#f9fafb] px-0.5 transition-opacity",
              showLabel ? "opacity-100" : "opacity-0",
            )}
          >
            <span
              data-morph-label
              className="truncate text-base font-medium leading-6 text-foreground"
            >
              {entity.name}
            </span>
            {detailed && entityReview(entity) === "suggested" && (
              <EntityConfidenceChip entity={entity} size="md" tone="muted" />
            )}
          </span>
          {showPropertySummary && (
            <span className="flex items-center gap-1 whitespace-nowrap rounded-[4px] bg-[#f9fafb] px-0.5 text-xs leading-4 text-muted-foreground">
              <span>{entity.properties.length} props</span>
              {(
                [
                  ["suggested", propertySummary.suggested],
                  ["warning", propertySummary.warning],
                  ["error", propertySummary.error],
                ] as const
              ).map(([summaryStatus, count]) =>
                count > 0 ? (
                  <span
                    key={summaryStatus}
                    style={{ backgroundColor: statusDotColor(summaryStatus) }}
                    className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-xs leading-4 text-white"
                  >
                    {count}
                  </span>
                ) : null,
              )}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
