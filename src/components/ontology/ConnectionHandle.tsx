import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The single visual primitive for "create a connection from here" — used for both the Entity
 * Type's 4 boundary handles (Overview + Detail) and the single Property/Column mapping handle.
 * Hollow by default, filled solid blue when active (hovered or being dragged from). Visually and
 * behaviorally distinct from Status (a colored dot showing review state) and from the Draggable
 * affordance (a grip icon that moves the item) — this is the only affordance that starts a
 * connector drag.
 *
 * Sizing/color/shadow match the Figma reference exactly (node 90-598 "Item Hover" / 90-580 "Dot
 * Hover"): a 12px circle, white fill, 1.5px #00ded8 border, sitting on the item's boundary.
 */
export function ConnectionHandle({
  active = false,
  enlarged = false,
  showPlus = false,
  hoverFill = true,
  className,
  style,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  "aria-label": ariaLabel,
  title,
}: {
  /** Filled solid blue instead of hollow — the hovered/active/dragging-from state. */
  active?: boolean;
  /** Scales the dot up (a CSS transform, not a size-class swap, so its boundary anchor point on
   * whichever side never needs recalculating) — Overview's Entity node handles use this for their
   * own per-handle hover state; every other caller leaves it `false` and gets the plain small dot
   * unchanged. */
  enlarged?: boolean;
  /** Renders a small "+" glyph centered in the dot, paired with `enlarged` — shown while this
   * specific handle is hovered, or while it's the active source of a connect-drag. */
  showPlus?: boolean;
  /** Whether a plain CSS `:hover` should fill the dot solid on its own — the single mapping-handle
   * callers rely on this (no JS-driven hover state of their own), but Overview's 4-side Entity
   * handles drive their filled/enlarged/plus states from real hover + drag state instead, so they
   * pass `false` here to avoid the two mechanisms fighting each other. */
  hoverFill?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerEnter?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <span
      role="button"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={(e) => {
        // Same reasoning as DraggableHandle: swallow a plain click (this handle only starts a
        // connector drag), but let a shift/cmd/ctrl-click bubble to the row underneath so
        // multi-select still works when the click happens to land on this handle.
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) e.stopPropagation();
      }}
      aria-label={ariaLabel}
      title={title}
      style={style}
      className={cn(
        "pointer-events-auto box-border flex size-3 shrink-0 cursor-grab items-center justify-center rounded-full border-[1.5px] border-[#00ded8] shadow-[0_0_0_2px_#f6f6f6] transition-[transform,background-color] active:cursor-grabbing",
        active ? "bg-[#00ded8]" : cn("bg-white", hoverFill && "hover:bg-[#00ded8]"),
        enlarged && "scale-[1.6]",
        className,
      )}
    >
      {showPlus && (
        <Plus className={cn("size-2", active ? "text-white" : "text-[#00ded8]")} strokeWidth={3} />
      )}
    </span>
  );
}
