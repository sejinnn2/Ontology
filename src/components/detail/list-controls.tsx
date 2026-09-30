import { useState } from "react";
import {
  Calendar,
  Fingerprint,
  Hash,
  List,
  Plus,
  ToggleLeft,
  Type as TypeIcon,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SortDropdown, type SortKey, type SortState } from "@/components/ontology/SortDropdown";
import { cn } from "@/lib/utils";
import filterIcon from "@/assets/icons/filter-1-16.svg";
import hashtagIcon from "@/assets/icons/hashtag-16.svg";
import searchIcon from "@/assets/icons/magnifying-glass-2-16.svg";

/**
 * The list pieces the editing workspace's Graph views share (`EditingGraph`): the Filter / Sort / + / Search bar above a Property or Column list, and the
 * icons its rows use.
 */

/** A Central Icon exported from the Zaimler Figma file (see `src/assets/icons/`), in the Figma
 * Icon_template's own box: a fixed square holding the SVG at its native size. */
export function FigmaIcon({
  src,
  size = 16,
  className,
}: {
  src: string;
  size?: 16 | 20;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("relative block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {/* Not draggable itself — a drag handle's icon must let its handle start the drag. */}
      <img
        alt=""
        src={src}
        draggable={false}
        className="pointer-events-none absolute inset-0 block size-full"
      />
    </span>
  );
}

// The one Filter control every Property/Column list in this workspace shares — "All" (no-op),
// "Mapped" (has a confirmed Property<->Column mapping), "Unmapped" (no mapping, or only a still-
// Suggested one — see `hasMapping`), and "Only Identifier" (isIdentifierProperty). A
// single enum rather than 3 separate booleans since exactly one of them applies at a time.
export type ListFilter = "all" | "mapped" | "unmapped" | "identifier";
export const LIST_FILTER_LABEL: Record<ListFilter, string> = {
  all: "Filter",
  mapped: "Mapped",
  unmapped: "Unmapped",
  identifier: "Only Identifier",
};

/**
 * The Property/Column list header — Filter ("Only Identifier"), Sort (Name/Confidence, via the
 * same shared `SortDropdown` the Entity Types/Data Tables toolbox panels use), and a Search box
 * that filters this ONE list by name. Every one of the 4 lists this appears above (Current
 * Entity's own Properties, a Connected Entity's own expanded Properties, an expanded Table's own
 * Columns, and `CurrentDataTableCard`'s own Columns) owns its own independent state for all
 * three, keyed by whichever Entity/Table it belongs to — see `visiblePropertiesFor`/the
 * `ExpandedTable`-local column filtering for where that state is actually applied.
 */
/** The Filter control's own trigger + menu — same open/close-on-outside-click shape as
 * `SortDropdown`, just with 4 fixed options instead of Name/Confidence. Kept local to this file
 * (unlike `SortDropdown`) since nothing outside this workspace needs a Mapped/Unmapped/Identifier
 * filter today. */
export function FilterDropdown({
  value,
  onChange,
}: {
  value: ListFilter;
  onChange: (next: ListFilter) => void;
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
            "flex h-6 shrink-0 items-center gap-1 rounded-[4.77px] px-1.5 text-[14px] font-medium leading-6 text-[#6d7472] transition-colors hover:bg-black/[0.08]",
            value !== "all" && "bg-black/[0.08] text-[#161919]",
          )}
        >
          {LIST_FILTER_LABEL[value]}
          <FigmaIcon src={filterIcon} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
        className="z-[100] w-36 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node-lift)]"
      >
        <div role="menu" className="flex flex-col gap-0.5">
          {(["all", "mapped", "unmapped", "identifier"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={value === key}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              className={cn(
                "rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                value === key
                  ? "bg-black/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {key === "all" ? "All" : LIST_FILTER_LABEL[key]}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The + that opens `ItemEditorModal` to create a new item in that list. */
export function CreateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[#6d7472] hover:bg-black/[0.08] hover:text-[#161919]"
    >
      <Plus className="size-4" strokeWidth={1.5} />
    </button>
  );
}

export function ListControls({
  filter,
  onFilterChange,
  sort,
  onSortChange,
  sortOptions,
  search,
  onSearchChange,
  searchPlaceholder,
  onCreate,
  createLabel,
  className,
}: {
  // Both omitted entirely hides the Filter control — Mapped/Unmapped/Only Identifier are all
  // facts about a Property's own mapping, which not every list this appears above has enough
  // context for (e.g. a Data Table's Column list, shared across however many Entities map into
  // it).
  filter?: ListFilter;
  onFilterChange?: (next: ListFilter) => void;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  sortOptions?: readonly SortKey[] | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  onCreate?: (() => void) | undefined;
  createLabel?: string;
  // Overrides the bar's own padding / surface (e.g. the Graph view's property panel).
  className?: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    // Figma "filter section" (node 449:28721): 40px, pl-10/pr-12, the lane's own surface color.
    <div
      className={cn(
        "lod-detail relative z-50 flex h-10 shrink-0 items-center gap-2 bg-inherit pl-2.5 pr-3",
        className,
      )}
    >
      {searchOpen ? (
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onSearchChange("");
              setSearchOpen(false);
            }
          }}
          placeholder={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-[14px] text-[#161919] outline-none placeholder:text-[#9ea3a2]"
        />
      ) : (
        <div className="flex items-center gap-1">
          {onFilterChange && <FilterDropdown value={filter ?? "all"} onChange={onFilterChange} />}
          <SortDropdown
            sort={sort}
            onChange={onSortChange}
            showPrefix={false}
            variant="figma"
            options={sortOptions}
          />
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        {onCreate && <CreateButton label={createLabel ?? "Create"} onClick={onCreate} />}
        <button
          type="button"
          onClick={() => {
            if (searchOpen && search) onSearchChange("");
            setSearchOpen((open) => !open);
          }}
          aria-label={searchOpen ? "Close search" : "Search"}
          className="flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[#6d7472] hover:bg-black/[0.08]"
        >
          {searchOpen ? <X className="size-4" strokeWidth={1.5} /> : <FigmaIcon src={searchIcon} />}
        </button>
      </div>
    </div>
  );
}

// Figma's own "type-icon" (node 426:30479 et al.) is a bare empty 16px square — a placeholder,
// not a real glyph — so this picks a real one per Property type instead of copying the empty box
// literally. Matched by loose substring on the (free-form) type string, not an exhaustive enum,
// since `Property.type` isn't a closed set; anything unrecognized falls back to the generic "Aa"
// type glyph rather than showing nothing.
export function propertyTypeIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("bool")) return ToggleLeft;
  if (t.includes("date") || t.includes("time")) return Calendar;
  if (t.includes("enum")) return List;
  if (t.includes("uuid")) return Fingerprint;
  if (t.includes("int") || t.includes("decimal") || t.includes("numeric") || t.includes("float")) {
    return Hash;
  }
  return TypeIcon;
}

/** The pill's type icon: Figma's IconHashtag for numeric types (the only type glyph the Zaimler
 * file draws); other types keep their Lucide glyph, drawn at the same 1px stroke. Hovering it
 * names the type ("date", "integer", …). */
export function PropertyTypeGlyph({
  type,
  color = "#09090B",
}: {
  type: string;
  // The icon's color — the Graph view's rows use the muted #6d7472.
  color?: string;
}) {
  const TypeGlyph = propertyTypeIcon(type);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={type} className="flex shrink-0">
          {TypeGlyph === Hash ? (
            // The hashtag is an exported SVG with its own stroke color, so it's used as a mask
            // and filled with `color`.
            <span
              aria-hidden
              className="block size-4 shrink-0"
              style={{
                backgroundColor: color,
                // Quoted: the asset can be an inline `data:` URI, invalid in a bare `url()`.
                maskImage: `url(${JSON.stringify(hashtagIcon)})`,
                WebkitMaskImage: `url(${JSON.stringify(hashtagIcon)})`,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
              }}
            />
          ) : (
            <TypeGlyph className="size-4" style={{ color }} strokeWidth={1.5} aria-hidden />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent className="font-mono">{type || "unknown"}</TooltipContent>
    </Tooltip>
  );
}
