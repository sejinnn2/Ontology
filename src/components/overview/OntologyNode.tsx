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
import { StatusBadge, statusDotColor } from "@/components/ontology/StatusBadge";
import { EntityConfidenceChip } from "@/components/ontology/ConfidenceChip";
import { classNodeMapping } from "@/components/detail/class-node";
import typeSuggestedIcon from "@/assets/icons/node-type-suggested-20.svg";
import typeConfirmedIcon from "@/assets/icons/node-type-confirmed-20.svg";
import typeWarningIcon from "@/assets/icons/node-type-warning-24.svg";
import typeErrorIcon from "@/assets/icons/node-type-error-20.svg";
import dotFull from "@/assets/icons/class-dot-full-6.svg";
import dotPartial from "@/assets/icons/class-dot-partial-6.svg";
import dotNone from "@/assets/icons/class-dot-none-6.svg";

/** Overview's own fixed canvas-node footprint (Figma: node 246:63476 / 246:63464) — the circle
 * connectors and hit-testing anchor to, regardless of the `detailed` text below it. */
export const ONTOLOGY_NODE_SIZE = 40;
/**
 * The OUTER positioned wrapper is a fixed box (`OVERVIEW_NODE_BOX_W` × `OVERVIEW_NODE_BOX_H`, the
 * largest card) that always holds the node centered — a card (zoomed in) or the 40px circle (zoomed
 * out) — so a node's center never moves when it switches between the two. `entity.x` / `entity.y`
 * are this box's top-left; connectors and hit-testing anchor to the visible footprint.
 */
export const OVERVIEW_NODE_BOX_W = 256;
export const OVERVIEW_NODE_BOX_H = 64;
/** Kept for the circle's own footprint and the places that still reason in circle terms. */
export const ONTOLOGY_NODE_WRAPPER_W = OVERVIEW_NODE_BOX_W;

/** Figma "Node(Temporal)" card sizes (Size=Small / Medium / Large): the busier a type is, the
 * larger its card. */
export type OverviewCardSize = "small" | "medium" | "large";
export const OVERVIEW_CARD: Record<OverviewCardSize, { w: number; h: number }> = {
  small: { w: 168, h: 60 },
  medium: { w: 208, h: 60 },
  large: { w: 256, h: 64 },
};
export const overviewCardSizeFor = (relationCount: number): OverviewCardSize =>
  relationCount >= 20 ? "large" : relationCount >= 5 ? "medium" : "small";

// Overview accent (replaces the old Blue 500): focus, hover and connection UI.
const ACCENT = "#0092b8";

const TYPE_ICON = {
  suggested: typeSuggestedIcon,
  confirmed: typeConfirmedIcon,
  warning: typeWarningIcon,
  error: typeErrorIcon,
} as const;

const SIDES: Side[] = ["top", "right", "bottom", "left"];

// Figma "Dot" on a card: 8px, centered 7.5px outside the card's side midpoint.
const CARD_SIDE_POSITION: Record<Side, string> = {
  top: "left-1/2 -top-[11.5px] -translate-x-1/2",
  bottom: "left-1/2 -bottom-[11.5px] -translate-x-1/2",
  left: "-left-[11.5px] top-1/2 -translate-y-1/2",
  right: "-right-[11.5px] top-1/2 -translate-y-1/2",
};

// Figma "Dot": 8px, its near edge 3px outside the circle (just past the 3px hover ring).
const SIDE_POSITION: Record<Side, string> = {
  top: "left-1/2 -top-[16px] -translate-x-1/2",
  bottom: "left-1/2 -bottom-[16px] -translate-x-1/2",
  left: "-left-[16px] top-1/2 -translate-y-1/2",
  right: "-right-[16px] top-1/2 -translate-y-1/2",
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
  onHandleHover,
  nameSize,
  card = null,
  relationCount = 0,
  selected = false,
}: {
  /** The node itself is selected (not just hovered): the card's Selected state. */
  selected?: boolean;
  /** Zoomed in: draw the Figma card at this size. `null` draws the 40px circle (zoomed out). */
  card?: OverviewCardSize | null;
  /** Its Relations — the card's "N links". */
  relationCount?: number;
  /** The name's size at this zoom (the shared semantic-zoom scale) — it grows as the canvas
   * shrinks, so it stays readable on screen. */
  nameSize?: { size: number; line: number } | undefined;
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
  /** Which connection dot the pointer is over (null when it leaves) — for the new-node preview. */
  onHandleHover?: ((side: Side | null) => void) | undefined;
}) {
  const dragging = connectSourceSide !== null;
  const isTarget = connectTargetSide !== null;
  const status = entityStatus(entity);
  const propertySummary = propertyStatusCounts(entity.properties);
  // Which of the 4 handles the pointer is directly over right now (Figma "Dot Hover": filled blue).
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);

  if (card) {
    // Zoomed in: Figma "Node(Temporal)" card. Default / Selected (active) / Highlighted (related)
    // / Hover / Dot Hover / Dim (muted) map onto `emphasis` and the hover + handle state below.
    const dims = OVERVIEW_CARD[card];
    const large = card === "large";
    const mapping = classNodeMapping(entity);
    const propCount = entity.properties.length;
    const counts = `${propCount} ${propCount === 1 ? "prop" : "props"} · ${relationCount} ${relationCount === 1 ? "link" : "links"}`;
    const showChip = card !== "small" && entityReview(entity) === "suggested";
    return (
      <div
        className={cn(
          "group relative flex shrink-0 items-center justify-center transition-opacity",
          emphasis === "muted" && "opacity-20",
        )}
        style={{ width: OVERVIEW_NODE_BOX_W, height: OVERVIEW_NODE_BOX_H }}
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
            "relative select-none bg-transparent text-left",
            onStartMove && !movementLocked && "cursor-grab active:cursor-grabbing",
          )}
        >
          <span
            style={{ width: dims.w, height: dims.h }}
            className={cn(
              "relative flex items-center gap-1 rounded-[4px] border px-3 transition-[border-color,box-shadow,background-color]",
              emphasis === "active" && selected
                ? "border-[#0092b8] bg-[#f2f8fa] shadow-[inset_0_0_0_1px_#0092b8]"
                : emphasis === "active"
                  ? "border-[#0092b8] bg-white"
                  : emphasis === "related"
                    ? "border-[rgba(0,146,184,0.5)] bg-white shadow-[inset_0_0_0_1px_rgba(0,146,184,0.5)] group-hover:border-[#0092b8] group-hover:shadow-none"
                    : "border-[rgba(98,116,142,0.4)] bg-white group-hover:border-[#0092b8]",
              (isTarget || dragging) && "border-[#0092b8]",
              moveTarget && "shadow-[0_0_0_4px_var(--color-primary)]",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <span className="relative size-5 shrink-0">
                  <img
                    alt=""
                    src={TYPE_ICON[status]}
                    className={cn(
                      "absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2",
                      status === "warning" ? "size-6" : "size-5",
                    )}
                  />
                </span>
                <span
                  data-morph-label
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium text-[#020618]",
                    large ? "text-base leading-6" : "text-sm leading-5",
                  )}
                >
                  {entity.name}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <img
                  alt=""
                  src={mapping === "full" ? dotFull : mapping === "partial" ? dotPartial : dotNone}
                  className="block size-1.5 shrink-0"
                />
                <span className="truncate text-[12px] leading-4 text-[#62748e]">{counts}</span>
              </span>
            </span>
            {showChip && <EntityConfidenceChip entity={entity} size="md" tone="muted" />}
            {onStartConnect &&
              SIDES.map((side) => {
                if (dragging) return null;
                const isSource = connectSourceSide === side;
                const isTargetSide = connectTargetSide === side;
                const active = isSource || isTargetSide;
                const hovered = hoveredSide === side;
                return (
                  <ConnectionHandle
                    key={side}
                    active={active || hovered}
                    plus={hovered && !active}
                    hoverFill={false}
                    onPointerEnter={() => {
                      setHoveredSide(side);
                      onHandleHover?.(side);
                    }}
                    onPointerLeave={() => {
                      setHoveredSide((current) => (current === side ? null : current));
                      onHandleHover?.(null);
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStartConnect(side, e.clientX, e.clientY);
                    }}
                    aria-label={`Drag from ${entity.name || "this entity"} to connect to another entity, or drop on empty canvas to create a new connected one`}
                    className={cn(
                      "absolute z-10 opacity-0 transition-opacity",
                      CARD_SIDE_POSITION[side],
                      (dragging || isTarget || active || hovered) && "opacity-100",
                      !dragging && !isTarget && "group-hover:opacity-100",
                    )}
                  />
                );
              })}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        // The 40px circle sits at the box's center (12px down in the 64px box), its name below.
        "group relative flex w-[256px] shrink-0 flex-col items-center gap-3 pt-3 text-center transition-opacity",
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
                ? "shadow-[0_0_0_3px_#0092b8]"
                : emphasis === "related"
                  ? "shadow-[0_0_0_2px_rgba(0,146,184,0.5)] group-hover:shadow-[0_0_0_3px_#0092b8]"
                  : "shadow-[0_0_0_1px_var(--node-ring)] group-hover:shadow-[0_0_0_3px_#0092b8]",
          )}
        >
          <StatusBadge
            status={status}
            size={36}
            confidence={entity.confidence}
            warningReason={entityWarningReason(entity)}
            errorReason={entityErrorReason(entity)}
            noTooltip
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
                  plus={hovered && !active}
                  hoverFill={false}
                  onPointerEnter={() => {
                    setHoveredSide(side);
                    onHandleHover?.(side);
                  }}
                  onPointerLeave={() => {
                    setHoveredSide((current) => (current === side ? null : current));
                    onHandleHover?.(null);
                  }}
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
              style={
                nameSize ? { fontSize: nameSize.size, lineHeight: `${nameSize.line}px` } : undefined
              }
            >
              {entity.name}
            </span>
            {detailed && entityReview(entity) === "suggested" && (
              <EntityConfidenceChip entity={entity} size="sm" tone="muted" />
            )}
          </span>
          {showPropertySummary && (
            <span className="flex items-center gap-1 whitespace-nowrap rounded-[4px] bg-[#f9fafb] px-0.5 text-[10px] leading-[14px] text-muted-foreground">
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
                    className="inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] leading-[14px] text-white"
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
