import { cn } from "@/lib/utils";

/**
 * The single visual primitive for "move this item" — a 6-dot grip icon, right-aligned per the
 * Figma reference (node 90-617 "Draggable"). Visually and behaviorally distinct from a Connection
 * handle (a circle on the item's boundary that starts a connector) and from Status (a colored dot
 * showing review state, on the opposite/left side) — dragging from here must never create a
 * connection, only move the item itself.
 */
export function DraggableHandle({
  onPointerDown,
  className,
  "aria-label": ariaLabel,
  title = "Drag to move",
}: {
  onPointerDown?: (e: React.PointerEvent) => void;
  className?: string;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <span
      role="button"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        // A plain click here does nothing and must not reach whatever's underneath (e.g. a
        // property row's own click-to-preview). A shift/cmd/ctrl-click, though, is a multi-select
        // gesture aimed at the row, not at this handle — let it bubble so the row still toggles
        // selection even when the click happens to land on this small icon.
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) e.stopPropagation();
      }}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "inline-flex size-[10px] shrink-0 cursor-grab items-center justify-center active:cursor-grabbing",
        className,
      )}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="3" cy="1" r="1" fill="#C2C2C2" />
        <circle cx="7" cy="1" r="1" fill="#C2C2C2" />
        <circle cx="3" cy="5" r="1" fill="#C2C2C2" />
        <circle cx="7" cy="5" r="1" fill="#C2C2C2" />
        <circle cx="3" cy="9" r="1" fill="#C2C2C2" />
        <circle cx="7" cy="9" r="1" fill="#C2C2C2" />
      </svg>
    </span>
  );
}
