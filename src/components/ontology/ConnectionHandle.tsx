import { cn } from "@/lib/utils";

/**
 * The single visual primitive for "create a connection from here" — used for both the Entity
 * Type's 4 boundary handles (Overview + Detail) and the single Property/Column mapping handle.
 * Hollow by default, filled solid blue when active (hovered or being dragged from). Visually and
 * behaviorally distinct from Status (a colored dot showing review state) and from the Draggable
 * affordance (a grip icon that moves the item) — this is the only affordance that starts a
 * connector drag.
 *
 * Sizing/color/shadow match Figma "Dot" (362:222226): an 8px circle, white with a 1px #e3e5e4
 * border, filled #3b82f6 while active.
 */
export function ConnectionHandle({
  active = false,
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
  /** Whether a plain CSS `:hover` should fill the dot solid on its own — the single mapping-handle
   * callers rely on this (no JS-driven hover state of their own), but Overview's 4-side Entity
   * handles drive their filled state from real hover + drag state instead, so they
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
      style={style}
      className={cn(
        // Figma "Dot" (362:222226): 8px, white, 1px #e3e5e4 with a 2px canvas halo; blue when active.
        "pointer-events-auto box-border flex size-2 shrink-0 cursor-grab items-center justify-center rounded-full border shadow-[0_0_0_2px_#f9fafb] transition-[transform,background-color,border-color] active:cursor-grabbing",
        active
          ? "border-[#3b82f6] bg-[#3b82f6]"
          : cn(
              "border-[#e3e5e4] bg-white",
              hoverFill && "hover:border-[#3b82f6] hover:bg-[#3b82f6]",
            ),
        className,
      )}
    ></span>
  );
}
