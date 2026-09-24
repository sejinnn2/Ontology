import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Side } from "@/lib/geometry";
import {
  entityDisplayStatus,
  entityStatus,
  propertyStatus,
  propertyStatusCounts,
  entityErrorReason,
  tablesUsedByEntity,
  type Entity,
  type ReviewStatus,
} from "@/lib/mock-data";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";
import {
  StatusBadge,
  reviewStatusLabel,
  statusBorderColor,
} from "@/components/ontology/StatusBadge";
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

// Figma's own "Property status ring" palette (node 217:60226) — deliberately a separate, more
// saturated palette from the plain ontology StatusBadge colors above (`statusBorderColor`), not a
// reuse of them; matched to the exact hex values from that file rather than approximated.
const PROPERTY_RING_COLORS: Record<ReviewStatus, string> = {
  suggested: "#7C61FF",
  confirmed: "#0AA9FF",
  error: "#EF3636",
  warning: "#FFAE06",
};
// Figma's own hover-state ring color (node 216:60197, the "hover" layer) — a third, distinct blue
// from both the ring palette above and the plain ontology "confirmed" teal.
const HOVER_RING_COLOR = "#0A89FF";

// Both rings below share this exact geometry (Figma's own units, a 46×46 node: outer radius 23,
// inner radius 20.24 — i.e. a center radius of 21.62 and a stroke width of 2.76), applied via a
// matching `viewBox` rather than by hand-converting to this app's actual 44px node footprint — the
// browser scales the two down together for free, and it keeps these numbers a direct, checkable
// match to the file instead of a derived approximation. Shared between the default segmented ring
// and its hover replacement so the two crossfade in place, never at a subtly different radius or
// thickness from each other.
const RING_VIEWBOX = 46;
const RING_R = 21.62;
const RING_STROKE = 2.76;
// Figma's own badge diameter (36px) is relative to that same 46px node — scaled down to this app's
// actual 44px node footprint (a real CSS pixel size, unlike the ring above, since `StatusBadge`
// takes a literal `size` rather than living inside the ring's own scaled `viewBox`).
const RING_BADGE_SIZE = (36 / RING_VIEWBOX) * ONTOLOGY_NODE_SIZE;

/** Angular allocations reflect the actual distribution of this Entity's own Properties across the
 * 4 ReviewStatuses; small white seams separate statuses. Purely a Property-status breakdown — has
 * nothing to do with the Entity's own displayed status in the center (see `entityDisplayStatus`),
 * which is a completely separate, independent fact. Drawn clockwise from 12 o'clock in Error →
 * Warning → Confirmed → Suggested order. Fades out on hover — see `HoverRing` below, its
 * replacement while the node is actually being pointed at. */
function PropertyStatusRing({
  entity,
  counts,
  emphasizeSuggested = false,
}: {
  entity: Entity;
  counts: ReturnType<typeof propertyStatusCounts>;
  emphasizeSuggested?: boolean;
}) {
  const statuses: ReviewStatus[] = ["error", "warning", "confirmed", "suggested"];
  const orderedCounts = statuses.map((status) => counts[status]);
  const total = entity.properties.length;
  const circumference = 2 * Math.PI * RING_R;
  const segments = orderedCounts.filter((count) => count > 0).length;
  // A status this rare (say 1 Property out of 50) would render as a near-invisible sliver at its
  // true proportional length — the whole point of this ring is to surface EVERY status that's
  // actually present, not just the dominant ones, so exact proportionality isn't the goal here.
  // Each present status first claims this minimum share of the ring regardless of its real count;
  // only the circumference left over after every minimum is reserved gets split proportionally
  // among the statuses that already exceed it on their own — so a dominant status still reads as
  // visually larger, it just never fully swallows a rare one.
  const MIN_SHARE = 0.12;
  const minLength = circumference * MIN_SHARE;
  const raw = orderedCounts.map((count) => ({
    count,
    length: count > 0 ? (circumference * count) / total : 0,
  }));
  const reservedForRare =
    raw.filter((r) => r.length > 0 && r.length < minLength).length * minLength;
  const remaining = circumference - reservedForRare;
  const dominantTotal = raw.reduce((sum, r) => (r.length >= minLength ? sum + r.count : sum), 0);
  const lengths = raw.map((r) => {
    if (r.length === 0) return 0;
    if (r.length < minLength) return minLength;
    return dominantTotal > 0 ? (remaining * r.count) / dominantTotal : r.length;
  });
  let offset = 0;
  const suggestedIndex = statuses.indexOf("suggested");
  const suggestedStart = lengths.slice(0, suggestedIndex).reduce((sum, length) => sum + length, 0);
  const suggestedLength = lengths[suggestedIndex] ?? 0;
  const suggestedAngle =
    ((suggestedStart + suggestedLength / 2) / circumference) * Math.PI * 2 - Math.PI / 2;
  const badgeRadius = 28;
  const badgeX = RING_VIEWBOX / 2 + Math.cos(suggestedAngle) * badgeRadius;
  const badgeY = RING_VIEWBOX / 2 + Math.sin(suggestedAngle) * badgeRadius;

  return (
    <>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
        className="pointer-events-none absolute inset-0 size-11 -rotate-90 transition-opacity group-hover:opacity-0"
      >
        {total === 0 && (
          <circle
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_R}
            fill="none"
            stroke="#d4d4d8"
            strokeWidth={RING_STROKE}
          />
        )}
        {statuses.map((status, index) => {
          const length = lengths[index];
          if (!length) return null;
          // ~4° seam between segments in the source file — 1.5 (of this ring's own ~135.8
          // circumference) matches that almost exactly, shrinking only for a segment small enough
          // that it would otherwise eat noticeably into that one status's own visible share.
          const gap = segments > 1 ? Math.min(1.5, length * 0.2) : 0;
          const start = offset;
          offset += length;
          return (
            <circle
              key={status}
              cx={RING_VIEWBOX / 2}
              cy={RING_VIEWBOX / 2}
              r={RING_R}
              fill="none"
              stroke={PROPERTY_RING_COLORS[status]}
              strokeWidth={
                emphasizeSuggested && status === "suggested" ? RING_STROKE * 2 : RING_STROKE
              }
              strokeDasharray={`${length - gap} ${circumference - length + gap}`}
              strokeDashoffset={-(start + gap / 2)}
            />
          );
        })}
      </svg>
      {emphasizeSuggested && counts.suggested > 0 && (
        <span
          aria-label={`${counts.suggested} suggested properties`}
          style={{
            left: `${(badgeX / RING_VIEWBOX) * 100}%`,
            top: `${(badgeY / RING_VIEWBOX) * 100}%`,
          }}
          className="pointer-events-none absolute z-20 inline-flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#7C61FF] text-[9px] font-semibold leading-none text-white shadow-sm"
        >
          {counts.suggested}
        </span>
      )}
    </>
  );
}

/** The segmented ring's hover replacement — a single solid ring in Figma's own hover-state blue
 * (`HOVER_RING_COLOR`), same position/thickness (`RING_R`/`RING_STROKE`/`RING_VIEWBOX`) as the
 * default ring above, so hovering the node reads as a crossfade in place rather than a size or
 * position jump. Trades the Property-status breakdown for a plainer "this is hoverable/active"
 * signal while the pointer is actually on the node — the breakdown itself is still one hover away
 * (or a click, into the Entity's own Detail view) whenever it's actually wanted. */
function HoverRing() {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
      className="pointer-events-none absolute inset-0 size-11 opacity-0 transition-opacity group-hover:opacity-100"
    >
      <circle
        cx={RING_VIEWBOX / 2}
        cy={RING_VIEWBOX / 2}
        r={RING_R}
        fill="none"
        stroke={HOVER_RING_COLOR}
        strokeWidth={RING_STROKE}
      />
    </svg>
  );
}

const SIDE_POSITION: Record<Side, string> = {
  top: "left-1/2 -top-[6px] -translate-x-1/2",
  bottom: "left-1/2 -bottom-[6px] -translate-x-1/2",
  left: "-left-[6px] top-1/2 -translate-y-1/2",
  right: "-right-[6px] top-1/2 -translate-y-1/2",
};

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
 * Hovering the node still reveals its 4 connection handles (unchanged). It no longer fans out the
 * entity's mapped Data Table names on hover — that's now surfaced by CLICKING the node instead:
 * selecting an Entity highlights its own mapped rows in the Data Tables panel alongside this canvas
 * (see `OverviewCanvas`'s own `activeEntityTableNames`), which stays visible as long as the
 * selection does rather than disappearing the moment the pointer leaves.
 */
export function OntologyNode({
  entity,
  detailed,
  nodeScale = 1,
  showLabel = true,
  showPropertySummary = false,
  emphasizeSuggestedProperties = false,
  emphasis = "normal",
  onClick,
  onStartMove,
  movementLocked = false,
  onStartConnect,
  connectSourceSide = null,
  connectTargetSide = null,
  moveTarget = false,
  propertyStatusRing = true,
}: {
  entity: Entity;
  /** Overview hub emphasis. A transform keeps the node centered without moving its label/layout. */
  nodeScale?: number;
  /** On by default wherever this node shows an Entity's own status at all — Overview's own
   * canvas nodes and Detail's related-entity satellites alike, so the ring/hover treatment reads
   * the same across the whole app. */
  propertyStatusRing?: boolean;
  /** Show confidence + props/table count below the name — Overview passes `view.z > 1` (zoomed
   * past 100%), matching Figma's own zoomed-in variant. */
  detailed: boolean;
  /** Overview semantic zoom may temporarily de-emphasize the visible name while preserving the
   * node's footprint and hit target. Defaults on so compact nodes outside Overview are unchanged. */
  showLabel?: boolean;
  /** Overview-only semantic zoom layer. Kept separate from `detailed` so the existing confidence
   * threshold and Detail View satellites remain unchanged. */
  showPropertySummary?: boolean;
  /** Overview Property Suggestions highlight mode only. */
  emphasizeSuggestedProperties?: boolean;
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
  const tableNames = tablesUsedByEntity(entity);
  const status = propertyStatusRing ? entityStatus(entity) : entityDisplayStatus(entity);
  const propertySummary = propertyStatusCounts(entity.properties);
  const entityStatusGlyph =
    status === "confirmed" ? "✓" : status === "suggested" ? "✦" : status === "warning" ? "!" : "!";
  const entityStatusTooltip = (
    <div className="min-w-[120px] space-y-1.5">
      <div className="flex items-center gap-1.5 font-medium text-white">
        <span style={{ color: PROPERTY_RING_COLORS[status] }}>{entityStatusGlyph}</span>
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
                  style={{ backgroundColor: PROPERTY_RING_COLORS[propertyReviewStatus] }}
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
  // Which of the 4 handles the pointer is directly over right now — drives the "enlarge + show a
  // plus" progressive-reveal step described on `ConnectionHandle`'s own `enlarged`/`showPlus`
  // props. Purely local, per-node UI state; never touches app-state.
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);

  return (
    <div
      className={cn(
        "group relative flex w-[100px] shrink-0 flex-col items-center gap-2 text-center transition-opacity",
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
          "relative flex select-none flex-col items-center gap-1 bg-transparent text-center",
          onStartMove && !movementLocked && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span
          style={{
            borderColor: propertyStatusRing ? "transparent" : statusBorderColor(status),
            transform: `scale(${nodeScale})`,
          }}
          className={cn(
            "relative flex size-11 shrink-0 items-center justify-center rounded-full bg-white shadow-[0px_1px_1.5px_rgba(0,0,0,0.1),0px_1px_1px_rgba(0,0,0,0.1)] transition-[opacity,box-shadow,transform]",
            // A real (if transparent) border here — even at 0 color — still eats into the padding
            // box that `PropertyStatusRing`'s `inset-0` SVG anchors to, while `StatusBadge` below
            // stays centered by flexbox instead — the two would end up centered on two DIFFERENT
            // points, a fraction of a pixel apart, reading as the ring not quite hugging the badge.
            // No border at all when the ring is doing that job instead keeps both concentric.
            propertyStatusRing ? "border-0" : "border-[1.5px]",
            emphasis === "active" && "ring-[3px] ring-[#3b82f6]",
            emphasis === "related" && "ring-2 ring-[#3b82f6]/60",
            moveTarget && "ring-[4px] ring-primary",
          )}
        >
          {propertyStatusRing && (
            <>
              <PropertyStatusRing
                entity={entity}
                counts={propertySummary}
                emphasizeSuggested={emphasizeSuggestedProperties}
              />
              <HoverRing />
            </>
          )}
          <StatusBadge
            status={status}
            size={propertyStatusRing ? RING_BADGE_SIZE : 35}
            confidence={entity.confidence}
            warningReason={entity.warningReason}
            errorReason={entityErrorReason(entity)}
            tooltipContent={entityStatusTooltip}
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
              className={cn(
                "truncate bg-[#fafafa] px-0.5 text-sm font-medium leading-4 text-foreground transition-opacity",
                showLabel ? "opacity-100" : "opacity-0",
              )}
            >
              {entity.name}
            </span>
            {detailed && entityDisplayStatus(entity) === "suggested" && (
              <ConfidenceChip confidence={entity.confidence} />
            )}
          </span>
          {detailed && !propertyStatusRing && (
            <span className="whitespace-nowrap text-[10px] font-normal leading-[10px] text-[#909090]">
              {entity.properties.length} props · {tableNames.length} table
              {tableNames.length === 1 ? "" : "s"}
            </span>
          )}
          {showPropertySummary && propertyStatusRing && (
            <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium leading-4 text-[#70757c]">
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
                    style={{ backgroundColor: PROPERTY_RING_COLORS[summaryStatus] }}
                    className="inline-flex size-4 items-center justify-center rounded-full text-[9px] font-semibold leading-none text-white"
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
