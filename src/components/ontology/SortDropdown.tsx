import sortLinesIcon from "@/assets/icons/sort-lines-16.svg";
import { useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// --- Sorting, shared by every list this feature touches (Entity types / Data Tables toolboxes,
// a card's own Properties, a table's own Columns). Purely a display-order concern — it reorders
// what a list renders, never an item's canvas x/y, so it can never move a node. ------------------
export type SortKey = "relevance" | "name" | "confidence";
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
    if (state.key === "relevance") return 0;
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
  showPrefix = true,
  variant = "default",
  compact = false,
  options = ["name", "confidence"],
}: {
  sort: SortState;
  onChange: (key: SortKey) => void;
  className?: string;
  showPrefix?: boolean;
  variant?: "default" | "figma";
  /** 12px label (the editing graph's cards) instead of 14px. */
  compact?: boolean;
  options?: readonly SortKey[] | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            variant === "figma"
              ? cn(
                  "flex h-6 items-center gap-1.5 rounded-[4px] px-1 text-[14px] leading-none text-[#6d7472] transition-colors hover:bg-black/[0.08]",
                  compact && "text-[12px] leading-4",
                )
              : "flex items-center rounded-[4px] px-1.5 py-0.5 text-xs font-normal text-muted-foreground transition-colors hover:bg-accent",
            className,
          )}
        >
          {variant === "figma" && (
            // Figma 466:86067: the sort lines lead the label; flipped for descending.
            <span className={cn("relative size-4 shrink-0", sort.dir === "desc" && "-scale-y-100")}>
              <img alt="" src={sortLinesIcon} className="absolute inset-0 block size-full" />
            </span>
          )}
          {showPrefix && "Sort: "}
          {sort.key === "relevance"
            ? options.includes("relevance")
              ? "Relevance"
              : "Sort"
            : sort.key === "name"
              ? "Name"
              : "Confidence"}
          {variant !== "figma" && (
            <ArrowUpDown className={cn("size-3", sort.dir === "desc" && "-scale-y-100")} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
        className="z-[100] w-32 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node-lift)]"
      >
        <div role="menu" className="flex flex-col gap-0.5">
          {options.map((key) => (
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
              {key === "relevance" ? "Relevance" : key === "name" ? "Name" : "Confidence"}
              {sort.key === key && (
                <ArrowUpDown className={cn("size-2.5", sort.dir === "desc" && "-scale-y-100")} />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
