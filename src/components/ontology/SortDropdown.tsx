import { useEffect, useRef, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// --- Sorting, shared by every list this feature touches (Entity types / Data Tables toolboxes,
// a card's own Properties, a table's own Columns). Purely a display-order concern — it reorders
// what a list renders, never an item's canvas x/y, so it can never move a node. ------------------
export type SortKey = "name" | "confidence";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };
export const DEFAULT_SORT: SortState = { key: "name", dir: "asc" };

/** Clicking the already-active key flips direction; switching keys picks that key's own more
 * useful default direction (name starts A-Z, confidence starts High-Low) rather than carrying
 * over whatever direction the previous key happened to be on. */
export function nextSortState(current: SortState, key: SortKey): SortState {
  if (key === current.key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "confidence" ? "desc" : "asc" };
}

export function sortByState<T>(
  items: T[],
  state: SortState,
  name: (item: T) => string,
  confidence: (item: T) => number | undefined,
): T[] {
  const sorted = [...items].sort((a, b) => {
    if (state.key === "name") return name(a).localeCompare(name(b));
    return (confidence(a) ?? -1) - (confidence(b) ?? -1);
  });
  if (state.dir === "desc") sorted.reverse();
  return sorted;
}

/** The Entity Types / Data Tables PANEL header's own compact sort control — a single "Sort: Name
 * ↕" trigger opening a 2-option menu. Every in-canvas card's own Property/Column list keeps the
 * original always-visible two-button `SortBar` control (in DetailView.tsx) untouched — only the
 * top-level panel headers (Detail's two toolboxes, Overview's Data Tables panel) use this one.
 * Selecting either option, including the one already active, calls `onChange` exactly like
 * `SortBar` did — the underlying `nextSortState` toggle-direction-on-repeat-click behavior is
 * entirely unchanged, this only changes how that same action is triggered. */
export function SortDropdown({
  sort,
  onChange,
  className,
}: {
  sort: SortState;
  onChange: (key: SortKey) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent"
      >
        Sort: {sort.key === "name" ? "Name" : "Confidence"}
        <ArrowUpDown className={cn("size-2.5", sort.dir === "desc" && "-scale-y-100")} />
      </button>
      {open && (
        <div
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-30 mt-1 flex w-32 flex-col gap-0.5 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node-lift)]"
        >
          {(["name", "confidence"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={sort.key === key}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                sort.key === key
                  ? "bg-black/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {key === "name" ? "Name" : "Confidence"}
              {sort.key === key && (
                <ArrowUpDown className={cn("size-2.5", sort.dir === "desc" && "-scale-y-100")} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
