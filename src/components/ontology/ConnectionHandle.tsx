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
 * Hover"): a 12px circle, white fill, 1.5px #61b2ff border, sitting on the item's boundary.
 */
export function ConnectionHandle({
  active = false,
  className,
  style,
  onPointerDown,
  "aria-label": ariaLabel,
  title,
}: {
  /** Filled solid blue instead of hollow — the hovered/active/dragging-from state. */
  active?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent) => void;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <span
      role="button"
      tabIndex={-1}
      onPointerDown={onPointerDown}
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
        "pointer-events-auto box-border size-3 shrink-0 cursor-grab rounded-full border-[1.5px] border-[#61b2ff] shadow-[0_0_0_2px_#f6f6f6] transition-colors hover:bg-[#61b2ff] active:cursor-grabbing",
        active ? "bg-[#61b2ff]" : "bg-white",
        className,
      )}
    />
  );
}
