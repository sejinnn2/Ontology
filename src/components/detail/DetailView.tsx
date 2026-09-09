import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  Plus,
  Scissors,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tableByName,
  tableMappingStatus,
  entitiesUsingTable,
  tablesUsedByEntity,
  columnSampleValues,
  relationLabel,
  isIdentifierProperty,
  propertyStatus,
  propertyErrorReason,
  entityStatus,
  entityErrorReason,
  type Entity,
  type Property,
  type Relation,
  type TableColumn,
  type TableSchema,
} from "@/lib/mock-data";
import { orthogonalPath, sideBetween, edgeAnchorsForRects, NODE_W } from "@/lib/geometry";
import type { Side, Rect } from "@/lib/geometry";
import type { ConfidenceRange, DetailAnchor, OntologyApp } from "@/lib/app-state";
import { EntityNode } from "@/components/overview/EntityNode";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";
import { DraggableHandle } from "@/components/ontology/DraggableHandle";
import { DeleteButton } from "@/components/ontology/DeleteButton";
import { StatusBadge, statusBorderColor } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import { SearchInput } from "@/components/ontology/SearchInput";
import { CreateEntityButton } from "@/components/ontology/CreateEntityButton";
import {
  CanvasControls,
  useCanvasToolShortcuts,
  type CanvasTool,
} from "@/components/ontology/CanvasControls";
import {
  SortDropdown,
  DEFAULT_SORT,
  nextSortState,
  sortByState,
  type SortKey,
  type SortState,
} from "@/components/ontology/SortDropdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextPanelBody, contextItemKey, type ContextItem } from "./ContextPanel";

/** Stable empty-Set fallback for "this entity has no property selection yet" — a fresh `new
 * Set()` on every lookup would defeat referential-equality checks (and just churns memory) for
 * what's overwhelmingly the common case. Never mutated in place — callers only ever read it or
 * replace it wholesale via setState. */
const EMPTY_ID_SET: Set<string> = new Set();

/** The one sort-control UI reused everywhere a list can be sorted — two small toggle buttons
 * rather than a dropdown, so the current key *and* direction are always visible at a glance. */
function SortBar({
  sort,
  onChange,
  className,
}: {
  sort: SortState;
  onChange: (key: SortKey) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      {(["name", "confidence"] as const).map((key) => (
        <button
          key={key}
          type="button"
          // Several callers render this inside a pannable canvas, whose own onPointerDown grabs
          // pointer capture for panning on any bubbled pointerdown — which then retargets the
          // resulting click away from this button (see the property row's own fix for the full
          // explanation). Harmless for the toolbox-panel callers outside any canvas.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onChange(key)}
          title={
            key === "name"
              ? sort.key === "name" && sort.dir === "desc"
                ? "Sorted Z–A — click for A–Z"
                : "Sorted A–Z — click for Z–A"
              : sort.key === "confidence" && sort.dir === "asc"
                ? "Sorted Low–High — click for High–Low"
                : "Sorted High–Low — click for Low–High"
          }
          className={cn(
            "flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors",
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
  );
}

/** The "+ Add property" action below a Property list, and the inline input it turns into — never
 * a modal. Enter creates the Property (a blank name is a silent no-op, same as clicking away with
 * nothing typed); Escape always cancels regardless of what's been typed. */
function AddPropertyRow({
  isAdding,
  onStartAdd,
  onSubmit,
  onCancel,
}: {
  isAdding: boolean;
  onStartAdd: () => void;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  if (!isAdding) {
    return (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onStartAdd}
        className="mt-1 flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent"
      >
        <Plus className="size-3.5" /> Add property
      </button>
    );
  }
  return (
    <input
      key="new-property-input"
      autoFocus
      type="text"
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onSubmit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit(e.currentTarget.value);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      placeholder="Property name..."
      className="mt-1 w-full rounded-[10px] border border-dashed border-input bg-background px-3 py-2 text-[14px] leading-[16.5px] outline-none focus:border-primary"
    />
  );
}

/** Wraps a Column row's name/type (never its Confidence chip — see the callers, which keep that
 * as an untouched sibling) so hovering the row shows this column's real sample values, pulled
 * straight from the table's own mock rows rather than a separately-authored list. A completely
 * separate hover target from the Confidence chip's own tooltip, by construction: this trigger and
 * the chip are siblings with non-overlapping boxes, so hovering one can never also arm the other. */
function SampleDataTrigger({
  table,
  columnName,
  className,
  children,
}: {
  table: TableSchema;
  columnName: string;
  className?: string;
  children: React.ReactNode;
}) {
  const samples = columnSampleValues(table, columnName);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={className}>{children}</div>
      </TooltipTrigger>
      <TooltipContent className="space-y-1">
        <p className="font-medium text-white">Sample data</p>
        {samples.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {samples.slice(0, 6).map((v) => (
              <li key={v} className="text-[#B7BCC4]">
                {v}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[#B7BCC4]">No sample data available.</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function IdentifierIcon() {
  return (
    <span
      className="flex size-4 shrink-0 flex-col items-center justify-center gap-2.5 text-[14px] leading-none"
      title="Identifier"
      aria-label="Identifier"
    >
      🔑
    </span>
  );
}

/** Marks exactly where a dragged toolbox item will land, inline among the existing satellites —
 * ported from the older prototype's own drop-position indicator. */
/** Marks exactly where a dragged toolbox item will land — "pill" for the related-entities column
 * (a satellite-sized slot), "card" for the center Entity-card column or the Columns area (a
 * card-sized slot). Fixed dimensions regardless of what actually renders once dropped, since it's
 * an insertion marker, not a preview of the final (usually taller) card. */
function DropInsertionPlaceholder({ variant }: { variant: "pill" | "card" }) {
  if (variant === "pill") {
    return (
      <div
        className="box-border flex h-[43px] w-[160px] shrink-0 items-center justify-center gap-2 rounded-full border-[1.5px] border-dashed border-[#61B2FF] bg-[rgba(97,178,255,0.05)] py-[6px] pl-[6px] pr-[12px]"
        aria-hidden="true"
      >
        <Plus className="size-4 text-[#61B2FF]" strokeWidth={2.5} />
      </div>
    );
  }
  return (
    <div
      className="box-border flex h-[47px] w-[268.8px] shrink-0 flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-[#61B2FF] bg-[rgba(97,178,255,0.05)] px-[12px] py-[8px]"
      aria-hidden="true"
    >
      <Plus className="size-4 text-[#61B2FF]" strokeWidth={2.5} />
    </div>
  );
}

const MIN_Z = 0.5;
const MAX_Z = 1.5;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
// Matches the panels' own w-60 / w-11 Tailwind classes — used only to reserve enough room on
// each side when fitting the graph into the visible gap between them on first render.
const PANEL_OPEN_W = 240;
const PANEL_COLLAPSED_W = 44;
// A resized panel can only grow from its own default open width, never shrink below it — the
// default is already the narrowest width every row's own content (name/confidence/handle) fits
// at without truncation.
const PANEL_MIN_W = PANEL_OPEN_W;
const PANEL_MAX_W = 480;

// `propertyId`/`ownerEntityId` are only set for a real Property<->Column mapping line (never for
// a purely-visual connector like a table's own anchor-to-column lines) — their presence is what
// the hover-delete control below checks to decide whether a given line can be disconnected at
// all, rather than parsing meaning back out of `id`.
type Line = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  propertyId?: string;
  ownerEntityId?: string;
  /** Which axis the line's own two anchor sides face along (see `edgeAnchorsForRects` in
   * geometry.ts — a "left/right" pair is always "horizontal", a "top/bottom" pair "vertical").
   * Adaptively recomputed by every `computeLines` from the two connected elements' CURRENT
   * positions, so a card or row that's been dragged to a different relative position gets a
   * freshly-chosen side rather than one baked in at creation. Defaults to "horizontal" for the
   * handful of purely-visual lines that never bothered computing this. */
  axis?: "horizontal" | "vertical";
};
const curve = (l: Line) =>
  orthogonalPath(
    { x: l.x1, y: l.y1 },
    { x: l.x2, y: l.y2 },
    undefined,
    l.axis === "vertical" ? "vertical" : l.axis === "horizontal" ? "horizontal" : "auto",
  );

// A Property<->Column mapping is inherently a many-to-many fan between two parallel lists whose
// own orders rarely match (a property's row position has nothing to do with its mapped column's
// row position), so these lines routinely cross when the two rows face each other left/right.
// Smoothing each connector into a horizontal S-curve — pulling the control points halfway toward
// the opposite endpoint's X — is the standard "bipartite fan" treatment (the same shape a Sankey
// diagram uses) and stays legible even with several lines crossing at once. When the two rows'
// adaptively-chosen anchor sides instead face top/bottom (the card they're on has been dragged to
// a different relative position), that fan shape no longer applies — this falls back to the same
// rounded orthogonal elbow the graph-like Relation lines use, via `curve` above, since a vertical
// S-curve would cut across whatever sits between the two rows.
const mappingCurve = (l: Line) => {
  if (l.axis === "vertical") return curve(l);
  const dx = (l.x2 - l.x1) / 2;
  return `M ${l.x1} ${l.y1} C ${l.x1 + dx} ${l.y1}, ${l.x2 - dx} ${l.y2}, ${l.x2} ${l.y2}`;
};

// A cached off-screen canvas context, reused to measure relation-label text width synchronously
// during render (not via a post-render DOM measurement) — see relationGapPx below for why that
// ordering matters.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureTextWidth(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * 7; // non-DOM environment fallback (tests, SSR)
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
// The relation label pill's own chrome around its name text: a 16px status badge + 4px gap
// (gap-1) + 1.5px border on both sides + pl-1 (4px) + pr-2 (8px) padding.
const RELATION_LABEL_CHROME = 16 + 4 + 1.5 * 2 + 4 + 8;
const RELATION_LABEL_FONT = "500 10.5px 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";

/**
 * The one reusable Detail shell: a left "Entity types" toolbox and a right "Data Tables" toolbox
 * (both jump the whole Detail view to a different anchor, without returning to Overview first), a
 * center canvas area (pan/zoom, grid background — same visual language as the Overview canvas),
 * and bottom canvas controls. The actual mapping graph is passed in as `children`, rendered inside
 * the pannable/zoomable surface. There's no separate top bar here — Figma merges Back into the
 * global Header's Review Progress row instead (see routes/index.tsx), and the anchor's own
 * name/status already shows as that card's title inside `children`.
 */
function DetailShell({
  entityItems,
  onFocusEntity,
  onCreateEntity,
  onDropEntity,
  tableItems,
  entities,
  onFocusTable,
  onDropTable,
  onDragMove,
  onDragEnd,
  zoom,
  setZoom,
  pan,
  setPan,
  contextItem,
  onCloseContext,
  onSwapRelation,
  onRenameRelation,
  onEditRelationDescription,
  onRenameEntity,
  onEditEntityDescription,
  onRenameProperty,
  onEditPropertyDescription,
  onDeleteEntity,
  onDeleteProperty,
  onDeleteRelation,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  confidenceRange,
  onCanvasPointerDown,
  children,
}: {
  entityItems: Entity[];
  /** Clicking an Entity Types toolbox row navigates Detail to a new anchor centered on that
   * Entity Type — "panel = take me there", the opposite of a canvas click (which only inspects,
   * never navigates; see the canvas's own click handlers below). Dragging the row instead places
   * it into the CURRENT workspace without navigating — see `onDropEntity`. The optional second
   * argument additionally focuses one matched Property in the newly-opened anchor, for a
   * Property search-result row. */
  onFocusEntity: (id: string, focusPropertyId?: string) => void;
  /** Creates a brand-new Entity Type from the panel's own "+" popover — never placed on any
   * canvas automatically, and never treated as an AI suggestion (see app-state's `createEntity`):
   * it only ever appears here until the user drags it onto a canvas themselves. */
  onCreateEntity: (name: string) => void;
  /** Dropping an Entity Type from the toolbox onto the canvas places it there instead of
   * navigating — a lightweight way to bring another item into view without leaving this one.
   * Given the exact client coordinates it was released at, so the target canvas can place it at
   * that actual drop position rather than always appending it. */
  onDropEntity: (id: string, clientX: number, clientY: number) => void;
  tableItems: TableSchema[];
  /** Live entities, used only to compute each table's mapping-status badge in the toolbox. */
  entities: Entity[];
  /** Same idea as `onFocusEntity`, for the Data Tables toolbox — the optional second argument
   * focuses one matched Column, for a Column search-result row. */
  onFocusTable: (name: string, focusColumnName?: string) => void;
  onDropTable: (name: string, clientX: number, clientY: number) => void;
  /** Fired continuously (post drag-threshold) while a toolbox item is being dragged, so the
   * canvas underneath can show drop-zone feedback at the live cursor position. */
  onDragMove?: (kind: "entity" | "table", id: string, clientX: number, clientY: number) => void;
  /** Fired once a toolbox drag ends, dropped or not, so the canvas can clear any drop-zone
   * feedback it was showing. */
  onDragEnd?: () => void;
  zoom: number;
  setZoom: (fn: (z: number) => number) => void;
  pan: { x: number; y: number };
  setPan: (fn: (p: { x: number; y: number }) => { x: number; y: number }) => void;
  /** The currently-selected item for the bottom contextual panel, owned by the calling canvas
   * (each canvas knows its own Entity/Property/Relation/Table/Column objects) — DetailShell only
   * renders the shared floating chrome around whatever content that selection produces. */
  contextItem: ContextItem | null;
  onCloseContext: () => void;
  /** Swap a Relation's from/to, surfaced inside the contextual panel's own Relation view (see
   * ContextPanelBody) — owned by the calling canvas since it's the one with `updateRelation`.
   * Confirming a Relation is no longer a per-item action here; it only happens through the
   * global Confirm dialog (see Header). */
  onSwapRelation: (relationId: string) => void;
  onRenameRelation: (relationId: string, name: string) => void;
  onEditRelationDescription: (relationId: string, description: string) => void;
  /** Name/Description edits surfaced inside the contextual panel (see ContextPanelBody) — plain
   * field updates via the calling canvas's own `updateEntity`/`updateProperty`, no special-casing
   * the way a Relation's rename needs (see `renameRelation`'s own Error-clearing rule). */
  onRenameEntity: (entityId: string, name: string) => void;
  onEditEntityDescription: (entityId: string, description: string) => void;
  onRenameProperty: (entityId: string, propertyId: string, name: string) => void;
  onEditPropertyDescription: (entityId: string, propertyId: string, description: string) => void;
  /** Delete actions surfaced inside the contextual panel (see ContextPanelBody) — each moves the
   * item to Trash rather than destroying it, owned by the calling canvas since it's the one with
   * the underlying app-state mutations. */
  onDeleteEntity: (entityId: string) => void;
  onDeleteProperty: (entityId: string, propertyId: string) => void;
  onDeleteRelation: (relationId: string) => void;
  /** The canvas controls' own Undo/Redo pill — same app-wide history stack as Overview's. */
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** The Header's Confidence score range — filters which rows the Entity types / Data Tables
   * toolboxes below show, same "pure display filter" treatment as search and sort. */
  confidenceRange: ConfidenceRange;
  /** Fired on every canvas-background pointerdown (mirrors Overview's own "clear selection
   * eagerly on pointerdown" pattern) — a click on a specific item still wins because that item's
   * own handler runs afterward and stops propagation. */
  onCanvasPointerDown?: () => void;
  children: React.ReactNode;
}) {
  const [entityPanelOpen, setEntityPanelOpen] = useState(true);
  const [tablePanelOpen, setTablePanelOpen] = useState(true);
  // User-resizable panel width — grippable at each panel's own inner edge (see the resize handle
  // below). Only ever applies while the panel is open; a collapsed panel always stays at
  // PANEL_COLLAPSED_W regardless of whatever width it was resized to before collapsing.
  const [entityPanelWidth, setEntityPanelWidth] = useState(PANEL_OPEN_W);
  const [tablePanelWidth, setTablePanelWidth] = useState(PANEL_OPEN_W);
  const panelResize = useRef<{
    side: "entity" | "table";
    startX: number;
    startWidth: number;
  } | null>(null);
  const startPanelResize = useCallback(
    (side: "entity" | "table") => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      panelResize.current = {
        side,
        startX: e.clientX,
        startWidth: side === "entity" ? entityPanelWidth : tablePanelWidth,
      };
    },
    [entityPanelWidth, tablePanelWidth],
  );
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = panelResize.current;
      if (!r) return;
      // The Entity types panel is pinned to the left edge, so dragging right (positive dx) grows
      // it; the Data Tables panel is pinned to the right edge, so dragging left (negative dx)
      // grows it instead — the sign flips, everything else about the drag is identical.
      const dx = e.clientX - r.startX;
      const next = clamp(r.startWidth + (r.side === "entity" ? dx : -dx), PANEL_MIN_W, PANEL_MAX_W);
      if (r.side === "entity") setEntityPanelWidth(next);
      else setTablePanelWidth(next);
    };
    const onUp = () => {
      panelResize.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
  // Display order only — never touches canvas position, an entity's own confidence, or anything
  // else about the item itself.
  const [entitySort, setEntitySort] = useState<SortState>(DEFAULT_SORT);
  const [tableSort, setTableSort] = useState<SortState>(DEFAULT_SORT);
  // Search, same pure-display treatment as sorting above — filters which toolbox rows render,
  // never the ontology data or canvas itself. Case-insensitive substring match on the item's own
  // name, since that's the only thing shown in either list. Collapsed behind its own icon in the
  // panel's content-controls row — never a permanently-visible input — so closing it also clears
  // the query, the same "a collapsed search never sits silently filtered" rule Overview's own
  // on-demand search already follows.
  const [entitySearchOpen, setEntitySearchOpen] = useState(false);
  const [tableSearchOpen, setTableSearchOpen] = useState(false);
  const [entitySearch, setEntitySearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const toggleEntitySearch = useCallback(() => {
    setEntitySearchOpen((open) => {
      if (open) setEntitySearch("");
      return !open;
    });
  }, []);
  const toggleTableSearch = useCallback(() => {
    setTableSearchOpen((open) => {
      if (open) setTableSearch("");
      return !open;
    });
  }, []);
  // Tables carry an optional confidence — one with none is never excluded by the range filter,
  // the same "no data renders as no opinion" rule the Confidence chip itself follows.
  const inConfidenceRange = useCallback(
    (confidence: number | undefined) => {
      if (confidence == null) return true;
      const pct = Math.round(confidence * 100);
      return pct >= confidenceRange.min && pct <= confidenceRange.max;
    },
    [confidenceRange],
  );
  // Search matches an Entity Type by its own name OR by any of its Properties' names — a
  // Property match keeps the parent Entity Type visible (and lists which Property matched)
  // even when the Entity Type's own name doesn't match at all. Never touches which Properties
  // actually render on the canvas card itself — this only narrows the toolbox list.
  const entitySearchQuery = entitySearch.trim().toLowerCase();
  const matchedPropertiesByEntity = useMemo(() => {
    const map = new Map<string, Property[]>();
    if (!entitySearchQuery) return map;
    entityItems.forEach((e) => {
      const matches = e.properties.filter((p) => p.name.toLowerCase().includes(entitySearchQuery));
      if (matches.length > 0) map.set(e.id, matches);
    });
    return map;
  }, [entityItems, entitySearchQuery]);
  const sortedEntityItems = useMemo(
    () =>
      sortByState(
        entityItems.filter(
          (e) =>
            inConfidenceRange(e.confidence) &&
            (!entitySearchQuery ||
              e.name.toLowerCase().includes(entitySearchQuery) ||
              matchedPropertiesByEntity.has(e.id)),
        ),
        entitySort,
        (e) => e.name,
        (e) => e.confidence,
      ),
    [entityItems, entitySort, entitySearchQuery, inConfidenceRange, matchedPropertiesByEntity],
  );
  // Same parent-keeps-visible-for-a-child-match treatment, Table <-> Column.
  const tableSearchQuery = tableSearch.trim().toLowerCase();
  const matchedColumnsByTable = useMemo(() => {
    const map = new Map<string, TableColumn[]>();
    if (!tableSearchQuery) return map;
    tableItems.forEach((t) => {
      const matches = t.columns.filter((c) => c.name.toLowerCase().includes(tableSearchQuery));
      if (matches.length > 0) map.set(t.name, matches);
    });
    return map;
  }, [tableItems, tableSearchQuery]);
  const sortedTableItems = useMemo(
    () =>
      sortByState(
        tableItems.filter(
          (t) =>
            inConfidenceRange(t.confidence) &&
            (!tableSearchQuery ||
              t.name.toLowerCase().includes(tableSearchQuery) ||
              matchedColumnsByTable.has(t.name)),
        ),
        tableSort,
        (t) => t.name,
        (t) => t.confidence,
      ),
    [tableItems, tableSort, tableSearchQuery, inConfidenceRange, matchedColumnsByTable],
  );

  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // The Select/Pan tool switch in the canvas controls bar below — "pan" (the default, matching
  // this canvas's original always-drag-to-pan behavior) lets a background drag move the view;
  // "select" turns that off, so a background drag no longer pans.
  const [tool, setTool] = useState<CanvasTool>("pan");
  useCanvasToolShortcuts(tool, setTool);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCanvasPointerDown?.();
    if (tool !== "pan") return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPan(() => ({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const zoomBy = (factor: number) => setZoom((z) => clamp(z * factor, MIN_Z, MAX_Z));

  // Dragging a toolbox item: a plain click still navigates (see the pointerup handling below) —
  // it only becomes a "drop onto the canvas" placement once the pointer has actually moved past
  // a small threshold, so a normal click never accidentally places a duplicate.
  const canvasRef = useRef<HTMLDivElement>(null);
  // The pan/zoom transform wrapper around `children` — measured once on mount (at the initial
  // zoom of 1, before this effect adjusts it) to fit the graph into the space actually visible
  // between the two floating side panels, rather than the canvas's full (wider) box.
  const contentRef = useRef<HTMLDivElement>(null);
  // Shared by the mount-only auto-fit below and the canvas controls' own "Fit to content" button
  // — `contentEl`'s measured rect already reflects whatever `zoom` currently is (the transform
  // scales it), so this always divides that back out first to recover the natural, zoom=1 size
  // before computing a new fit — correct whether called at mount (zoom is still 1, a no-op
  // division) or later, on demand, from any zoom level the user has since panned/zoomed to.
  const fitToContent = useCallback(() => {
    const canvasEl = canvasRef.current;
    const contentEl = contentRef.current;
    if (!canvasEl || !contentEl) return;
    const rect = contentEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const naturalW = rect.width / zoom;
    const naturalH = rect.height / zoom;
    const canvasRect = canvasEl.getBoundingClientRect();
    const sideMargin = 32;
    const leftReserved = (entityPanelOpen ? entityPanelWidth : PANEL_COLLAPSED_W) + sideMargin;
    const rightReserved = (tablePanelOpen ? tablePanelWidth : PANEL_COLLAPSED_W) + sideMargin;
    const topReserved = 32;
    const bottomReserved = 96;
    const availW = canvasRect.width - leftReserved - rightReserved;
    const availH = canvasRect.height - topReserved - bottomReserved;
    if (availW <= 0 || availH <= 0) return;
    const fitZoom = clamp(Math.min(availW / naturalW, availH / naturalH, 1), MIN_Z, MAX_Z);
    setZoom(() => fitZoom);
    setPan(() => ({ x: 0, y: 0 }));
  }, [entityPanelOpen, tablePanelOpen, entityPanelWidth, tablePanelWidth, zoom, setZoom, setPan]);
  useLayoutEffect(() => {
    fitToContent();
    // Mount-only: re-fitting every time a panel toggles or content changes would fight the
    // user's own pan/zoom while they're actively working the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tbDrag, setTbDrag] = useState<{
    kind: "entity" | "table";
    id: string;
    label: string;
  } | null>(null);
  const [tbDragPos, setTbDragPos] = useState<{ x: number; y: number } | null>(null);
  const [overCanvas, setOverCanvas] = useState(false);
  const tbDragInfo = useRef<{
    kind: "entity" | "table";
    id: string;
    label: string;
    sx: number;
    sy: number;
    moved: boolean;
  } | null>(null);

  // Latest callbacks in refs so the single mount-time window listener below always calls the
  // current version without needing to resubscribe on every render.
  const callbacksRef = useRef({
    onFocusEntity,
    onDropEntity,
    onFocusTable,
    onDropTable,
    onDragMove,
    onDragEnd,
  });
  callbacksRef.current = {
    onFocusEntity,
    onDropEntity,
    onFocusTable,
    onDropTable,
    onDragMove,
    onDragEnd,
  };

  const startToolboxDrag = (
    kind: "entity" | "table",
    id: string,
    label: string,
    x: number,
    y: number,
  ) => {
    tbDragInfo.current = { kind, id, label, sx: x, sy: y, moved: false };
  };

  useEffect(() => {
    const isOverCanvas = (x: number, y: number) => {
      const r = canvasRef.current?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const onMove = (e: PointerEvent) => {
      const info = tbDragInfo.current;
      if (!info) return;
      if (!info.moved && Math.hypot(e.clientX - info.sx, e.clientY - info.sy) > 6) {
        info.moved = true;
        setTbDrag({ kind: info.kind, id: info.id, label: info.label });
      }
      if (info.moved) {
        setTbDragPos({ x: e.clientX, y: e.clientY });
        setOverCanvas(isOverCanvas(e.clientX, e.clientY));
        callbacksRef.current.onDragMove?.(info.kind, info.id, e.clientX, e.clientY);
      }
    };
    const onUp = (e: PointerEvent) => {
      const info = tbDragInfo.current;
      tbDragInfo.current = null;
      setTbDrag(null);
      setTbDragPos(null);
      setOverCanvas(false);
      if (!info) return;
      const cb = callbacksRef.current;
      if (info.moved) {
        if (isOverCanvas(e.clientX, e.clientY)) {
          if (info.kind === "entity") cb.onDropEntity(info.id, e.clientX, e.clientY);
          else cb.onDropTable(info.id, e.clientX, e.clientY);
        }
        cb.onDragEnd?.();
      } else if (info.kind === "entity") {
        cb.onFocusEntity(info.id);
      } else {
        cb.onFocusTable(info.id);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* The whole work area below the header is one continuous canvas — dot background runs
          edge to edge, underneath the floating panels/controls below, which are absolute
          overlays layered on top rather than flex siblings, so they never take up or shrink the
          canvas's own box (collapsing/expanding one never moves a single node's coordinates). */}
      <div
        ref={canvasRef}
        className={cn(
          "relative min-h-0 flex-1 select-none overflow-hidden canvas-grid",
          tbDrag && overCanvas && "ring-2 ring-inset ring-primary/30",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          ref={contentRef}
          className="absolute left-1/2 top-1/2 origin-center"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {children}
        </div>

        {/* LEFT — Entity types toolbox: jump the whole Detail view onto a different entity.
            Collapsible: collapsing only hides this navigation rail — it never touches canvas
            content, selection, or the ontology itself. A floating overlay, not a layout
            participant — its own pointerdown never reaches the canvas's pan handler. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ width: entityPanelOpen ? entityPanelWidth : PANEL_COLLAPSED_W }}
          className={cn(
            "absolute left-4 top-4 z-20 flex h-[calc(100%-32px)] flex-col overflow-hidden rounded-2xl border border-node-border bg-node shadow-[var(--shadow-node)] transition-[width]",
          )}
        >
          {entityPanelOpen && (
            <div
              onPointerDown={startPanelResize("entity")}
              title="Drag to resize"
              aria-hidden="true"
              className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize"
            />
          )}
          <div className="flex shrink-0 items-center justify-between border-b border-node-border px-4 py-3">
            {entityPanelOpen && (
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                Entity types
              </span>
            )}
            <div className={cn("flex shrink-0 items-center gap-1", !entityPanelOpen && "ml-auto")}>
              {entityPanelOpen && <CreateEntityButton onCreate={onCreateEntity} />}
              <button
                type="button"
                onClick={() => setEntityPanelOpen((v) => !v)}
                aria-label={
                  entityPanelOpen ? "Collapse Entity types panel" : "Expand Entity types panel"
                }
                title={entityPanelOpen ? "Collapse" : "Expand"}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              >
                {entityPanelOpen ? (
                  <ChevronLeft className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </button>
            </div>
          </div>
          {!entityPanelOpen && (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-[11px] font-medium text-muted-foreground [writing-mode:vertical-rl]">
                Entity types
              </span>
            </div>
          )}
          {entityPanelOpen && (
            <div className="flex shrink-0 flex-col gap-1.5 border-b border-node-border px-3 py-1.5">
              <div className="flex items-center justify-between">
                <SortDropdown
                  sort={entitySort}
                  onChange={(k) => setEntitySort((s) => nextSortState(s, k))}
                />
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={toggleEntitySearch}
                  aria-pressed={entitySearchOpen}
                  aria-label={entitySearchOpen ? "Close search" : "Search entity types"}
                  title={entitySearchOpen ? "Close search" : "Search"}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                    entitySearchOpen
                      ? "bg-black/[0.08] text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {entitySearchOpen ? <X className="size-3.5" /> : <Search className="size-3.5" />}
                </button>
              </div>
              {entitySearchOpen && (
                <SearchInput
                  value={entitySearch}
                  onChange={setEntitySearch}
                  placeholder="Search entity types..."
                />
              )}
            </div>
          )}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3",
              !entityPanelOpen && "hidden",
            )}
          >
            {sortedEntityItems.map((e) => {
              const matchedProperties = matchedPropertiesByEntity.get(e.id);
              const tableCount = tablesUsedByEntity(e).length;
              return (
                <div key={e.id} className="flex flex-col gap-1">
                  <button
                    onPointerDown={(ev) => {
                      if (ev.button !== 0) return;
                      startToolboxDrag("entity", e.id, e.name, ev.clientX, ev.clientY);
                    }}
                    // Mouse clicks are handled by the pointerdown/pointerup drag-vs-click logic
                    // above; a keyboard-activated click (Enter/Space on a focused button) never
                    // goes through pointerdown at all and has event.detail === 0, so this only
                    // ever fires for that.
                    onClick={(ev) => {
                      if (ev.detail === 0) onFocusEntity(e.id);
                    }}
                    title={`Click to open ${e.name}, or drag onto the canvas to place it here`}
                    className={cn(
                      "flex w-full shrink-0 items-center gap-2 rounded-[10px] border bg-white px-3 py-2 font-normal text-left hover:bg-accent",
                      contextItem?.kind === "entity" && contextItem.entity.id === e.id
                        ? "border-[#61B2FF]"
                        : "border-black/[0.08]",
                      tbDrag?.kind === "entity" && tbDrag.id === e.id && "opacity-30",
                    )}
                  >
                    <StatusBadge
                      status={entityStatus(e)}
                      confidence={e.confidence}
                      warningReason={e.warningReason}
                      errorReason={entityErrorReason(e)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                      <span className="block w-full truncate text-[12px] font-medium leading-[16.5px] text-[#171B22]">
                        {e.name}
                      </span>
                      <span className="block w-full truncate text-[10px] font-normal leading-[10px] text-[#909090]">
                        {e.properties.length} props · {tableCount} table
                        {tableCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <ConfidenceChip confidence={e.confidence} />
                    <DraggableHandle
                      title="Drag onto the canvas to place here"
                      aria-label={`Drag ${e.name} onto the canvas`}
                    />
                  </button>
                  {/* A Property-name match keeps its parent Entity Type visible even when the
                      Entity Type's own name doesn't match — this lists exactly which Property
                      matched, never the rest of that entity's (unmatched) properties. A search
                      result is still a PANEL click, so it navigates too — into this Entity Type,
                      with the matched Property already focused. */}
                  {matchedProperties && (
                    <ul className="flex flex-col gap-0.5 pl-9">
                      {matchedProperties.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onPointerDown={(ev) => ev.stopPropagation()}
                            onClick={() => onFocusEntity(e.id, p.id)}
                            title={`Click to open ${e.name} with ${p.name} focused`}
                            className="w-full truncate rounded-md px-1 text-left text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            {p.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* BOTTOM — canvas controls, and above them (when open) the contextual info panel —
            stacked together, centered, fixed to the canvas's own bottom edge regardless of pan,
            zoom, or side-panel state. A floating overlay, same as the side panels above. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-x-8 bottom-4 z-30 flex flex-col items-center gap-3"
        >
          {contextItem && (
            <div className="flex max-h-[50vh] w-full max-w-[864px] items-start overflow-hidden rounded-[18px] border border-[#DDE0E3] bg-white p-4 shadow-[0_2px_4px_0_rgba(17,22,31,0.06)]">
              <div
                key={contextItemKey(contextItem)}
                className="flex min-w-0 flex-1 shrink-0 flex-col items-start gap-1 self-stretch overflow-y-auto break-words pr-4 [&>p]:w-full"
              >
                <ContextPanelBody
                  item={contextItem}
                  onSwapRelation={onSwapRelation}
                  onRenameRelation={onRenameRelation}
                  onEditRelationDescription={onEditRelationDescription}
                  onRenameEntity={onRenameEntity}
                  onEditEntityDescription={onEditEntityDescription}
                  onRenameProperty={onRenameProperty}
                  onEditPropertyDescription={onEditPropertyDescription}
                  onDeleteEntity={onDeleteEntity}
                  onDeleteProperty={onDeleteProperty}
                  onDeleteRelation={onDeleteRelation}
                />
              </div>
              <button
                type="button"
                onClick={onCloseContext}
                aria-label="Close"
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-[#70757C] hover:bg-accent"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path
                    d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
                    stroke="currentColor"
                    strokeWidth="1.16667"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          )}
          <CanvasControls
            tool={tool}
            onToolChange={setTool}
            zoomPercent={Math.round(zoom * 100)}
            onZoomOut={() => zoomBy(1 / 1.2)}
            onZoomIn={() => zoomBy(1.2)}
            onFitToContent={fitToContent}
            onUndo={onUndo}
            onRedo={onRedo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        </div>

        {/* RIGHT — Data Tables toolbox: jump the whole Detail view onto a different table.
            Collapsible independently of the left panel. A floating overlay, not a layout
            participant. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ width: tablePanelOpen ? tablePanelWidth : PANEL_COLLAPSED_W }}
          className={cn(
            "absolute right-4 top-4 z-20 flex h-[calc(100%-32px)] flex-col overflow-hidden rounded-2xl border border-node-border bg-node shadow-[var(--shadow-node)] transition-[width]",
          )}
        >
          {tablePanelOpen && (
            <div
              onPointerDown={startPanelResize("table")}
              title="Drag to resize"
              aria-hidden="true"
              className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize"
            />
          )}
          <div className="flex shrink-0 items-center justify-between border-b border-node-border px-4 py-3">
            <button
              type="button"
              onClick={() => setTablePanelOpen((v) => !v)}
              aria-label={
                tablePanelOpen ? "Collapse Data Tables panel" : "Expand Data Tables panel"
              }
              title={tablePanelOpen ? "Collapse" : "Expand"}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              {tablePanelOpen ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </button>
            {tablePanelOpen && (
              <span className="truncate text-[14px] font-semibold">Data Tables</span>
            )}
          </div>
          {!tablePanelOpen && (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-[11px] font-medium text-muted-foreground [writing-mode:vertical-rl]">
                Data Tables
              </span>
            </div>
          )}
          {tablePanelOpen && (
            <div className="flex shrink-0 flex-col gap-1.5 border-b border-node-border px-3 py-1.5">
              <div className="flex items-center justify-between">
                <SortDropdown
                  sort={tableSort}
                  onChange={(k) => setTableSort((s) => nextSortState(s, k))}
                />
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={toggleTableSearch}
                  aria-pressed={tableSearchOpen}
                  aria-label={tableSearchOpen ? "Close search" : "Search data tables"}
                  title={tableSearchOpen ? "Close search" : "Search"}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                    tableSearchOpen
                      ? "bg-black/[0.08] text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {tableSearchOpen ? <X className="size-3.5" /> : <Search className="size-3.5" />}
                </button>
              </div>
              {tableSearchOpen && (
                <SearchInput
                  value={tableSearch}
                  onChange={setTableSearch}
                  placeholder="Search data tables..."
                />
              )}
            </div>
          )}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3",
              !tablePanelOpen && "hidden",
            )}
          >
            {sortedTableItems.map((t) => {
              const matchedColumns = matchedColumnsByTable.get(t.name);
              const entityCount = entitiesUsingTable(t.name, entities).length;
              return (
                <div key={t.name} className="flex flex-col gap-1">
                  <button
                    onPointerDown={(ev) => {
                      if (ev.button !== 0) return;
                      startToolboxDrag("table", t.name, t.name, ev.clientX, ev.clientY);
                    }}
                    onClick={(ev) => {
                      if (ev.detail === 0) onFocusTable(t.name);
                    }}
                    title={`Click to open ${t.name}, or drag onto the canvas to place it here`}
                    className={cn(
                      "flex w-full shrink-0 items-center gap-2 rounded-[10px] border bg-white px-3 py-2 font-normal text-left hover:bg-accent",
                      contextItem?.kind === "table" && contextItem.table.name === t.name
                        ? "border-[#61B2FF]"
                        : "border-black/[0.08]",
                      tbDrag?.kind === "table" && tbDrag.id === t.name && "opacity-30",
                    )}
                  >
                    <MappingStatusBadge status={tableMappingStatus(t.name, entities)} size={20} />
                    <span className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                      <span className="block w-full truncate text-[12px] font-medium leading-[16.5px] text-[#171B22]">
                        {t.name}
                      </span>
                      <span className="block w-full truncate text-[10px] font-normal leading-[10px] text-[#909090]">
                        {t.columns.length} columns · {entityCount} entit
                        {entityCount === 1 ? "y" : "ies"}
                      </span>
                    </span>
                    <ConfidenceChip confidence={t.confidence} />
                    <DraggableHandle
                      title="Drag onto the canvas to place here"
                      aria-label={`Drag ${t.name} onto the canvas`}
                    />
                  </button>
                  {/* A Column-name match keeps its parent Table visible even when the Table's own
                      name doesn't match — this lists exactly which Column matched, never the
                      rest of that table's (unmatched) columns. A search result is still a PANEL
                      click, so it navigates too — into this Table, with the matched Column
                      already focused. */}
                  {matchedColumns && (
                    <ul className="flex flex-col gap-0.5 pl-9">
                      {matchedColumns.map((c) => (
                        <li key={c.name}>
                          <button
                            type="button"
                            onPointerDown={(ev) => ev.stopPropagation()}
                            onClick={() => onFocusTable(t.name, c.name)}
                            title={`Click to open ${t.name} with ${c.name} focused`}
                            className="w-full truncate rounded-md px-1 text-left text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            {c.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ghost preview following the cursor while dragging a toolbox item toward the canvas */}
      {tbDrag && tbDragPos && (
        <div
          style={{ left: tbDragPos.x, top: tbDragPos.y }}
          className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-node-border bg-node px-3 py-1.5 text-[12px] font-medium text-foreground opacity-90 shadow-[var(--shadow-node-lift)]"
        >
          {tbDrag.kind === "table" && <Table2 className="size-3.5 shrink-0" strokeWidth={2} />}
          {tbDrag.label}
        </div>
      )}
    </div>
  );
}

export function DetailView({
  app,
  anchor,
}: {
  app: OntologyApp;
  anchor: NonNullable<DetailAnchor>;
}) {
  const { entities, tables, openDetail } = app;
  const onFocusEntity = useCallback(
    (id: string, focusPropertyId?: string) => openDetail("entity", id, focusPropertyId),
    [openDetail],
  );
  const onFocusTable = useCallback(
    (name: string, focusColumnName?: string) => openDetail("table", name, focusColumnName),
    [openDetail],
  );

  if (anchor.kind === "entity") {
    const entity = entities.find((e) => e.id === anchor.id);
    if (!entity) return null;
    return (
      <EntityDetailCanvas
        key={`entity:${entity.id}`}
        app={app}
        entity={entity}
        onFocusEntity={onFocusEntity}
        onFocusTable={onFocusTable}
        entityItems={entities}
        tableItems={tables}
        initialFocusPropertyId={anchor.focusPropertyId}
      />
    );
  }

  // A Table entry is NOT a different Detail mode — it's the exact same canvas as an Entity entry,
  // just seeded with a different initial visible set: every Entity Type mapped into this table
  // becomes its own main row (one of them stands in as `entity`, the row this canvas happens to
  // be keyed/centered on; every other main row already renders identically regardless of how it
  // got there — see `initialExtraMainEntityIds`'s own comment on EntityDetailCanvas). From here
  // on, the canvas has no notion of "table mode" at all — Merge, Split, multi-select, mapping,
  // Relation creation, and delete all operate on `mainEntities` the same way no matter which of
  // its rows came from the entry point versus a later manual drag.
  const table = tableByName(anchor.id);
  if (!table) return null;
  const mappedEntities = entitiesUsingTable(table.name, entities);
  const [anchorEntity, ...otherMappedEntities] = mappedEntities;
  if (!anchorEntity) return null;
  return (
    <EntityDetailCanvas
      key={`table:${table.name}`}
      app={app}
      entity={anchorEntity}
      onFocusEntity={onFocusEntity}
      onFocusTable={onFocusTable}
      entityItems={entities}
      tableItems={tables}
      initialExtraMainEntityIds={otherMappedEntities.map((e) => e.id)}
      initialVisibleTableNames={[table.name]}
      initialFocusColumn={
        anchor.focusColumnName ? { table: table.name, column: anchor.focusColumnName } : undefined
      }
    />
  );
}

/** Entity-focused Detail: the anchor Entity Type on top, its directly related entities beside it
 * (subtle — click to re-focus Detail onto one of them), and the central Properties <-> Columns
 * mapping below, columns grouped by the source table they belong to. */
function EntityDetailCanvas({
  app,
  entity,
  onFocusEntity,
  onFocusTable,
  entityItems,
  tableItems,
  initialFocusPropertyId,
  initialFocusColumn,
  initialExtraMainEntityIds,
  initialVisibleTableNames,
}: {
  app: OntologyApp;
  entity: Entity;
  onFocusEntity: (id: string, focusPropertyId?: string) => void;
  onFocusTable: (name: string, focusColumnName?: string) => void;
  entityItems: Entity[];
  tableItems: TableSchema[];
  /** Arrive with this Property (owned by `entity`) already selected in the bottom contextual
   * panel — set only by Overview's ontology search when the user picks a Property result. Read
   * once, on mount, never re-applied if it changes later (this whole component remounts fresh —
   * see DetailView's own remount key — whenever the entry point itself changes anyway). */
  initialFocusPropertyId?: string | undefined;
  /** Arrive with this Column already selected in the bottom contextual panel instead — set only
   * when the entry point was a Data Table (a Table-entry's own `focusColumnName`, or Overview's
   * data search picking a Column result). Mutually exclusive with `initialFocusPropertyId` in
   * practice (an entry has exactly one of the two), but both are accepted independently since
   * they seed the same `contextItem` state the same read-once way. */
  initialFocusColumn?: { table: string; column: string } | undefined;
  /** Seeds `extraMainEntityIds` — see its own comment below — with more than just an empty start.
   * Entering via a Data Table picks one of the entities mapped to it as `entity` (the row that
   * anchors this canvas) and passes every OTHER entity mapped to that same table in here, so they
   * show up as their own full main rows — complete with their own related-entity satellites —
   * exactly as if the user had dragged each of them in by hand from the Entity Types toolbox.
   * Nothing downstream of this list (Merge, Split, multi-select, mapping, Relation creation,
   * delete, etc.) knows or cares how a main row's id got into this list. */
  initialExtraMainEntityIds?: string[] | undefined;
  /** Restricts which tables the Columns area ever shows to just this set — set only for a Table
   * entry, to just that one entry table. A Table entry's own job is to gather "everyone connected
   * to THIS table", not to also fan out into every OTHER table any of those entities separately
   * happen to map into (an Entity entry's own "1 Entity <-> N Tables" fan is a different, and
   * still fully preserved, thing — see the plain `columnGroups`/`extraColumnGroups` behavior for
   * an entity opened directly). Left `undefined` for an Entity entry, which shows every table any
   * visible entity maps into, same as always. A table added afterward by hand (drag from the
   * toolbox) is never restricted by this — see `visibleTableNames` below. */
  initialVisibleTableNames?: string[] | undefined;
}) {
  const {
    relations,
    entities,
    updateEntity,
    updateProperty,
    updateMapping,
    updateRelation,
    createEntity,
    createProperty,
    moveProperties,
    splitEntity,
    mergeEntities,
    addRelation,
    createPlaceholderRelation,
    renameRelation,
    deleteEntity,
    deleteProperty,
    deleteRelation,
    deleteEntities,
    deleteProperties,
    deleteRelations,
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    confidenceRange,
  } = app;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const related = useMemo(
    () =>
      relations
        .filter((r) => r.from === entity.id || r.to === entity.id)
        .map((r) => entities.find((e) => e.id === (r.from === entity.id ? r.to : r.from)))
        .filter((e): e is Entity => !!e),
    [relations, entities, entity.id],
  );

  /** The one real Relation connecting this anchor to a given related entity — used to give the
   * relation a small clickable badge on its line (Detail otherwise renders relations as bare
   * lines with nothing to click). Entities dragged in as "extra" satellites have no entry here,
   * since they don't have a real relation to the anchor. */
  const relationForEntityId = useMemo(() => {
    const map = new Map<string, Relation>();
    relations.forEach((r) => {
      if (r.from === entity.id) map.set(r.to, r);
      else if (r.to === entity.id) map.set(r.from, r);
    });
    return map;
  }, [relations, entity.id]);

  // Entity Types dragged in from the left toolbox — placed as extra satellites alongside the
  // real related entities, purely so they're visible here; dragging one in doesn't fabricate a
  // relationship (that's an Edit-step action, not implemented yet).
  const [extraEntityIds, setExtraEntityIds] = useState<string[]>([]);
  const relatedIds = useMemo(() => new Set(related.map((e) => e.id)), [related]);
  // Explicit display order for the whole related-entities column (real relations + extras) once
  // a drop has actually positioned one — until then, satellites keep their natural order (real
  // relations first, extras after) so a drop can land anywhere among them, not just after every
  // real one.
  const [relatedOrder, setRelatedOrder] = useState<string[]>([]);
  const allRelated = useMemo(() => {
    const extra = extraEntityIds
      .filter((id) => id !== entity.id && !relatedIds.has(id))
      .map((id) => entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e);
    const combined = [...related, ...extra];
    if (relatedOrder.length > 0) {
      const orderIndex = new Map(relatedOrder.map((id, i) => [id, i]));
      combined.sort(
        (a, b) =>
          (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return combined;
  }, [related, extraEntityIds, relatedIds, entity.id, entities, relatedOrder]);

  // How wide a gap to leave between the satellites column and the Properties card, so every
  // relation label fits between them without touching either — measured from the actual relation
  // names (via canvas text metrics, not a post-render DOM measurement) so it's already correct on
  // the very first paint, before DetailShell's own fit-to-content effect runs and measures this
  // area's total size.
  const relationGapPx = useMemo(() => {
    let maxLabelWidth = 0;
    allRelated.forEach((other) => {
      const relation = relationForEntityId.get(other.id);
      if (!relation) return;
      const textWidth = measureTextWidth(relation.name, RELATION_LABEL_FONT);
      maxLabelWidth = Math.max(maxLabelWidth, textWidth + RELATION_LABEL_CHROME);
    });
    return maxLabelWidth > 0 ? Math.ceil(maxLabelWidth) + 32 : 80;
  }, [allRelated, relationForEntityId]);

  // Source Tables dragged in from the right toolbox — placed as an extra column group, all of
  // whose columns start unmapped (no property points to them yet, so no connector is drawn).
  const [extraTableNames, setExtraTableNames] = useState<string[]>([]);
  // A Table entry's own restriction on which tables ever show — see `initialVisibleTableNames`'s
  // own comment. `null` (an Entity entry) means no restriction at all: every table any visible
  // entity maps into shows, same as this canvas has always behaved. Never revisited after mount —
  // manually dragging a table in (`extraTableNames` above) is a separate, always-allowed path, so
  // this only ever narrows the automatic reveal, never anything the user does by hand afterward.
  const [visibleTableNames] = useState<Set<string> | null>(() =>
    initialVisibleTableNames ? new Set(initialVisibleTableNames) : null,
  );
  const tableIsVisible = useCallback(
    (t: string) =>
      visibleTableNames === null || visibleTableNames.has(t) || extraTableNames.includes(t),
    [visibleTableNames, extraTableNames],
  );
  // Explicit display order for the Columns area (natural + extra table groups) once a drop has
  // actually positioned one — until then, groups keep their natural order (see columnGroups).
  const [tableOrder, setTableOrder] = useState<string[]>([]);
  // Entity Types shown as a full main row (name + properties) alongside the anchor's own, not a
  // satellite pill — either dropped directly onto the center card column by hand, or, for a Table
  // entry, every OTHER entity mapped to that entry table (see `initialExtraMainEntityIds`).
  // Never fabricates a relationship: if one already exists between the anchor and this entity,
  // whatever connector that produces elsewhere (e.g. its own related-satellite pill, if it's also
  // a real relation) is unaffected — this is purely an additional, independent card.
  const [extraMainEntityIds, setExtraMainEntityIds] = useState<string[]>(
    () => initialExtraMainEntityIds ?? [],
  );
  // Every main row currently shown — the anchor plus whatever's been dropped into (or seeded
  // into, for a Table entry — see DetailView's own comment on `initialExtraMainEntityIds`) the
  // center column. Computed early since the Columns area below needs the FULL list to decide
  // which table each entity's mappings belong to, not just the anchor's own.
  const mainEntities = useMemo(() => {
    const extras = extraMainEntityIds
      .map((id) => entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e && e.id !== entity.id);
    return [entity, ...extras];
  }, [entity, extraMainEntityIds, entities]);

  // Which tables are already shown SOMEWHERE right now — deliberately not "which tables any main
  // entity's properties map to" (a table hidden by `visibleTableNames`, e.g. a Table entry's own
  // scoping — see its comment — still counts as "not used" here, so dragging it in from the
  // toolbox by hand always works, exactly like it would for a table nobody maps into at all).
  const usedTableNames = useMemo(
    () =>
      new Set(
        mainEntities
          .flatMap((m) => m.properties.filter((p) => p.mapping).map((p) => p.mapping!.table))
          .filter(tableIsVisible),
      ),
    [mainEntities, tableIsVisible],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const propsCardRef = useRef<HTMLDivElement>(null);
  const relatedRefs = useRef<Map<string, HTMLElement>>(new Map());
  const propertyRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Drop zones for the two toolbox drags above: the related-entities column (pill satellites,
  // left of the Properties card), the center Entity-card column (the anchor's card, plus — since
  // each extra Entity dropped in gets its own full row below the anchor's, mirroring 8082's
  // MainCluster — every extra row's own card too), and the whole Columns area (right of the
  // anchor's own row). A drag only ever lands if it's released inside its own zone (Entity types
  // can land in either of the first two; Tables only in the third) — dropped elsewhere, it's
  // simply cancelled.
  const relatedColumnRef = useRef<HTMLDivElement>(null);
  // Spans the anchor's row AND every extra row stacked below it, so "is this drop inside the
  // center card column" (checked against `propsCardRef`'s own X range, shared by every row's
  // card) means "anywhere down the whole stack of rows", not just the anchor's own row.
  const mainStackRef = useRef<HTMLDivElement>(null);
  const mainCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const columnsAreaRef = useRef<HTMLDivElement>(null);
  const columnGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Collapsing a main entity's row (the anchor's own, or an extra's) hides everything about that
  // row except its card's own header — its related satellites, the relation lines to them, its
  // properties, its own mapped columns, and the property<->column lines between them all simply
  // go unrendered, rather than tracking a second "hidden" layout state; computeLines already
  // no-ops for any ref that doesn't exist, so the lines disappear for free.
  const [collapsedMainIds, setCollapsedMainIds] = useState<Set<string>>(new Set());
  const toggleMainCollapsed = useCallback((id: string) => {
    setCollapsedMainIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Properties list display order/filter, per main entity (the anchor's own card, or an extra
  // row's) — same per-entity-Record pattern as collapse and multi-select above, and just as much
  // a pure display concern: it reorders/hides which property *rows render*, never touches the
  // property data itself or any canvas position.
  const [propertySortByEntity, setPropertySortByEntity] = useState<Record<string, SortState>>({});
  const [onlyIdentifierByEntity, setOnlyIdentifierByEntity] = useState<Record<string, boolean>>({});
  const propertySortFor = useCallback(
    (entityId: string) => propertySortByEntity[entityId] ?? DEFAULT_SORT,
    [propertySortByEntity],
  );
  const setPropertySortFor = useCallback((entityId: string, key: SortKey) => {
    setPropertySortByEntity((prev) => ({
      ...prev,
      [entityId]: nextSortState(prev[entityId] ?? DEFAULT_SORT, key),
    }));
  }, []);
  const toggleOnlyIdentifier = useCallback((entityId: string) => {
    setOnlyIdentifierByEntity((prev) => ({ ...prev, [entityId]: !prev[entityId] }));
  }, []);
  const visibleProperties = useCallback(
    (entityId: string, properties: Property[]) => {
      const filtered = onlyIdentifierByEntity[entityId]
        ? properties.filter((p) => isIdentifierProperty(p.name))
        : properties;
      return sortByState(
        filtered,
        propertySortFor(entityId),
        (p) => p.name,
        (p) => p.confidence,
      );
    },
    [onlyIdentifierByEntity, propertySortFor],
  );

  // Columns list display order, per source table shown here (the anchor's own primary table, an
  // extra main entity's own, or one dropped in directly) — same pure-display, per-key-Record
  // pattern as the Properties sort above, kept separate since a Columns area can show several
  // tables' worth of columns at once and each table's own list sorts independently.
  const [columnSortByTable, setColumnSortByTable] = useState<Record<string, SortState>>({});
  const columnSortFor = useCallback(
    (table: string) => columnSortByTable[table] ?? DEFAULT_SORT,
    [columnSortByTable],
  );
  const setColumnSortForTable = useCallback((table: string, key: SortKey) => {
    setColumnSortByTable((prev) => ({
      ...prev,
      [table]: nextSortState(prev[table] ?? DEFAULT_SORT, key),
    }));
  }, []);
  const visibleColumns = useCallback(
    <C extends { column: string; confidence?: number | undefined }>(table: string, cols: C[]) =>
      sortByState(
        cols,
        columnSortFor(table),
        (c) => c.column,
        (c) => c.confidence,
      ),
    [columnSortFor],
  );

  // A Table row's own collapse, independent of an Entity row's: collapsing a Table only hides
  // that one table's own column list (and, since its columns simply stop rendering, the
  // Property<->Column lines pointing at them disappear for free the same way an Entity row's own
  // collapse already does) — it never cascades to any connected Entity, unlike collapsing an
  // Entity row itself.
  const [collapsedTables, setCollapsedTables] = useState<Set<string>>(new Set());
  const toggleTableCollapsed = useCallback((table: string) => {
    setCollapsedTables((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  }, []);

  const [toolboxDragPos, setToolboxDragPos] = useState<{
    kind: "entity" | "table";
    x: number;
    y: number;
  } | null>(null);

  const onToolboxDragMove = useCallback(
    (kind: "entity" | "table", _id: string, clientX: number, clientY: number) =>
      setToolboxDragPos({ kind, x: clientX, y: clientY }),
    [],
  );
  const onToolboxDragEnd = useCallback(() => setToolboxDragPos(null), []);

  const inRect = (r: DOMRect | undefined, x: number, y: number) =>
    !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  // "Is (x,y) inside the center card column" — every row's card shares the same X position/width
  // as the anchor's own (`propsCardRef`), so that rect's X range combined with the full vertical
  // extent of the row stack (`mainStackRef`) covers a drop anywhere down the whole stack, not just
  // within the anchor's own row.
  const inCenterColumnBand = (x: number, y: number) => {
    const cardRect = propsCardRef.current?.getBoundingClientRect();
    const stackRect = mainStackRef.current?.getBoundingClientRect();
    if (!cardRect || !stackRect) return false;
    return x >= cardRect.left && x <= cardRect.right && y >= stackRect.top && y <= stackRect.bottom;
  };

  type ColGroupEntry = {
    column: string;
    type: string;
    confidence?: number | undefined;
    /** Every property, from any currently-shown main entity, that maps into this one column —
     * usually 0 or 1, but genuinely 2+ when more than one entity's property happens to point at
     * the same column (real, if uncommon, data — two different entities both drawing from one
     * column). A table shared by more than one main entity (see `tableOwner` below) can end up
     * with entries owned by DIFFERENT entities inside the SAME group — that's the whole point:
     * the table only renders once, but every entity that actually maps into it still gets its own
     * correctly-attributed connector, and a column with 2+ mappers draws one connector per mapper
     * rather than silently keeping only one. */
    mappedBy: { propertyId: string; ownerEntityId: string }[];
  };

  // Every table any currently-shown main entity maps into, merged across ALL of them — a table
  // used by two or more main entities (Order and Shipment both mapping into `orders`, say) is
  // still just ONE entry here, with contributions from each entity's own properties, rather than
  // one independent copy per entity. `tableOwner` right below decides which single row actually
  // renders each table's card; this is the shared data both that row and every OTHER entity's own
  // connector lines draw from.
  const allColumnGroups = useMemo(() => {
    const byTable = new Map<string, ColGroupEntry[]>();
    // Finds (creating if needed) the one entry for this table.column — never a second, duplicate
    // row for a column that happens to have more than one property mapped into it.
    const entryFor = (table: string, column: string): ColGroupEntry => {
      const list = byTable.get(table) ?? [];
      let entry = list.find((c) => c.column === column);
      if (!entry) {
        const col = tableByName(table)?.columns.find((c) => c.name === column);
        entry = { column, type: col?.type ?? "", confidence: col?.confidence, mappedBy: [] };
        list.push(entry);
        byTable.set(table, list);
      }
      return entry;
    };
    mainEntities.forEach((m) => {
      m.properties.forEach((p) => {
        if (!p.mapping || !tableIsVisible(p.mapping.table)) return;
        entryFor(p.mapping.table, p.mapping.column).mappedBy.push({
          propertyId: p.id,
          ownerEntityId: m.id,
        });
      });
    });
    // Show every column of each main entity's own primary table (not just whichever ones already
    // have a property pointing at them) so an unmapped — or about-to-be-reconnected — property
    // always has somewhere to connect to.
    mainEntities.forEach((m) => {
      if (!tableIsVisible(m.table)) return;
      const primary = tableByName(m.table);
      if (!primary) return;
      primary.columns.forEach((c) => entryFor(m.table, c.name));
    });
    extraTableNames.forEach((t) => {
      if (byTable.has(t)) return;
      const table = tableByName(t);
      table?.columns.forEach((c) => entryFor(t, c.name));
    });
    // Each table's own column list still reads in the table's natural column order, regardless of
    // which entity contributed which entry.
    byTable.forEach((cols, t) => {
      const primary = tableByName(t);
      if (!primary) return;
      cols.sort(
        (a, b) =>
          primary.columns.findIndex((c) => c.name === a.column) -
          primary.columns.findIndex((c) => c.name === b.column),
      );
    });
    return byTable;
  }, [mainEntities, extraTableNames, tableIsVisible]);

  // Which single main row's Columns area actually renders a given table's card — whichever main
  // entity uses it first, anchor before extras in `mainEntities`' own order, so a shared table
  // reads as belonging to the row a person would naturally look at first. A manually-dropped extra
  // table with no natural owner defaults to the anchor's own row.
  const tableOwner = useMemo(() => {
    const map = new Map<string, string>();
    mainEntities.forEach((m) => {
      const uses = new Set(m.properties.filter((p) => p.mapping).map((p) => p.mapping!.table));
      uses.add(m.table);
      uses.forEach((t) => {
        if (!tableIsVisible(t)) return;
        if (!map.has(t)) map.set(t, m.id);
      });
    });
    extraTableNames.forEach((t) => {
      if (!map.has(t)) map.set(t, entity.id);
    });
    return map;
  }, [mainEntities, extraTableNames, entity.id, tableIsVisible]);

  const orderedColumnGroupEntries = useMemo(() => {
    const entries = Array.from(allColumnGroups.entries());
    // Wherever a table drop has actually positioned a group, that position wins — anything not
    // yet touched just keeps its natural spot at the end, since Array#sort is stable.
    if (tableOrder.length > 0) {
      const orderIndex = new Map(tableOrder.map((t, i) => [t, i]));
      entries.sort(
        (a, b) =>
          (orderIndex.get(a[0]) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(b[0]) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return entries;
  }, [allColumnGroups, tableOrder]);

  const columnGroups = useMemo(
    () => orderedColumnGroupEntries.filter(([t]) => tableOwner.get(t) === entity.id),
    [orderedColumnGroupEntries, tableOwner, entity.id],
  );

  /** Read-only display for whatever's dropped into the center column beyond the anchor: real
   * Relations of that entity (never the anchor or another currently-shown main — those already
   * have their own row) as satellite pills, and its own primary table's columns — matching 8082's
   * MainCluster, where every entity shown here (not just the anchor) gets its own full row rather
   * than a bare properties card. No drag-in/split/connect for these rows, same restriction as the
   * card itself already had — this only adds what's already true of the entity's real data. */
  const extraRelatedEntities = useMemo(() => {
    const mainIds = new Set(mainEntities.map((m) => m.id));
    const map = new Map<string, Entity[]>();
    mainEntities.slice(1).forEach((m) => {
      const sats = relations
        .filter((r) => r.from === m.id || r.to === m.id)
        .map((r) => entities.find((e) => e.id === (r.from === m.id ? r.to : r.from)))
        .filter((e): e is Entity => !!e && !mainIds.has(e.id));
      map.set(m.id, sats);
    });
    return map;
  }, [mainEntities, relations, entities]);

  const extraColumnGroups = useMemo(() => {
    const map = new Map<string, [string, ColGroupEntry[]][]>();
    mainEntities.slice(1).forEach((m) => {
      map.set(
        m.id,
        orderedColumnGroupEntries.filter(([t]) => tableOwner.get(t) === m.id),
      );
    });
    return map;
  }, [mainEntities, orderedColumnGroupEntries, tableOwner]);

  const extraRelatedRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Placing an Entity Type in the LEFT satellite column next to the anchor's card is exactly what
  // that column visually means — "related to this" — so it always backs that up with a real
  // Relation, never just a look. Called only for an entity genuinely new to the column (never on a
  // reorder of one already there), this is what creates the unnamed, Error-status placeholder
  // relation for that pair. Placing one in the CENTER column instead (stacking another full main
  // row above/below) carries no such meaning — vertical order there is purely layout, not a
  // relationship — so that drop path never calls this.
  const ensureMainEntityRelation = useCallback(
    (otherId: string) => {
      const hasRelation = relations.some(
        (r) =>
          (r.from === entity.id && r.to === otherId) || (r.from === otherId && r.to === entity.id),
      );
      if (!hasRelation) createPlaceholderRelation(entity.id, otherId);
    },
    [relations, entity.id, createPlaceholderRelation],
  );

  const onDropEntity = useCallback(
    (id: string, clientX: number, clientY: number) => {
      if (id === entity.id) return;
      if (inRect(relatedColumnRef.current?.getBoundingClientRect(), clientX, clientY)) {
        let insertAt = allRelated.length;
        for (let i = 0; i < allRelated.length; i++) {
          const el = relatedRefs.current.get(allRelated[i]!.id);
          if (!el) continue;
          if (clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) {
            insertAt = i;
            break;
          }
        }
        const idsInOrder = allRelated.map((e) => e.id);
        setRelatedOrder(() => {
          const without = idsInOrder.filter((x) => x !== id);
          const clamped = Math.min(insertAt, without.length);
          return [...without.slice(0, clamped), id, ...without.slice(clamped)];
        });
        const isNewToColumn = !relatedIds.has(id);
        if (isNewToColumn) {
          setExtraEntityIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
          ensureMainEntityRelation(id);
        }
        return;
      }
      if (inCenterColumnBand(clientX, clientY)) {
        // The anchor's own card always stays first; only the extras (from index 1 on) are
        // reordered by where among them the drop actually landed.
        let insertAt = mainEntities.length - 1;
        for (let i = 1; i < mainEntities.length; i++) {
          const el = mainCardRefs.current.get(mainEntities[i]!.id);
          if (!el) continue;
          if (clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) {
            insertAt = i - 1;
            break;
          }
        }
        setExtraMainEntityIds((ids) => {
          const without = ids.filter((x) => x !== id);
          const clamped = Math.min(Math.max(0, insertAt), without.length);
          return [...without.slice(0, clamped), id, ...without.slice(clamped)];
        });
      }
    },
    [entity.id, relatedIds, allRelated, mainEntities, ensureMainEntityRelation],
  );

  const onDropTable = useCallback(
    (name: string, clientX: number, clientY: number) => {
      if (!inRect(columnsAreaRef.current?.getBoundingClientRect(), clientX, clientY)) return;
      if (usedTableNames.has(name)) return;
      let insertAt = columnGroups.length;
      for (let i = 0; i < columnGroups.length; i++) {
        const el = columnGroupRefs.current.get(columnGroups[i]![0]);
        if (!el) continue;
        if (clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) {
          insertAt = i;
          break;
        }
      }
      const namesInOrder = columnGroups.map(([t]) => t);
      setExtraTableNames((ts) => (ts.includes(name) ? ts : [...ts, name]));
      setTableOrder(() => {
        const without = namesInOrder.filter((t) => t !== name);
        const clamped = Math.min(insertAt, without.length);
        return [...without.slice(0, clamped), name, ...without.slice(clamped)];
      });
    },
    [usedTableNames, columnGroups],
  );

  // Where the live drag currently sits, for the drop-zone feedback rendered below — null unless
  // the pointer is actually over the zone it would land in.
  const relatedInsertIndex = useMemo(() => {
    if (!toolboxDragPos || toolboxDragPos.kind !== "entity") return null;
    if (
      !inRect(relatedColumnRef.current?.getBoundingClientRect(), toolboxDragPos.x, toolboxDragPos.y)
    )
      return null;
    let idx = allRelated.length;
    for (let i = 0; i < allRelated.length; i++) {
      const el = relatedRefs.current.get(allRelated[i]!.id);
      if (!el) continue;
      if (
        toolboxDragPos.y <
        el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2
      ) {
        idx = i;
        break;
      }
    }
    return idx;
  }, [toolboxDragPos, allRelated]);

  // Same idea as relatedInsertIndex, for the center Entity-card column — an index into
  // mainEntities (index 0, the anchor's own card, is never a valid insertion point).
  const centerInsertIndex = useMemo(() => {
    if (!toolboxDragPos || toolboxDragPos.kind !== "entity") return null;
    if (!inCenterColumnBand(toolboxDragPos.x, toolboxDragPos.y)) return null;
    let idx = mainEntities.length;
    for (let i = 1; i < mainEntities.length; i++) {
      const el = mainCardRefs.current.get(mainEntities[i]!.id);
      if (!el) continue;
      if (
        toolboxDragPos.y <
        el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2
      ) {
        idx = i;
        break;
      }
    }
    return idx;
  }, [toolboxDragPos, mainEntities]);

  // Same idea again, for the Columns area (Tables only).
  const tableInsertIndex = useMemo(() => {
    if (!toolboxDragPos || toolboxDragPos.kind !== "table") return null;
    if (
      !inRect(columnsAreaRef.current?.getBoundingClientRect(), toolboxDragPos.x, toolboxDragPos.y)
    )
      return null;
    let idx = columnGroups.length;
    for (let i = 0; i < columnGroups.length; i++) {
      const el = columnGroupRefs.current.get(columnGroups[i]![0]);
      if (!el) continue;
      if (
        toolboxDragPos.y <
        el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2
      ) {
        idx = i;
        break;
      }
    }
    return idx;
  }, [toolboxDragPos, columnGroups]);

  const [lines, setLines] = useState<Line[]>([]);
  // Which mapping line the pointer is currently over — driven by a wide, invisible "hit" path
  // drawn on top of each thin visible one (see the SVG below), since hovering a 1.4px line
  // precisely isn't realistic. Only lines with a `propertyId` (a real Property<->Column mapping,
  // never the table's own purely-visual anchor-to-column lines) ever set this.
  const [hoveredMappingLineId, setHoveredMappingLineId] = useState<string | null>(null);
  const [relatedLines, setRelatedLines] = useState<Line[]>([]);
  // Same idea as `relatedLines`, but for the satellites of an extra main entity (not the anchor) —
  // kept separate since each entry needs its own relation lookup (`relationId`), rather than the
  // anchor-scoped `relationForEntityId` map `relatedLines`' own renderer already uses.
  const [extraRelatedLines, setExtraRelatedLines] = useState<
    (Line & { relationId: string | null })[]
  >([]);
  // A real Relation connecting the anchor directly to one of the extra main entities stacked
  // below it (e.g. dragging a related satellite into the card column, or dropping an Entity Type
  // from the toolbox that happens to already relate to the anchor) — drawn straight down the
  // column instead of out to the side, since these two cards are stacked vertically rather than
  // sitting in the satellite column.
  const [mainRelatedLines, setMainRelatedLines] = useState<(Line & { relationId: string })[]>([]);

  // --- Node move: drag a satellite, the Properties card, or a Columns card by its header to
  // nudge it anywhere on the canvas — a free-form layout aid, layered on top of the flex flow via
  // a CSS transform rather than replacing it, so nothing else has to reflow. Below the 6px
  // threshold it resolves as a plain click instead (open the contextual panel, focus a satellite,
  // etc.) via `nodeClickActionsRef`, mirroring the click-vs-drag pattern used everywhere else in
  // this app. Offsets are local to this mount, so switching anchors resets them for free. -------
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const nodeDragInfo = useRef<{
    id: string;
    sx: number;
    sy: number;
    baseDx: number;
    baseDy: number;
    moved: boolean;
  } | null>(null);
  const nodeClickActionsRef = useRef<
    Record<string, (mods: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void>
  >({});

  const startNodeDrag = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const base = nodeOffsets[id] ?? { dx: 0, dy: 0 };
      nodeDragInfo.current = {
        id,
        sx: clientX,
        sy: clientY,
        baseDx: base.dx,
        baseDy: base.dy,
        moved: false,
      };
    },
    [nodeOffsets],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const info = nodeDragInfo.current;
      if (!info) return;
      const dx = e.clientX - info.sx;
      const dy = e.clientY - info.sy;
      if (!info.moved && Math.hypot(dx, dy) > 6) info.moved = true;
      if (info.moved) {
        setNodeOffsets((prev) => ({
          ...prev,
          [info.id]: { dx: info.baseDx + dx / zoom, dy: info.baseDy + dy / zoom },
        }));
      }
    };
    const onUp = (e: PointerEvent) => {
      const info = nodeDragInfo.current;
      nodeDragInfo.current = null;
      if (!info) return;
      if (!info.moved) {
        nodeClickActionsRef.current[info.id]?.({
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        });
        return;
      }
      // Dragging a related satellite pill into the center card column promotes it to a full main
      // Entity Type row of its own — the same destination a toolbox item's drag lands in (see
      // `onDropEntity`'s `inCenterColumnBand` branch) — so any already-related entity can be
      // pulled in for a full row too, not just ones dragged from the toolbox. The pill's own nudge
      // offset is cleared on promotion so it snaps back to its normal slot in the satellite column
      // instead of sitting dragged-away next to the new card. Promoting to the CENTER column never
      // creates or requires a Relation on its own (see `ensureMainEntityRelation`'s own comment) —
      // this entity is already a satellite here precisely because a real Relation already backs
      // it, from whichever gesture (drag into the LEFT column, or a genuine seeded Relation) put
      // it in `allRelated` in the first place.
      if (allRelated.some((r) => r.id === info.id) && inCenterColumnBand(e.clientX, e.clientY)) {
        setExtraMainEntityIds((ids) => (ids.includes(info.id) ? ids : [...ids, info.id]));
        setNodeOffsets((prev) => {
          if (!(info.id in prev)) return prev;
          const next = { ...prev };
          delete next[info.id];
          return next;
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [zoom, allRelated]);

  const nodeTransform = (id: string): React.CSSProperties | undefined => {
    const o = nodeOffsets[id];
    return o ? { transform: `translate(${o.dx}px, ${o.dy}px)` } : undefined;
  };

  const computeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    // The container-relative, zoom-corrected Rect for an element — what `edgeAnchorsForRects`
    // (see geometry.ts) needs to adaptively pick which side of TWO boxes face each other, rather
    // than a fixed side baked in per call site the way this canvas used to compute anchors.
    const rectOf = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - cRect.left) / zoom,
        y: (r.top - cRect.top) / zoom,
        width: r.width / zoom,
        height: r.height / zoom,
      };
    };
    const horizontal = (side: Side) => side === "left" || side === "right";

    // One shared table card can carry entries owned by several DIFFERENT main entities (see
    // `allColumnGroups`) — every entry still draws its own connector, from whichever entity's
    // property row actually owns it (via `propertyRefs`, keyed globally by property id) to the
    // ONE rendered column row for its table (via `columnRefs`, keyed globally by `table.column`
    // now that a table never renders more than once).
    const next: Line[] = [];
    orderedColumnGroupEntries.forEach(([table, cols]) => {
      cols.forEach((c) => {
        const colEl = columnRefs.current.get(`${table}.${c.column}`);
        if (!colEl) return;
        // A column with 2+ mappers (see `allColumnGroups`) draws one connector per mapper, each
        // from that specific property's own row — never collapsed down to just one line.
        c.mappedBy.forEach(({ propertyId, ownerEntityId }) => {
          const propEl = propertyRefs.current.get(propertyId);
          if (!propEl) return;
          const { p1, p2, side1 } = edgeAnchorsForRects(rectOf(propEl), rectOf(colEl), 8);
          next.push({
            id: `pc-${propertyId}-${table}.${c.column}`,
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            propertyId,
            ownerEntityId,
            axis: horizontal(side1) ? "horizontal" : "vertical",
          });
        });
      });
    });
    setLines(next);

    // Every Entity<->Entity Relation connector below (satellite<->card, and card<->card) uses the
    // same `edgeAnchorsForRects` adaptive-side utility Overview's own Relation lines use, rather
    // than a fixed side baked in per call site — a satellite or a whole card can be individually
    // dragged anywhere (see `startNodeDrag`/`nodeOffsets`), so which side of each box actually
    // faces the other has to be recomputed from their CURRENT rects every time, exactly like
    // Overview already does for its own Entity nodes.
    const nextRelated: Line[] = [];
    const cardEl = propsCardRef.current;
    if (cardEl) {
      const cardRect = rectOf(cardEl);
      allRelated.forEach((other) => {
        const el = relatedRefs.current.get(other.id);
        if (!el) return;
        // The path is drawn FROM the relation's actual `from` entity TO its `to` entity — never
        // hardcoded satellite-to-card — so the arrowhead (added where this line renders) lands on
        // whichever side the relation data actually points at, even when that's the satellite
        // (the anchor is the "from" side) rather than the card.
        const relation = relationForEntityId.get(other.id);
        const anchorIsTo = !relation || relation.to === entity.id;
        const { p1: satAnchor, p2: cardAnchor } = edgeAnchorsForRects(rectOf(el), cardRect, 8);
        const [p1, p2] = anchorIsTo ? [satAnchor, cardAnchor] : [cardAnchor, satAnchor];
        nextRelated.push({ id: `rel-${other.id}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      });
    }
    setRelatedLines(nextRelated);

    // Same satellite<->card lines, one full set per extra main entity's own row.
    const nextExtraRelated: (Line & { relationId: string | null })[] = [];
    mainEntities.slice(1).forEach((m) => {
      const mCardEl = mainCardRefs.current.get(m.id);
      if (!mCardEl) return;
      const mCardRect = rectOf(mCardEl);
      const satellites = extraRelatedEntities.get(m.id) ?? [];
      satellites.forEach((sat) => {
        const el = extraRelatedRefs.current.get(`${m.id}:${sat.id}`);
        if (!el) return;
        const relation = relations.find(
          (r) => (r.from === m.id && r.to === sat.id) || (r.from === sat.id && r.to === m.id),
        );
        const anchorIsTo = !relation || relation.to === m.id;
        const { p1: satAnchor, p2: cardAnchor } = edgeAnchorsForRects(rectOf(el), mCardRect, 8);
        const [p1, p2] = anchorIsTo ? [satAnchor, cardAnchor] : [cardAnchor, satAnchor];
        nextExtraRelated.push({
          id: `xrel-${m.id}:${sat.id}`,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          relationId: relation?.id ?? null,
        });
      });
    });
    setExtraRelatedLines(nextExtraRelated);

    // Anchor card <-> an extra main entity's own card, whenever a real Relation connects them
    // directly — same arrow-direction logic as the satellite lines above (drawn from the
    // relation's actual `from` to its actual `to`), with the adaptive side letting this reroute
    // to left/right instead of the usual top/bottom once either card has been dragged elsewhere.
    const nextMainRelated: (Line & { relationId: string })[] = [];
    if (cardEl) {
      const cardRect = rectOf(cardEl);
      mainEntities.slice(1).forEach((m) => {
        const mCardEl = mainCardRefs.current.get(m.id);
        if (!mCardEl) return;
        const relation = relations.find(
          (r) => (r.from === entity.id && r.to === m.id) || (r.from === m.id && r.to === entity.id),
        );
        if (!relation) return;
        const { p1: a, p2: b } = edgeAnchorsForRects(cardRect, rectOf(mCardEl), 8);
        const anchorIsTo = relation.to === entity.id;
        const [p1, p2] = anchorIsTo ? [b, a] : [a, b];
        nextMainRelated.push({
          id: `mrel-${m.id}`,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          relationId: relation.id,
        });
      });
    }
    setMainRelatedLines(nextMainRelated);
  }, [
    entity,
    orderedColumnGroupEntries,
    allRelated,
    zoom,
    nodeOffsets,
    relationForEntityId,
    mainEntities,
    extraRelatedEntities,
    relations,
    collapsedMainIds,
    onlyIdentifierByEntity,
    collapsedTables,
  ]);

  useLayoutEffect(() => computeLines(), [computeLines]);
  useLayoutEffect(() => {
    window.addEventListener("resize", computeLines);
    return () => window.removeEventListener("resize", computeLines);
  }, [computeLines]);

  // --- Property <-> Column drag-to-map ------------------------------------------------------
  // Either end can start the drag (a property's own connect handle, or a column's), and it
  // always completes on whichever kind of node it's released over — connecting sets that
  // property's one mapping, so "reconnect" is just the same gesture landing on a different
  // column (or a different property, for a column-anchored drag).
  type MapDropTarget =
    { type: "column"; table: string; column: string } | { type: "property"; propertyId: string };
  const [dragOrigin, setDragOrigin] = useState<
    | { anchor: "property"; propertyId: string; x1: number; y1: number }
    | { anchor: "column"; table: string; column: string; x1: number; y1: number }
    | null
  >(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [mapDropTarget, setMapDropTarget] = useState<MapDropTarget | null>(null);
  const mapDropTargetRef = useRef<MapDropTarget | null>(null);

  useEffect(() => {
    if (!dragOrigin) return;
    const container = containerRef.current;
    const onMove = (e: MouseEvent) => {
      if (container) {
        const r = container.getBoundingClientRect();
        setDragPos({ x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom });
      }
      let hit: MapDropTarget | null = null;
      columnRefs.current.forEach((el, key) => {
        const r = el.getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          const idx = key.lastIndexOf(".");
          hit = { type: "column", table: key.slice(0, idx), column: key.slice(idx + 1) };
        }
      });
      if (!hit) {
        propertyRefs.current.forEach((el, propertyId) => {
          const r = el.getBoundingClientRect();
          if (
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          ) {
            hit = { type: "property", propertyId };
          }
        });
      }
      mapDropTargetRef.current = hit;
      setMapDropTarget(hit);
    };
    const onUp = () => {
      const target = mapDropTargetRef.current;
      const origin = dragOrigin;
      if (target) {
        if (origin.anchor === "property" && target.type === "column") {
          const ownerId = mainEntities.find((m) =>
            m.properties.some((p) => p.id === origin.propertyId),
          )?.id;
          if (ownerId) {
            updateMapping(ownerId, origin.propertyId, {
              table: target.table,
              column: target.column,
            });
          }
        } else if (origin.anchor === "column" && target.type === "property") {
          const ownerId = mainEntities.find((m) =>
            m.properties.some((p) => p.id === target.propertyId),
          )?.id;
          if (ownerId) {
            updateMapping(ownerId, target.propertyId, {
              table: origin.table,
              column: origin.column,
            });
          }
        }
      }
      mapDropTargetRef.current = null;
      setMapDropTarget(null);
      setDragOrigin(null);
      setDragPos(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragOrigin, updateMapping, zoom, mainEntities]);

  // --- Split-selection state lives here (rather than down by handleSplit, below) purely so
  // `startMoveProperty` can read it — grabbing a *selected* property's handle drags the whole
  // selection, so the state needs to exist before that callback closes over it. Keyed per main
  // entity (the anchor's own id, or an extra row's) — matching 8082's MainCluster, where every
  // shown entity gets its own independent multi-select + Split, not just the one in focus. -------
  const [selectedPropertyIdsByEntity, setSelectedPropertyIdsByEntity] = useState<
    Record<string, Set<string>>
  >({});
  const selectedPropertyIdsFor = useCallback(
    (entityId: string) => selectedPropertyIdsByEntity[entityId] ?? EMPTY_ID_SET,
    [selectedPropertyIdsByEntity],
  );
  const togglePropertySelected = useCallback((entityId: string, propertyId: string) => {
    setSelectedPropertyIdsByEntity((prev) => {
      const current = prev[entityId] ?? EMPTY_ID_SET;
      const next = new Set(current);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return { ...prev, [entityId]: next };
    });
  }, []);
  const clearPropertySelection = useCallback((entityId: string) => {
    setSelectedPropertyIdsByEntity((prev) => ({ ...prev, [entityId]: EMPTY_ID_SET }));
  }, []);
  // Splitting stays on this same Detail canvas — the new entity is added right into
  // `extraMainEntityIds`, positioned immediately after whichever main row it split off from, so
  // it renders as a new row directly below that one (matching 8082's MainCluster behavior) rather
  // than navigating Detail away to the new entity by itself.
  const handleSplit = (entityId: string) => {
    const newId = splitEntity(entityId, Array.from(selectedPropertyIdsFor(entityId)));
    clearPropertySelection(entityId);
    if (!newId) return;
    if (entityId === entity.id) {
      setExtraMainEntityIds((ids) => [newId, ...ids]);
    } else {
      setExtraMainEntityIds((ids) => {
        const idx = ids.indexOf(entityId);
        if (idx === -1) return [...ids, newId];
        return [...ids.slice(0, idx + 1), newId, ...ids.slice(idx + 1)];
      });
    }
  };
  // Same contextual selection Split already uses, applied to app-state's batch deleteProperties
  // instead — every selected property (in this one entity's own Split-selection) moves to Trash
  // together, then the selection clears, matching "clear the selection after deletion".
  const handleDeleteSelectedProperties = (entityId: string) => {
    const propertyIds = Array.from(selectedPropertyIdsFor(entityId));
    if (propertyIds.length === 0) return;
    deleteProperties(propertyIds.map((propertyId) => ({ entityId, propertyId })));
    clearPropertySelection(entityId);
    setContextItem((cur) =>
      cur?.kind === "property" && propertyIds.includes(cur.property.id) ? null : cur,
    );
  };

  // "+ Add property" — an inline input in the Property list itself, never a modal. Only one main
  // entity's row can have it open at a time, which is all that's ever needed since adding is a
  // quick, one-at-a-time action; opening it on a different card just moves the input there.
  const [addingPropertyEntityId, setAddingPropertyEntityId] = useState<string | null>(null);
  const handleCreateProperty = useCallback(
    (entityId: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed) createProperty(entityId, trimmed);
      setAddingPropertyEntityId(null);
    },
    [createProperty],
  );

  // --- Move: drag a property row — or, when the grabbed row is part of the current multi-select,
  // the whole selection together — onto a related satellite or an extra main Entity card to move
  // it/them onto that entity. A plain click (no movement) falls through to the shift/cmd-select
  // handling below, same drag-vs-click threshold as the toolbox drag. -------------------------
  const movePropertyInfo = useRef<{
    propertyIds: string[];
    fromEntityId: string;
    sx: number;
    sy: number;
    moved: boolean;
  } | null>(null);
  const [movePropertyDrag, setMovePropertyDrag] = useState<{
    propertyIds: string[];
    names: string[];
  } | null>(null);
  const [movePropertyPos, setMovePropertyPos] = useState<{ x: number; y: number } | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);

  // Conflict resolution — shown instead of moving immediately whenever the destination entity
  // already has a property whose name (trimmed, case-insensitive) matches one being moved, so a
  // move never silently overwrites, drops, or duplicates a name without the user choosing to.
  const [moveConflict, setMoveConflict] = useState<{
    fromEntityId: string;
    toEntityId: string;
    toEntityName: string;
    items: {
      id: string;
      originalName: string;
      hasConflict: boolean;
      resolution: "rename" | "skip";
      renamedTo: string;
    }[];
  } | null>(null);

  // `fromEntityId` lets this fire from any main entity's own properties (the anchor's or an
  // extra row's) — each has its own independent multi-select, so grabbing a *selected* property's
  // handle drags that entity's whole selection together, regardless of which row it's on.
  const startMoveProperty = (propertyId: string, fromEntityId: string, x: number, y: number) => {
    const selected = selectedPropertyIdsFor(fromEntityId);
    const propertyIds =
      selected.has(propertyId) && selected.size > 1 ? Array.from(selected) : [propertyId];
    movePropertyInfo.current = { propertyIds, fromEntityId, sx: x, sy: y, moved: false };
  };

  // Resolves a completed drop: if none of the moving properties collide by name with the
  // destination's existing properties, commits the move immediately; otherwise opens the conflict
  // panel below instead of touching any data, so the user decides per conflicting property
  // (rename or leave it on the source) before anything actually moves.
  const requestPropertyMove = useCallback(
    (propertyIds: string[], fromEntityId: string, toEntityId: string) => {
      const source = entities.find((e) => e.id === fromEntityId);
      const target = entities.find((e) => e.id === toEntityId);
      if (!source || !target) return;
      const moveIdSet = new Set(propertyIds);
      const moving = source.properties.filter((p) => moveIdSet.has(p.id));
      if (moving.length === 0) return;
      const targetNames = new Set(target.properties.map((p) => p.name.trim().toLowerCase()));
      const anyConflict = moving.some((p) => targetNames.has(p.name.trim().toLowerCase()));
      if (!anyConflict) {
        moveProperties(
          fromEntityId,
          toEntityId,
          moving.map((p) => ({ id: p.id, name: p.name })),
        );
        clearPropertySelection(fromEntityId);
        return;
      }
      const taken = new Set(targetNames);
      setMoveConflict({
        fromEntityId,
        toEntityId,
        toEntityName: target.name || "Untitled",
        items: moving.map((p) => {
          const hasConflict = targetNames.has(p.name.trim().toLowerCase());
          let renamedTo = p.name;
          if (hasConflict) {
            let n = 2;
            renamedTo = `${p.name} (${n})`;
            while (taken.has(renamedTo.trim().toLowerCase())) {
              n += 1;
              renamedTo = `${p.name} (${n})`;
            }
            taken.add(renamedTo.trim().toLowerCase());
          }
          return { id: p.id, originalName: p.name, hasConflict, resolution: "rename", renamedTo };
        }),
      });
    },
    [entities, moveProperties, clearPropertySelection],
  );

  const confirmMoveConflict = () => {
    if (!moveConflict) return;
    const items = moveConflict.items
      .filter((i) => i.resolution !== "skip")
      .map((i) => ({ id: i.id, name: i.resolution === "rename" ? i.renamedTo : i.originalName }));
    moveProperties(moveConflict.fromEntityId, moveConflict.toEntityId, items);
    clearPropertySelection(moveConflict.fromEntityId);
    setMoveConflict(null);
  };
  const cancelMoveConflict = () => setMoveConflict(null);

  useEffect(() => {
    const findMoveTargetAt = (x: number, y: number, excludeId: string) => {
      let hit: string | null = null;
      relatedRefs.current.forEach((el, id) => {
        if (id === excludeId) return;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = id;
      });
      if (hit) return hit;
      mainCardRefs.current.forEach((el, id) => {
        if (id === excludeId) return;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = id;
      });
      if (hit) return hit;
      // Extra rows' own satellites are also valid drop targets — same as the anchor's — for a
      // property dragged from any main entity (including that same row's own card).
      extraRelatedRefs.current.forEach((el, key) => {
        const satId = key.slice(key.indexOf(":") + 1);
        if (satId === excludeId) return;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = satId;
      });
      return hit;
    };
    const onMove = (e: PointerEvent) => {
      const info = movePropertyInfo.current;
      if (!info) return;
      if (!info.moved && Math.hypot(e.clientX - info.sx, e.clientY - info.sy) > 6) {
        info.moved = true;
        const source = mainEntities.find((m) => m.id === info.fromEntityId);
        const names = info.propertyIds.map(
          (id) => source?.properties.find((p) => p.id === id)?.name ?? "",
        );
        setMovePropertyDrag({ propertyIds: info.propertyIds, names });
      }
      if (info.moved) {
        setMovePropertyPos({ x: e.clientX, y: e.clientY });
        setMoveTargetId(findMoveTargetAt(e.clientX, e.clientY, info.fromEntityId));
      }
    };
    const onUp = (e: PointerEvent) => {
      const info = movePropertyInfo.current;
      movePropertyInfo.current = null;
      setMovePropertyDrag(null);
      setMovePropertyPos(null);
      setMoveTargetId(null);
      if (!info || !info.moved) return;
      const hit = findMoveTargetAt(e.clientX, e.clientY, info.fromEntityId);
      if (hit) requestPropertyMove(info.propertyIds, info.fromEntityId, hit);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [entity.id, mainEntities, requestPropertyMove]);

  // --- Entity connect: drag from a related satellite's boundary handle onto another satellite to
  // create a Relation between them — the same grammar and the same addRelation/duplicate-guard
  // logic as the Overview canvas, just scoped to the satellites visible here. ------------------
  const [entityConnectDrag, setEntityConnectDrag] = useState<{
    sourceId: string;
    side: Side;
    origin: { x: number; y: number };
  } | null>(null);
  const [entityConnectPos, setEntityConnectPos] = useState<{ x: number; y: number } | null>(null);
  const [entityConnectTargetId, setEntityConnectTargetId] = useState<string | null>(null);

  const toContainerPos = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const r = container.getBoundingClientRect();
      return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
    },
    [zoom],
  );

  const startEntityConnect = useCallback(
    (otherId: string, side: Side, clientX: number, clientY: number) => {
      setEntityConnectDrag({ sourceId: otherId, side, origin: toContainerPos(clientX, clientY) });
      setEntityConnectPos(toContainerPos(clientX, clientY));
    },
    [toContainerPos],
  );

  useEffect(() => {
    if (!entityConnectDrag) return;
    const findRelatedAt = (x: number, y: number, excludeId: string) => {
      let hit: string | null = null;
      relatedRefs.current.forEach((el, id) => {
        if (id === excludeId) return;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = id;
      });
      return hit;
    };
    const onMove = (e: PointerEvent) => {
      setEntityConnectPos(toContainerPos(e.clientX, e.clientY));
      setEntityConnectTargetId(findRelatedAt(e.clientX, e.clientY, entityConnectDrag.sourceId));
    };
    const onUp = (e: PointerEvent) => {
      const hit = findRelatedAt(e.clientX, e.clientY, entityConnectDrag.sourceId);
      if (hit) addRelation(entityConnectDrag.sourceId, hit);
      setEntityConnectDrag(null);
      setEntityConnectPos(null);
      setEntityConnectTargetId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [entityConnectDrag, toContainerPos, addRelation]);

  const entityConnectTargetSide = useMemo(() => {
    if (!entityConnectTargetId || !entityConnectPos) return null;
    const el = relatedRefs.current.get(entityConnectTargetId);
    const container = containerRef.current;
    if (!el || !container) return null;
    const r = el.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    const center = {
      x: (r.left + r.width / 2 - c.left) / zoom,
      y: (r.top + r.height / 2 - c.top) / zoom,
    };
    return sideBetween(center, entityConnectPos);
  }, [entityConnectTargetId, entityConnectPos, zoom]);

  // --- Merge: shift/cmd-click 1+ of the other *main* Entity Type cards (not the related
  // satellite pills — those are just relation indicators, not full entities ready to merge) to
  // select them, then Merge combines them with the anchor entity into a brand-new one, and Detail
  // jumps to it. ---------------------------------------------------------------------------
  const [selectedMergeIds, setSelectedMergeIds] = useState<Set<string>>(new Set());
  const toggleMergeSelected = useCallback((id: string) => {
    setSelectedMergeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const mergeCandidates = useMemo(
    () => mainEntities.slice(1).filter((e) => selectedMergeIds.has(e.id)),
    [mainEntities, selectedMergeIds],
  );
  // Every entity actually being merged, anchor included — the name-suggestion source for the
  // Merge panel below (each one's own current name is offered as a one-click option, alongside a
  // couple of AI-suggested combinations of all of them).
  const mergeEntitiesList = useMemo(() => [entity, ...mergeCandidates], [entity, mergeCandidates]);
  const mergeAiSuggestions = useMemo(() => {
    if (mergeEntitiesList.length < 2) return [];
    const names = mergeEntitiesList.map((e) => e.name || "Entity");
    const joined = names.join(" ");
    const camel = names.join("");
    return Array.from(new Set([joined, camel].filter((s) => s.trim().length > 0)));
  }, [mergeEntitiesList]);

  // --- Relation multi-select: shift/cmd-click 1+ Relation badges to select them for the same
  // contextual-action surface as Merge/Split — the only action available for a Relation selection
  // is Delete (relations can't be merged or split). A flat Set is enough (unlike Split's
  // per-entity Record) since every Relation badge on this canvas already carries its own unique
  // id regardless of which of the 3 line groups (related/extra-related/main-related) drew it. ---
  const [selectedRelationIds, setSelectedRelationIds] = useState<Set<string>>(new Set());
  const toggleRelationSelected = useCallback((id: string) => {
    setSelectedRelationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Contextual selection: click an Entity Type / Property / Relation / Column to open the
  // bottom panel with just its Name + Description — everything else about it is already visible
  // on the canvas. Separate from drag/connect (those elements stopPropagation on pointerdown) and
  // separate from the shift-click multi-select used by Split/Merge above. ---------------------
  const [contextItem, setContextItem] = useState<ContextItem | null>(() => {
    const property = initialFocusPropertyId
      ? entity.properties.find((p) => p.id === initialFocusPropertyId)
      : undefined;
    if (property) return { kind: "property", entity, property };
    const table = initialFocusColumn ? tableByName(initialFocusColumn.table) : undefined;
    const column = table?.columns.find((c) => c.name === initialFocusColumn?.column);
    if (table && column) return { kind: "column", tableName: table.name, column };
    return null;
  });
  const handleMerge = () => {
    if (!mergeName.trim()) return;
    const ids = [entity.id, ...mergeCandidates.map((e) => e.id)];
    const newId = mergeEntities(ids, mergeName.trim());
    setSelectedMergeIds(new Set());
    setMergePanelOpen(false);
    setMergeName("");
    if (newId) onFocusEntity(newId);
  };

  // Same underlying deletion as the hover-delete/context-panel Delete for a single Entity Type —
  // just applied to the anchor plus every selected merge-candidate in one atomic pass (see
  // app-state's deleteEntities, which cascades Relations/Properties correctly even when two
  // selected entities are directly connected to each other). Clears both selection tracks and the
  // now-stale merge panel, matching "clear the selection after deletion".
  const handleDeleteSelectedEntities = useCallback(() => {
    const ids = [entity.id, ...mergeCandidates.map((e) => e.id)];
    deleteEntities(ids);
    setSelectedMergeIds(new Set());
    setMergePanelOpen(false);
    setMergeName("");
    setContextItem((cur) => (cur?.kind === "entity" && ids.includes(cur.entity.id) ? null : cur));
  }, [entity.id, mergeCandidates, deleteEntities]);

  const handleDeleteSelectedRelations = useCallback(() => {
    const ids = Array.from(selectedRelationIds);
    if (ids.length === 0) return;
    deleteRelations(ids);
    setSelectedRelationIds(new Set());
    setContextItem((cur) =>
      cur?.kind === "relation" && ids.includes(cur.relation.id) ? null : cur,
    );
  }, [selectedRelationIds, deleteRelations]);

  // Swap direction is an explicit action only — never a drag-reconnect — and Confirm re-derives
  // the block from live `entities`/`relations` on every call, so it always reflects whatever the
  // two connected Entity Types' status is *right now*, not whatever it was when the panel opened.
  // Both also refresh `contextItem` itself when it's this same relation — otherwise the panel
  // would keep showing the pre-swap/pre-confirm snapshot it was opened with, since `contextItem`
  // is its own state rather than something re-derived from `relations` on every render.
  const handleSwapRelation = useCallback(
    (relationId: string) => {
      const relation = relations.find((r) => r.id === relationId);
      if (!relation) return;
      const swapped = { ...relation, from: relation.to, to: relation.from };
      updateRelation(relationId, { from: swapped.from, to: swapped.to });
      setContextItem((cur) =>
        cur?.kind === "relation" && cur.relation.id === relationId
          ? { kind: "relation", relation: swapped }
          : cur,
      );
    },
    [relations, updateRelation],
  );
  const handleRenameRelation = useCallback(
    (relationId: string, name: string) => {
      renameRelation(relationId, name);
      const relation = relations.find((r) => r.id === relationId);
      if (!relation) return;
      const trimmed = name.trim();
      const renamed = {
        ...relation,
        name: trimmed,
        status:
          relation.status === "error" && relation.name.trim() === "" && trimmed !== ""
            ? ("suggested" as const)
            : relation.status,
      };
      setContextItem((cur) =>
        cur?.kind === "relation" && cur.relation.id === relationId
          ? { kind: "relation", relation: renamed }
          : cur,
      );
    },
    [relations, renameRelation],
  );
  const handleEditRelationDescription = useCallback(
    (relationId: string, description: string) => {
      updateRelation(relationId, { description });
      setContextItem((cur) =>
        cur?.kind === "relation" && cur.relation.id === relationId
          ? { kind: "relation", relation: { ...cur.relation, description } }
          : cur,
      );
    },
    [updateRelation],
  );
  // Name/Description edits are plain field updates — no special-casing the way a Relation's
  // rename needs (see `renameRelation`'s own Error-clearing rule); each still refreshes the local
  // contextual-panel snapshot the same way every other edit here does, since `contextItem` isn't
  // re-derived from `entities` on every render.
  const handleRenameEntity = useCallback(
    (entityId: string, name: string) => {
      // `updateEntity` itself deliberately never pushes undo history (see its own comment in
      // app-state.ts) since it's also used for continuous position dragging — a discrete, one-shot
      // edit like this one has to push explicitly, right before making the actual change.
      pushHistory();
      updateEntity(entityId, { name });
      setContextItem((cur) =>
        cur?.kind === "entity" && cur.entity.id === entityId
          ? { kind: "entity", entity: { ...cur.entity, name } }
          : cur,
      );
    },
    [updateEntity, pushHistory],
  );
  const handleEditEntityDescription = useCallback(
    (entityId: string, description: string) => {
      pushHistory();
      updateEntity(entityId, { description });
      setContextItem((cur) =>
        cur?.kind === "entity" && cur.entity.id === entityId
          ? { kind: "entity", entity: { ...cur.entity, description } }
          : cur,
      );
    },
    [updateEntity, pushHistory],
  );
  const handleRenameProperty = useCallback(
    (entityId: string, propertyId: string, name: string) => {
      updateProperty(entityId, propertyId, { name });
      setContextItem((cur) =>
        cur?.kind === "property" && cur.property.id === propertyId
          ? { kind: "property", entity: cur.entity, property: { ...cur.property, name } }
          : cur,
      );
    },
    [updateProperty],
  );
  const handleEditPropertyDescription = useCallback(
    (entityId: string, propertyId: string, description: string) => {
      updateProperty(entityId, propertyId, { description });
      setContextItem((cur) =>
        cur?.kind === "property" && cur.property.id === propertyId
          ? { kind: "property", entity: cur.entity, property: { ...cur.property, description } }
          : cur,
      );
    },
    [updateProperty],
  );

  // Delete moves the item to Trash (see app-state's `deleteEntity`/`deleteProperty`/
  // `deleteRelation`) rather than destroying it; each wrapper here only adds clearing the local
  // contextual-panel state so it doesn't keep showing an item that's now gone. Deleting the
  // anchor entity itself needs no extra navigation here — app-state's `deleteEntity` already
  // clears `detail`, which unmounts this whole canvas in favor of Overview.
  const handleDeleteEntity = useCallback(
    (entityId: string) => {
      deleteEntity(entityId);
      setContextItem((cur) => (cur?.kind === "entity" && cur.entity.id === entityId ? null : cur));
      setSelectedMergeIds((ids) =>
        ids.has(entityId) ? new Set([...ids].filter((id) => id !== entityId)) : ids,
      );
    },
    [deleteEntity],
  );
  const handleDeleteProperty = useCallback(
    (entityId: string, propertyId: string) => {
      deleteProperty(entityId, propertyId);
      setContextItem((cur) =>
        cur?.kind === "property" && cur.property.id === propertyId ? null : cur,
      );
      setSelectedPropertyIdsByEntity((prev) => {
        const current = prev[entityId];
        if (!current?.has(propertyId)) return prev;
        const next = new Set(current);
        next.delete(propertyId);
        return { ...prev, [entityId]: next };
      });
    },
    [deleteProperty],
  );
  const handleDeleteRelation = useCallback(
    (relationId: string) => {
      deleteRelation(relationId);
      setContextItem((cur) =>
        cur?.kind === "relation" && cur.relation.id === relationId ? null : cur,
      );
      setSelectedRelationIds((ids) =>
        ids.has(relationId) ? new Set([...ids].filter((id) => id !== relationId)) : ids,
      );
    },
    [deleteRelation],
  );

  nodeClickActionsRef.current["anchor"] = () => setContextItem({ kind: "entity", entity });

  return (
    <>
      <DetailShell
        entityItems={entityItems}
        onFocusEntity={onFocusEntity}
        onCreateEntity={createEntity}
        onDropEntity={onDropEntity}
        tableItems={tableItems}
        entities={entities}
        onFocusTable={onFocusTable}
        onDropTable={onDropTable}
        onSwapRelation={handleSwapRelation}
        onRenameRelation={handleRenameRelation}
        onEditRelationDescription={handleEditRelationDescription}
        onRenameEntity={handleRenameEntity}
        onEditEntityDescription={handleEditEntityDescription}
        onRenameProperty={handleRenameProperty}
        onEditPropertyDescription={handleEditPropertyDescription}
        onDeleteEntity={handleDeleteEntity}
        onDeleteProperty={handleDeleteProperty}
        onDeleteRelation={handleDeleteRelation}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        confidenceRange={confidenceRange}
        onDragMove={onToolboxDragMove}
        onDragEnd={onToolboxDragEnd}
        zoom={zoom}
        setZoom={setZoom}
        pan={pan}
        setPan={setPan}
        contextItem={contextItem}
        onCloseContext={() => setContextItem(null)}
        onCanvasPointerDown={() => setContextItem(null)}
      >
        <div
          ref={containerRef}
          className="relative flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-10 whitespace-nowrap"
        >
          <svg className="pointer-events-none absolute inset-0 z-20 overflow-visible">
            <defs>
              {/* Arrowhead for relation lines only — points at the relation's actual `to` side
                  (see computeLines), never a fixed screen direction. Property<->Column mapping
                  lines below intentionally have no marker. */}
              <marker
                id="relation-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth={6}
                markerHeight={6}
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" className="fill-zinc-400" />
              </marker>
            </defs>
            {relatedLines.map((l) => {
              const otherId = l.id.slice(4);
              const hasRelation = relationForEntityId.has(otherId);
              return (
                <path
                  key={l.id}
                  d={curve(l)}
                  fill="none"
                  strokeLinecap="round"
                  className="stroke-zinc-400"
                  strokeWidth={1.3}
                  opacity={0.7}
                  markerEnd={hasRelation ? "url(#relation-arrow)" : undefined}
                />
              );
            })}
            {lines.map((l) => (
              <g key={l.id}>
                <path
                  d={mappingCurve(l)}
                  fill="none"
                  strokeLinecap="round"
                  className="stroke-zinc-400"
                  strokeWidth={1.4}
                  opacity={0.85}
                />
                {/* Invisible, much wider duplicate of the same path — hovering a 1.4px line
                    precisely isn't realistic, so this is the actual hover hit-target for the
                    delete control rendered below the svg. */}
                <path
                  d={mappingCurve(l)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  pointerEvents="stroke"
                  className="pointer-events-auto cursor-pointer"
                  onMouseEnter={() => setHoveredMappingLineId(l.id)}
                  onMouseLeave={() => setHoveredMappingLineId((cur) => (cur === l.id ? null : cur))}
                />
              </g>
            ))}
            {extraRelatedLines.map((l) => (
              <path
                key={l.id}
                d={curve(l)}
                fill="none"
                strokeLinecap="round"
                className="stroke-zinc-400"
                strokeWidth={1.3}
                opacity={0.7}
                markerEnd={l.relationId ? "url(#relation-arrow)" : undefined}
              />
            ))}
            {mainRelatedLines.map((l) => (
              <path
                key={l.id}
                d={curve(l)}
                fill="none"
                strokeLinecap="round"
                className="stroke-zinc-400"
                strokeWidth={1.3}
                opacity={0.7}
                markerEnd="url(#relation-arrow)"
              />
            ))}
            {dragOrigin && dragPos && (
              <path
                d={`M ${dragOrigin.x1} ${dragOrigin.y1} L ${dragPos.x} ${dragPos.y}`}
                fill="none"
                stroke="#61b2ff"
                strokeWidth={2}
                strokeDasharray="4 3"
                opacity={0.9}
              />
            )}
            {entityConnectDrag && entityConnectPos && (
              <path
                d={`M ${entityConnectDrag.origin.x} ${entityConnectDrag.origin.y} L ${entityConnectPos.x} ${entityConnectPos.y}`}
                fill="none"
                stroke="#61b2ff"
                strokeWidth={2}
                strokeDasharray="4 3"
                opacity={0.9}
              />
            )}
          </svg>

          {/* Hover-revealed disconnect for a Property<->Column mapping line — never deletes the
            Property or the Column, only clears that one mapping (the existing reconnect gesture,
            dragging a new connector onto either end, is untouched). */}
          {lines.map((l) => {
            if (hoveredMappingLineId !== l.id || !l.propertyId || !l.ownerEntityId) return null;
            const mid = { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
            const propertyId = l.propertyId;
            const ownerEntityId = l.ownerEntityId;
            return (
              <button
                key={l.id}
                type="button"
                style={{ left: mid.x, top: mid.y }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseEnter={() => setHoveredMappingLineId(l.id)}
                onMouseLeave={() => setHoveredMappingLineId(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  updateMapping(ownerEntityId, propertyId, null);
                  setHoveredMappingLineId(null);
                }}
                aria-label="Disconnect this mapping"
                title="Disconnect this mapping"
                className="absolute z-20 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-node-border bg-white text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
              >
                <X className="size-2.5" />
              </button>
            );
          })}

          {/* Small clickable badge on each related-line's midpoint — the only way to reach a
            Relation's Name + Description in Detail, since the line itself has nothing to click. */}
          {relatedLines.map((l) => {
            const otherId = l.id.slice(4); // strips the "rel-" prefix set when the line was built
            const relation = relationForEntityId.get(otherId);
            if (!relation) return null;
            const mid = { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
            const isContextSelected =
              contextItem?.kind === "relation" && contextItem.relation.id === relation.id;
            const isRelSelected = selectedRelationIds.has(relation.id);
            return (
              <div
                key={relation.id}
                style={{ left: mid.x, top: mid.y }}
                className="group/relbadge absolute z-20 -translate-x-1/2 -translate-y-1/2"
              >
                <button
                  type="button"
                  style={{ borderColor: statusBorderColor(relation.status) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleRelationSelected(relation.id);
                    else setContextItem({ kind: "relation", relation });
                  }}
                  title={
                    isRelSelected
                      ? "Selected for delete — click to deselect"
                      : `${relationLabel(relation)} — click for name and description, or shift-click to select for delete`
                  }
                  className={cn(
                    "inline-flex items-center justify-center gap-1 rounded-full border-[1.5px] bg-white py-1 pl-1 pr-2 shadow-[0_2.281px_1.14px_0_rgba(0,0,0,0.1)]",
                    isRelSelected && "shadow-[0_0_0_2px_#60a5fa]",
                    isContextSelected && "ring-2 ring-primary",
                  )}
                >
                  <StatusBadge
                    status={relation.status}
                    size={16}
                    confidence={relation.confidence}
                    warningReason={relation.warningReason}
                    errorReason={relation.errorReason}
                  />
                  <span className="whitespace-nowrap text-[10.5px] font-medium leading-[15.75px] text-[#171B22]">
                    {relationLabel(relation)}
                  </span>
                </button>
                {/* Hover-revealed delete — removes only this Relation, never either connected
                    Entity Type. */}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRelation(relation.id);
                  }}
                  aria-label={`Delete relation ${relationLabel(relation)}`}
                  title="Delete this relation"
                  className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-node-border bg-white text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent hover:text-foreground group-hover/relbadge:opacity-100"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            );
          })}

          {/* Same relation badge, for an extra main entity's own satellite lines. */}
          {extraRelatedLines.map((l) => {
            const relation = l.relationId ? relations.find((r) => r.id === l.relationId) : null;
            if (!relation) return null;
            const mid = { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
            const isContextSelected =
              contextItem?.kind === "relation" && contextItem.relation.id === relation.id;
            const isRelSelected = selectedRelationIds.has(relation.id);
            return (
              <div
                key={relation.id}
                style={{ left: mid.x, top: mid.y }}
                className="group/relbadge absolute z-20 -translate-x-1/2 -translate-y-1/2"
              >
                <button
                  type="button"
                  style={{ borderColor: statusBorderColor(relation.status) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleRelationSelected(relation.id);
                    else setContextItem({ kind: "relation", relation });
                  }}
                  title={
                    isRelSelected
                      ? "Selected for delete — click to deselect"
                      : `${relationLabel(relation)} — click for name and description, or shift-click to select for delete`
                  }
                  className={cn(
                    "inline-flex items-center justify-center gap-1 rounded-full border-[1.5px] bg-white py-1 pl-1 pr-2 shadow-[0_2.281px_1.14px_0_rgba(0,0,0,0.1)]",
                    isRelSelected && "shadow-[0_0_0_2px_#60a5fa]",
                    isContextSelected && "ring-2 ring-primary",
                  )}
                >
                  <StatusBadge
                    status={relation.status}
                    size={16}
                    confidence={relation.confidence}
                    warningReason={relation.warningReason}
                    errorReason={relation.errorReason}
                  />
                  <span className="whitespace-nowrap text-[10.5px] font-medium leading-[15.75px] text-[#171B22]">
                    {relationLabel(relation)}
                  </span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRelation(relation.id);
                  }}
                  aria-label={`Delete relation ${relationLabel(relation)}`}
                  title="Delete this relation"
                  className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-node-border bg-white text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent hover:text-foreground group-hover/relbadge:opacity-100"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            );
          })}

          {/* Same relation badge again, for the straight-down anchor<->extra-main-card lines. */}
          {mainRelatedLines.map((l) => {
            const relation = relations.find((r) => r.id === l.relationId);
            if (!relation) return null;
            const mid = { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
            const isContextSelected =
              contextItem?.kind === "relation" && contextItem.relation.id === relation.id;
            const isRelSelected = selectedRelationIds.has(relation.id);
            return (
              <div
                key={relation.id}
                style={{ left: mid.x, top: mid.y }}
                className="group/relbadge absolute z-20 -translate-x-1/2 -translate-y-1/2"
              >
                <button
                  type="button"
                  style={{ borderColor: statusBorderColor(relation.status) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleRelationSelected(relation.id);
                    else setContextItem({ kind: "relation", relation });
                  }}
                  title={
                    isRelSelected
                      ? "Selected for delete — click to deselect"
                      : `${relationLabel(relation)} — click for name and description, or shift-click to select for delete`
                  }
                  className={cn(
                    "inline-flex items-center justify-center gap-1 rounded-full border-[1.5px] bg-white py-1 pl-1 pr-2 shadow-[0_2.281px_1.14px_0_rgba(0,0,0,0.1)]",
                    isRelSelected && "shadow-[0_0_0_2px_#60a5fa]",
                    isContextSelected && "ring-2 ring-primary",
                  )}
                >
                  <StatusBadge
                    status={relation.status}
                    size={16}
                    confidence={relation.confidence}
                    warningReason={relation.warningReason}
                    errorReason={relation.errorReason}
                  />
                  <span className="whitespace-nowrap text-[10.5px] font-medium leading-[15.75px] text-[#171B22]">
                    {relationLabel(relation)}
                  </span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRelation(relation.id);
                  }}
                  aria-label={`Delete relation ${relationLabel(relation)}`}
                  title="Delete this relation"
                  className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-node-border bg-white text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent hover:text-foreground group-hover/relbadge:opacity-100"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            );
          })}

          {/* Properties <-> Columns: the central relationship. Related entities (subtle, click to
            re-focus, shift/cmd-click to select for Merge) connect straight into the Properties
            card — no separate anchor circle. Every extra Entity dropped into the center column
            gets an identical row of its own (its own related satellites, its own card, its own
            mapped columns) stacked below this one — see `mainEntities.slice(1)` further down. */}
          <div ref={mainStackRef} className="flex flex-col gap-16">
            <div className="relative z-10 flex items-start gap-20">
              <div
                ref={relatedColumnRef}
                className="flex flex-col items-center gap-6 pt-8"
                // The base gap-20 (80px) above already covers the card<->Columns-area pair; this
                // adds only whatever extra room the widest relation label actually needs beyond
                // that, so the satellites<->card gap grows independently of the other one.
                style={{ marginRight: Math.max(0, relationGapPx - 80) }}
              >
                {collapsedMainIds.has(entity.id) && (
                  <p className="w-[120px] text-center text-[10.5px] text-muted-foreground">
                    {allRelated.length} related (collapsed)
                  </p>
                )}
                {!collapsedMainIds.has(entity.id) &&
                  allRelated.length === 0 &&
                  relatedInsertIndex === null && (
                    <p className="w-[120px] text-center text-[10.5px] text-muted-foreground">
                      Drop an Entity Type here to add it.
                    </p>
                  )}
                {!collapsedMainIds.has(entity.id) &&
                  allRelated.map((other, i) => {
                    // Canvas click = inspect, never navigate — a related satellite pill shows its
                    // own name/description in the Context Panel, same as any other canvas object,
                    // while the CURRENT Detail anchor stays exactly where it is. Only clicking this
                    // same Entity Type in the Entity Types PANEL navigates (see DetailShell's own
                    // `onFocusEntity`).
                    nodeClickActionsRef.current[other.id] = () =>
                      setContextItem({ kind: "entity", entity: other });
                    return (
                      <div key={other.id} className="contents">
                        {relatedInsertIndex === i && <DropInsertionPlaceholder variant="pill" />}
                        <div
                          ref={(el) => {
                            if (el) relatedRefs.current.set(other.id, el);
                            else relatedRefs.current.delete(other.id);
                          }}
                          style={nodeTransform(other.id)}
                          className="flex flex-col items-center gap-1 rounded-full"
                          title="Click for name and description, drag to reposition, or drop a dragged property here to move it"
                        >
                          <EntityNode
                            entity={other}
                            scale={1}
                            moveTarget={moveTargetId === other.id}
                            onClick={() => setContextItem({ kind: "entity", entity: other })}
                            onStartMove={(clientX, clientY) =>
                              startNodeDrag(other.id, clientX, clientY)
                            }
                            onStartConnect={(side, clientX, clientY) =>
                              startEntityConnect(other.id, side, clientX, clientY)
                            }
                            connectSourceSide={
                              entityConnectDrag?.sourceId === other.id
                                ? entityConnectDrag.side
                                : null
                            }
                            connectTargetSide={
                              entityConnectTargetId === other.id ? entityConnectTargetSide : null
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                {!collapsedMainIds.has(entity.id) && relatedInsertIndex === allRelated.length && (
                  <DropInsertionPlaceholder variant="pill" />
                )}
              </div>

              <div className="flex flex-col gap-4">
                <div
                  ref={(el) => {
                    propsCardRef.current = el;
                    // The anchor's own card is a valid property-move drop target too — same as
                    // every other main entity's card — so a property dragged out from a satellite
                    // or an extra row can be dropped straight back onto it.
                    if (el) mainCardRefs.current.set(entity.id, el);
                    else mainCardRefs.current.delete(entity.id);
                  }}
                  style={nodeTransform("anchor")}
                  className={cn(
                    "group/entitycard flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 [&>div]:w-full",
                    moveTargetId === entity.id
                      ? "shadow-[0_0_0_4px_var(--color-primary)]"
                      : contextItem?.kind === "entity" && contextItem.entity.id === entity.id
                        ? "shadow-[0_0_0_2px_#FCFCFC,0_0_0_5px_#61B2FF,0_2px_2px_0_rgba(0,0,0,0.10)]"
                        : "shadow-[0_2px_2px_0_rgba(0,0,0,0.1)]",
                  )}
                >
                  <div className="flex w-full items-center gap-1">
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        startNodeDrag("anchor", e.clientX, e.clientY);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.detail === 0) setContextItem({ kind: "entity", entity });
                      }}
                      title="Click for name and description, or drag to reposition"
                      className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 truncate rounded-full px-1 pb-1 text-left hover:bg-accent active:cursor-grabbing"
                    >
                      <StatusBadge
                        status={entityStatus(entity)}
                        confidence={entity.confidence}
                        warningReason={entity.warningReason}
                        errorReason={entityErrorReason(entity)}
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                        {entity.name}
                      </span>
                      <ConfidenceChip confidence={entity.confidence} />
                    </button>
                    <DeleteButton
                      onClick={() => handleDeleteEntity(entity.id)}
                      aria-label={`Delete ${entity.name || "this entity"}`}
                      title="Delete Entity Type"
                      size={13}
                      className="size-5 opacity-0 group-hover/entitycard:opacity-100"
                    />
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMainCollapsed(entity.id);
                      }}
                      aria-label={
                        collapsedMainIds.has(entity.id)
                          ? `Expand ${entity.name || "this entity"}'s row`
                          : `Collapse ${entity.name || "this entity"}'s row`
                      }
                      title={collapsedMainIds.has(entity.id) ? "Expand row" : "Collapse row"}
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                    >
                      {collapsedMainIds.has(entity.id) ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                    </button>
                  </div>
                  {!collapsedMainIds.has(entity.id) && (
                    <div className="flex w-full items-center justify-between gap-1">
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => toggleOnlyIdentifier(entity.id)}
                        aria-pressed={!!onlyIdentifierByEntity[entity.id]}
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                          onlyIdentifierByEntity[entity.id]
                            ? "bg-black/[0.08] text-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        Only Identifier
                      </button>
                      <SortBar
                        sort={propertySortFor(entity.id)}
                        onChange={(k) => setPropertySortFor(entity.id, k)}
                      />
                    </div>
                  )}
                  {!collapsedMainIds.has(entity.id) &&
                    visibleProperties(entity.id, entity.properties).map((p) => {
                      const isDropTarget =
                        mapDropTarget?.type === "property" && mapDropTarget.propertyId === p.id;
                      const isSelected = selectedPropertyIdsFor(entity.id).has(p.id);
                      const isContextSelected =
                        contextItem?.kind === "property" && contextItem.property.id === p.id;
                      return (
                        <div
                          key={p.id}
                          ref={(el) => {
                            if (el) propertyRefs.current.set(p.id, el);
                            else propertyRefs.current.delete(p.id);
                          }}
                          // Without this, the canvas's own onPointerDown (a few levels up) sees the
                          // bubbled pointerdown and calls setPointerCapture on itself for panning —
                          // which then retargets the resulting click event to the canvas, so this
                          // row's onClick below never fires for a real mouse click (only synthetic
                          // ones dispatched directly on the row). Every other clickable canvas
                          // element already stops propagation on pointerdown for the same reason.
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.shiftKey || e.metaKey || e.ctrlKey)
                              togglePropertySelected(entity.id, p.id);
                            else setContextItem({ kind: "property", entity, property: p });
                          }}
                          title="Click for name and description, or shift-click to select for split"
                          className={cn(
                            "group/prop relative flex w-[241.8px] cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] leading-[16.5px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                            p.mapping
                              ? "bg-[#F5F3FF] font-medium text-[#553EB7]"
                              : "bg-white font-normal text-[#555]",
                            isSelected && "shadow-[0_0_0_2px_#60a5fa]",
                            isContextSelected && "shadow-[0_0_0_2px_var(--color-primary)]",
                            isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                            movePropertyDrag?.propertyIds.includes(p.id) && "opacity-40",
                          )}
                        >
                          {/* IDENTIFIER — key-icon for the entity's identifier property, unless it's
                      currently blocked (unmapped), in which case the Error status badge takes this
                      same left-of-name slot instead — see mock-data's `propertyStatus`. */}
                          {isIdentifierProperty(p.name) &&
                            (propertyStatus(p) === "error" ? (
                              <StatusBadge
                                status="error"
                                size={16}
                                confidence={p.confidence}
                                errorReason={propertyErrorReason(p)}
                              />
                            ) : (
                              <IdentifierIcon />
                            ))}
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <ConfidenceChip confidence={p.confidence} />
                          <DeleteButton
                            onClick={() => handleDeleteProperty(entity.id, p.id)}
                            aria-label={`Delete ${p.name || "this property"}`}
                            title="Delete Property"
                            className="opacity-0 group-hover/prop:opacity-100"
                          />
                          {/* DRAGGABLE — right, moves the Property itself onto another Entity. Never
                      creates a connection. */}
                          <DraggableHandle
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              startMoveProperty(p.id, entity.id, e.clientX, e.clientY);
                            }}
                            aria-label={`Drag to move ${p.name} to another entity`}
                            title="Drag to move to another entity"
                          />
                          {/* Hover-to-clear-mapping is temporarily disabled — the red X no longer
                      appears on hover. */}
                          {/* CONNECTION HANDLE — boundary, separate from Draggable. Hover-revealed; drag
                      onto a column to connect (or reconnect) this property's one mapping. Never
                      moves the Property. */}
                          <ConnectionHandle
                            active={isDropTarget}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const container = containerRef.current;
                              const pos = container
                                ? {
                                    x: (e.clientX - container.getBoundingClientRect().left) / zoom,
                                    y: (e.clientY - container.getBoundingClientRect().top) / zoom,
                                  }
                                : { x: 0, y: 0 };
                              setDragOrigin({
                                anchor: "property",
                                propertyId: p.id,
                                x1: pos.x,
                                y1: pos.y,
                              });
                              setDragPos(pos);
                            }}
                            aria-label={`Drag to connect ${p.name} to a column`}
                            title="Drag to connect to a column"
                            className="absolute -right-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/prop:opacity-100"
                          />
                        </div>
                      );
                    })}
                  {!collapsedMainIds.has(entity.id) &&
                    selectedPropertyIdsFor(entity.id).size > 0 && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => handleSplit(entity.id)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90"
                        >
                          <Scissors className="size-3.5" /> Split (
                          {selectedPropertyIdsFor(entity.id).size})
                        </button>
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => handleDeleteSelectedProperties(entity.id)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#f15b15]/25 px-3 py-1.5 text-[11.5px] font-medium text-[#9c461e] transition-colors hover:bg-[#ffe6db]"
                        >
                          <Trash2 className="size-3.5" /> Delete (
                          {selectedPropertyIdsFor(entity.id).size})
                        </button>
                      </div>
                    )}
                  {!collapsedMainIds.has(entity.id) && (
                    <AddPropertyRow
                      isAdding={addingPropertyEntityId === entity.id}
                      onStartAdd={() => setAddingPropertyEntityId(entity.id)}
                      onSubmit={(name) => handleCreateProperty(entity.id, name)}
                      onCancel={() => setAddingPropertyEntityId(null)}
                    />
                  )}
                </div>
              </div>

              <div ref={columnsAreaRef} className="flex flex-col gap-4">
                {collapsedMainIds.has(entity.id) && (
                  <p className="w-56 text-center text-[11.5px] text-muted-foreground">
                    {columnGroups.length} table{columnGroups.length === 1 ? "" : "s"} (collapsed)
                  </p>
                )}
                {!collapsedMainIds.has(entity.id) &&
                  columnGroups.length === 0 &&
                  tableInsertIndex === null && (
                    <p className="w-56 text-center text-[11.5px] text-muted-foreground">
                      {entity.properties.some((p) => p.mapping)
                        ? "Mapped to a table not shown in this view."
                        : "No properties mapped to a column yet."}
                    </p>
                  )}
                {!collapsedMainIds.has(entity.id) &&
                  columnGroups.map(([table, cols], i) => {
                    const nodeId = `table:${table}`;
                    const tableConfidence = tableByName(table)?.confidence;
                    nodeClickActionsRef.current[nodeId] = () => {
                      const schema = tableByName(table);
                      if (schema) setContextItem({ kind: "table", table: schema });
                    };
                    return (
                      <div key={table} className="contents">
                        {tableInsertIndex === i && <DropInsertionPlaceholder variant="card" />}
                        <div
                          ref={(el) => {
                            if (el) columnGroupRefs.current.set(table, el);
                            else columnGroupRefs.current.delete(table);
                          }}
                          style={nodeTransform(nodeId)}
                          className={cn(
                            "flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 [&>div]:w-full",
                            contextItem?.kind === "table" && contextItem.table.name === table
                              ? "shadow-[0_0_0_2px_#FCFCFC,0_0_0_5px_#61B2FF,0_2px_2px_0_rgba(0,0,0,0.10)]"
                              : "shadow-[0_2px_2px_0_rgba(0,0,0,0.1)]",
                          )}
                        >
                          <div className="flex w-full items-center gap-1">
                            <button
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                startNodeDrag(nodeId, e.clientX, e.clientY);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (e.detail === 0) {
                                  const schema = tableByName(table);
                                  if (schema) setContextItem({ kind: "table", table: schema });
                                }
                              }}
                              className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 truncate rounded-full py-1 text-left hover:bg-accent active:cursor-grabbing"
                              title="Click for name and description, or drag to reposition"
                            >
                              <MappingStatusBadge
                                status={tableMappingStatus(table, entities)}
                                size={20}
                              />
                              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                                {table}
                              </span>
                              <ConfidenceChip confidence={tableConfidence} />
                            </button>
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTableCollapsed(table);
                              }}
                              aria-label={
                                collapsedTables.has(table)
                                  ? `Expand ${table}'s row`
                                  : `Collapse ${table}'s row`
                              }
                              title={collapsedTables.has(table) ? "Expand row" : "Collapse row"}
                              className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                            >
                              {collapsedTables.has(table) ? (
                                <ChevronRight className="size-3.5" />
                              ) : (
                                <ChevronDown className="size-3.5" />
                              )}
                            </button>
                          </div>
                          {collapsedTables.has(table) && (
                            <p className="w-full text-center text-[10.5px] text-muted-foreground">
                              {cols.length} column{cols.length === 1 ? "" : "s"} (collapsed)
                            </p>
                          )}
                          {!collapsedTables.has(table) && (
                            <div className="flex w-full items-center justify-end">
                              <SortBar
                                sort={columnSortFor(table)}
                                onChange={(k) => setColumnSortForTable(table, k)}
                              />
                            </div>
                          )}
                          {!collapsedTables.has(table) &&
                            visibleColumns(table, cols).map((c) => {
                              const key = `${table}.${c.column}`;
                              const isDropTarget =
                                mapDropTarget?.type === "column" &&
                                mapDropTarget.table === table &&
                                mapDropTarget.column === c.column;
                              const isContextSelected =
                                contextItem?.kind === "column" &&
                                contextItem.tableName === table &&
                                contextItem.column.name === c.column;
                              const schema = tableByName(table);
                              return (
                                <div
                                  key={c.column}
                                  ref={(el) => {
                                    if (el) columnRefs.current.set(key, el);
                                    else columnRefs.current.delete(key);
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const col = schema?.columns.find((tc) => tc.name === c.column);
                                    if (col)
                                      setContextItem({
                                        kind: "column",
                                        tableName: table,
                                        column: col,
                                      });
                                  }}
                                  title="Click for name and description"
                                  className={cn(
                                    "group/col relative flex w-[241.8px] cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] leading-[16.5px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                                    c.mappedBy.length > 0
                                      ? "bg-[#EAF7ED] font-medium text-[#0E6C21]"
                                      : "bg-white font-normal text-[#555]",
                                    isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                                    isContextSelected && "shadow-[0_0_0_2px_var(--color-primary)]",
                                  )}
                                >
                                  {schema ? (
                                    <SampleDataTrigger
                                      table={schema}
                                      columnName={c.column}
                                      className="flex min-w-0 flex-1 items-center gap-1"
                                    >
                                      <span className="min-w-0 flex-1 truncate">{c.column}</span>
                                      <span
                                        className={cn(
                                          "shrink-0 font-['IBM_Plex_Mono'] text-[10.8px] font-normal leading-[16.2px]",
                                          c.mappedBy.length > 0
                                            ? "text-[#318F5A]"
                                            : "text-[#70757C]/60",
                                        )}
                                      >
                                        {c.type}
                                      </span>
                                    </SampleDataTrigger>
                                  ) : (
                                    <>
                                      <span className="min-w-0 flex-1 truncate">{c.column}</span>
                                      <span
                                        className={cn(
                                          "shrink-0 font-['IBM_Plex_Mono'] text-[10.8px] font-normal leading-[16.2px]",
                                          c.mappedBy.length > 0
                                            ? "text-[#318F5A]"
                                            : "text-[#70757C]/60",
                                        )}
                                      >
                                        {c.type}
                                      </span>
                                    </>
                                  )}
                                  <ConfidenceChip confidence={c.confidence} />
                                  {/* CONNECTION HANDLE — hover-revealed; drag onto a property to connect it
                          here. Columns have no Draggable affordance — they can't be moved. */}
                                  <ConnectionHandle
                                    active={isDropTarget}
                                    onPointerDown={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const container = containerRef.current;
                                      const pos = container
                                        ? {
                                            x:
                                              (e.clientX - container.getBoundingClientRect().left) /
                                              zoom,
                                            y:
                                              (e.clientY - container.getBoundingClientRect().top) /
                                              zoom,
                                          }
                                        : { x: 0, y: 0 };
                                      setDragOrigin({
                                        anchor: "column",
                                        table,
                                        column: c.column,
                                        x1: pos.x,
                                        y1: pos.y,
                                      });
                                      setDragPos(pos);
                                    }}
                                    aria-label={`Drag to connect ${c.column} to a property`}
                                    title="Drag to connect to a property"
                                    className="absolute -left-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/col:opacity-100"
                                  />
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    );
                  })}
                {!collapsedMainIds.has(entity.id) && tableInsertIndex === columnGroups.length && (
                  <DropInsertionPlaceholder variant="card" />
                )}
              </div>
            </div>

            {/* Entity Types dropped directly onto the center column — each gets a full row of its
            own, exactly mirroring the anchor's row above: its own real related entities as
            satellite pills, its own card, and its own primary table's mapped columns. Read-only —
            no drag-in/split/connect affordances of its own, since those only make sense for the
            entity actually in focus — this only surfaces what's already true of that entity's
            real data (matching 8082's MainCluster, where every shown entity gets a full row). */}
            {mainEntities.slice(1).map((other, i) => {
              const nodeId = `main:${other.id}`;
              nodeClickActionsRef.current[nodeId] = (mods) => {
                if (mods.shiftKey || mods.metaKey || mods.ctrlKey) toggleMergeSelected(other.id);
                else setContextItem({ kind: "entity", entity: other });
              };
              const satellites = extraRelatedEntities.get(other.id) ?? [];
              const ownColumnGroups = extraColumnGroups.get(other.id) ?? [];
              const isCollapsed = collapsedMainIds.has(other.id);
              return (
                <div key={other.id} className="contents">
                  {centerInsertIndex === i + 1 && (
                    <div className="relative z-10 flex items-start gap-20">
                      <div
                        style={{ width: NODE_W, marginRight: Math.max(0, relationGapPx - 80) }}
                      />
                      <DropInsertionPlaceholder variant="card" />
                    </div>
                  )}
                  <div className="relative z-10 flex items-start gap-20">
                    {/* Same `relationGapPx` margin as the anchor's own satellite column (not
                      recomputed per row) so every row's card lines up at the same X position
                      regardless of whose relation labels happen to be widest. */}
                    <div
                      className="flex flex-col items-center gap-6 pt-8"
                      style={{ marginRight: Math.max(0, relationGapPx - 80) }}
                    >
                      {isCollapsed && (
                        <p className="w-[120px] text-center text-[10.5px] text-muted-foreground">
                          {satellites.length} related (collapsed)
                        </p>
                      )}
                      {!isCollapsed &&
                        satellites.map((sat) => (
                          <div
                            key={sat.id}
                            ref={(el) => {
                              const key = `${other.id}:${sat.id}`;
                              if (el) extraRelatedRefs.current.set(key, el);
                              else extraRelatedRefs.current.delete(key);
                            }}
                          >
                            <EntityNode
                              entity={sat}
                              scale={1}
                              onClick={() => setContextItem({ kind: "entity", entity: sat })}
                            />
                          </div>
                        ))}
                    </div>

                    <div className="flex flex-col gap-4">
                      <div
                        ref={(el) => {
                          if (el) mainCardRefs.current.set(other.id, el);
                          else mainCardRefs.current.delete(other.id);
                        }}
                        style={nodeTransform(nodeId)}
                        className={cn(
                          "group/entitycard flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 [&>div]:w-full",
                          moveTargetId === other.id
                            ? "shadow-[0_0_0_4px_var(--color-primary)]"
                            : contextItem?.kind === "entity" && contextItem.entity.id === other.id
                              ? "shadow-[0_0_0_2px_#FCFCFC,0_0_0_5px_#61B2FF,0_2px_2px_0_rgba(0,0,0,0.10)]"
                              : "shadow-[0_2px_2px_0_rgba(0,0,0,0.1)]",
                          selectedMergeIds.has(other.id) && "ring-2 ring-primary ring-offset-2",
                        )}
                      >
                        <div className="flex w-full items-center gap-1">
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              startNodeDrag(nodeId, e.clientX, e.clientY);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (e.detail === 0) setContextItem({ kind: "entity", entity: other });
                            }}
                            title={
                              selectedMergeIds.has(other.id)
                                ? "Selected for merge — click to deselect"
                                : "Click for name and description, drag to reposition, or shift-click to select for merge"
                            }
                            className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 truncate rounded-full px-1 pb-1 text-left hover:bg-accent active:cursor-grabbing"
                          >
                            <StatusBadge
                              status={entityStatus(other)}
                              confidence={other.confidence}
                              warningReason={other.warningReason}
                              errorReason={entityErrorReason(other)}
                            />
                            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                              {other.name}
                            </span>
                            <ConfidenceChip confidence={other.confidence} />
                          </button>
                          <DeleteButton
                            onClick={() => handleDeleteEntity(other.id)}
                            aria-label={`Delete ${other.name || "this entity"}`}
                            title="Delete Entity Type"
                            size={13}
                            className="size-5 opacity-0 group-hover/entitycard:opacity-100"
                          />
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMainCollapsed(other.id);
                            }}
                            aria-label={
                              isCollapsed
                                ? `Expand ${other.name || "this entity"}'s row`
                                : `Collapse ${other.name || "this entity"}'s row`
                            }
                            title={isCollapsed ? "Expand row" : "Collapse row"}
                            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                          </button>
                        </div>
                        {!isCollapsed && (
                          <div className="flex w-full items-center justify-between gap-1">
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => toggleOnlyIdentifier(other.id)}
                              aria-pressed={!!onlyIdentifierByEntity[other.id]}
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                                onlyIdentifierByEntity[other.id]
                                  ? "bg-black/[0.08] text-foreground"
                                  : "text-muted-foreground hover:bg-accent",
                              )}
                            >
                              Only Identifier
                            </button>
                            <SortBar
                              sort={propertySortFor(other.id)}
                              onChange={(k) => setPropertySortFor(other.id, k)}
                            />
                          </div>
                        )}
                        {!isCollapsed &&
                          visibleProperties(other.id, other.properties).map((p) => {
                            const isDropTarget =
                              mapDropTarget?.type === "property" &&
                              mapDropTarget.propertyId === p.id;
                            const isSelected = selectedPropertyIdsFor(other.id).has(p.id);
                            const isContextSelected =
                              contextItem?.kind === "property" && contextItem.property.id === p.id;
                            return (
                              <div
                                key={p.id}
                                ref={(el) => {
                                  if (el) propertyRefs.current.set(p.id, el);
                                  else propertyRefs.current.delete(p.id);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (e.shiftKey || e.metaKey || e.ctrlKey)
                                    togglePropertySelected(other.id, p.id);
                                  else
                                    setContextItem({
                                      kind: "property",
                                      entity: other,
                                      property: p,
                                    });
                                }}
                                title="Click for name and description, or shift-click to select for split"
                                className={cn(
                                  "group/prop relative flex cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                                  p.mapping
                                    ? "bg-[#F5F3FF] font-medium text-[#553EB7]"
                                    : "bg-white font-normal text-[#555]",
                                  isSelected && "shadow-[0_0_0_2px_#60a5fa]",
                                  isContextSelected && "shadow-[0_0_0_2px_var(--color-primary)]",
                                  isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                                  movePropertyDrag?.propertyIds.includes(p.id) && "opacity-40",
                                )}
                              >
                                {isIdentifierProperty(p.name) &&
                                  (propertyStatus(p) === "error" ? (
                                    <StatusBadge
                                      status="error"
                                      size={16}
                                      confidence={p.confidence}
                                      errorReason={propertyErrorReason(p)}
                                    />
                                  ) : (
                                    <IdentifierIcon />
                                  ))}
                                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                <ConfidenceChip confidence={p.confidence} />
                                <DeleteButton
                                  onClick={() => handleDeleteProperty(other.id, p.id)}
                                  aria-label={`Delete ${p.name || "this property"}`}
                                  title="Delete Property"
                                  className="opacity-0 group-hover/prop:opacity-100"
                                />
                                {/* DRAGGABLE — moves this Property onto another Entity, or (when
                              part of this row's own selection) the whole selection together —
                              same as the anchor's own properties. */}
                                <DraggableHandle
                                  onPointerDown={(e) => {
                                    if (e.button !== 0) return;
                                    e.stopPropagation();
                                    startMoveProperty(p.id, other.id, e.clientX, e.clientY);
                                  }}
                                  aria-label={`Drag to move ${p.name} to another entity`}
                                  title="Drag to move to another entity"
                                />
                                {/* CONNECTION HANDLE — same property<->column mapping drag as the
                              anchor's own properties. */}
                                <ConnectionHandle
                                  active={isDropTarget}
                                  onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const container = containerRef.current;
                                    const pos = container
                                      ? {
                                          x:
                                            (e.clientX - container.getBoundingClientRect().left) /
                                            zoom,
                                          y:
                                            (e.clientY - container.getBoundingClientRect().top) /
                                            zoom,
                                        }
                                      : { x: 0, y: 0 };
                                    setDragOrigin({
                                      anchor: "property",
                                      propertyId: p.id,
                                      x1: pos.x,
                                      y1: pos.y,
                                    });
                                    setDragPos(pos);
                                  }}
                                  aria-label={`Drag to connect ${p.name} to a column`}
                                  title="Drag to connect to a column"
                                  className="absolute -right-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/prop:opacity-100"
                                />
                              </div>
                            );
                          })}
                        {!isCollapsed && selectedPropertyIdsFor(other.id).size > 0 && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => handleSplit(other.id)}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90"
                            >
                              <Scissors className="size-3.5" /> Split (
                              {selectedPropertyIdsFor(other.id).size})
                            </button>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => handleDeleteSelectedProperties(other.id)}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#f15b15]/25 px-3 py-1.5 text-[11.5px] font-medium text-[#9c461e] transition-colors hover:bg-[#ffe6db]"
                            >
                              <Trash2 className="size-3.5" /> Delete (
                              {selectedPropertyIdsFor(other.id).size})
                            </button>
                          </div>
                        )}
                        {!isCollapsed && (
                          <AddPropertyRow
                            isAdding={addingPropertyEntityId === other.id}
                            onStartAdd={() => setAddingPropertyEntityId(other.id)}
                            onSubmit={(name) => handleCreateProperty(other.id, name)}
                            onCancel={() => setAddingPropertyEntityId(null)}
                          />
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      {isCollapsed && (
                        <p className="w-56 text-center text-[11.5px] text-muted-foreground">
                          {ownColumnGroups.length} table{ownColumnGroups.length === 1 ? "" : "s"}{" "}
                          (collapsed)
                        </p>
                      )}
                      {!isCollapsed &&
                        ownColumnGroups.map(([table, cols]) => {
                          const tableConfidence = tableByName(table)?.confidence;
                          return (
                            <div
                              key={table}
                              className="flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 shadow-[0_2px_2px_0_rgba(0,0,0,0.1)] [&>div]:w-full"
                            >
                              <div className="flex w-full items-center gap-1">
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const schema = tableByName(table);
                                    if (schema) setContextItem({ kind: "table", table: schema });
                                  }}
                                  title="Click for name and description"
                                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-full py-1 text-left hover:bg-accent"
                                >
                                  <MappingStatusBadge
                                    status={tableMappingStatus(table, entities)}
                                    size={20}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                                    {table}
                                  </span>
                                  <ConfidenceChip confidence={tableConfidence} />
                                </button>
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTableCollapsed(table);
                                  }}
                                  aria-label={
                                    collapsedTables.has(table)
                                      ? `Expand ${table}'s row`
                                      : `Collapse ${table}'s row`
                                  }
                                  title={collapsedTables.has(table) ? "Expand row" : "Collapse row"}
                                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                                >
                                  {collapsedTables.has(table) ? (
                                    <ChevronRight className="size-3.5" />
                                  ) : (
                                    <ChevronDown className="size-3.5" />
                                  )}
                                </button>
                              </div>
                              {collapsedTables.has(table) && (
                                <p className="w-full text-center text-[10.5px] text-muted-foreground">
                                  {cols.length} column{cols.length === 1 ? "" : "s"} (collapsed)
                                </p>
                              )}
                              {!collapsedTables.has(table) && (
                                <div className="flex w-full items-center justify-end">
                                  <SortBar
                                    sort={columnSortFor(table)}
                                    onChange={(k) => setColumnSortForTable(table, k)}
                                  />
                                </div>
                              )}
                              {!collapsedTables.has(table) &&
                                visibleColumns(table, cols).map((c) => {
                                  const isDropTarget =
                                    mapDropTarget?.type === "column" &&
                                    mapDropTarget.table === table &&
                                    mapDropTarget.column === c.column;
                                  const schema = tableByName(table);
                                  return (
                                    <div
                                      key={c.column}
                                      ref={(el) => {
                                        const key = `${table}.${c.column}`;
                                        if (el) columnRefs.current.set(key, el);
                                        else columnRefs.current.delete(key);
                                      }}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const col = schema?.columns.find(
                                          (tc) => tc.name === c.column,
                                        );
                                        if (col)
                                          setContextItem({
                                            kind: "column",
                                            tableName: table,
                                            column: col,
                                          });
                                      }}
                                      title="Click for name and description"
                                      className={cn(
                                        "group/col relative flex w-[241.8px] cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] leading-[16.5px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                                        c.mappedBy.length > 0
                                          ? "bg-[#EAF7ED] font-medium text-[#0E6C21]"
                                          : "bg-white font-normal text-[#555]",
                                        isDropTarget && "shadow-[0_0_0_2px_#38bdf8]",
                                      )}
                                    >
                                      {schema ? (
                                        <SampleDataTrigger
                                          table={schema}
                                          columnName={c.column}
                                          className="flex min-w-0 flex-1 items-center gap-1"
                                        >
                                          <span className="min-w-0 flex-1 truncate">
                                            {c.column}
                                          </span>
                                          <span
                                            className={cn(
                                              "shrink-0 font-['IBM_Plex_Mono'] text-[10.8px] font-normal leading-[16.2px]",
                                              c.mappedBy.length > 0
                                                ? "text-[#318F5A]"
                                                : "text-[#70757C]/60",
                                            )}
                                          >
                                            {c.type}
                                          </span>
                                        </SampleDataTrigger>
                                      ) : (
                                        <>
                                          <span className="min-w-0 flex-1 truncate">
                                            {c.column}
                                          </span>
                                          <span
                                            className={cn(
                                              "shrink-0 font-['IBM_Plex_Mono'] text-[10.8px] font-normal leading-[16.2px]",
                                              c.mappedBy.length > 0
                                                ? "text-[#318F5A]"
                                                : "text-[#70757C]/60",
                                            )}
                                          >
                                            {c.type}
                                          </span>
                                        </>
                                      )}
                                      <ConfidenceChip confidence={c.confidence} />
                                      {/* CONNECTION HANDLE — same column<->property mapping drag as
                                  the anchor's own columns. */}
                                      <ConnectionHandle
                                        active={isDropTarget}
                                        onPointerDown={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          const container = containerRef.current;
                                          const pos = container
                                            ? {
                                                x:
                                                  (e.clientX -
                                                    container.getBoundingClientRect().left) /
                                                  zoom,
                                                y:
                                                  (e.clientY -
                                                    container.getBoundingClientRect().top) /
                                                  zoom,
                                              }
                                            : { x: 0, y: 0 };
                                          setDragOrigin({
                                            anchor: "column",
                                            table,
                                            column: c.column,
                                            x1: pos.x,
                                            y1: pos.y,
                                          });
                                          setDragPos(pos);
                                        }}
                                        aria-label={`Drag to connect ${c.column} to a property`}
                                        title="Drag to connect to a property"
                                        className="absolute -left-1.5 top-1/2 z-10 -translate-y-1/2 opacity-0 group-hover/col:opacity-100"
                                      />
                                    </div>
                                  );
                                })}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              );
            })}
            {centerInsertIndex === mainEntities.length && (
              <div className="relative z-10 flex items-start gap-20">
                <div style={{ width: NODE_W, marginRight: Math.max(0, relationGapPx - 80) }} />
                <DropInsertionPlaceholder variant="card" />
              </div>
            )}
          </div>

          {/* floating contextual action surface — same hierarchy for every multi-selection kind
          on this canvas: shift/cmd-click 1+ other main Entity Type cards for [Merge][Delete], or
          1+ Relation badges for [Delete]. Never both at once in practice (they're independent
          selection tracks), but each only ever renders the actions valid for its own kind. */}
          {selectedMergeIds.size > 0 && (
            <div className="absolute left-1/2 top-0 z-30 flex -translate-x-1/2 items-center gap-2">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setMergePanelOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-[var(--shadow-node-lift)] transition-opacity hover:opacity-90"
              >
                <GitMerge className="size-3.5" /> Merge
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleDeleteSelectedEntities}
                className="flex items-center gap-1.5 rounded-full bg-[#ffe6db] px-4 py-2 text-[13px] font-medium text-[#9c461e] shadow-[var(--shadow-node-lift)] transition-opacity hover:opacity-90"
              >
                <Trash2 className="size-3.5" /> Delete ({selectedMergeIds.size + 1})
              </button>
            </div>
          )}
          {selectedRelationIds.size > 0 && (
            <div className="absolute left-1/2 top-0 z-30 flex -translate-x-1/2 items-center gap-2">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleDeleteSelectedRelations}
                className="flex items-center gap-1.5 rounded-full bg-[#ffe6db] px-4 py-2 text-[13px] font-medium text-[#9c461e] shadow-[var(--shadow-node-lift)] transition-opacity hover:opacity-90"
              >
                <Trash2 className="size-3.5" /> Delete ({selectedRelationIds.size})
              </button>
            </div>
          )}
          {mergePanelOpen && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute left-1/2 top-10 z-30 flex w-[320px] -translate-x-1/2 flex-col gap-2.5 rounded-lg border border-node-border bg-node p-3 shadow-[var(--shadow-node-lift)]"
            >
              <div className="flex items-center gap-1.5 text-[12px] font-medium">
                <GitMerge className="size-3.5 text-primary" />
                Merge {selectedMergeIds.size + 1} entities into one
              </div>
              <p className="text-[10.5px] text-muted-foreground">
                All properties from {entity.name}
                {mergeCandidates.map((e) => `, ${e.name || "Untitled"}`).join("")} will be combined.
                Name the resulting entity:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {mergeEntitiesList.map((e) => (
                  <button
                    key={e.id}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => setMergeName(e.name)}
                    className={cn(
                      "rounded-full border px-2 py-1 text-[10.5px] transition-colors",
                      mergeName === e.name
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {e.name || "Untitled"}
                  </button>
                ))}
                {mergeAiSuggestions.map((name) => (
                  <button
                    key={name}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => setMergeName(name)}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-1 text-[10.5px] transition-colors",
                      mergeName === name
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-data/40 bg-data-soft text-data hover:bg-data-soft/70",
                    )}
                  >
                    {name}
                    <span className="text-[8.5px] uppercase tracking-wide opacity-70">AI</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={mergeName}
                  onChange={(e) => setMergeName(e.target.value)}
                  placeholder="Custom name"
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11.5px] outline-none focus:border-primary"
                />
                <button
                  onClick={handleMerge}
                  disabled={!mergeName.trim()}
                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Merge
                </button>
                <button
                  onClick={() => {
                    setMergePanelOpen(false);
                    setMergeName("");
                  }}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
                  aria-label="Cancel merge"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </DetailShell>

      {/* ghost preview following the cursor while dragging a property row (or, when multiple are
        selected, the whole selection) toward a related entity or extra main card — rendered
        outside DetailShell's pan/zoom transform so "fixed" tracks the viewport, not the canvas's
        own coordinate space. A count badge only appears once 2+ properties are actually moving
        together, so a normal single-property drag still just shows its name as before. */}
      {movePropertyDrag && movePropertyPos && (
        <div
          style={{ left: movePropertyPos.x, top: movePropertyPos.y }}
          className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-node-border bg-node px-3 py-1.5 text-[12px] font-medium text-foreground opacity-90 shadow-[var(--shadow-node-lift)]"
        >
          {movePropertyDrag.propertyIds.length > 1 ? (
            <>
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {movePropertyDrag.propertyIds.length}
              </span>
              {movePropertyDrag.propertyIds.length} properties
            </>
          ) : (
            movePropertyDrag.names[0]
          )}
        </div>
      )}

      {/* Move-conflict resolution — appears instead of moving immediately when the drop target
        already has a property whose name collides with one being moved. Nothing has been written
        to the ontology yet at this point: Cancel leaves every entity exactly as it was, and
        Confirm applies exactly the per-property rename/skip choices made here. */}
      {moveConflict && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
        >
          <div className="w-[420px] rounded-2xl border border-node-border bg-node p-4 shadow-[var(--shadow-node-lift)]">
            <p className="text-[13px] font-semibold text-foreground">
              Name conflicts moving into {moveConflict.toEntityName || "Untitled"}
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              These properties already have a same-named property on the destination entity. Rename
              the incoming one or skip moving it — everything else in the selection will still move.
            </p>
            <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
              {moveConflict.items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border px-3 py-2",
                    item.hasConflict ? "border-amber-300 bg-amber-50" : "border-node-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-foreground">
                      {item.originalName}
                    </span>
                    {!item.hasConflict && (
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">
                        No conflict
                      </span>
                    )}
                  </div>
                  {item.hasConflict && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[11.5px] text-foreground">
                        <input
                          type="radio"
                          name={`resolve-${item.id}`}
                          checked={item.resolution === "rename"}
                          onChange={() =>
                            setMoveConflict((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    items: prev.items.map((i) =>
                                      i.id === item.id ? { ...i, resolution: "rename" } : i,
                                    ),
                                  }
                                : prev,
                            )
                          }
                        />
                        Rename to
                      </label>
                      <input
                        type="text"
                        value={item.renamedTo}
                        disabled={item.resolution !== "rename"}
                        onChange={(e) => {
                          const value = e.target.value;
                          setMoveConflict((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  items: prev.items.map((i) =>
                                    i.id === item.id ? { ...i, renamedTo: value } : i,
                                  ),
                                }
                              : prev,
                          );
                        }}
                        className="min-w-0 flex-1 rounded-md border border-node-border bg-background px-2 py-1 text-[11.5px] disabled:opacity-40"
                      />
                      <label className="flex shrink-0 items-center gap-1 text-[11.5px] text-foreground">
                        <input
                          type="radio"
                          name={`resolve-${item.id}`}
                          checked={item.resolution === "skip"}
                          onChange={() =>
                            setMoveConflict((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    items: prev.items.map((i) =>
                                      i.id === item.id ? { ...i, resolution: "skip" } : i,
                                    ),
                                  }
                                : prev,
                            )
                          }
                        />
                        Skip
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelMoveConflict}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMoveConflict}
                disabled={moveConflict.items.some(
                  (i) => i.resolution === "rename" && !i.renamedTo.trim(),
                )}
                className="rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
