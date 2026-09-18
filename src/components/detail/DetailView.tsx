import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  GitMerge,
  Plus,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tableByName,
  tableMappingStatus,
  tableMappingCompleteness,
  entitiesUsingTable,
  tablesUsedByEntity,
  columnSampleValues,
  relationLabel,
  isIdentifierProperty,
  propertyStatus,
  entityStatus,
  entityDisplayStatus,
  entityErrorReason,
  isReviewItemInScope,
  isColumnInScope,
  isTableInScope,
  tableHighestMappingConfidence,
  mappingStatus,
  type Entity,
  type Property,
  type Relation,
  type ReviewStatus,
  type TableColumn,
  type TableSchema,
  type MappingStatus,
} from "@/lib/mock-data";
import {
  orthogonalPath,
  sideBetween,
  edgeAnchorsForRects,
  rightToLeftAnchors,
  NODE_W,
} from "@/lib/geometry";
import type { Side, Rect } from "@/lib/geometry";
import {
  suggestionKey,
  parseSuggestionKey,
  type ConfidenceRange,
  type DetailAnchor,
  type OntologyApp,
  type MorphRect,
  type SuggestionRef,
} from "@/lib/app-state";
import {
  OntologyNode,
  ONTOLOGY_NODE_SIZE,
  ONTOLOGY_NODE_WRAPPER_W,
} from "@/components/overview/OntologyNode";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import { ConnectionHandle } from "@/components/ontology/ConnectionHandle";
import { DraggableHandle } from "@/components/ontology/DraggableHandle";
import { DeleteButton } from "@/components/ontology/DeleteButton";
import {
  StatusBadge,
  statusBorderColor,
  reviewStatusLabel,
} from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import {
  CanvasToolStack,
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
import { CreateEntityWizard } from "@/components/ontology/CreateEntityWizard";
import { DefineRelationDialog } from "@/components/ontology/DefineRelationDialog";
import { SelectionControlBar } from "./SelectionControlBar";
import { AiReviewBar } from "@/components/ontology/AiReviewBar";

/** The anchor card's own sub-element positions, reported once via `onAnchorMorphTarget` — see
 * that prop's own doc comment on `EntityDetailCanvas`. `cardRect` is the whole card's own outer
 * bounds (border included) at the moment of measurement — the card's body is never collapsed
 * (only its opacity is, via `bodyVisible`), so this is already the card's TRUE final size, and
 * the morph overlay's shell grows directly to it in one continuous motion instead of arriving at
 * a smaller "header-only" stop first; the other 4 are where its individual header pieces
 * (icon/name/confidence/chevron) sit within it. */
export type AnchorMorphRects = {
  cardRect: MorphRect;
  headerRect: MorphRect;
  iconRect: MorphRect;
  nameRect: MorphRect;
  confidenceRect: MorphRect;
  chevronRect: MorphRect;
};

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
          onClick={(e) => {
            e.stopPropagation();
            onChange(key);
          }}
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

/** The collapsible group header above a Property list's Mapped or Unmapped section — a mapping-
 * completeness split, not a review-status one (see `EntityDetailCanvas`'s own
 * `isMappedGroupOpen`/`isUnmappedGroupOpen` for that distinction). Purely a display toggle, same
 * "which rows render" concern as `SortBar`/"Only Identifier" above it — collapsing a group never
 * touches the properties themselves. */
function PropertyGroupHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      className="flex w-full shrink-0 items-center gap-1 px-1 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {open ? (
        <ChevronDown className="size-3 shrink-0" />
      ) : (
        <ChevronRight className="size-3 shrink-0" />
      )}
      {label} · {count}
    </button>
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
        onClick={(e) => {
          e.stopPropagation();
          onStartAdd();
        }}
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
      onClick={(e) => e.stopPropagation()}
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
 * an insertion marker, not a preview of the final (usually taller) card. `label` is shown only for
 * the center-column "card" variant, and only while promoting an existing compact related-entity
 * satellite into the workspace (never for a plain toolbox drop, which is dropping something new,
 * not "adding" an already-visible thing) — see the two `centerInsertIndex` render sites below. */
function DropInsertionPlaceholder({
  variant,
  label,
}: {
  variant: "pill" | "card";
  label?: string | undefined;
}) {
  if (variant === "pill") {
    return (
      <div
        className="box-border flex h-[43px] w-[160px] shrink-0 items-center justify-center gap-2 rounded-full border-[1.5px] border-dashed border-[#00DED8] bg-[rgba(0,222,216,0.05)] py-[6px] pl-[6px] pr-[12px]"
        aria-hidden="true"
      >
        <Plus className="size-4 text-[#00DED8]" strokeWidth={2.5} />
      </div>
    );
  }
  return (
    <div
      className="box-border flex h-[47px] w-[268.8px] shrink-0 flex-col items-center justify-center gap-1 rounded-[16px] border-[1.5px] border-dashed border-[#00DED8] bg-[rgba(0,222,216,0.05)] px-[12px] py-[8px]"
      aria-hidden="true"
    >
      <Plus className="size-4 text-[#00DED8]" strokeWidth={2.5} />
      {label && (
        <span className="whitespace-nowrap text-[10.5px] font-medium text-[#00DED8]">{label}</span>
      )}
    </div>
  );
}

/**
 * The SAME placement area as `DropInsertionPlaceholder` above, but for when nothing is currently
 * being dragged — "an Entity Type can go here" either by dropping an existing one (unchanged, see
 * `DropInsertionPlaceholder`) or by clicking this to create a brand-new one. Deliberately near-
 * invisible at rest (`opacity-40`, a plain dashed gray border) so the workspace doesn't read as a
 * grid of empty cards — hovering is what actually reveals the "+ Add Entity Type" affordance.
 * Rendered as `null` (not just hidden) the moment ANY Entity/Table placement drag starts anywhere
 * on this canvas (`suppressed`), since `DropInsertionPlaceholder` itself takes over the exact
 * target slot's visual feedback at that point — the two are mutually exclusive, never stacked. */
function EntityPlacementSlot({
  variant,
  suppressed,
  onCreate,
}: {
  variant: "pill" | "card";
  suppressed: boolean;
  onCreate: () => void;
}) {
  if (suppressed) return null;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onCreate();
      }}
      title="Add a new Entity Type"
      className={cn(
        "group/placement box-border flex shrink-0 items-center justify-center gap-1.5 border-[1.5px] border-dashed border-[#e1e3e6] opacity-40 transition-[opacity,border-color,background-color] hover:border-[#00DED8] hover:bg-[rgba(0,222,216,0.05)] hover:opacity-100",
        variant === "pill"
          ? "h-[43px] w-[160px] rounded-full"
          : "h-[47px] w-[268.8px] flex-col rounded-[16px] px-[12px] py-[8px]",
      )}
    >
      <Plus
        className="size-4 shrink-0 text-[#9a9a9a] transition-colors group-hover/placement:text-[#00DED8]"
        strokeWidth={2.5}
      />
      <span className="hidden whitespace-nowrap text-[10.5px] font-medium text-[#00DED8] group-hover/placement:inline">
        Add Entity Type
      </span>
    </button>
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
  /** `table.column`, set alongside `propertyId`/`ownerEntityId` on every real Property<->Column
   * mapping line — lets a hovered Column row look up its own line(s) the same way a hovered
   * Property row already can via `propertyId`, without re-parsing `id`. */
  columnKey?: string;
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
// own orders don't always match (see the alignment ordering above `visibleProperties`/
// `visibleColumns` use to minimize this up front), so these lines can still cross even after that.
// Every mapping line's endpoints are always a Property's right edge -> a Column's left edge (see
// `rightToLeftAnchors` in geometry.ts — never the adaptive top/bottom anchoring other connectors
// use), so `axis` is always "horizontal" here; smoothing each one into a horizontal S-curve —
// pulling the control points halfway toward the opposite endpoint's X — keeps the whole curve
// inside the horizontal gutter between the two cards (the standard "bipartite fan" treatment, the
// same shape a Sankey diagram uses) rather than dipping into either card's own content, and stays
// legible even with several lines crossing at once. The `curve()` fallback below is defensive only
// — a real Property<->Column line's `axis` is never anything else — kept so a malformed line still
// renders as *something* instead of a broken path string.
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
const RELATION_LABEL_FONT = "500 10.5px 'Geist', ui-sans-serif, system-ui, sans-serif";

// A Column row's own mapping-status color scheme — a Column has no ontology ReviewStatus of its
// own (see mock-data's own `MappingStatus` doc comment), so its dot shows this instead: "Mapped"
// reuses the exact same teal as the ontology "Confirmed" color (via `statusBorderColor` below) —
// both read as "this is done," just on their own separate axis (mapping vs. ontology) — while
// "Suggested" reuses the app's existing AI-suggestion purple, and "None" is a plain neutral gray
// for a Column with no mapping suggestion at all. Property rows never use this palette — a
// Property's own dot always shows its plain ontology ReviewStatus (see each render site's own
// `statusBorderColor(propertyStatus(p))` call) — ontology and mapping lifecycles stay visually
// independent, never conflated on the same dot.
const MAPPING_SUGGESTED_COLOR = "#7c5eff";
const MAPPING_MAPPED_COLOR = statusBorderColor("confirmed");
const MAPPING_NONE_COLOR = "#c1c1c6";

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
  onRemoveEntityFromWorkspace,
  onRemoveTableFromWorkspace,
  onDeleteContextItem,
  onAcceptContextItem,
  onRejectContextItem,
  onAcceptMapping,
  onRejectMapping,
  onDisconnectMapping,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  confidenceRange,
  statusFilter,
  selectionBar,
  aiReviewBar,
  onCanvasPointerDown,
  canvasEntityIds,
  canvasTableNames,
  anchorEntityIds,
  anchorTableNames,
  onClose,
  contextRevealed,
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
  /** "Remove from workspace" surfaced inside the contextual panel, for the currently-shown
   * Entity/Table only (see ContextPanelBody's own doc comments) — a pure view/workspace action,
   * never an ontology mutation. Delete itself no longer surfaces inside this panel at all — it
   * lives only in the contextual selection control now (see `SelectionControlBar`).
   * `onRemoveEntityFromWorkspace` is undefined whenever the current context item isn't a
   * removable Entity (the anchor, or a compact satellite shown only via a real Relation);
   * `onRemoveTableFromWorkspace` is defined whenever the current item is a Data Table, since
   * every table shown here can always be removed from this workspace. */
  onRemoveEntityFromWorkspace?: (() => void) | undefined;
  onRemoveTableFromWorkspace?: (() => void) | undefined;
  /** Single-selection Delete/Accept/Reject for whichever Entity/Property/Relation `contextItem`
   * currently holds — see `ContextPanelBody`'s own doc comment. Already scoped to this exact item
   * by the calling canvas's own `deletableKeys`/`rejectableKeys`/`acceptableKeys` (the same
   * eligibility the contextual selection control uses), so `undefined` here always means genuinely
   * not eligible, never a disabled button. */
  onDeleteContextItem?: (() => void) | undefined;
  onAcceptContextItem?: (() => void) | undefined;
  onRejectContextItem?: (() => void) | undefined;
  /** A mapped Column's own Mapping actions (Disconnect/Accept/Reject) — see `ContextPanelBody`'s
   * own doc comment for why these act on an owning Property rather than `contextItem` itself. */
  onAcceptMapping?: ((entityId: string, propertyId: string) => void) | undefined;
  onRejectMapping?: ((entityId: string, propertyId: string) => void) | undefined;
  onDisconnectMapping?: ((entityId: string, propertyId: string) => void) | undefined;
  /** The canvas controls' own Undo/Redo pill — same app-wide history stack as Overview's. */
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** The Header's Confidence score range — filters which rows the Entity types / Data Tables
   * toolboxes below show, same "pure display filter" treatment as search and sort. */
  confidenceRange: ConfidenceRange;
  /** The Header's Filter — which review statuses show in the Entity types toolbox below (Data
   * Tables has no review status of its own, so this only ever narrows that one list). */
  statusFilter: Set<ReviewStatus>;
  /** The Suggestion selection's own contextual Accept/Decline bar — a fully pre-built element
   * handed down from `EntityDetailCanvas` (which owns `entities`/`relations`/`suggestionSelection`)
   * rather than threaded through as five more separate props here, since this shell is otherwise
   * a pure presentational layout and has no reason to know about the selection workflow itself. */
  selectionBar: React.ReactNode;
  /** The permanent AI Review control (Confidence score, Suggestions in range, Select all in
   * range, Generate Suggestions) — same "fully pre-built element" treatment as `selectionBar`
   * above, and stacked directly beneath it in the same bottom-center floating column. */
  aiReviewBar: React.ReactNode;
  /** Fired on every canvas-background pointerdown (mirrors Overview's own "clear selection
   * eagerly on pointerdown" pattern) — a click on a specific item still wins because that item's
   * own handler runs afterward and stops propagation. */
  onCanvasPointerDown?: () => void;
  /** Every Entity Type / Data Table currently rendered somewhere on the canvas (the anchor, every
   * extra main row, every related satellite, or a table any of those maps into) — the left/right
   * toolbox rows for these get a soft highlight, so "already placed here" reads at a glance
   * against everything still just "available" to drag in. */
  canvasEntityIds: Set<string>;
  canvasTableNames: Set<string>;
  /** The subset of `canvasEntityIds`/`canvasTableNames` that's a MAIN row here — a full anchor or
   * extra-row card, not just a compact satellite pill or a table merely mapped into by one of
   * those cards' own properties — gets a stronger bordered highlight instead of the plain
   * background every other on-canvas item gets. */
  anchorEntityIds: Set<string>;
  anchorTableNames: Set<string>;
  /** Exits back to the Overview canvas — rendered here (floating over the canvas, past the
   * Entity types panel) rather than in the page's own Header, which stays GLOBAL and unchanged
   * across the Overview↔Editing transition; see routes/index.tsx's own doc comment. */
  onClose: () => void;
  /** PHASE 2 of the Overview→Editing morph transition (see `EntityDetailCanvas`'s own doc
   * comment on the state of the same name) — `true` immediately for every normal entry; only
   * ever starts `false` right after a morph-triggered entry, briefly hiding/sliding-out both side
   * panels below until the selected Entity has mostly finished its own morph. */
  contextRevealed: boolean;
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
  // Per-panel local search has been removed in favor of the Header's own Global Search, which
  // covers the exact same Entity Type/Property/Table/Column scope across the whole Ontology + Data
  // model at once — see `GlobalSearchPalette`/app-state's `searchFocus` doc comments for why
  // keeping both would just be two ways to do the same search. Confidence range and Filter still
  // dim (never remove) rows in both lists below — see each row's own `inScope` check.
  const sortedEntityItems = useMemo(
    () =>
      sortByState(
        entityItems,
        entitySort,
        (e) => e.name,
        (e) => e.confidence,
      ),
    [entityItems, entitySort],
  );
  // Tables have no Confidence/ReviewStatus of their own — `isTableInScope`/
  // `tableHighestMappingConfidence` derive both from whichever Property↔Column Mapping(s) touch
  // the table instead (see their own doc comments in mock-data.ts). Same "dim, don't remove"
  // treatment as Entity Types above.
  const sortedTableItems = useMemo(
    () =>
      sortByState(
        tableItems,
        tableSort,
        (t) => t.name,
        (t) => tableHighestMappingConfidence(t.name, entities),
      ),
    [tableItems, tableSort, entities],
  );

  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // The Select/Pan tool switch in the canvas controls bar below — "select" is the default (a
  // background drag does nothing but deselect); switching to "pan" is what lets a background drag
  // move the view instead.
  const [tool, setTool] = useState<CanvasTool>("select");
  useCanvasToolShortcuts(tool, setTool, onUndo, onRedo);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Only the canvas itself is "empty space". Let clicks that bubble from cards, rows, relation
    // badges, and other canvas objects preserve the current selection so a second plain click can
    // extend it into a multi-selection.
    if (e.target === e.currentTarget) onCanvasPointerDown?.();
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
  // Jumps straight to an exact zoom level — the Zoom menu's own presets (see CanvasToolStack's
  // `onSetZoomPercent` doc comment). Like `zoomBy` above, this only ever touches `zoom`, never
  // `pan` — a toolbar preset pick isn't anchored to any particular screen point the way the
  // trackpad/wheel zoom gesture is.
  const setZoomPercent = (pct: number) => setZoom(() => clamp(pct / 100, MIN_Z, MAX_Z));

  // Zoom around an arbitrary screen point (the cursor) instead of `zoomBy`'s implicit "whatever
  // point the transform happens to leave fixed" — needed for the trackpad-pinch/Cmd+wheel gesture
  // below. Unlike Overview's own `zoomAtPoint` (a single `{x,y,z}` state, so one anchor formula
  // covers both translate and scale together), `zoom`/`pan` are two independent states here and
  // this canvas's content div transforms around ITS OWN center (`origin-center`, not top-left —
  // see this component's own `contentRef` doc comment), so the anchor math differs: it measures
  // the content box's current on-screen center directly (`getBoundingClientRect`, the same
  // measure-don't-assume approach `fitToContent` above already relies on) rather than reading it
  // out of state, then re-solves `pan` so the cursor's own screen position stays fixed while
  // `zoom` changes around that measured center. Reads `zoom` directly from render scope (rather
  // than a `setZoom` updater) deliberately — nesting a `setPan` call inside a `setZoom` updater
  // would make that updater impure (a real bug this went through: React double-invokes state
  // updaters in development to catch exactly this, which silently applied the resulting pan shift
  // twice). The cost is that this callback — and the wheel listener below that depends on it — is
  // recreated on every zoom tick, which is cheap for a single native listener.
  const zoomAtPoint = useCallback(
    (cursorX: number, cursorY: number, factor: number) => {
      const canvasEl = canvasRef.current;
      const contentEl = contentRef.current;
      if (!canvasEl || !contentEl) return;
      const canvasRect = canvasEl.getBoundingClientRect();
      const contentRect = contentEl.getBoundingClientRect();
      const centerX = contentRect.left - canvasRect.left + contentRect.width / 2;
      const centerY = contentRect.top - canvasRect.top + contentRect.height / 2;
      const nextZoom = clamp(zoom * factor, MIN_Z, MAX_Z);
      const k = nextZoom / zoom;
      setZoom(() => nextZoom);
      setPan((p) => ({
        x: p.x + (cursorX - centerX) * (1 - k),
        y: p.y + (cursorY - centerY) * (1 - k),
      }));
    },
    [zoom, setZoom, setPan],
  );

  // Trackpad/mouse-wheel pan+zoom — see `OverviewCanvas`'s own identical effect for the full
  // rationale (native non-passive listener for a reliable `preventDefault`; ungated on `tool` to
  // match every other pan/zoom-capable canvas app's convention).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        zoomAtPoint(px, py, factor);
      } else if (e.shiftKey) {
        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        setPan((p) => ({ x: p.x - dx, y: p.y }));
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAtPoint, setPan]);

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
    const sideMargin = 16;
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

        {/* Exits back to Overview — floats over the canvas past the Entity types panel's own
            current width, matching Figma exactly (never a full-width row above the canvas, which
            would leave the rest of that row empty). */}
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ left: (entityPanelOpen ? entityPanelWidth : PANEL_COLLAPSED_W) + 16 }}
          className="absolute top-3 z-20 flex h-9 shrink-0 items-center gap-1 rounded-[4px] border border-border bg-white px-2 text-sm font-medium text-[#161919] transition-colors hover:bg-accent"
        >
          <ArrowLeft className="size-4" /> Back to Ontology view
        </button>

        {/* LEFT — Entity types toolbox: jump the whole Detail view onto a different entity.
            Collapsible: collapsing only hides this navigation rail — it never touches canvas
            content, selection, or the ontology itself. Docked flush to the canvas's own left
            edge (no floating card look) — its own pointerdown never reaches the canvas's pan
            handler. PHASE 2 of the morph transition: while `!contextRevealed`, sits shifted 24px
            further left (partly past the canvas's own clipped edge) and invisible, then slides
            + fades to rest — "enters from outside the workspace," never a flat opacity pop. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: entityPanelOpen ? entityPanelWidth : PANEL_COLLAPSED_W,
            transform: contextRevealed ? "translateX(0)" : "translateX(-24px)",
            opacity: contextRevealed ? 1 : 0,
            pointerEvents: contextRevealed ? "auto" : "none",
            transition:
              "width 150ms ease, transform 230ms cubic-bezier(0.4,0,0.2,1), opacity 230ms ease",
          }}
          className="absolute left-0 top-0 z-20 flex h-full flex-col overflow-hidden border-r border-node-border bg-node"
        >
          {entityPanelOpen && (
            <div
              onPointerDown={startPanelResize("entity")}
              title="Drag to resize"
              aria-hidden="true"
              className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize"
            />
          )}
          <div className="flex shrink-0 items-center gap-1 border-b border-node-border py-3 pl-2 pr-4">
            <button
              type="button"
              onClick={() => setEntityPanelOpen((v) => !v)}
              aria-label={
                entityPanelOpen ? "Collapse Entity types panel" : "Expand Entity types panel"
              }
              title={entityPanelOpen ? "Collapse" : "Expand"}
              className="flex size-6 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent"
            >
              {entityPanelOpen ? (
                <ChevronLeft className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
            {entityPanelOpen && (
              <span className="truncate text-base font-medium text-foreground">Entity types</span>
            )}
          </div>
          {!entityPanelOpen && (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-[11px] font-medium text-muted-foreground [writing-mode:vertical-rl]">
                Entity types
              </span>
            </div>
          )}
          {entityPanelOpen && (
            <div className="flex shrink-0 items-center justify-between px-2.5 pb-1.5 pt-1.5">
              <SortDropdown
                sort={entitySort}
                onChange={(k) => setEntitySort((s) => nextSortState(s, k))}
                showPrefix={false}
              />
            </div>
          )}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto",
              !entityPanelOpen && "hidden",
            )}
          >
            {sortedEntityItems.map((e) => {
              const tableCount = tablesUsedByEntity(e).length;
              // Out of the active Confidence range or excluded by Filter — dimmed, never removed
              // from this list, so the full set of Entity Types is always visible and browsable
              // regardless of review scope.
              const inScope = isReviewItemInScope(
                e.status,
                e.confidence,
                confidenceRange,
                statusFilter,
              );
              const isAnchor = anchorEntityIds.has(e.id);
              return (
                <div key={e.id} className={cn(!inScope && "opacity-40")}>
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
                      "flex w-full shrink-0 items-center gap-2 border-l-[3px] border-transparent py-1 pl-4 pr-3 font-normal text-left transition-colors",
                      isAnchor
                        ? "border-l-[#3b82f6] bg-[#eff6ff]"
                        : canvasEntityIds.has(e.id)
                          ? "bg-[#eff6ff]"
                          : "bg-white hover:bg-muted",
                      tbDrag?.kind === "entity" && tbDrag.id === e.id && "opacity-30",
                    )}
                  >
                    <DraggableHandle
                      title="Drag onto the canvas to place here"
                      aria-label={`Drag ${e.name} onto the canvas`}
                    />
                    <StatusBadge
                      status={entityDisplayStatus(e)}
                      confidence={e.confidence}
                      warningReason={e.warningReason}
                      errorReason={entityErrorReason(e)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                      <span className="block w-full truncate text-sm font-medium leading-6 text-foreground">
                        {e.name}
                      </span>
                      <span className="block w-full truncate text-xs font-normal leading-5 text-muted-foreground">
                        {e.properties.length} props · {tableCount} table
                        {tableCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    {/* Confidence is a fact about a pending AI suggestion, not persistent metadata
                        — once Applied ("confirmed"), only the lifecycle/validation badge above
                        remains. A Warning/Error is still its own not-yet-Applied state, so it
                        keeps showing Confidence same as a plain Suggested item would. */}
                    {e.status !== "confirmed" && <ConfidenceChip confidence={e.confidence} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* BOTTOM — exactly one of three things fixed to the canvas's own bottom edge regardless
            of pan, zoom, or side-panel state: the contextual selection control (2+ objects
            selected — see `selectionBar`'s own doc comment above), the AI Review control (nothing
            selected/inspected) — both centered floating pills, unchanged — or the contextual
            inspection panel (exactly one object selected/clicked), which instead docks flush
            between the two side panels the same flat, borderless-shadow way they dock to the
            canvas's own edges (see the Entity types panel's own doc comment) rather than floating
            as a separate card. "Single selection = inspect, multi-selection = act": never more
            than one of the three at once, so which one a click actually affects is never
            ambiguous. Canvas controls themselves float separately — see
            `CanvasZoomControls`/`CanvasToolStack` below this block. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-x-8 bottom-4 z-30 flex flex-col items-center gap-3"
        >
          {selectionBar ? selectionBar : !contextItem ? aiReviewBar : null}
        </div>
        {!selectionBar && contextItem && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              left: entityPanelOpen ? entityPanelWidth : PANEL_COLLAPSED_W,
              right: tablePanelOpen ? tablePanelWidth : PANEL_COLLAPSED_W,
            }}
            className="absolute bottom-0 z-30 flex max-h-[50vh] items-start gap-2 overflow-hidden border-t border-node-border bg-node p-4"
          >
            <div
              key={contextItemKey(contextItem)}
              className="flex min-w-0 flex-1 shrink-0 flex-col items-start gap-1 self-stretch overflow-y-auto break-words pr-4 [&>p]:w-full"
            >
              <ContextPanelBody
                item={contextItem}
                entities={entities}
                onSwapRelation={onSwapRelation}
                onRenameRelation={onRenameRelation}
                onEditRelationDescription={onEditRelationDescription}
                onRenameEntity={onRenameEntity}
                onEditEntityDescription={onEditEntityDescription}
                onRenameProperty={onRenameProperty}
                onEditPropertyDescription={onEditPropertyDescription}
                onRemoveEntityFromWorkspace={onRemoveEntityFromWorkspace}
                onRemoveTableFromWorkspace={onRemoveTableFromWorkspace}
                onDeleteContextItem={onDeleteContextItem}
                onAcceptContextItem={onAcceptContextItem}
                onRejectContextItem={onRejectContextItem}
                onAcceptMapping={onAcceptMapping}
                onRejectMapping={onRejectMapping}
                onDisconnectMapping={onDisconnectMapping}
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

        {/* The canvas's whole control surface — tool switch, Undo/Redo, and Zoom — as one compact
            horizontal pill at the canvas's own top-right corner (Figma: node 191:53333), matching
            Overview's own toolbar layout/position now that Editing Mode moved to it too — just at
            this canvas's own `compact` (28px-button) sizing. The right Data Tables toolbox is
            docked flush to the canvas's own edge (see its own comment below), so this needs to sit
            past its actual current (open/collapsed, independently resizable) width instead of
            overlapping it. */}
        <CanvasToolStack
          className="absolute top-3 z-20"
          style={{ right: (tablePanelOpen ? tablePanelWidth : PANEL_COLLAPSED_W) + 16 }}
          orientation="horizontal"
          compact
          tool={tool}
          onToolChange={setTool}
          zoomPercent={Math.round(zoom * 100)}
          onZoomOut={() => zoomBy(1 / 1.2)}
          onZoomIn={() => zoomBy(1.2)}
          onFitToContent={fitToContent}
          onSetZoomPercent={setZoomPercent}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
        />

        {/* RIGHT — Data Tables toolbox: jump the whole Detail view onto a different table.
            Collapsible independently of the left panel. Docked flush to the canvas's own right
            edge (no floating card look). PHASE 2 of the morph transition — same slide + fade as
            the Entity types panel above, mirrored (shifted right instead of left). */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: tablePanelOpen ? tablePanelWidth : PANEL_COLLAPSED_W,
            transform: contextRevealed ? "translateX(0)" : "translateX(24px)",
            opacity: contextRevealed ? 1 : 0,
            pointerEvents: contextRevealed ? "auto" : "none",
            transition:
              "width 150ms ease, transform 230ms cubic-bezier(0.4,0,0.2,1), opacity 230ms ease",
          }}
          className="absolute right-0 top-0 z-20 flex h-full flex-col overflow-hidden border-l border-node-border bg-node"
        >
          {tablePanelOpen && (
            <div
              onPointerDown={startPanelResize("table")}
              title="Drag to resize"
              aria-hidden="true"
              className="absolute left-0 top-0 z-10 h-full w-2 cursor-col-resize"
            />
          )}
          <div className="flex shrink-0 items-center gap-1 border-b border-node-border py-3 pl-2 pr-4">
            <button
              type="button"
              onClick={() => setTablePanelOpen((v) => !v)}
              aria-label={
                tablePanelOpen ? "Collapse Data Tables panel" : "Expand Data Tables panel"
              }
              title={tablePanelOpen ? "Collapse" : "Expand"}
              className="flex size-6 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent"
            >
              {tablePanelOpen ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </button>
            {tablePanelOpen && (
              <span className="truncate text-base font-medium text-foreground">Data Tables</span>
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
            <div className="flex shrink-0 items-center justify-between px-2.5 pb-1.5 pt-1.5">
              <SortDropdown
                sort={tableSort}
                onChange={(k) => setTableSort((s) => nextSortState(s, k))}
                showPrefix={false}
              />
            </div>
          )}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto",
              !tablePanelOpen && "hidden",
            )}
          >
            {sortedTableItems.map((t) => {
              const entityCount = entitiesUsingTable(t.name, entities).length;
              // Tables have no Confidence/ReviewStatus of their own — derived from whichever
              // Property↔Column Mapping(s) touch it instead (see `isTableInScope`'s own doc
              // comment). Dims the row, never removes it from this list.
              const inScope = isTableInScope(t.name, entities, confidenceRange, statusFilter);
              const isAnchor = anchorTableNames.has(t.name);
              return (
                <div key={t.name} className={cn(!inScope && "opacity-40")}>
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
                      "flex w-full shrink-0 items-center gap-2 border-l-[3px] border-transparent py-1 pl-4 pr-3 font-normal text-left transition-colors",
                      isAnchor
                        ? "border-l-[#3b82f6] bg-[#eff6ff]"
                        : canvasTableNames.has(t.name)
                          ? "bg-[#eff6ff]"
                          : "bg-white hover:bg-muted",
                      tbDrag?.kind === "table" && tbDrag.id === t.name && "opacity-30",
                    )}
                  >
                    <DraggableHandle
                      title="Drag onto the canvas to place here"
                      aria-label={`Drag ${t.name} onto the canvas`}
                    />
                    <MappingStatusBadge
                      status={tableMappingStatus(t.name, entities)}
                      {...tableMappingCompleteness(t.name, entities)}
                      size={20}
                    />
                    <span className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                      <span className="block w-full truncate text-sm font-medium leading-6 text-foreground">
                        {t.name}
                      </span>
                      <span className="block w-full truncate text-xs font-normal leading-5 text-muted-foreground">
                        {t.columns.length} columns · {entityCount} entit
                        {entityCount === 1 ? "y" : "ies"}
                      </span>
                    </span>
                  </button>
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
  onAnchorMorphTarget,
}: {
  app: OntologyApp;
  anchor: NonNullable<DetailAnchor>;
  /** See `EntityDetailCanvas`'s own doc comment on the same-named prop — threaded straight
   * through, only ever relevant for an entity entry (a Table entry never has a morph origin to
   * report toward, since the morph only ever starts from an Overview node click). */
  onAnchorMorphTarget?: ((rects: AnchorMorphRects) => void) | undefined;
}) {
  const { entities, tables, openDetail, entityMorphOrigin } = app;
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
        isAnchorMorphing={entityMorphOrigin?.entityId === entity.id}
        onAnchorMorphTarget={onAnchorMorphTarget}
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
  isAnchorMorphing,
  onAnchorMorphTarget,
}: {
  app: OntologyApp;
  entity: Entity;
  onFocusEntity: (id: string, focusPropertyId?: string) => void;
  onFocusTable: (name: string, focusColumnName?: string) => void;
  entityItems: Entity[];
  tableItems: TableSchema[];
  /** True for exactly one render pass: this canvas was just entered via the Overview→Editing
   * morph transition (see `EntityMorphOverlay`) and the overlay is still mid-flight toward this
   * exact card. While true, the anchor card's own header is invisible (opacity-0, not
   * unrendered — its layout position still has to be real for `onAnchorMorphTarget` below to
   * measure) and its body sits collapsed to zero height, so the overlay reads as the only visible
   * version of this Entity until it arrives and hands off. */
  isAnchorMorphing?: boolean;
  /** Reports the anchor card's own header sub-element positions once, on mount (after this
   * canvas's own pan/zoom-to-fit has already settled — see `fitToContent`), so the morph overlay
   * above knows exactly where to travel to. Irrelevant, but harmless to still call, when this
   * mount wasn't triggered by a morph at all. */
  onAnchorMorphTarget?: ((rects: AnchorMorphRects) => void) | undefined;
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
    confirmMapping,
    updateRelation,
    createProperty,
    createEntityWithProperties,
    moveProperties,
    splitEntity,
    mergeEntities,
    createRelation,
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
    setConfidenceRange,
    selectSuggestionKeys,
    statusFilter,
    suggestionSelection,
    toggleSuggestionSelected,
    clearSuggestionSelection,
    acceptSuggestions,
    declineSuggestions,
    issueInspection,
    clearIssueInspection,
  } = app;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Entity Types shown as a full main row (name + properties) alongside the anchor's own, not a
  // satellite pill — either dropped directly onto the center card column by hand, or, for a Table
  // entry, every OTHER entity mapped to that entry table (see `initialExtraMainEntityIds`), or
  // promoted from a compact related-satellite pill (see `startNodeDrag`'s own `onUp` handler
  // below). Never fabricates a relationship: if one already exists between the anchor and this
  // entity, that connector is redrawn card-to-card instead of disappearing (see `mainRelatedLines`
  // below) — this is purely an additional, independent card. Declared here (ahead of `related`/
  // `allRelated` just below) since those need `mainEntities`'s ids to dedupe against.
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
  const mainEntityIds = useMemo(() => new Set(mainEntities.map((m) => m.id)), [mainEntities]);

  // The same Entity Type never gets two representations on this canvas at once (a compact
  // satellite pill AND a fully expanded main row) — whichever of the anchor's real Relations or
  // manually-dropped extras would otherwise put an entity in the satellite column is suppressed
  // here the moment that same entity is already a main row (`mainEntityIds`); the Relation itself
  // is untouched and still renders, just card-to-card instead of card-to-satellite (see
  // `mainRelatedLines` below), exactly mirroring `extraRelatedEntities`'s own `mainIds` exclusion
  // for an extra row's satellites.
  const related = useMemo(
    () =>
      relations
        .filter((r) => r.from === entity.id || r.to === entity.id)
        .map((r) => entities.find((e) => e.id === (r.from === entity.id ? r.to : r.from)))
        .filter((e): e is Entity => !!e && !mainEntityIds.has(e.id)),
    [relations, entities, entity.id, mainEntityIds],
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
      .filter((id) => id !== entity.id && !relatedIds.has(id) && !mainEntityIds.has(id))
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
  }, [related, extraEntityIds, relatedIds, mainEntityIds, entity.id, entities, relatedOrder]);

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
  // "Remove from workspace" for a Data Table (see this file's own module-level distinction
  // between removing a workspace representation and an ontology mutation — Data Tables have no
  // Delete action at all, only this) — layered on top of the visibility rule below rather than
  // folded into `extraTableNames`/`visibleTableNames`, since a hidden table can be either one of
  // those underneath (a manually-dropped extra, this Table entry's own initial table, or simply
  // one a visible Entity's own mapping already pulls in) and this needs to override all three
  // uniformly. Bringing a table back in via the toolbox (`onDropTable` below) clears its entry
  // here, exactly mirroring how re-adding it also re-adds it to `extraTableNames`.
  const [hiddenTableNames, setHiddenTableNames] = useState<Set<string>>(() => new Set());
  const tableIsVisible = useCallback(
    (t: string) =>
      (visibleTableNames === null || visibleTableNames.has(t) || extraTableNames.includes(t)) &&
      !hiddenTableNames.has(t),
    [visibleTableNames, extraTableNames, hiddenTableNames],
  );
  // Explicit display order for the Columns area (natural + extra table groups) once a drop has
  // actually positioned one — until then, groups keep their natural order (see columnGroups).
  const [tableOrder, setTableOrder] = useState<string[]>([]);

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
  // Only populated for the anchor's own card, purely to report its header's exact resting
  // sub-element positions back up for the Overview→Editing morph overlay to travel toward (see
  // `onAnchorMorphTarget` below and `EntityMorphOverlay`) — never read for anything else.
  const anchorHeaderRowRef = useRef<HTMLDivElement>(null);
  const anchorIconRef = useRef<HTMLSpanElement>(null);
  const anchorNameRef = useRef<HTMLSpanElement>(null);
  const anchorConfidenceRef = useRef<HTMLSpanElement>(null);
  const anchorChevronRef = useRef<HTMLButtonElement>(null);
  const isMorphing = !!isAnchorMorphing;
  // PHASE 1 (0-~280ms): the card's own body content (Only Identifier, Mapped/Unmapped Properties,
  // Add property) — starts revealed for every normal entry, and for a morph entry starts hidden,
  // then flips visible slightly BEFORE the morph overlay above finishes its own header travel
  // (~60% through it), so the body's fade overlaps the tail of that motion instead of only
  // starting once it's fully done. This is still the SELECTED entity finishing its own morph into
  // "the expanded Editing card" — not yet the surrounding Editing context (see `contextRevealed`
  // below for that). 160ms is ~60% of EntityMorphOverlay's own 280ms duration; not imported
  // directly since that component itself imports a type FROM this file (importing back would be
  // circular) — keep the two in sync by eye if either duration ever changes.
  const [bodyVisible, setBodyVisible] = useState(!isMorphing);
  useEffect(() => {
    if (!isMorphing) {
      setBodyVisible(true);
      return;
    }
    const BODY_REVEAL_DELAY_MS = 160;
    const t = window.setTimeout(() => setBodyVisible(true), BODY_REVEAL_DELAY_MS);
    return () => window.clearTimeout(t);
    // Mount-only: `isAnchorMorphing` only ever matters for the one render pass it starts true on
    // — this whole canvas remounts (a fresh `key`) whenever the anchor itself changes anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // PHASE 2 (~220-450ms): everything that ISN'T the selected Entity itself — its related Entity
  // Types, the Relation connectors to them, its mapped Data Tables/columns, and (in DetailShell)
  // the two side panels — stays hidden until the selected Entity has MOSTLY finished morphing
  // (220ms into its own 280ms motion), then fades/slides in together. Keeps the hierarchy the
  // user actually perceives: "this Entity opened, then its editing environment appeared around
  // it" rather than everything materializing at once at click time. Starts already-revealed for
  // every normal (non-morph) entry, same as `bodyVisible` above.
  const [contextRevealed, setContextRevealed] = useState(!isMorphing);
  useEffect(() => {
    if (!isMorphing) {
      setContextRevealed(true);
      return;
    }
    const CONTEXT_REVEAL_DELAY_MS = 220;
    const t = window.setTimeout(() => setContextRevealed(true), CONTEXT_REVEAL_DELAY_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Runs once, on mount — deliberately AFTER `DetailShell`'s own `fitToContent` `useLayoutEffect`
  // has already settled `zoom`/`pan` (child layout effects commit before a parent's own, and
  // `DetailShell` is rendered by this component as a wrapper around this JSX), so the anchor
  // header is already resting at its final on-screen position the very first time this measures
  // it — never a stale pre-fit position the overlay would otherwise travel to and then jump from.
  useLayoutEffect(() => {
    if (!onAnchorMorphTarget) return;
    const card = propsCardRef.current;
    const header = anchorHeaderRowRef.current;
    const icon = anchorIconRef.current;
    const name = anchorNameRef.current;
    const confidence = anchorConfidenceRef.current;
    const chevron = anchorChevronRef.current;
    if (!card || !header || !icon || !name || !confidence || !chevron) return;
    onAnchorMorphTarget({
      cardRect: card.getBoundingClientRect(),
      headerRect: header.getBoundingClientRect(),
      iconRect: icon.getBoundingClientRect(),
      nameRect: name.getBoundingClientRect(),
      confidenceRect: confidence.getBoundingClientRect(),
      chevronRect: chevron.getBoundingClientRect(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, matching `fitToContent`'s own
  }, []);
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
  const tableCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
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
  type ColGroupEntry = {
    column: string;
    type: string;
    /** NOT the Column's own Confidence — a Column doesn't have one (see `TableSchema`'s own doc
     * comment in mock-data.ts). This is the highest Mapping Confidence among `mappedBy` below,
     * used ONLY to sort/align this column against its mapped Property counterpart — never
     * rendered as a labeled value. `undefined` (sorts/aligns last) when nothing maps into this
     * column yet. */
    mappingConfidenceRank?: number | undefined;
    /** Every property, from any currently-shown main entity, that maps into this one column —
     * usually 0 or 1, but genuinely 2+ when more than one entity's property happens to point at
     * the same column (real, if uncommon, data — two different entities both drawing from one
     * column). A table shared by more than one main entity (see `tableOwner` below) can end up
     * with entries owned by DIFFERENT entities inside the SAME group — that's the whole point:
     * the table only renders once, but every entity that actually maps into it still gets its own
     * correctly-attributed connector, and a column with 2+ mappers draws one connector per mapper
     * rather than silently keeping only one. */
    mappedBy: {
      propertyId: string;
      ownerEntityId: string;
      /** This ONE mapper's own connector state — see mock-data's own `MappingStatus`/`ColumnRef`
       * doc comment. A column with 2+ mappers can have a mix of `"suggested"`/`"mapped"` at once;
       * `columnMappingState` below is what resolves that mix into one dot/count. */
      status: MappingStatus;
    }[];
  };

  // Every table any currently-shown main entity maps into, merged across ALL of them — a table
  // used by two or more main entities (Order and Shipment both mapping into `orders`, say) is
  // still just ONE entry here, with contributions from each entity's own properties, rather than
  // one independent copy per entity. `tableOwner` (below `columnGroups`) decides which single row
  // actually renders each table's card; this is the shared data both that row and every OTHER
  // entity's own connector lines draw from. Computed up here, ahead of the Properties/Columns sort
  // machinery below, since the Property<->Column alignment ordering (`propertyRankForColumns` /
  // `columnRankForProperties`) needs this `mappedBy` data to know which row aligns with which.
  const allColumnGroups = useMemo(() => {
    const byTable = new Map<string, ColGroupEntry[]>();
    // Finds (creating if needed) the one entry for this table.column — never a second, duplicate
    // row for a column that happens to have more than one property mapped into it.
    const entryFor = (table: string, column: string): ColGroupEntry => {
      const list = byTable.get(table) ?? [];
      let entry = list.find((c) => c.column === column);
      if (!entry) {
        const col = tableByName(table)?.columns.find((c) => c.name === column);
        // `mappingConfidenceRank` is filled in below, once every entry's `mappedBy` is complete —
        // a Column has no Confidence of its own at all (see `TableSchema`'s own doc comment in
        // mock-data.ts), so this is derived from whichever Property maps into it, never read off
        // `col` (which carries no such field to read).
        entry = { column, type: col?.type ?? "", mappingConfidenceRank: undefined, mappedBy: [] };
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
          status: mappingStatus(p.mapping),
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
    // Derived rank, now that every entry's `mappedBy` is final — the highest Mapping Confidence
    // among whichever Properties map into this column, or `undefined` (unmapped, or nothing
    // resolvable) — used only to sort/align (`visibleColumns` below), never displayed as a
    // labeled Column confidence (the Column itself has none — see this type's own doc comment).
    byTable.forEach((cols) => {
      cols.forEach((entry) => {
        let max: number | undefined;
        entry.mappedBy.forEach(({ propertyId, ownerEntityId }) => {
          const owner = mainEntities.find((m) => m.id === ownerEntityId);
          const prop = owner?.properties.find((p) => p.id === propertyId);
          if (prop && (max == null || prop.confidence > max)) max = prop.confidence;
        });
        entry.mappingConfidenceRank = max;
      });
    });
    return byTable;
  }, [mainEntities, extraTableNames, tableIsVisible]);

  // The Column row's own dot — the mapping's OWN lifecycle ("Suggested Mapping" vs "Mapped"),
  // never the mapping Property's ontology ReviewStatus (a Column has no review status of its own
  // to borrow — see mock-data's own module-level mapping-state doc). A column with 2+ mappers (see
  // `ColGroupEntry`'s own doc comment) prioritizes "suggested" while ANY pending mapping still
  // needs review, even when another mapping into the same Column is already confirmed. Grouping
  // remains based on whether at least one confirmed mapping exists (see `columnHasMapped` below),
  // so this purple dot is a pending-work signal without moving an already-mapped Column back into
  // the Unmapped section.
  const columnMappingState = useCallback((entry: ColGroupEntry): MappingStatus | null => {
    if (entry.mappedBy.length === 0) return null;
    return entry.mappedBy.some((m) => m.status === "suggested") ? "suggested" : "mapped";
  }, []);
  const columnHasMapped = useCallback(
    (entry: ColGroupEntry) => entry.mappedBy.some((mapping) => mapping.status === "mapped"),
    [],
  );

  // Which side of the Property<->Column mapping the entry point put in charge — set once, from
  // `visibleTableNames` (itself never revisited after mount, see its own comment above), so this
  // never flips mid-session no matter how many entities/tables get dragged in afterward. A Table
  // entry names exactly one anchor table (`initialVisibleTableNames` is always a 1-element list);
  // an Entity entry leaves `visibleTableNames` null, meaning "Properties are the anchor" instead.
  const anchorKind: "entity" | "table" = visibleTableNames ? "table" : "entity";
  const anchorTableName: string | undefined = visibleTableNames
    ? Array.from(visibleTableNames)[0]
    : undefined;

  // Columns list display order, per source table shown here (the anchor's own primary table, an
  // extra main entity's own, or one dropped in directly) — same pure-display, per-key-Record
  // pattern as the Properties sort below, kept separate since a Columns area can show several
  // tables' worth of columns at once and each table's own list sorts independently. Declared
  // ahead of the Properties sort state so a Table entry's `columnRankForProperties` (below) can
  // read this table's own explicit sort before `visibleProperties` needs it.
  const [columnSortByTable, setColumnSortByTable] = useState<Record<string, SortState>>({});
  const [onlyIdentifierByTable, setOnlyIdentifierByTable] = useState<Record<string, boolean>>({});
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
  const columnIsIdentifier = useCallback(
    (entry: ColGroupEntry) =>
      entry.mappedBy.some(({ ownerEntityId, propertyId }) => {
        const owner = mainEntities.find((entity) => entity.id === ownerEntityId);
        const property = owner?.properties.find((candidate) => candidate.id === propertyId);
        return !!property && isIdentifierProperty(property);
      }),
    [mainEntities],
  );
  // Has THIS SPECIFIC table/entity's own sort ever been explicitly changed by the user (clicked
  // Name or Confidence in its `SortBar`)? Distinct from `columnSortFor`/`propertySortFor` above,
  // which always return a value (defaulting to `DEFAULT_SORT`) for the sort control's own display
  // — this instead answers "is the alignment ordering below still free to apply to this one list,
  // or has the user overridden it," by checking for the Record entry itself rather than its value
  // (a value can legitimately come back around to equal `DEFAULT_SORT` after a couple of clicks —
  // see `nextSortState` — so only "was a key ever written" reliably means "the user touched this").
  const hasExplicitColumnSort = useCallback(
    (table: string) => table in columnSortByTable,
    [columnSortByTable],
  );

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
  const hasExplicitPropertySort = useCallback(
    (entityId: string) => entityId in propertySortByEntity,
    [propertySortByEntity],
  );
  const toggleOnlyIdentifier = useCallback(
    (entityId: string) => {
      const next = !onlyIdentifierByEntity[entityId];
      const owner = mainEntities.find((entity) => entity.id === entityId);
      const connectedTables = owner ? tablesUsedByEntity(owner) : [];
      setOnlyIdentifierByEntity((previous) => ({ ...previous, [entityId]: next }));
      setOnlyIdentifierByTable((previous) => {
        const updated = { ...previous };
        connectedTables.forEach((table) => {
          updated[table] = next;
        });
        return updated;
      });
    },
    [onlyIdentifierByEntity, mainEntities],
  );
  const toggleOnlyIdentifierTable = useCallback(
    (table: string) => {
      const next = !onlyIdentifierByTable[table];
      const connectedEntityIds = mainEntities
        .filter((entity) => entity.properties.some((property) => property.mapping?.table === table))
        .map((entity) => entity.id);
      setOnlyIdentifierByTable((previous) => ({ ...previous, [table]: next }));
      setOnlyIdentifierByEntity((previous) => {
        const updated = { ...previous };
        connectedEntityIds.forEach((entityId) => {
          updated[entityId] = next;
        });
        return updated;
      });
    },
    [onlyIdentifierByTable, mainEntities],
  );
  // Each main entity's Properties area splits into two independently collapsible groups — Mapped
  // (has at least one "mapped"/confirmed Property<->Column mapping) and Unmapped (no confirmed
  // mapping — includes both a still-Suggested mapping and no mapping at all; see `mappingStatus`'s
  // own doc comment) — purely a mapping-completeness split, orthogonal to ontology review status:
  // a property can be Mapped+Suggested(review), Mapped+Confirmed(review), Unmapped+Suggested
  // (review), or Unmapped+Confirmed(review) independently (see `propertyStatus` for the one place
  // Error/Warning/Suggested/Confirmed review status is actually decided — completely separate from
  // mapping status). Both groups start open; each entity's
  // own open/closed state persists independently as this Record fills in, same per-entity-Record
  // pattern as sort/collapse above.
  const [propertyGroupOpenByEntity, setPropertyGroupOpenByEntity] = useState<
    Record<string, { mapped?: boolean; unmapped?: boolean }>
  >({});
  const isMappedGroupOpen = useCallback(
    (entityId: string) => propertyGroupOpenByEntity[entityId]?.mapped ?? true,
    [propertyGroupOpenByEntity],
  );
  const isUnmappedGroupOpen = useCallback(
    (entityId: string) => propertyGroupOpenByEntity[entityId]?.unmapped ?? true,
    [propertyGroupOpenByEntity],
  );
  // --- Property<->Column alignment ordering -------------------------------------------------
  // The entry point names ONE side "the anchor" (`anchorKind` above) — that side's own Name /
  // Confidence / Only-Identifier sort, above, is never touched by any of this. The OTHER side's
  // list, as long as the user hasn't explicitly picked its own Name/Confidence sort for that
  // specific entity/table (`hasExplicitPropertySort` / `hasExplicitColumnSort` above), instead
  // renders in whatever order lines its rows up with their mapped counterpart on the anchor side.
  // This is "reduce crossings through layout first": a fresh Detail view starts with as few
  // Property<->Column crossings as the anchor's own ordering allows, without ever reordering the
  // anchor itself — and the moment a user picks an explicit sort for either side, that side's
  // list goes back to obeying it exactly like before this existed.

  // Table-anchor only: EVERY currently-visible table's own Column order (its own Name/Confidence
  // sort, or the default) — not just the anchor table's — turned into one combined `table.column`
  // -> position lookup, built table-by-table in `allColumnGroups`'s own natural (anchor-first)
  // order so every shown entity's Properties can line up against whichever table they're actually
  // mapped into. This is what lets an extra main row's own separate table (one the anchor itself
  // never mapped into) get the exact same crossing-reduction the anchor table already had, instead
  // of always falling to the end unsorted — properties mapped into an EARLIER table in this
  // combined order always sort before properties mapped into a LATER one, so same-table properties
  // still cluster together rather than interleaving by coincidental same-column-index.
  const columnRankForProperties = useMemo(() => {
    if (anchorKind !== "table") return null;
    const rank = new Map<string, number>();
    let i = 0;
    allColumnGroups.forEach((entries, table) => {
      const filtered = onlyIdentifierByTable[table] ? entries.filter(columnIsIdentifier) : entries;
      const ordered = sortByState(
        filtered,
        columnSortFor(table),
        (c) => c.column,
        (c) => c.mappingConfidenceRank,
      );
      ordered.forEach((c) => rank.set(`${table}.${c.column}`, i++));
    });
    return rank;
  }, [anchorKind, allColumnGroups, columnSortFor, onlyIdentifierByTable, columnIsIdentifier]);

  const visibleProperties = useCallback(
    (entityId: string, properties: Property[]) => {
      const filtered = onlyIdentifierByEntity[entityId]
        ? properties.filter((p) => isIdentifierProperty(p))
        : properties;
      if (columnRankForProperties && !hasExplicitPropertySort(entityId)) {
        // Properties align to whichever visible table's Column order they're actually mapped
        // into (any table, not just the anchor's own — see `columnRankForProperties`'s own doc
        // comment); anything not mapped at all (or mapped into a table that isn't shown) has no
        // position to align to, so it falls to the end, alphabetically among itself — it'll
        // typically land in the separate Unmapped group at render time anyway (see
        // `renderProperty`'s own mapped/unmapped split).
        return [...filtered].sort((a, b) => {
          const rankA = a.mapping
            ? (columnRankForProperties.get(`${a.mapping.table}.${a.mapping.column}`) ??
              Number.POSITIVE_INFINITY)
            : Number.POSITIVE_INFINITY;
          const rankB = b.mapping
            ? (columnRankForProperties.get(`${b.mapping.table}.${b.mapping.column}`) ??
              Number.POSITIVE_INFINITY)
            : Number.POSITIVE_INFINITY;
          if (rankA !== rankB) return rankA - rankB;
          return a.name.localeCompare(b.name);
        });
      }
      return sortByState(
        filtered,
        propertySortFor(entityId),
        (p) => p.name,
        (p) => p.confidence,
      );
    },
    [onlyIdentifierByEntity, propertySortFor, columnRankForProperties, hasExplicitPropertySort],
  );

  // Entity-anchor only: a combined rank across every currently-shown main entity's own Property
  // order (each entity's own list already respects ITS OWN Name/Confidence/Only-Identifier state
  // via `visibleProperties` above, concatenated in `mainEntities`' own anchor-first order) — lets
  // every table's Column list line its rows up against whichever Property maps into them, the
  // mirror image of `columnRankForProperties` above.
  const propertyRankForColumns = useMemo(() => {
    if (anchorKind !== "entity") return null;
    const rank = new Map<string, number>();
    let i = 0;
    mainEntities.forEach((m) => {
      visibleProperties(m.id, m.properties).forEach((p) => {
        rank.set(p.id, i++);
      });
    });
    return rank;
  }, [anchorKind, mainEntities, visibleProperties]);

  const visibleColumns = useCallback(
    (table: string, cols: ColGroupEntry[]) => {
      const filtered = onlyIdentifierByTable[table] ? cols.filter(columnIsIdentifier) : cols;
      if (propertyRankForColumns && !hasExplicitColumnSort(table)) {
        // A column aligns to the earliest-ranked Property mapped into it (usually just one; see
        // `ColGroupEntry.mappedBy`'s own note on the rare 2+ case) — anything unmapped has no
        // anchor position, so it falls to the end, alphabetically among itself (and typically
        // lands in the separate Unmapped group at render time regardless).
        return [...filtered].sort((a, b) => {
          const rankA = (a.mappedBy ?? []).reduce(
            (min, m) => Math.min(min, propertyRankForColumns.get(m.propertyId) ?? Infinity),
            Number.POSITIVE_INFINITY,
          );
          const rankB = (b.mappedBy ?? []).reduce(
            (min, m) => Math.min(min, propertyRankForColumns.get(m.propertyId) ?? Infinity),
            Number.POSITIVE_INFINITY,
          );
          if (rankA !== rankB) return rankA - rankB;
          return a.column.localeCompare(b.column);
        });
      }
      return sortByState(
        filtered,
        columnSortFor(table),
        (c) => c.column,
        (c) => c.mappingConfidenceRank,
      );
    },
    [
      propertyRankForColumns,
      hasExplicitColumnSort,
      columnSortFor,
      onlyIdentifierByTable,
      columnIsIdentifier,
    ],
  );

  // --- Unmapped-section ordering ------------------------------------------------------------
  // A parallel, Unmapped-only refinement on top of the crossing-reduction scheme above: the
  // Mapped section already gets good alignment from `columnRankForProperties`/
  // `propertyRankForColumns` (which don't distinguish Mapped from Suggested), but WITHIN the
  // Unmapped section specifically we want a clearer, purpose-built reading order — the Identifier
  // row first (it's usually the very row responsible for this Entity's own Error, so it should
  // never get buried among 30+ other rows), then every row with a Suggested Mapping (grouped
  // together, and aligned with its Column/Property counterpart to minimize connector crossings —
  // same "reduce crossings through layout first" idea as above, just scoped to this one section),
  // then rows with no mapping suggestion at all. Same anchor/non-anchor direction rule as
  // `columnRankForProperties`/`propertyRankForColumns`: only the NON-authoritative side's Suggested
  // rows get a cross-rank to align to; the authoritative side's own Suggested rows sort
  // alphabetically among themselves (there's nothing to align THEM to — the other side follows
  // them, not the reverse). Both rank maps below build from `visibleColumns`/`visibleProperties`
  // themselves, so an explicit Name/Confidence sort on the authoritative side is honored
  // automatically, exactly like it already is for the two rank maps above.
  const suggestedColumnRank = useMemo(() => {
    if (anchorKind !== "table") return null;
    const rank = new Map<string, number>();
    let i = 0;
    allColumnGroups.forEach((entries, table) => {
      visibleColumns(table, entries)
        .filter((c) => columnMappingState(c) === "suggested")
        .forEach((c) => rank.set(`${table}.${c.column}`, i++));
    });
    return rank;
  }, [anchorKind, allColumnGroups, visibleColumns, columnMappingState]);

  const suggestedPropertyRank = useMemo(() => {
    if (anchorKind !== "entity") return null;
    const rank = new Map<string, number>();
    let i = 0;
    mainEntities.forEach((m) => {
      visibleProperties(m.id, m.properties)
        .filter((p) => p.mapping && mappingStatus(p.mapping) === "suggested")
        .forEach((p) => rank.set(p.id, i++));
    });
    return rank;
  }, [anchorKind, mainEntities, visibleProperties]);

  // Re-sorts an already-filtered Unmapped Properties list: Identifier first, then Suggested
  // Mappings (aligned via `suggestedColumnRank` when this side isn't the anchor — see doc comment
  // above), then no-mapping-suggestion rows — each tier alphabetical among itself as the final
  // tie-break, so ordering stays as stable/predictable as possible. Callers skip this entirely
  // (keeping the plain `visibleProperties` order) once the user has picked an explicit
  // Name/Confidence sort for this entity, same override rule as everywhere else in this file.
  const orderUnmappedProperties = useCallback(
    (unmapped: Property[]) =>
      [...unmapped].sort((a, b) => {
        const tierOf = (p: Property) => (isIdentifierProperty(p) ? 0 : p.mapping ? 1 : 2);
        const tierA = tierOf(a);
        const tierB = tierOf(b);
        if (tierA !== tierB) return tierA - tierB;
        if (tierA === 1 && suggestedColumnRank) {
          const rankOf = (p: Property) =>
            p.mapping
              ? (suggestedColumnRank.get(`${p.mapping.table}.${p.mapping.column}`) ??
                Number.POSITIVE_INFINITY)
              : Number.POSITIVE_INFINITY;
          const rankA = rankOf(a);
          const rankB = rankOf(b);
          if (rankA !== rankB) return rankA - rankB;
        }
        return a.name.localeCompare(b.name);
      }),
    [suggestedColumnRank],
  );

  // Mirror of `orderUnmappedProperties`, for a Table card's own Unmapped Columns list.
  const orderUnmappedColumns = useCallback(
    (unmappedCols: ColGroupEntry[]) =>
      [...unmappedCols].sort((a, b) => {
        const tierOf = (c: ColGroupEntry) =>
          c.column.trim().toLowerCase() === "id" ? 0 : c.mappedBy.length > 0 ? 1 : 2;
        const tierA = tierOf(a);
        const tierB = tierOf(b);
        if (tierA !== tierB) return tierA - tierB;
        if (tierA === 1 && suggestedPropertyRank) {
          const rankOf = (c: ColGroupEntry) =>
            c.mappedBy.reduce(
              (min, m) => Math.min(min, suggestedPropertyRank.get(m.propertyId) ?? Infinity),
              Number.POSITIVE_INFINITY,
            );
          const rankA = rankOf(a);
          const rankB = rankOf(b);
          if (rankA !== rankB) return rankA - rankB;
        }
        return a.column.localeCompare(b.column);
      }),
    [suggestedPropertyRank],
  );

  // Mapped/Unmapped Columns grouping, inside a Table card's own Columns area — the exact same
  // mapping-completeness split as `propertyGroupOpenByEntity` above, just keyed per TABLE name
  // instead of per entity, since a Table card (not an Entity one) is what carries these groups.
  // Both groups start open, same as Properties.
  const [columnGroupOpenByTable, setColumnGroupOpenByTable] = useState<
    Record<string, { mapped?: boolean; unmapped?: boolean }>
  >({});
  const isMappedColumnGroupOpen = useCallback(
    (table: string) => columnGroupOpenByTable[table]?.mapped ?? true,
    [columnGroupOpenByTable],
  );
  const isUnmappedColumnGroupOpen = useCallback(
    (table: string) => columnGroupOpenByTable[table]?.unmapped ?? true,
    [columnGroupOpenByTable],
  );

  // A group toggle is shared only across Entity/Table contexts that actually have a mapping
  // between them. Collapsing one Entity hides its rows from the paired Table, but leaves that
  // Table group open when another visible Entity still needs it (and vice versa). Expanding either
  // side reopens every directly paired counterpart. This keeps the behavior bidirectional without
  // turning these per-Entity/per-Table records into one global collapse switch.
  type MappingGroup = "mapped" | "unmapped";
  const propertyBelongsToGroup = useCallback((property: Property, group: MappingGroup) => {
    if (!property.mapping) return false;
    return group === "mapped"
      ? mappingStatus(property.mapping) === "mapped"
      : mappingStatus(property.mapping) === "suggested";
  }, []);
  const connectedTablesForEntity = useCallback(
    (entityId: string, group: MappingGroup) => {
      const owner = mainEntities.find((candidate) => candidate.id === entityId);
      return new Set(
        owner?.properties
          .filter((property) => propertyBelongsToGroup(property, group))
          .map((property) => property.mapping!.table) ?? [],
      );
    },
    [mainEntities, propertyBelongsToGroup],
  );
  const connectedEntitiesForTable = useCallback(
    (table: string, group: MappingGroup) =>
      new Set(
        mainEntities
          .filter((owner) =>
            owner.properties.some(
              (property) =>
                property.mapping?.table === table && propertyBelongsToGroup(property, group),
            ),
          )
          .map((owner) => owner.id),
      ),
    [mainEntities, propertyBelongsToGroup],
  );
  const propertyGroupIsOpen = useCallback(
    (entityId: string, group: MappingGroup) => propertyGroupOpenByEntity[entityId]?.[group] ?? true,
    [propertyGroupOpenByEntity],
  );
  const columnGroupIsOpen = useCallback(
    (table: string, group: MappingGroup) => columnGroupOpenByTable[table]?.[group] ?? true,
    [columnGroupOpenByTable],
  );
  const toggleEntityMappingGroup = useCallback(
    (entityId: string, group: MappingGroup) => {
      const nextOpen = !propertyGroupIsOpen(entityId, group);
      const tables = connectedTablesForEntity(entityId, group);
      setPropertyGroupOpenByEntity((prev) => ({
        ...prev,
        [entityId]: { ...prev[entityId], [group]: nextOpen },
      }));
      if (tables.size === 0) return;
      setColumnGroupOpenByTable((prev) => {
        const next = { ...prev };
        tables.forEach((table) => {
          const otherOpenContext = [...connectedEntitiesForTable(table, group)].some(
            (otherEntityId) =>
              otherEntityId !== entityId && propertyGroupIsOpen(otherEntityId, group),
          );
          if (nextOpen || !otherOpenContext) {
            next[table] = { ...next[table], [group]: nextOpen };
          }
        });
        return next;
      });
    },
    [connectedEntitiesForTable, connectedTablesForEntity, propertyGroupIsOpen],
  );
  const toggleTableMappingGroup = useCallback(
    (table: string, group: MappingGroup) => {
      const nextOpen = !columnGroupIsOpen(table, group);
      const entityIds = connectedEntitiesForTable(table, group);
      setColumnGroupOpenByTable((prev) => ({
        ...prev,
        [table]: { ...prev[table], [group]: nextOpen },
      }));
      if (entityIds.size === 0) return;
      setPropertyGroupOpenByEntity((prev) => {
        const next = { ...prev };
        entityIds.forEach((entityId) => {
          const otherOpenContext = [...connectedTablesForEntity(entityId, group)].some(
            (otherTable) => otherTable !== table && columnGroupIsOpen(otherTable, group),
          );
          if (nextOpen || !otherOpenContext) {
            next[entityId] = { ...next[entityId], [group]: nextOpen };
          }
        });
        return next;
      });
    },
    [columnGroupIsOpen, connectedEntitiesForTable, connectedTablesForEntity],
  );
  const toggleMappedGroupOpen = useCallback(
    (entityId: string) => toggleEntityMappingGroup(entityId, "mapped"),
    [toggleEntityMappingGroup],
  );
  const toggleUnmappedGroupOpen = useCallback(
    (entityId: string) => toggleEntityMappingGroup(entityId, "unmapped"),
    [toggleEntityMappingGroup],
  );
  const toggleMappedColumnGroupOpen = useCallback(
    (table: string) => toggleTableMappingGroup(table, "mapped"),
    [toggleTableMappingGroup],
  );
  const toggleUnmappedColumnGroupOpen = useCallback(
    (table: string) => toggleTableMappingGroup(table, "unmapped"),
    [toggleTableMappingGroup],
  );

  // A Column's own review-scope, for the same dim-not-remove treatment Entities/Properties get —
  // Columns have no Confidence/ReviewStatus of their own, so this is derived from whichever
  // Property↔Column Mapping(s) touch it (an unmapped column has nothing to derive from, so it's
  // always in scope — "no data renders as no opinion", same rule as everywhere else). Looks the
  // mapping Property up against `mainEntities` (rather than calling mock-data's own
  // `isColumnInScope`, which re-scans ALL entities) since a column's `mappedBy` here already names
  // exactly which main entity/property to check.
  const isColEntryInScope = useCallback(
    (col: { mappedBy: { propertyId: string; ownerEntityId: string }[] }) => {
      if (col.mappedBy.length === 0) return true;
      return col.mappedBy.some(({ propertyId, ownerEntityId }) => {
        const owner = mainEntities.find((m) => m.id === ownerEntityId);
        const prop = owner?.properties.find((p) => p.id === propertyId);
        return (
          prop &&
          isReviewItemInScope(propertyStatus(prop), prop.confidence, confidenceRange, statusFilter)
        );
      });
    },
    [mainEntities, confidenceRange, statusFilter],
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

  // Live position of an in-progress satellite-pill drag, ONLY while the dragged pill is currently
  // a compact related-entity satellite (never set for the Properties/Columns card-header drag,
  // which shares this same `nodeDragInfo` mechanism — see the node-drag effect further below,
  // where this is actually set/cleared) — drives the placement-preview
  // (`DropInsertionPlaceholder`) shown below while the pointer sits over the center column, via
  // `centerInsertIndex`, the exact same mechanism `toolboxDragPos` above already drives for a
  // toolbox drag. Declared here (rather than right beside the effect that sets it) so it's in
  // scope for `centerInsertIndex` just below, which needs to react to either drag source.
  const [satelliteDragPos, setSatelliteDragPos] = useState<{ x: number; y: number } | null>(null);

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

  // Where among the extra main rows (`mainEntities.slice(1)`) a center-column drop at this Y
  // would land — shared by the toolbox's own drop handler (`onDropEntity`) and by promoting a
  // related-satellite pill by dragging it into this same column (see the node-drag `onUp` handler
  // below), so both paths insert at the row the user actually hovered over rather than always
  // appending to the end.
  const computeCenterInsertAt = useCallback(
    (clientY: number) => {
      let insertAt = mainEntities.length - 1;
      for (let i = 1; i < mainEntities.length; i++) {
        const el = mainCardRefs.current.get(mainEntities[i]!.id);
        if (!el) continue;
        if (clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) {
          insertAt = i - 1;
          break;
        }
      }
      return insertAt;
    },
    [mainEntities],
  );

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

  /** Mostly read-only display for whatever's dropped into the center column beyond the anchor:
   * real Relations of that entity (never the anchor or another currently-shown main — those
   * already have their own row) as satellite pills, and its own primary table's columns —
   * matching 8082's MainCluster, where every entity shown here (not just the anchor) gets its own
   * full row rather than a bare properties card. No split/connect for these rows, same restriction
   * as the card itself already had — this only adds what's already true of the entity's real data.
   * The one exception is dragging one of THESE satellite pills into the center column, which
   * promotes it exactly the same way as one of the anchor's own (see `satelliteIds`/the node-drag
   * effect below) — the same Entity Type only ever gets one canvas representation, so promotion
   * has to work uniformly no matter whose row a satellite currently sits in. */
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

  // Every entity id currently rendered as a COMPACT satellite pill anywhere on this canvas — the
  // anchor's own (`allRelated`) plus every extra main row's own (`extraRelatedEntities`) — used to
  // recognize a promotable drag regardless of whose row the dragged pill happens to sit in (the
  // same "any Entity Type can be promoted" rule applies uniformly; see the node-drag effect below,
  // which is the only other place this matters).
  const satelliteIds = useMemo(() => {
    const ids = new Set(allRelated.map((e) => e.id));
    extraRelatedEntities.forEach((sats) => sats.forEach((s) => ids.add(s.id)));
    return ids;
  }, [allRelated, extraRelatedEntities]);

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
        const insertAt = computeCenterInsertAt(clientY);
        setExtraMainEntityIds((ids) => {
          const without = ids.filter((x) => x !== id);
          const clamped = Math.min(Math.max(0, insertAt), without.length);
          return [...without.slice(0, clamped), id, ...without.slice(clamped)];
        });
      }
    },
    [entity.id, relatedIds, allRelated, computeCenterInsertAt, ensureMainEntityRelation],
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
      // Re-adding a table that was previously removed from this workspace un-hides it too — the
      // toolbox drag is the one "bring it back" entry point (see `hiddenTableNames`'s own doc
      // comment), whether it got here originally via a mapping, this Table entry's own initial
      // table, or a prior manual drag.
      setHiddenTableNames((names) => {
        if (!names.has(name)) return names;
        const next = new Set(names);
        next.delete(name);
        return next;
      });
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
  // mainEntities (index 0, the anchor's own card, is never a valid insertion point). Two possible
  // live-drag sources feed this: a toolbox item (`toolboxDragPos`, kind "entity") or an existing
  // compact related-entity satellite being promoted (`satelliteDragPos`) — whichever is currently
  // active; both use the identical "which row am I hovering over" math below.
  const centerInsertIndex = useMemo(() => {
    const pos =
      toolboxDragPos && toolboxDragPos.kind === "entity" ? toolboxDragPos : satelliteDragPos;
    if (!pos) return null;
    if (!inCenterColumnBand(pos.x, pos.y)) return null;
    let idx = mainEntities.length;
    for (let i = 1; i < mainEntities.length; i++) {
      const el = mainCardRefs.current.get(mainEntities[i]!.id);
      if (!el) continue;
      if (pos.y < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  }, [toolboxDragPos, satelliteDragPos, mainEntities]);

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
  // Which Property row or Column row the pointer is currently over, if it's a MAPPED one — drives
  // the "hover to isolate" treatment on the Property<->Column mapping lines below: with 15-20+
  // mappings fanning out between two parallel lists, the connectors cross constantly and tracing
  // one by eye alone doesn't scale, so hovering either endpoint highlights just its own line(s)
  // (and the row(s) on the other side) and fades the rest, rather than changing how the lines are
  // routed (which wouldn't reduce the crossings — see the crossing-count note on `mappingCurve`).
  const [hoveredMapEndpoint, setHoveredMapEndpoint] = useState<
    { type: "property"; propertyId: string } | { type: "column"; columnKey: string } | null
  >(null);

  // --- Contextual selection: click an Entity Type / Property / Relation / Column to open the
  // bottom panel with just its Name + Description — everything else about it is already visible
  // on the canvas. Separate from drag/connect (those elements stopPropagation on pointerdown) and
  // separate from the shift-click multi-select used by Split/Merge above. Declared up here (rather
  // than down with the rest of the contextual-panel logic) so the mapping-highlight block right
  // below can use a clicked Property/Column as a HOLD-STILL version of the hover isolation above —
  // see `highlightedMapLines`' own comment. ----------------------------------------------------
  const [contextItem, setContextItem] = useState<ContextItem | null>(() => {
    // A persisted Issues-popover navigation target (see app-state's own `issueInspection` doc
    // comment) takes priority over the two Search-driven hints below — it's what lets clicking a
    // Warning/Error on Overview, then entering Editing Mode by some unrelated path afterward
    // (a toolbox click, double-clicking a node), still land with that exact Entity/Property/
    // Relation selected and its Inspector open. Only consumed here if it actually concerns THIS
    // anchor; anything else falls through to the existing initial-focus hints, exactly as before.
    if (issueInspection) {
      if (issueInspection.kind === "entity" && issueInspection.id === entity.id) {
        return { kind: "entity", entity };
      }
      if (issueInspection.kind === "property" && issueInspection.entityId === entity.id) {
        const p = entity.properties.find((x) => x.id === issueInspection.propertyId);
        if (p) return { kind: "property", entity, property: p };
      }
      if (issueInspection.kind === "relation") {
        const r = relations.find(
          (x) => x.id === issueInspection.id && (x.from === entity.id || x.to === entity.id),
        );
        if (r) return { kind: "relation", relation: r };
      }
    }
    const property = initialFocusPropertyId
      ? entity.properties.find((p) => p.id === initialFocusPropertyId)
      : undefined;
    if (property) return { kind: "property", entity, property };
    const table = initialFocusColumn ? tableByName(initialFocusColumn.table) : undefined;
    const column = table?.columns.find((c) => c.name === initialFocusColumn?.column);
    if (table && column) return { kind: "column", tableName: table.name, column };
    return null;
  });
  // Table-side Suggested Mapping rows participate in the same contextual bulk-action surface as
  // ontology objects, but keep their own selection because accepting a Mapping must only change
  // `mapping.status` — never the owning Property's independent review status.
  const [mappingSelection, setMappingSelection] = useState<Set<string>>(new Set());
  const mappingSelectionKey = useCallback(
    (entityId: string, propertyId: string) => `${entityId}\u0001${propertyId}`,
    [],
  );
  const selectedMappingRefs = useMemo(
    () =>
      Array.from(mappingSelection).flatMap((key) => {
        const [entityId, propertyId] = key.split("\u0001");
        if (!entityId || !propertyId) return [];
        const owner = entities.find((candidate) => candidate.id === entityId);
        const property = owner?.properties.find((candidate) => candidate.id === propertyId);
        return property?.mapping && mappingStatus(property.mapping) === "suggested"
          ? [{ entityId, propertyId }]
          : [];
      }),
    [mappingSelection, entities],
  );
  const toggleColumnMappingSelection = useCallback(
    (
      mappedBy: { propertyId: string; ownerEntityId: string; status: MappingStatus }[],
      shiftKey: boolean,
    ) => {
      const keys = mappedBy
        .filter(({ status }) => status === "suggested")
        .map(({ ownerEntityId, propertyId }) => mappingSelectionKey(ownerEntityId, propertyId));
      if (keys.length === 0) return false;
      if (!shiftKey) {
        clearSuggestionSelection();
        setMappingSelection(new Set(keys));
        setContextItem(null);
        return true;
      }
      setMappingSelection((previous) => {
        const next = new Set(previous);
        const remove = keys.every((key) => next.has(key));
        keys.forEach((key) => (remove ? next.delete(key) : next.add(key)));
        return next;
      });
      setContextItem(null);
      return true;
    },
    [mappingSelectionKey, clearSuggestionSelection],
  );
  // A Split creates its Entity in app state and adds the card to this workspace in the same
  // interaction. Remember that fresh id until the next render can resolve the actual Entity, then
  // open its Inspector immediately so the blank name receives focus and Description is ready.
  const [pendingSplitEntityId, setPendingSplitEntityId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingSplitEntityId) return;
    const splitEntity = entities.find((candidate) => candidate.id === pendingSplitEntityId);
    if (!splitEntity) return;
    setContextItem({ kind: "entity", entity: splitEntity });
    setPendingSplitEntityId(null);
  }, [entities, pendingSplitEntityId]);
  // Hover always wins while it's active (it's the more immediate, transient signal); once the
  // pointer moves off, a clicked-and-still-selected Property or Column (`contextItem`, the same
  // state the bottom Name+Description panel reads) keeps its own mapping's connector highlighted
  // instead of dropping back to the uniform default — "Mapping selection" staying highlighted
  // independent of hover, per the isolate-a-mapping requirement this all exists for.
  const selectedMapEndpoint = useMemo<
    { type: "property"; propertyId: string } | { type: "column"; columnKey: string } | null
  >(() => {
    if (!contextItem) return null;
    if (contextItem.kind === "property" && contextItem.property.mapping)
      return { type: "property", propertyId: contextItem.property.id };
    if (contextItem.kind === "column" && contextItem.column)
      return { type: "column", columnKey: `${contextItem.tableName}.${contextItem.column.name}` };
    return null;
  }, [contextItem]);

  // --- Unified selection: Entities/Properties/Relations all share the one `suggestionSelection`
  // Set (see app-state's own doc comment) — the single-vs-multi rule this whole canvas follows is
  // "single selection = inspect, multi-selection = act" (see the contextual selection control
  // rendered near the bottom of this component): a plain click replaces the current selection,
  // while Shift+Click adds/removes an object from the shared multi-selection. Clicking empty canvas
  // clears everything. `contextItem` is kept in
  // sync here (not derived) so Table/Column selection — which never joins this Set, since Tables/
  // Columns aren't Suggested/Applied ontology objects with anything to Accept/Reject/Merge/Split —
  // can keep setting it directly, unaffected by any of this.
  const refToContextItem = useCallback(
    (ref: SuggestionRef): ContextItem | null => {
      if (ref.kind === "entity") {
        const e = entities.find((x) => x.id === ref.id);
        return e ? { kind: "entity", entity: e } : null;
      }
      if (ref.kind === "relation") {
        const r = relations.find((x) => x.id === ref.id);
        return r ? { kind: "relation", relation: r } : null;
      }
      if (ref.kind !== "property") return null;
      const owner = entities.find((x) => x.id === ref.entityId);
      const p = owner?.properties.find((x) => x.id === ref.propertyId);
      return owner && p ? { kind: "property", entity: owner, property: p } : null;
    },
    [entities, relations],
  );
  const selectOnClick = useCallback(
    (ref: SuggestionRef, mods?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      const key = suggestionKey(ref);
      if (!mods?.shiftKey) {
        selectSuggestionKeys([key]);
        setMappingSelection(new Set());
        setContextItem(refToContextItem(ref));
        return;
      }
      const next = new Set(suggestionSelection);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      toggleSuggestionSelected(ref);
      if (next.size === 1) {
        const onlyRef = parseSuggestionKey(Array.from(next)[0]!);
        setContextItem(onlyRef ? refToContextItem(onlyRef) : null);
      } else if (next.size === 0) {
        setContextItem(null);
      }
      // next.size >= 2: `contextItem` is left exactly as it was — irrelevant while the selection
      // control is what's actually rendered, and it'll be re-synced the moment this drops back to
      // exactly 1 (see above) rather than needing its own separate reconciliation pass.
    },
    [suggestionSelection, toggleSuggestionSelected, selectSuggestionKeys, refToContextItem],
  );
  // The other half of `issueInspection` (see app-state's own doc comment, and this file's own
  // `contextItem` mount initializer above, which seeds FROM it): once seeded, also ring it in the
  // unified selection the same way a normal click would (`contextItem` alone doesn't draw the
  // selected-card ring — `suggestionSelection` does) — runs once, on mount, since after that the
  // user's own clicks are what own this Set. Guarded by a ref rather than an empty dep array so
  // this can still list its real dependencies for lint purposes.
  const ranIssueInspectionSeedRef = useRef(false);
  useEffect(() => {
    if (ranIssueInspectionSeedRef.current) return;
    ranIssueInspectionSeedRef.current = true;
    if (!issueInspection || !contextItem) return;
    const matches =
      (contextItem.kind === "entity" &&
        issueInspection.kind === "entity" &&
        contextItem.entity.id === issueInspection.id) ||
      (contextItem.kind === "property" &&
        issueInspection.kind === "property" &&
        contextItem.property.id === issueInspection.propertyId) ||
      (contextItem.kind === "relation" &&
        issueInspection.kind === "relation" &&
        contextItem.relation.id === issueInspection.id);
    if (!matches) return;
    if (contextItem.kind === "entity") {
      selectSuggestionKeys([suggestionKey({ kind: "entity", id: contextItem.entity.id })]);
    } else if (contextItem.kind === "property") {
      selectSuggestionKeys([
        suggestionKey({
          kind: "property",
          entityId: contextItem.entity.id,
          propertyId: contextItem.property.id,
        }),
      ]);
    } else if (contextItem.kind === "relation") {
      selectSuggestionKeys([suggestionKey({ kind: "relation", id: contextItem.relation.id })]);
    }
  }, [issueInspection, contextItem, selectSuggestionKeys]);
  // Clears the pin the moment it no longer concerns what's actually selected in THIS Editing
  // session — either this anchor Entity isn't what the issue was even about (the user navigated
  // to something unrelated entirely, e.g. via the Entity Types toolbox), or it IS the right
  // anchor but the user has since clicked a different Property/Entity/Relation of their own
  // accord. Overview's own equivalent lives in app-state (it reads global `selection`, not this
  // component's local `contextItem`). Deliberately does nothing while `contextItem` is merely
  // `null` (closed the Inspector, or built a 2+ multi-selection) — closing isn't "selecting
  // another object," so that alone never drops the pin.
  useEffect(() => {
    if (!issueInspection) return;
    const relatesToAnchor =
      (issueInspection.kind === "entity" && issueInspection.id === entity.id) ||
      (issueInspection.kind === "property" && issueInspection.entityId === entity.id) ||
      (issueInspection.kind === "relation" &&
        relations.some(
          (r) => r.id === issueInspection.id && (r.from === entity.id || r.to === entity.id),
        ));
    if (!relatesToAnchor) {
      clearIssueInspection();
      return;
    }
    if (!contextItem) return;
    const stillMatches =
      (contextItem.kind === "entity" &&
        issueInspection.kind === "entity" &&
        contextItem.entity.id === issueInspection.id) ||
      (contextItem.kind === "property" &&
        issueInspection.kind === "property" &&
        contextItem.property.id === issueInspection.propertyId) ||
      (contextItem.kind === "relation" &&
        issueInspection.kind === "relation" &&
        contextItem.relation.id === issueInspection.id);
    if (!stillMatches) clearIssueInspection();
  }, [issueInspection, contextItem, entity.id, relations, clearIssueInspection]);
  // Every currently-selected Entity/Property/Relation, resolved to a real object — the contextual
  // selection control's own composition ("2 Entities · 3 Properties selected") and every action's
  // eligibility check read this instead of re-deriving it themselves.
  const selectedRefs = useMemo(() => {
    const refs: SuggestionRef[] = [];
    suggestionSelection.forEach((key) => {
      const ref = parseSuggestionKey(key);
      if (ref) refs.push(ref);
    });
    return refs;
  }, [suggestionSelection]);
  const selectedEntities = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "entity" }> => r.kind === "entity")
        .map((r) => entities.find((e) => e.id === r.id))
        .filter((e): e is Entity => !!e),
    [selectedRefs, entities],
  );
  const selectedProperties = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "property" }> => r.kind === "property")
        .map((r) => {
          const owner = entities.find((e) => e.id === r.entityId);
          const p = owner?.properties.find((x) => x.id === r.propertyId);
          return owner && p ? { entity: owner, property: p } : null;
        })
        .filter((v): v is { entity: Entity; property: Property } => !!v),
    [selectedRefs, entities],
  );
  const selectedRelations = useMemo(
    () =>
      selectedRefs
        .filter((r): r is Extract<SuggestionRef, { kind: "relation" }> => r.kind === "relation")
        .map((r) => relations.find((x) => x.id === r.id))
        .filter((r): r is Relation => !!r),
    [selectedRefs, relations],
  );
  // --- The contextual selection control's own action eligibility (see SelectionControlBar's own
  // doc comment for the full rule set) — Delete acts on whichever selected objects are already
  // Applied ("confirmed"); Reject/Accept act on whichever are still Suggested, mirroring the same
  // eligibility `declineSuggestions`/`acceptSuggestions` already enforce ontology-wide. Every
  // handler below scopes its own call to exactly that subset's keys, never the whole selection
  // indiscriminately, then clears the selection the same way Accept/Reject already did before this
  // was unified. -------------------------------------------------------------------------------
  const deletableKeys = useMemo(
    () => [
      ...selectedEntities
        .filter((e) => e.status === "confirmed")
        .map((e) => suggestionKey({ kind: "entity", id: e.id })),
      ...selectedProperties
        .filter(({ property }) => property.status === "confirmed")
        .map(({ entity, property }) =>
          suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
        ),
      ...selectedRelations
        .filter((r) => r.status === "confirmed")
        .map((r) => suggestionKey({ kind: "relation", id: r.id })),
    ],
    [selectedEntities, selectedProperties, selectedRelations],
  );
  const rejectableKeys = useMemo(
    () => [
      ...selectedEntities
        .filter((e) => e.status !== "confirmed")
        .map((e) => suggestionKey({ kind: "entity", id: e.id })),
      ...selectedProperties
        .filter(({ property }) => property.status !== "confirmed")
        .map(({ entity, property }) =>
          suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
        ),
      ...selectedRelations
        .filter((r) => r.status !== "confirmed")
        .map((r) => suggestionKey({ kind: "relation", id: r.id })),
    ],
    [selectedEntities, selectedProperties, selectedRelations],
  );
  const acceptableKeys = useMemo(
    () => [
      ...selectedEntities
        .filter((e) => e.status !== "confirmed" && e.status !== "error")
        .map((e) => suggestionKey({ kind: "entity", id: e.id })),
      ...selectedProperties
        .filter(
          ({ entity, property }) =>
            property.status !== "confirmed" &&
            property.status !== "error" &&
            // "Child Applied → Parent must be Applied" (see app-state's own `acceptSuggestions`,
            // the one place this invariant is actually enforced): a lone Property can only be
            // Accepted once its own Entity is already confirmed, or is being accepted right
            // alongside it in this very selection — never on its own while the Entity is still
            // Suggested/Warning, since `acceptSuggestions` would silently drop it anyway. Hiding
            // Accept here instead of showing a button that quietly does nothing when clicked.
            (entity.status === "confirmed" || selectedEntities.some((e) => e.id === entity.id)),
        )
        .map(({ entity, property }) =>
          suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
        ),
      ...selectedRelations
        .filter((r) => r.status !== "confirmed" && r.status !== "error")
        .map((r) => suggestionKey({ kind: "relation", id: r.id })),
    ],
    [selectedEntities, selectedProperties, selectedRelations],
  );
  const handleDeleteSelection = useCallback(() => {
    const entityIds = selectedEntities.filter((e) => e.status === "confirmed").map((e) => e.id);
    const propertyItems = selectedProperties
      .filter(({ property }) => property.status === "confirmed")
      .map(({ entity, property }) => ({ entityId: entity.id, propertyId: property.id }));
    const relationIds = selectedRelations.filter((r) => r.status === "confirmed").map((r) => r.id);
    if (entityIds.length > 0) deleteEntities(entityIds);
    if (propertyItems.length > 0) deleteProperties(propertyItems);
    if (relationIds.length > 0) deleteRelations(relationIds);
    clearSuggestionSelection();
    setContextItem(null);
  }, [
    selectedEntities,
    selectedProperties,
    selectedRelations,
    deleteEntities,
    deleteProperties,
    deleteRelations,
    clearSuggestionSelection,
  ]);
  const handleRejectSelection = useCallback(
    () => declineSuggestions(rejectableKeys),
    [declineSuggestions, rejectableKeys],
  );
  const handleAcceptSelection = useCallback(
    () => acceptSuggestions(acceptableKeys),
    [acceptSuggestions, acceptableKeys],
  );
  const handleAcceptCombinedSelection = useCallback(() => {
    if (acceptableKeys.length > 0) acceptSuggestions(acceptableKeys);
    selectedMappingRefs.forEach(({ entityId, propertyId }) => confirmMapping(entityId, propertyId));
    setMappingSelection(new Set());
  }, [acceptableKeys, acceptSuggestions, selectedMappingRefs, confirmMapping]);
  const handleRejectCombinedSelection = useCallback(() => {
    if (rejectableKeys.length > 0) declineSuggestions(rejectableKeys);
    selectedMappingRefs.forEach(({ entityId, propertyId }) =>
      updateMapping(entityId, propertyId, null),
    );
    setMappingSelection(new Set());
  }, [rejectableKeys, declineSuggestions, selectedMappingRefs, updateMapping]);
  const handleSelectSuggestionsInRange = useCallback(
    (keys: string[]) => {
      const ontologyKeys: string[] = [];
      const mappingKeys = new Set<string>();
      keys.forEach((key) => {
        const ref = parseSuggestionKey(key);
        if (ref?.kind === "mapping") {
          mappingKeys.add(mappingSelectionKey(ref.entityId, ref.propertyId));
        } else {
          ontologyKeys.push(key);
        }
      });
      selectSuggestionKeys(ontologyKeys);
      setMappingSelection(mappingKeys);
    },
    [mappingSelectionKey, selectSuggestionKeys],
  );
  // Split only when every selected Property belongs to the SAME Entity and doing so wouldn't
  // empty that Entity out entirely (the same rule `splitEntity` itself enforces) — mixed-entity
  // Property selections, or ones mixed with a selected Entity/Relation, never offer Split.
  const splitEligibleEntityId = useMemo(() => {
    if (selectedEntities.length > 0 || selectedRelations.length > 0) return null;
    if (selectedProperties.length === 0) return null;
    const entityId = selectedProperties[0]!.entity.id;
    if (selectedProperties.some(({ entity }) => entity.id !== entityId)) return null;
    const owner = selectedProperties[0]!.entity;
    if (selectedProperties.length >= owner.properties.length) return null;
    return entityId;
  }, [selectedEntities, selectedProperties, selectedRelations]);
  const activeMapEndpoint = hoveredMapEndpoint ?? selectedMapEndpoint;
  const highlightedMapLines = useMemo(() => {
    if (!activeMapEndpoint) return null;
    return lines.filter((l) =>
      activeMapEndpoint.type === "property"
        ? l.propertyId === activeMapEndpoint.propertyId
        : l.columnKey === activeMapEndpoint.columnKey,
    );
  }, [lines, activeMapEndpoint]);
  // The row(s) on the FAR side of whichever lines are highlighted above — e.g. hovering (or
  // selecting) a Column lights up every Property row mapped to it, and vice versa — so the trace
  // works from either end.
  const highlightedPropertyIds = useMemo(() => {
    if (!highlightedMapLines) return null;
    return new Set(highlightedMapLines.map((l) => l.propertyId).filter((id): id is string => !!id));
  }, [highlightedMapLines]);
  const highlightedColumnKeys = useMemo(() => {
    if (!highlightedMapLines) return null;
    return new Set(highlightedMapLines.map((l) => l.columnKey).filter((k): k is string => !!k));
  }, [highlightedMapLines]);
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
        setSatelliteDragPos(satelliteIds.has(info.id) ? { x: e.clientX, y: e.clientY } : null);
      }
    };
    const onUp = (e: PointerEvent) => {
      const info = nodeDragInfo.current;
      nodeDragInfo.current = null;
      setSatelliteDragPos(null);
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
      // pulled in for a full row too, not just ones dragged from the toolbox, and regardless of
      // whether it's currently a satellite of the anchor or of some OTHER main row (`satelliteIds`
      // covers both — see its own comment). Lands at whichever row the pointer was actually
      // hovering over (same `computeCenterInsertAt` math the toolbox drop uses), matching the live
      // placement preview the user was just shown. The pill's own nudge offset is cleared on
      // promotion so it snaps back to its normal slot in the satellite column instead of sitting
      // dragged-away next to the new card — it's about to disappear from that column entirely
      // anyway (see `related`/`allRelated`'s own `mainEntityIds` exclusion), so there's no "old
      // position" left to preserve. Promoting to the CENTER column never creates or requires a
      // Relation on its own (see `ensureMainEntityRelation`'s own comment) — this entity is
      // already a satellite here precisely because a real Relation already backs it; that same
      // Relation is what `mainRelatedLines` then draws card-to-card once this entity is a main
      // row instead (now generalized to any pair of main rows, not just anchor<->extra).
      if (satelliteIds.has(info.id) && inCenterColumnBand(e.clientX, e.clientY)) {
        const insertAt = computeCenterInsertAt(e.clientY);
        setExtraMainEntityIds((ids) => {
          const without = ids.filter((x) => x !== info.id);
          const clamped = Math.min(Math.max(0, insertAt), without.length);
          return [...without.slice(0, clamped), info.id, ...without.slice(clamped)];
        });
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
  }, [zoom, satelliteIds, computeCenterInsertAt]);

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
    // A related-satellite's own ref is set on `OntologyNode`'s full outer wrapper (100px wide,
    // fitting the name label below the circle too — see its own doc comment), but a connector
    // should still anchor to just the 44px circle inside it, flush with the wrapper's own top and
    // horizontally centered, exactly like Overview's own math-only `nodeRect` does for its canvas
    // nodes. Recomputed from the same offset constants rather than re-deriving them here.
    const satelliteCircleRect = (el: Element): Rect => {
      const wrapper = rectOf(el);
      return {
        x: wrapper.x + (ONTOLOGY_NODE_WRAPPER_W - ONTOLOGY_NODE_SIZE) / 2,
        y: wrapper.y,
        width: ONTOLOGY_NODE_SIZE,
        height: ONTOLOGY_NODE_SIZE,
      };
    };
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
          if (app.editingIdea === "idea2") {
            const rowVisibleInCard = (row: Element, card: Element | undefined) => {
              if (!card) return true;
              const rowRect = row.getBoundingClientRect();
              const cardRect = card.getBoundingClientRect();
              // Header + section controls remain sticky at the top of the scroll viewport. Treat
              // rows underneath that 58px chrome as hidden so connectors never draw through it.
              const visibleTop = cardRect.top + 58;
              return rowRect.bottom > visibleTop && rowRect.top < cardRect.bottom - 8;
            };
            if (
              !rowVisibleInCard(propEl, mainCardRefs.current.get(ownerEntityId)) ||
              !rowVisibleInCard(colEl, tableCardRefs.current.get(table))
            )
              return;
          }
          // Always the Property's own right edge to the Column's own left edge — never the
          // adaptive `edgeAnchorsForRects` side-picker other connectors use — so a Property<->
          // Column mapping keeps its one semantic direction and never routes vertically through
          // either card's interior, no matter where either card has been dragged (see
          // `rightToLeftAnchors`'s own comment).
          const { p1, p2 } = rightToLeftAnchors(rectOf(propEl), rectOf(colEl), 8);
          next.push({
            id: `pc-${propertyId}-${table}.${c.column}`,
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            propertyId,
            ownerEntityId,
            columnKey: `${table}.${c.column}`,
            axis: "horizontal",
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
        const { p1: satAnchor, p2: cardAnchor } = edgeAnchorsForRects(
          satelliteCircleRect(el),
          cardRect,
          8,
        );
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
        const { p1: satAnchor, p2: cardAnchor } = edgeAnchorsForRects(
          satelliteCircleRect(el),
          mCardRect,
          8,
        );
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

    // Any two main entity cards (anchor<->extra, or extra<->extra) <-> each other, whenever a
    // real Relation connects them directly — the same "same Entity Type only ever gets one
    // representation" rule that keeps a promoted entity out of the satellite column (see
    // `related`/`allRelated`'s own `mainEntityIds` exclusion above) means a Relation between two
    // main rows must always be drawn card-to-card here rather than card-to-satellite; not just
    // for the anchor, since either end of a Relation can independently be promoted. Same
    // arrow-direction logic as the satellite lines above (drawn from the relation's actual `from`
    // to its actual `to`), with the adaptive side letting this reroute to left/right instead of
    // the usual top/bottom once either card has been dragged elsewhere.
    const nextMainRelated: (Line & { relationId: string })[] = [];
    for (let i = 0; i < mainEntities.length; i++) {
      const m = mainEntities[i]!;
      const mEl = mainCardRefs.current.get(m.id);
      if (!mEl) continue;
      for (let j = i + 1; j < mainEntities.length; j++) {
        const n = mainEntities[j]!;
        const nEl = mainCardRefs.current.get(n.id);
        if (!nEl) continue;
        const relation = relations.find(
          (r) => (r.from === m.id && r.to === n.id) || (r.from === n.id && r.to === m.id),
        );
        if (!relation) continue;
        const { p1: a, p2: b } = edgeAnchorsForRects(rectOf(mEl), rectOf(nEl), 8);
        const mIsTo = relation.to === m.id;
        const [p1, p2] = mIsTo ? [b, a] : [a, b];
        nextMainRelated.push({
          id: `mrel-${m.id}:${n.id}`,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          relationId: relation.id,
        });
      }
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
    app.editingIdea,
    // Collapsing a Mapped Properties/Mapped Columns group unmounts the rows inside it (and, for a
    // Column whose every mapper just went hidden, the Column row itself — see `mappedCols`'s own
    // filter above) — without these two in the deps, `computeLines` wouldn't rerun on that toggle
    // and the connector would keep rendering at its last-known position, pointing at nothing.
    propertyGroupOpenByEntity,
    columnGroupOpenByTable,
  ]);

  const cardScrollFrameRef = useRef<number | null>(null);
  const handleScrollableCardScroll = useCallback(() => {
    if (app.editingIdea !== "idea2" || cardScrollFrameRef.current !== null) return;
    cardScrollFrameRef.current = requestAnimationFrame(() => {
      cardScrollFrameRef.current = null;
      computeLines();
    });
  }, [app.editingIdea, computeLines]);
  useEffect(
    () => () => {
      if (cardScrollFrameRef.current !== null) cancelAnimationFrame(cardScrollFrameRef.current);
    },
    [],
  );

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
            // A drag-to-connect is the user's OWN direct action, not an AI proposal — it starts
            // "mapped" immediately, never as a Suggested Mapping needing a separate Accept.
            updateMapping(ownerId, origin.propertyId, {
              table: target.table,
              column: target.column,
              status: "mapped",
            });
          }
        } else if (origin.anchor === "column" && target.type === "property") {
          const ownerId = mainEntities.find((m) =>
            m.properties.some((p) => p.id === target.propertyId),
          )?.id;
          if (ownerId) {
            // Same reasoning as the Property→Column drag above — a direct user action, mapped
            // immediately.
            updateMapping(ownerId, target.propertyId, {
              table: origin.table,
              column: origin.column,
              status: "mapped",
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

  // --- Split-selection is now just a per-entity read of the one unified `suggestionSelection`
  // (see this component's own doc comment above `refToContextItem`) — `startMoveProperty` still
  // reads it to know whether grabbing a *selected* property's handle should drag the whole
  // selection together, same as before this was unified. -------------------------------------
  const selectedPropertyIdsFor = useCallback(
    (entityId: string) => {
      const ids = new Set<string>();
      suggestionSelection.forEach((key) => {
        const ref = parseSuggestionKey(key);
        if (ref?.kind === "property" && ref.entityId === entityId) ids.add(ref.propertyId);
      });
      return ids;
    },
    [suggestionSelection],
  );
  const togglePropertySelected = useCallback(
    (entityId: string, propertyId: string) =>
      toggleSuggestionSelected({ kind: "property", entityId, propertyId }),
    [toggleSuggestionSelected],
  );
  const clearPropertySelection = useCallback(
    (entityId: string) => {
      selectSuggestionKeys(
        Array.from(suggestionSelection).filter((key) => {
          const ref = parseSuggestionKey(key);
          return !(ref?.kind === "property" && ref.entityId === entityId);
        }),
      );
    },
    [suggestionSelection, selectSuggestionKeys],
  );
  // Splitting stays on this same Detail canvas — the new entity is added right into
  // `extraMainEntityIds`, positioned immediately after whichever main row it split off from, so
  // it renders as a new row directly below that one (matching 8082's MainCluster behavior) rather
  // than navigating Detail away to the new entity by itself.
  const handleSplit = (entityId: string) => {
    const newId = splitEntity(entityId, Array.from(selectedPropertyIdsFor(entityId)));
    clearPropertySelection(entityId);
    if (!newId) return;
    setPendingSplitEntityId(newId);
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
      if (hit) {
        setRelationDialogRequest({ sourceId: entityConnectDrag.sourceId, targetId: hit });
      } else {
        // `findRelatedAt` excludes the drag's own source — but a self-relation is explicitly
        // allowed, so a drop that lands back on the source's own element still opens the dialog,
        // just with both ends the same entity.
        const sourceEl = relatedRefs.current.get(entityConnectDrag.sourceId);
        const r = sourceEl?.getBoundingClientRect();
        const droppedOnSource =
          r &&
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom;
        if (droppedOnSource) {
          setRelationDialogRequest({
            sourceId: entityConnectDrag.sourceId,
            targetId: entityConnectDrag.sourceId,
          });
        }
      }
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
  }, [entityConnectDrag, toContainerPos]);

  // The "Define Relation" dialog's own request state — the same one Overview uses (see
  // `OverviewCanvas`'s own doc comment on `relationDialogRequest`), triggered here by
  // `entityConnectDrag`'s own pointer-up handler just above instead.
  const [relationDialogRequest, setRelationDialogRequest] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const relationDialogSource = relationDialogRequest
    ? (entities.find((e) => e.id === relationDialogRequest.sourceId) ?? null)
    : null;
  const relationDialogTarget = relationDialogRequest
    ? (entities.find((e) => e.id === relationDialogRequest.targetId) ?? null)
    : null;
  const handleRelationDialogCancel = useCallback(() => setRelationDialogRequest(null), []);
  const handleRelationDialogCreate = useCallback(
    ({ name, direction }: { name: string; direction: "fromSource" | "toSource" }) => {
      if (!relationDialogRequest) return;
      const fromId =
        direction === "fromSource"
          ? relationDialogRequest.sourceId
          : relationDialogRequest.targetId;
      const toId =
        direction === "fromSource"
          ? relationDialogRequest.targetId
          : relationDialogRequest.sourceId;
      createRelation(fromId, toId, name);
      setRelationDialogRequest(null);
    },
    [relationDialogRequest, createRelation],
  );

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
  // jumps to it. `selectedMergeIds` is now just "every selected Entity" (a read of the one unified
  // `suggestionSelection`, same as `selectedPropertyIdsFor` above) — `mergeCandidates` below is
  // what actually excludes the anchor from merge *candidacy* specifically (`mainEntities.slice(1)`),
  // so the anchor can still be selected (e.g. for Delete) without that making it its own merge
  // candidate. ---------------------------------------------------------------------------
  const selectedMergeIds = useMemo(() => {
    const ids = new Set<string>();
    suggestionSelection.forEach((key) => {
      const ref = parseSuggestionKey(key);
      if (ref?.kind === "entity") ids.add(ref.id);
    });
    return ids;
  }, [suggestionSelection]);

  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeName, setMergeName] = useState("");
  // Merge now acts on EXACTLY the selected Entities (`selectedEntities`, the unified selection's
  // own entity subset) — never force-including the anchor the way this used to. If the anchor
  // isn't part of the selection, merging leaves it untouched and this view simply navigates away
  // to the newly created entity once `handleMerge` below finishes.
  const mergeCandidates = selectedEntities;
  // The name-suggestion source for the Merge panel below (each one's own current name is offered
  // as a one-click option, alongside a couple of AI-suggested combinations of all of them).
  const mergeEntitiesList = mergeCandidates;
  const mergeAiSuggestions = useMemo(() => {
    if (mergeEntitiesList.length < 2) return [];
    const names = mergeEntitiesList.map((e) => e.name || "Entity");
    const joined = names.join(" ");
    const camel = names.join("");
    return Array.from(new Set([joined, camel].filter((s) => s.trim().length > 0)));
  }, [mergeEntitiesList]);

  // --- Relation multi-select: shift/cmd-click 1+ Relation badges to select them for the same
  // contextual selection control as Entities/Properties — the only action available for a
  // Relation selection is Delete/Accept/Reject (relations can't be merged or split). Also just a
  // read of the one unified `suggestionSelection` now, same as `selectedMergeIds` above. ---
  const selectedRelationIds = useMemo(() => {
    const ids = new Set<string>();
    suggestionSelection.forEach((key) => {
      const ref = parseSuggestionKey(key);
      if (ref?.kind === "relation") ids.add(ref.id);
    });
    return ids;
  }, [suggestionSelection]);
  const singleSelectedEntityId =
    suggestionSelection.size === 1 && selectedEntities.length === 1
      ? selectedEntities[0]!.id
      : null;
  const relationIsHighlighted = useCallback(
    (relation: Relation | null | undefined) =>
      !!relation &&
      (selectedRelationIds.has(relation.id) ||
        (!!singleSelectedEntityId &&
          (relation.from === singleSelectedEntityId || relation.to === singleSelectedEntityId))),
    [selectedRelationIds, singleSelectedEntityId],
  );
  const handleMerge = () => {
    if (!mergeName.trim()) return;
    const ids = mergeCandidates.map((e) => e.id);
    const newId = mergeEntities(ids, mergeName.trim());
    clearSuggestionSelection();
    setMergePanelOpen(false);
    setMergeName("");
    if (newId) onFocusEntity(newId);
  };

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

  // Per-item Delete no longer surfaces anywhere in this canvas's own UI — see
  // `handleDeleteSelection` (near `selectedRefs` above) and `SelectionControlBar`, which is the
  // only place Delete lives now, for a selection of any size.

  // "Remove from workspace" — a workspace/view action, never an ontology mutation (see this
  // file's own module-level distinction between the two): offered for an Entity currently shown
  // as an EXTRA main row (`extraMainEntityIds`) or a manually-added satellite (`extraEntityIds`),
  // AND for the anchor itself — removing the very Entity this whole Editing session is centered
  // on has nothing left to "fall back" to, so it closes the session instead (same as "Back to
  // Ontology view"), rather than being hidden as if there were nothing to do. Never offered for a
  // compact satellite shown only because a real Relation connects it to something visible, since
  // there's nothing manually "placed" there to undo. Filtering both lists unconditionally is
  // harmless: an id only ever lives in one of them at a time (and never the anchor's own id,
  // which is never added to either). If the removed Entity still has a real Relation to something
  // visible, it reappears as a compact related-satellite entirely on its own — `related`/
  // `allRelated` above already exclude anything in `mainEntityIds`, so no extra step is needed
  // here to make that happen.
  const removeEntityFromWorkspace = useCallback(
    (entityId: string) => {
      if (entityId === entity.id) {
        app.closeDetail();
        return;
      }
      setExtraMainEntityIds((ids) => ids.filter((id) => id !== entityId));
      setExtraEntityIds((ids) => ids.filter((id) => id !== entityId));
      setContextItem((cur) => (cur?.kind === "entity" && cur.entity.id === entityId ? null : cur));
    },
    [entity.id, app],
  );
  const removableWorkspaceEntityId =
    contextItem?.kind === "entity" &&
    (contextItem.entity.id === entity.id ||
      extraMainEntityIds.includes(contextItem.entity.id) ||
      extraEntityIds.includes(contextItem.entity.id))
      ? contextItem.entity.id
      : null;

  // Same idea for a Data Table — unlike Entities, every table shown here can always be removed
  // (there's no "anchor table" concept to protect; see `hiddenTableNames`'s own doc comment).
  const removeTableFromWorkspace = useCallback((tableName: string) => {
    setHiddenTableNames((names) => {
      if (names.has(tableName)) return names;
      const next = new Set(names);
      next.add(tableName);
      return next;
    });
    setContextItem((cur) => (cur?.kind === "table" && cur.table.name === tableName ? null : cur));
  }, []);
  const removableWorkspaceTableName = contextItem?.kind === "table" ? contextItem.table.name : null;

  // The canvas-first Entity creation flow (see `CreateEntityWizard`'s own doc comment) reused
  // here from Ontology Overview — same wizard, same atomic `createEntityWithProperties` call.
  // `source` carries the relation context when creation was started from an Entity's own
  // satellite-column placement slot (see the anchor's own render site below); `null` for the
  // center column's own slot, which has no clear relation context (dropping an EXISTING Entity
  // there doesn't fabricate one either — see `onDropEntity`'s own doc comment). Any active
  // Entity/Table placement drag suppresses these slots entirely rather than competing with
  // `DropInsertionPlaceholder`'s own drop-target feedback — see `EntityPlacementSlot`'s own doc
  // comment.
  const [creationRequest, setCreationRequest] = useState<{ source: Entity | null } | null>(null);
  const isPlacementDragActive = toolboxDragPos !== null || satelliteDragPos !== null;
  const handleCreationCancel = useCallback(() => setCreationRequest(null), []);
  const handleCreationSubmit = useCallback(
    (draft: {
      name: string;
      properties: { name: string; type: string; isIdentifier?: boolean }[];
      relationName: string;
      direction: "fromSource" | "toSource";
    }) => {
      if (!creationRequest) return;
      // No Overview position math needed here — a brand-new Entity created from within Editing
      // Mode has no canvas home yet on Overview either, same as the panel-based creation
      // `createEntity`'s own doc comment already covers (the user places it there by hand later,
      // via drag); what actually matters for THIS workspace is `extraMainEntityIds` below.
      const newId = createEntityWithProperties({
        name: draft.name,
        position: { x: 0, y: 0 },
        properties: draft.properties,
        connection: creationRequest.source
          ? {
              sourceEntityId: creationRequest.source.id,
              relationName: draft.relationName,
              direction: draft.direction,
            }
          : undefined,
      });
      // Shows up as a fully expanded main-row card (properties and all), never a compact
      // satellite — the user just finished configuring it in detail, so collapsing it back down
      // to a pill would hide the very thing they came here to see.
      setExtraMainEntityIds((ids) => (ids.includes(newId) ? ids : [...ids, newId]));
      setCreationRequest(null);
    },
    [creationRequest, createEntityWithProperties],
  );

  nodeClickActionsRef.current["anchor"] = (mods) =>
    selectOnClick({ kind: "entity", id: entity.id }, mods);

  // Every Entity Type currently rendered somewhere on this canvas (main rows + related
  // satellites) — see DetailShell's own `canvasEntityIds` doc comment.
  const canvasEntityIds = useMemo(
    () => new Set([...mainEntities.map((e) => e.id), ...allRelated.map((e) => e.id)]),
    [mainEntities, allRelated],
  );

  // The subset of `canvasEntityIds`/`canvasTableNames` that's actually a MAIN row on this
  // canvas — a full anchor/extra-row card, not just a compact satellite pill or a merely-mapped-
  // into table — so the toolbox panels can give these a stronger (bordered) highlight than the
  // plain background every other on-canvas item gets. `mainEntityIds` already is exactly this
  // for entities; the table equivalent is whichever table this view was itself entered on
  // (`anchorTableName`, only set when `anchorKind === "table"`) plus any table manually promoted
  // to its own extra card (`extraTableNames`) — a table merely mapped into by a main entity's own
  // property (e.g. `usedTableNames`) is NOT main by itself, it's still just a reference.
  const anchorTableNames = useMemo(() => {
    const set = new Set(extraTableNames);
    if (anchorKind === "table" && anchorTableName) set.add(anchorTableName);
    return set;
  }, [extraTableNames, anchorKind, anchorTableName]);

  // The AI Review bar's own "N suggestions"/Confidence breakdown is scoped to whatever's actually
  // on THIS Detail canvas right now (the same `canvasEntityIds`/`usedTableNames` the toolbox
  // panels already use for their own "already placed here" highlight) rather than the whole
  // ontology — Overview's own AiReviewBar stays global (it receives the full `entities`/
  // `relations`/`tables` directly), since "what's on screen" there already means "everything."
  // Relations only count once BOTH endpoints are actually shown, matching how a relation line
  // itself only ever renders card-to-card/card-to-satellite when both sides are present.
  const scopedEntities = useMemo(
    () => entities.filter((e) => canvasEntityIds.has(e.id)),
    [entities, canvasEntityIds],
  );
  const scopedRelations = useMemo(
    () => relations.filter((r) => canvasEntityIds.has(r.from) && canvasEntityIds.has(r.to)),
    [relations, canvasEntityIds],
  );
  const scopedTables = useMemo(
    () => tableItems.filter((t) => usedTableNames.has(t.name)),
    [tableItems, usedTableNames],
  );

  return (
    <>
      <DetailShell
        onClose={app.closeDetail}
        contextRevealed={contextRevealed}
        canvasEntityIds={canvasEntityIds}
        anchorEntityIds={mainEntityIds}
        canvasTableNames={usedTableNames}
        anchorTableNames={anchorTableNames}
        entityItems={entityItems}
        onFocusEntity={onFocusEntity}
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
        onRemoveEntityFromWorkspace={
          removableWorkspaceEntityId
            ? () => removeEntityFromWorkspace(removableWorkspaceEntityId)
            : undefined
        }
        onRemoveTableFromWorkspace={
          removableWorkspaceTableName
            ? () => removeTableFromWorkspace(removableWorkspaceTableName)
            : undefined
        }
        // Single selection = inspect + act: the exact same eligible-subset handlers the contextual
        // selection control uses (see `deletableKeys`/`rejectableKeys`/`acceptableKeys` above)
        // already read correctly for a 1-item selection, since `contextItem` and
        // `suggestionSelection` stay in sync at that size — no separate single-item logic needed.
        onDeleteContextItem={deletableKeys.length > 0 ? handleDeleteSelection : undefined}
        onAcceptContextItem={acceptableKeys.length > 0 ? handleAcceptSelection : undefined}
        onRejectContextItem={rejectableKeys.length > 0 ? handleRejectSelection : undefined}
        // Accepting/rejecting a mapping SUGGESTION is a mapping-lifecycle action (Suggested →
        // Mapped, or Suggested → gone), not an ontology-lifecycle one — it must never touch the
        // Property's own review status (`acceptSuggestions`/`declineSuggestions`, used elsewhere
        // for Entity/Property/Relation review actions, don't apply here). See `confirmMapping`'s
        // own doc comment in app-state.ts.
        onAcceptMapping={(entityId, propertyId) => confirmMapping(entityId, propertyId)}
        onRejectMapping={(entityId, propertyId) => updateMapping(entityId, propertyId, null)}
        onDisconnectMapping={(entityId, propertyId) => updateMapping(entityId, propertyId, null)}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        confidenceRange={confidenceRange}
        statusFilter={statusFilter}
        // Single selection = inspect (the contextItem panel below, unchanged); 2+ = act — this is
        // the only case that renders anything here at all now, replacing the several independent
        // floating bars (Merge/Delete, Split/Delete, Relation-delete, Accept/Reject) this canvas
        // used to show. `null` here (not this element) is what tells `DetailShell` to fall back to
        // `aiReviewBar`/the inspection panel instead — see its own render.
        selectionBar={
          suggestionSelection.size + selectedMappingRefs.length >= 2 ? (
            <>
              {mergePanelOpen && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex w-[320px] flex-col gap-2.5 rounded-lg border border-node-border bg-node p-3 shadow-[var(--shadow-node-lift)]"
                >
                  <div className="flex items-center gap-1.5 text-[12px] font-medium">
                    <GitMerge className="size-3.5 text-primary" />
                    Merge {mergeCandidates.length} entities into one
                  </div>
                  <p className="text-[10.5px] text-muted-foreground">
                    All properties from{" "}
                    {mergeCandidates.map((e) => e.name || "Untitled").join(", ")} will be combined.
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
              <SelectionControlBar
                entities={selectedEntities}
                properties={selectedProperties}
                relations={selectedRelations}
                mappingCount={selectedMappingRefs.length}
                onClear={() => {
                  clearSuggestionSelection();
                  setMappingSelection(new Set());
                  setContextItem(null);
                }}
                onMerge={selectedEntities.length >= 2 ? () => setMergePanelOpen(true) : undefined}
                onSplit={
                  splitEligibleEntityId ? () => handleSplit(splitEligibleEntityId) : undefined
                }
                onDelete={deletableKeys.length > 0 ? handleDeleteSelection : undefined}
                deleteCount={deletableKeys.length}
                onAccept={
                  acceptableKeys.length + selectedMappingRefs.length > 0
                    ? handleAcceptCombinedSelection
                    : undefined
                }
                acceptCount={acceptableKeys.length + selectedMappingRefs.length}
                onReject={
                  rejectableKeys.length + selectedMappingRefs.length > 0
                    ? handleRejectCombinedSelection
                    : undefined
                }
                rejectCount={rejectableKeys.length + selectedMappingRefs.length}
              />
            </>
          ) : null
        }
        aiReviewBar={
          <AiReviewBar
            entities={scopedEntities}
            relations={scopedRelations}
            tables={scopedTables}
            confidenceRange={confidenceRange}
            onConfidenceRangeChange={setConfidenceRange}
            onSelectSuggestionsInRange={handleSelectSuggestionsInRange}
          />
        }
        onDragMove={onToolboxDragMove}
        onDragEnd={onToolboxDragEnd}
        zoom={zoom}
        setZoom={setZoom}
        pan={pan}
        setPan={setPan}
        contextItem={contextItem}
        // Both close the currently-open inspector — and, since a single-selection inspector is
        // now just a size-1 read of the one unified `suggestionSelection` (see `selectOnClick`'s
        // own doc comment), clearing that selection too is what keeps `contextItem` from
        // silently re-deriving itself right back open on the next render.
        onCloseContext={() => {
          clearSuggestionSelection();
          setContextItem(null);
        }}
        onCanvasPointerDown={() => {
          clearSuggestionSelection();
          setMappingSelection(new Set());
          setContextItem(null);
        }}
      >
        <div
          ref={containerRef}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            clearSuggestionSelection();
            setMappingSelection(new Set());
            setContextItem(null);
          }}
          className="relative flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-10 whitespace-nowrap"
        >
          {/* PHASE 2 of the morph transition: every connector line here (Relation lines to related
              satellites, Property<->Column mapping lines into the tables area below) stays
              invisible until `contextRevealed` — both the satellites column and the tables area
              they connect are ALSO hidden until then (see their own comments below), so hiding
              this together with them is a plain, un-noticed opacity fade, never a line rendering
              with nothing (yet) at one of its own ends. Already in its final, correct positions
              throughout — only its opacity animates, never its geometry. */}
          <svg
            className="pointer-events-none absolute inset-0 z-20 overflow-visible transition-opacity duration-[230ms] ease-out"
            style={{ opacity: contextRevealed ? 1 : 0 }}
          >
            <defs>
              {/* Arrowhead for relation lines only — points at the relation's actual `to` side
                  (see computeLines), never a fixed screen direction. Property<->Column mapping
                  lines below intentionally have no marker. */}
              <marker
                id="relation-arrow"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth={7}
                markerHeight={7}
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  d="M2,1.5 L8.5,5 L2,8.5"
                  fill="none"
                  className="stroke-zinc-400"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
              <marker
                id="relation-arrow-selected"
                viewBox="0 0 10 10"
                refX="8.5"
                refY="5"
                markerWidth={7}
                markerHeight={7}
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  d="M2,1.5 L8.5,5 L2,8.5"
                  fill="none"
                  className="stroke-[#3b82f6]"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
            {relatedLines.map((l) => {
              const otherId = l.id.slice(4);
              const relation = relationForEntityId.get(otherId);
              // A Relation's own review-scope uses ITS OWN status/confidence (Relations →
              // Relation suggestion confidence), same `isReviewItemInScope` predicate every other
              // object type uses — dims the connector, never removes it, so the graph's shape
              // stays intact outside the active review scope.
              const dimmed = relation
                ? !isReviewItemInScope(
                    relation.status,
                    relation.confidence,
                    confidenceRange,
                    statusFilter,
                  )
                : false;
              const isHighlighted = relationIsHighlighted(relation);
              return (
                <path
                  key={l.id}
                  d={curve(l)}
                  fill="none"
                  strokeLinecap="round"
                  className={isHighlighted ? "stroke-[#3b82f6]" : "stroke-zinc-400"}
                  strokeWidth={isHighlighted ? 2 : 1.6}
                  opacity={dimmed ? 0.25 : 0.7}
                  markerEnd={
                    relation
                      ? isHighlighted
                        ? "url(#relation-arrow-selected)"
                        : "url(#relation-arrow)"
                      : undefined
                  }
                />
              );
            })}
            {lines.map((l) => {
              // A Property↔Column Mapping has no independent status/confidence of its own — it IS
              // the owning Property (see app-state's own note on this) — so the connector dims
              // exactly when that Property does.
              const owner = mainEntities.find((m) => m.id === l.ownerEntityId);
              const prop = owner?.properties.find((p) => p.id === l.propertyId);
              const dimmed = prop
                ? !isReviewItemInScope(
                    propertyStatus(prop),
                    prop.confidence,
                    confidenceRange,
                    statusFilter,
                  )
                : false;
              // The connector's own Suggested/Mapped lifecycle (see mock-data's own `MappingStatus`
              // doc comment) — independent of `dimmed` above, which is about the owning Property's
              // ontology review scope, not the mapping's own confirmation state.
              const isSuggested = !!prop?.mapping && mappingStatus(prop.mapping) === "suggested";
              // "Highlighted" covers BOTH a live hover and a clicked-and-still-selected Property/
              // Column (`selectedMapEndpoint`) — see `activeMapEndpoint`'s own comment. Selection
              // alone (no live hover) renders a touch less bold than an active hover, so the two
              // states stay visually distinguishable while both clearly read as "traced".
              const isHighlighted = !!highlightedMapLines?.includes(l);
              const isFaded = !!activeMapEndpoint && !isHighlighted;
              const isLiveHover = !!hoveredMapEndpoint;
              return (
                <g key={l.id}>
                  <path
                    d={mappingCurve(l)}
                    fill="none"
                    strokeLinecap="round"
                    className={isHighlighted ? "stroke-[#3b82f6]" : "stroke-zinc-400"}
                    style={
                      !isHighlighted && isSuggested
                        ? { stroke: MAPPING_SUGGESTED_COLOR }
                        : undefined
                    }
                    strokeWidth={isHighlighted ? (isLiveHover ? 2.2 : 1.9) : 1.2}
                    // A still-Suggested Mapping reads as provisional — a dashed line, same low
                    // resting opacity as everything else — never overwhelming even with 15-20+ of
                    // them on screen at once; hovering/selecting still takes over completely (solid
                    // blue), same as an already-Mapped connector.
                    strokeDasharray={!isHighlighted && isSuggested ? "4 3" : undefined}
                    // Default state is deliberately low-emphasis (a fainter, thinner line than
                    // before) — with 15-20+ mappings on screen, no connector should read as
                    // dominant until the user actually hovers or selects one; the real "let me
                    // trace this" experience is the hover/selection states above, not the resting
                    // one. See the "reduce visual noise" requirement this all satisfies.
                    opacity={isHighlighted ? 1 : isFaded ? 0.08 : dimmed ? 0.2 : 0.45}
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
                    onMouseEnter={() => {
                      setHoveredMappingLineId(l.id);
                      if (l.propertyId)
                        setHoveredMapEndpoint({ type: "property", propertyId: l.propertyId });
                    }}
                    onMouseLeave={() => {
                      setHoveredMappingLineId((cur) => (cur === l.id ? null : cur));
                      setHoveredMapEndpoint((cur) =>
                        cur?.type === "property" && cur.propertyId === l.propertyId ? null : cur,
                      );
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!l.columnKey || !l.ownerEntityId || !l.propertyId) return;
                      const separator = l.columnKey.indexOf(".");
                      const tableName = l.columnKey.slice(0, separator);
                      const columnName = l.columnKey.slice(separator + 1);
                      const column = tableByName(tableName)?.columns.find(
                        (candidate) => candidate.name === columnName,
                      );
                      if (!column) return;
                      clearSuggestionSelection();
                      setMappingSelection(new Set());
                      setContextItem({
                        kind: "column",
                        tableName,
                        column,
                        mappingEntityId: l.ownerEntityId,
                        mappingPropertyId: l.propertyId,
                      });
                    }}
                  />
                </g>
              );
            })}
            {extraRelatedLines.map((l) => {
              const relation = l.relationId ? relations.find((r) => r.id === l.relationId) : null;
              const dimmed = relation
                ? !isReviewItemInScope(
                    relation.status,
                    relation.confidence,
                    confidenceRange,
                    statusFilter,
                  )
                : false;
              const isHighlighted = relationIsHighlighted(relation);
              return (
                <path
                  key={l.id}
                  d={curve(l)}
                  fill="none"
                  strokeLinecap="round"
                  className={isHighlighted ? "stroke-[#3b82f6]" : "stroke-zinc-400"}
                  strokeWidth={isHighlighted ? 2 : 1.6}
                  opacity={dimmed ? 0.25 : 0.7}
                  markerEnd={
                    l.relationId
                      ? isHighlighted
                        ? "url(#relation-arrow-selected)"
                        : "url(#relation-arrow)"
                      : undefined
                  }
                />
              );
            })}
            {mainRelatedLines.map((l) => {
              const relation = relations.find((r) => r.id === l.relationId);
              const dimmed = relation
                ? !isReviewItemInScope(
                    relation.status,
                    relation.confidence,
                    confidenceRange,
                    statusFilter,
                  )
                : false;
              const isHighlighted = relationIsHighlighted(relation);
              return (
                <path
                  key={l.id}
                  d={curve(l)}
                  fill="none"
                  strokeLinecap="round"
                  className={isHighlighted ? "stroke-[#3b82f6]" : "stroke-zinc-400"}
                  strokeWidth={isHighlighted ? 2 : 1.6}
                  opacity={dimmed ? 0.25 : 0.7}
                  markerEnd={
                    isHighlighted ? "url(#relation-arrow-selected)" : "url(#relation-arrow)"
                  }
                />
              );
            })}
            {dragOrigin && dragPos && (
              <path
                d={`M ${dragOrigin.x1} ${dragOrigin.y1} L ${dragPos.x} ${dragPos.y}`}
                fill="none"
                stroke="#00ded8"
                strokeWidth={2}
                strokeDasharray="4 3"
                opacity={0.9}
              />
            )}
            {entityConnectDrag && entityConnectPos && (
              <path
                d={`M ${entityConnectDrag.origin.x} ${entityConnectDrag.origin.y} L ${entityConnectPos.x} ${entityConnectPos.y}`}
                fill="none"
                stroke="#00ded8"
                strokeWidth={2}
                strokeDasharray="4 3"
                opacity={0.9}
              />
            )}
          </svg>

          {/* Hover controls act on this exact Property↔Column edge. Suggested edges get independent
            Accept/Reject actions; confirmed edges keep the existing Disconnect action. */}
          {lines.map((l) => {
            if (hoveredMappingLineId !== l.id || !l.propertyId || !l.ownerEntityId) return null;
            const mid = { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
            const propertyId = l.propertyId;
            const ownerEntityId = l.ownerEntityId;
            const property = entities
              .find((candidate) => candidate.id === ownerEntityId)
              ?.properties.find((candidate) => candidate.id === propertyId);
            const isSuggested =
              !!property?.mapping && mappingStatus(property.mapping) === "suggested";
            if (isSuggested) {
              return (
                <div
                  key={l.id}
                  style={{ left: mid.x, top: mid.y }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseEnter={() => setHoveredMappingLineId(l.id)}
                  onMouseLeave={() => setHoveredMappingLineId(null)}
                  className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-[#d8d0ff] bg-white p-0.5 shadow-sm"
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmMapping(ownerEntityId, propertyId);
                      setHoveredMappingLineId(null);
                    }}
                    aria-label="Accept this suggested mapping"
                    title="Accept suggested mapping"
                    className="flex size-4 items-center justify-center rounded-full text-[#008f89] hover:bg-[#e2f8f6]"
                  >
                    <Check className="size-3" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      updateMapping(ownerEntityId, propertyId, null);
                      setHoveredMappingLineId(null);
                    }}
                    aria-label="Reject this suggested mapping"
                    title="Reject suggested mapping"
                    className="flex size-4 items-center justify-center rounded-full text-[#dc2626] hover:bg-[#fee2e2]"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            }
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
            const isRelSelected = selectedRelationIds.has(relation.id);
            return (
              <div
                key={relation.id}
                style={{ left: mid.x, top: mid.y }}
                className="group/relbadge absolute z-20 -translate-x-1/2 -translate-y-1/2"
              >
                <button
                  type="button"
                  style={{
                    borderColor: isRelSelected ? "#3b82f6" : statusBorderColor(relation.status),
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectOnClick({ kind: "relation", id: relation.id }, e);
                  }}
                  title={
                    isRelSelected
                      ? "Selected for delete — click to deselect"
                      : `${relationLabel(relation)} — click for name and description, or shift-click to select for delete`
                  }
                  className={cn(
                    "inline-flex items-center justify-center gap-1 rounded-full border-[1.5px] bg-white py-1 pl-1 pr-2 shadow-[0_2.281px_1.14px_0_rgba(0,0,0,0.1)]",
                    // Blue is the one selection color — single- and multi-selected Relations
                    // both read `isRelSelected` (a plain read of the unified selection).
                    isRelSelected && "shadow-[0_0_0_2px_#3b82f6]",
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
            const isRelSelected = selectedRelationIds.has(relation.id);
            return (
              <div
                key={relation.id}
                style={{ left: mid.x, top: mid.y }}
                className="group/relbadge absolute z-20 -translate-x-1/2 -translate-y-1/2"
              >
                <button
                  type="button"
                  style={{
                    borderColor: isRelSelected ? "#3b82f6" : statusBorderColor(relation.status),
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectOnClick({ kind: "relation", id: relation.id }, e);
                  }}
                  title={
                    isRelSelected
                      ? "Selected for delete — click to deselect"
                      : `${relationLabel(relation)} — click for name and description, or shift-click to select for delete`
                  }
                  className={cn(
                    "inline-flex items-center justify-center gap-1 rounded-full border-[1.5px] bg-white py-1 pl-1 pr-2 shadow-[0_2.281px_1.14px_0_rgba(0,0,0,0.1)]",
                    // Blue is the one selection color — single- and multi-selected Relations
                    // both read `isRelSelected` (a plain read of the unified selection).
                    isRelSelected && "shadow-[0_0_0_2px_#3b82f6]",
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
            const isRelSelected = selectedRelationIds.has(relation.id);
            return (
              <div
                key={relation.id}
                style={{ left: mid.x, top: mid.y }}
                className="group/relbadge absolute z-20 -translate-x-1/2 -translate-y-1/2"
              >
                <button
                  type="button"
                  style={{
                    borderColor: isRelSelected ? "#3b82f6" : statusBorderColor(relation.status),
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectOnClick({ kind: "relation", id: relation.id }, e);
                  }}
                  title={
                    isRelSelected
                      ? "Selected for delete — click to deselect"
                      : `${relationLabel(relation)} — click for name and description, or shift-click to select for delete`
                  }
                  className={cn(
                    "inline-flex items-center justify-center gap-1 rounded-full border-[1.5px] bg-white py-1 pl-1 pr-2 shadow-[0_2.281px_1.14px_0_rgba(0,0,0,0.1)]",
                    // Blue is the one selection color — single- and multi-selected Relations
                    // both read `isRelSelected` (a plain read of the unified selection).
                    isRelSelected && "shadow-[0_0_0_2px_#3b82f6]",
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
                className={cn(
                  "grid grid-cols-2 grid-flow-col items-center gap-x-8 gap-y-6 pt-8 transition-opacity duration-[230ms] ease-out",
                  // PHASE 2 of the morph transition: the related Entity Types stay hidden until
                  // the selected Entity has mostly finished its own morph, then fade in — already
                  // at their final positions, only their opacity ever animates here.
                  !contextRevealed && "pointer-events-none opacity-0",
                )}
                // The base gap-20 (80px) above already covers the card<->Columns-area pair; this
                // adds only whatever extra room the widest relation label actually needs beyond
                // that, so the satellites<->card gap grows independently of the other one.
                // `minWidth` reserves two real satellite-pill widths plus the grid's own gap-x-8
                // even when nothing is rendered inside it (collapsed, or genuinely no related
                // entities) — every extra Entity dropped into the center column reuses this same
                // value for its own satellite column (see `mainEntities.slice(1)` below), so no
                // row's card ever sits closer to its satellites than any other row's.
                // `grid-flow-col` + an explicit row count fills the grid column-major (all of the
                // left column top-to-bottom, then the right column) instead of the CSS Grid
                // default row-major/interleaved order — every satellite's connector line still
                // targets the same shared card edge, so keeping each column internally contiguous
                // (rather than alternating left/right down the list) noticeably cuts down on lines
                // crossing over the OTHER column to get there.
                style={{
                  marginRight: Math.max(0, relationGapPx - 80),
                  minWidth: NODE_W * 2 + 32,
                  gridTemplateRows: `repeat(${Math.max(1, Math.ceil(allRelated.length / 2))}, auto)`,
                }}
              >
                {collapsedMainIds.has(entity.id) && (
                  <p className="col-span-2 text-center text-[10.5px] text-muted-foreground">
                    {allRelated.length} related (collapsed)
                  </p>
                )}
                {!collapsedMainIds.has(entity.id) &&
                  allRelated.length === 0 &&
                  relatedInsertIndex === null && (
                    <p className="col-span-2 text-center text-[10.5px] text-muted-foreground">
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
                    nodeClickActionsRef.current[other.id] = (mods) =>
                      selectOnClick({ kind: "entity", id: other.id }, mods);
                    return (
                      <div key={other.id} className="contents">
                        {relatedInsertIndex === i && <DropInsertionPlaceholder variant="pill" />}
                        <div
                          ref={(el) => {
                            if (el) relatedRefs.current.set(other.id, el);
                            else relatedRefs.current.delete(other.id);
                          }}
                          style={nodeTransform(other.id)}
                          className={cn(
                            "flex flex-col items-center",
                            !isReviewItemInScope(
                              entityStatus(other),
                              other.confidence,
                              confidenceRange,
                              statusFilter,
                            ) && "opacity-40",
                          )}
                          title="Click for name and description, drag to reposition, or drop a dragged property here to move it"
                        >
                          <OntologyNode
                            entity={other}
                            detailed={zoom > 1}
                            emphasis={selectedMergeIds.has(other.id) ? "active" : "normal"}
                            moveTarget={moveTargetId === other.id}
                            onClick={(e) => selectOnClick({ kind: "entity", id: other.id }, e)}
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
                {!collapsedMainIds.has(entity.id) &&
                  (relatedInsertIndex === allRelated.length ? (
                    <DropInsertionPlaceholder variant="pill" />
                  ) : (
                    <EntityPlacementSlot
                      variant="pill"
                      suppressed={isPlacementDragActive}
                      onCreate={() => setCreationRequest({ source: entity })}
                    />
                  ))}
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
                  // Selects the whole Entity — a click anywhere on the card's own body (not just
                  // the narrow name/confidence header button above), same as clicking the header
                  // itself. Every interactive child inside (property rows, buttons, drag handles)
                  // already stops propagation on its own click/pointerdown, so this never fires for
                  // those — only for a click that actually lands on empty card real estate.
                  onClick={(e) => selectOnClick({ kind: "entity", id: entity.id }, e)}
                  onScroll={handleScrollableCardScroll}
                  className={cn(
                    "group/entitycard flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 [&>div]:w-full",
                    app.editingIdea === "idea2" &&
                      !collapsedMainIds.has(entity.id) &&
                      "max-h-[440px] justify-start overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
                    moveTargetId === entity.id
                      ? "shadow-[0_0_0_4px_var(--color-primary)]"
                      : // Blue is the one selection color across the whole canvas — single- and
                        // multi-selection both read from `selectedMergeIds` (a plain read of the
                        // unified selection), so there's never a second, darker ring stacked on
                        // top of this one.
                        selectedMergeIds.has(entity.id)
                        ? "shadow-[0_0_0_2px_#FCFCFC,0_0_0_4px_#3b82f6,0_2px_2px_0_rgba(0,0,0,0.10)]"
                        : "shadow-[0_2px_2px_0_rgba(0,0,0,0.1)]",
                    !isReviewItemInScope(
                      entityStatus(entity),
                      entity.confidence,
                      confidenceRange,
                      statusFilter,
                    ) && "opacity-40",
                  )}
                >
                  <div
                    ref={anchorHeaderRowRef}
                    className={cn(
                      // A fast, near-instant snap rather than its own visible fade — by the time
                      // this flips visible, the morph overlay's own header pieces are already
                      // resting at this exact position/style, so this is a swap between two
                      // identical-looking frames, not a second, separate reveal.
                      "flex w-full items-center gap-1 transition-opacity duration-75",
                      app.editingIdea === "idea2" && "sticky top-0 z-20 bg-white py-0.5",
                      isMorphing && "opacity-0",
                    )}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        startNodeDrag("anchor", e.clientX, e.clientY);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.detail === 0) selectOnClick({ kind: "entity", id: entity.id }, e);
                      }}
                      title={
                        suggestionSelection.has(suggestionKey({ kind: "entity", id: entity.id }))
                          ? "Selected — click to deselect, or shift-click to add more to the selection"
                          : "Click for name and description, or shift-click to select for Merge/Delete/Accept/Reject"
                      }
                      className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 truncate rounded-full px-1 pb-1 text-left active:cursor-grabbing"
                    >
                      {/* Selection is already shown by the card's own ring above — this stays a
                          plain wrapper (kept for the Overview↔Detail morph target ref). */}
                      <span ref={anchorIconRef} className="rounded-full">
                        <StatusBadge
                          status={entityDisplayStatus(entity)}
                          confidence={entity.confidence}
                          warningReason={entity.warningReason}
                          errorReason={entityErrorReason(entity)}
                        />
                      </span>
                      <span
                        ref={anchorNameRef}
                        className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]"
                      >
                        {entity.name}
                      </span>
                      {/* Ref target stays mounted even when the chip itself doesn't render (see
                          the mount-only morph-target effect above, which needs a real node here
                          regardless) — Confidence is a pending-suggestion fact, not persistent
                          metadata, so it's gone once Applied ("confirmed"); a Warning/Error is
                          still not-yet-Applied and keeps showing it like any Suggested item. */}
                      <span ref={anchorConfidenceRef} className="inline-flex shrink-0">
                        {entity.status !== "confirmed" && (
                          <ConfidenceChip confidence={entity.confidence} />
                        )}
                      </span>
                    </button>
                    {/* Delete now lives exclusively in the contextual selection control — select
                        this Entity (and anything else) there instead of a per-card inline action. */}
                    <button
                      ref={anchorChevronRef}
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
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity duration-75 hover:bg-accent",
                        isMorphing && "opacity-0",
                      )}
                    >
                      {collapsedMainIds.has(entity.id) ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                    </button>
                  </div>
                  {/* The card's own body — never height-collapsed (see `AnchorMorphRects`' own
                      doc comment on why that matters for the overlay's target measurement), just
                      a single plain opacity fade driven by `bodyVisible` — one unit, no per-row
                      stagger, overlapping the tail of the header morph above rather than waiting
                      for it to fully finish. */}
                  <div
                    className={cn(
                      "flex min-h-0 w-full flex-col gap-2 transition-opacity duration-150 ease-out",
                      bodyVisible ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {/* Only Identifier and Sort are shown on every Properties list regardless of
                        which side (Entity or Table) Editing Mode was entered on — not just the
                        entry point's own authoritative side. */}
                    {!collapsedMainIds.has(entity.id) && (
                      <div
                        className={cn(
                          "flex w-full items-center justify-between gap-1",
                          app.editingIdea === "idea2" && "sticky top-8 z-10 bg-white py-1",
                        )}
                      >
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleOnlyIdentifier(entity.id);
                          }}
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
                      (() => {
                        const props = visibleProperties(entity.id, entity.properties);
                        const mapped = props.filter(
                          (p) => p.mapping && mappingStatus(p.mapping) === "mapped",
                        );
                        // Unmapped = no CONFIRMED mapping — includes a still-Suggested one (see
                        // this file's own mapping-status color/priority doc below).
                        const unmapped = props.filter(
                          (p) => !p.mapping || mappingStatus(p.mapping) === "suggested",
                        );
                        // Identifier first, then Suggested (aligned to reduce crossings), then no
                        // suggestion at all — see `orderUnmappedProperties`'s own doc comment.
                        // Backs off entirely once the user has picked an explicit sort for THIS
                        // entity, same override rule the rank-based alignment above already uses.
                        const orderedUnmapped = hasExplicitPropertySort(entity.id)
                          ? unmapped
                          : orderUnmappedProperties(unmapped);
                        const mappedOpen = isMappedGroupOpen(entity.id);
                        const unmappedOpen = isUnmappedGroupOpen(entity.id);
                        const renderProperty = (p: Property) => {
                          const isDropTarget =
                            mapDropTarget?.type === "property" && mapDropTarget.propertyId === p.id;
                          const isSelected = selectedPropertyIdsFor(entity.id).has(p.id);
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
                                selectOnClick(
                                  { kind: "property", entityId: entity.id, propertyId: p.id },
                                  e,
                                );
                              }}
                              onMouseEnter={() => {
                                if (p.mapping)
                                  setHoveredMapEndpoint({ type: "property", propertyId: p.id });
                              }}
                              onMouseLeave={() =>
                                setHoveredMapEndpoint((cur) =>
                                  cur?.type === "property" && cur.propertyId === p.id ? null : cur,
                                )
                              }
                              title="Click for name and description, or shift-click to select for Split/Delete/Accept/Reject"
                              className={cn(
                                "group/prop relative flex w-full cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] leading-[16.5px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                                app.editingIdea === "idea2" &&
                                  "rounded-[4px] px-2 py-1.5 shadow-none",
                                p.mapping
                                  ? "bg-white font-medium text-foreground"
                                  : "bg-white font-normal text-[#555]",
                                isSelected && "shadow-[0_0_0_1px_#3b82f6]",
                                isDropTarget && "shadow-[0_0_0_2px_#00ded8]",
                                (movePropertyDrag?.propertyIds.includes(p.id) ||
                                  !isReviewItemInScope(
                                    propertyStatus(p),
                                    p.confidence,
                                    confidenceRange,
                                    statusFilter,
                                  )) &&
                                  "opacity-40",
                                highlightedPropertyIds?.has(p.id) && "shadow-[0_0_0_2px_#3b82f6]",
                              )}
                            >
                              {/* DRAGGABLE — leftmost, moves the Property itself onto another Entity.
                      Never creates a connection. */}
                              <DraggableHandle
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.stopPropagation();
                                  startMoveProperty(p.id, entity.id, e.clientX, e.clientY);
                                }}
                                aria-label={`Drag to move ${p.name} to another entity`}
                                title="Drag to move to another entity"
                              />
                              {/* Selection is already shown by the row's own shadow ring above —
                                  this dot stays a plain status indicator, not a second highlight.
                                  Always the Property's own ontology ReviewStatus — never the
                                  mapping's, which stays visually independent (see the Column row's
                                  own dot for that). */}
                              <span
                                title={reviewStatusLabel(propertyStatus(p))}
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: statusBorderColor(propertyStatus(p)) }}
                              />
                              {/* IDENTIFIER — between the status dot and the name, for the entity's
                      identifier property. No separate error badge here even when blocked
                      (unmapped) — the status dot to its left already shows error via color. */}
                              {isIdentifierProperty(p) && <IdentifierIcon />}
                              <span className="min-w-0 flex-1 truncate">{p.name}</span>
                              {/* Confidence is a pending-suggestion fact, not persistent metadata
                                — gone once Applied ("confirmed"); Warning/Error is still
                                not-yet-Applied and keeps it, same as a plain Suggested property. */}
                              {p.status !== "confirmed" && (
                                <ConfidenceChip confidence={p.confidence} />
                              )}
                              {/* Delete now lives exclusively in the contextual selection control. */}
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
                        };
                        return (
                          <>
                            {mapped.length > 0 && (
                              <div className="flex flex-col gap-1 rounded-[10px] bg-[#eff6ff] p-1">
                                <PropertyGroupHeader
                                  label="Mapped"
                                  count={mapped.length}
                                  open={mappedOpen}
                                  onToggle={() => toggleMappedGroupOpen(entity.id)}
                                />
                                {mappedOpen &&
                                  mapped
                                    .filter(
                                      (p) => p.mapping && isMappedColumnGroupOpen(p.mapping.table),
                                    )
                                    .map(renderProperty)}
                              </div>
                            )}
                            {unmapped.length > 0 && (
                              <div className="flex flex-col gap-1 rounded-[10px] bg-[#f4f4f4] p-1">
                                <PropertyGroupHeader
                                  label="Unmapped"
                                  count={unmapped.length}
                                  open={unmappedOpen}
                                  onToggle={() => toggleUnmappedGroupOpen(entity.id)}
                                />
                                {/* A merely-Suggested mapping still pairs with its Column the same
                                    way a Mapped one does above — its row stays hidden until the
                                    paired Table's own Unmapped group is open too, so a suggested
                                    connector never points at an unrendered row. A property with no
                                    mapping at all has nothing to pair with, so it always shows. */}
                                {unmappedOpen &&
                                  orderedUnmapped
                                    .filter(
                                      (p) =>
                                        !p.mapping || isUnmappedColumnGroupOpen(p.mapping.table),
                                    )
                                    .map(renderProperty)}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    {/* Split/Delete for a Property selection now live in the one contextual
                        selection control instead of this per-card inline bar — see
                        `SelectionControlBar`. */}
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
              </div>

              <div
                ref={columnsAreaRef}
                className={cn(
                  "flex flex-col gap-4 transition-opacity duration-[230ms] ease-out",
                  // PHASE 2 of the morph transition: mapped Data Tables/columns stay hidden until
                  // the selected Entity has mostly finished its own morph, then fade in — already
                  // at their final positions, only their opacity ever animates here.
                  !contextRevealed && "pointer-events-none opacity-0",
                )}
              >
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
                    // Tables have no Confidence/ReviewStatus of their own — derived from whichever
                    // Property↔Column Mapping(s) touch it instead (see `isTableInScope`'s own doc
                    // comment). Dims the whole card, never removes it.
                    const tableInScope = isTableInScope(
                      table,
                      entities,
                      confidenceRange,
                      statusFilter,
                    );
                    nodeClickActionsRef.current[nodeId] = () => {
                      const schema = tableByName(table);
                      if (schema) setContextItem({ kind: "table", table: schema });
                    };
                    return (
                      <div key={table} className="contents">
                        {tableInsertIndex === i && <DropInsertionPlaceholder variant="card" />}
                        <div
                          ref={(el) => {
                            if (el) {
                              columnGroupRefs.current.set(table, el);
                              tableCardRefs.current.set(table, el);
                            } else {
                              columnGroupRefs.current.delete(table);
                              tableCardRefs.current.delete(table);
                            }
                          }}
                          style={nodeTransform(nodeId)}
                          // Selects the whole Table — same "click anywhere on the card body" as the
                          // Entity card above; every interactive child already stops propagation.
                          onClick={() => {
                            const schema = tableByName(table);
                            if (schema) setContextItem({ kind: "table", table: schema });
                          }}
                          onScroll={handleScrollableCardScroll}
                          className={cn(
                            "flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 [&>div]:w-full",
                            app.editingIdea === "idea2" &&
                              !collapsedTables.has(table) &&
                              "max-h-[440px] justify-start overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
                            contextItem?.kind === "table" && contextItem.table.name === table
                              ? "shadow-[0_0_0_2px_#FCFCFC,0_0_0_5px_#3b82f6,0_2px_2px_0_rgba(0,0,0,0.10)]"
                              : "shadow-[0_2px_2px_0_rgba(0,0,0,0.1)]",
                            !tableInScope && "opacity-40",
                          )}
                        >
                          <div
                            className={cn(
                              "flex w-full items-center gap-1",
                              app.editingIdea === "idea2" && "sticky top-0 z-20 bg-white py-0.5",
                            )}
                          >
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
                              className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 truncate rounded-full py-1 text-left active:cursor-grabbing"
                              title="Click for name and description, or drag to reposition"
                            >
                              <MappingStatusBadge
                                status={tableMappingStatus(table, entities)}
                                {...tableMappingCompleteness(table, entities)}
                                size={20}
                              />
                              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                                {table}
                              </span>
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
                          {/* Only Identifier and Sort are shown on every Columns list regardless
                              of which side (Entity or Table) Editing Mode was entered on — not
                              just the entry point's own authoritative side. */}
                          {!collapsedTables.has(table) && (
                            <div
                              className={cn(
                                "flex w-full items-center justify-between gap-1",
                                app.editingIdea === "idea2" && "sticky top-8 z-10 bg-white py-1",
                              )}
                            >
                              <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleOnlyIdentifierTable(table);
                                }}
                                aria-pressed={!!onlyIdentifierByTable[table]}
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                                  onlyIdentifierByTable[table]
                                    ? "bg-black/[0.08] text-foreground"
                                    : "text-muted-foreground hover:bg-accent",
                                )}
                              >
                                Only Identifier
                              </button>
                              <SortBar
                                sort={columnSortFor(table)}
                                onChange={(k) => setColumnSortForTable(table, k)}
                              />
                            </div>
                          )}
                          {!collapsedTables.has(table) &&
                            (() => {
                              const visible = visibleColumns(table, cols);
                              const mappedCols = visible.filter(columnHasMapped);
                              // Unmapped = no CONFIRMED mapping — includes a still-Suggested one.
                              const unmappedCols = visible.filter((c) => !columnHasMapped(c));
                              // Identifier first, then Suggested (aligned to reduce crossings),
                              // then no suggestion at all — see `orderUnmappedColumns`'s own doc
                              // comment. Backs off once the user has explicitly sorted this table.
                              const orderedUnmappedCols = hasExplicitColumnSort(table)
                                ? unmappedCols
                                : orderUnmappedColumns(unmappedCols);
                              const mappedOpen = isMappedColumnGroupOpen(table);
                              const unmappedOpen = isUnmappedColumnGroupOpen(table);
                              const renderColumn = (c: ColGroupEntry) => {
                                const key = `${table}.${c.column}`;
                                const isDropTarget =
                                  mapDropTarget?.type === "column" &&
                                  mapDropTarget.table === table &&
                                  mapDropTarget.column === c.column;
                                const isContextSelected =
                                  contextItem?.kind === "column" &&
                                  contextItem.tableName === table &&
                                  contextItem.column.name === c.column;
                                const isMappingSelected = c.mappedBy.some(
                                  ({ ownerEntityId, propertyId, status }) =>
                                    status === "suggested" &&
                                    mappingSelection.has(
                                      mappingSelectionKey(ownerEntityId, propertyId),
                                    ),
                                );
                                const schema = tableByName(table);
                                const colInScope = isColEntryInScope(c);
                                const columnMapState = columnMappingState(c);
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
                                      if (
                                        e.shiftKey &&
                                        toggleColumnMappingSelection(c.mappedBy, true)
                                      )
                                        return;
                                      clearSuggestionSelection();
                                      setMappingSelection(new Set());
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
                                    onMouseEnter={() => {
                                      if (c.mappedBy.length > 0)
                                        setHoveredMapEndpoint({ type: "column", columnKey: key });
                                    }}
                                    onMouseLeave={() =>
                                      setHoveredMapEndpoint((cur) =>
                                        cur?.type === "column" && cur.columnKey === key
                                          ? null
                                          : cur,
                                      )
                                    }
                                    title="Click for name and description"
                                    className={cn(
                                      "group/col relative flex w-full cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] leading-[16.5px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                                      app.editingIdea === "idea2" &&
                                        "rounded-[4px] px-2 py-1.5 shadow-none",
                                      c.mappedBy.length > 0
                                        ? "bg-white font-medium text-foreground"
                                        : "bg-white font-normal text-[#555]",
                                      isDropTarget && "shadow-[0_0_0_2px_#00ded8]",
                                      isContextSelected && "shadow-[0_0_0_2px_#3b82f6]",
                                      isMappingSelected && "shadow-[0_0_0_2px_#3b82f6]",
                                      !colInScope && "opacity-40",
                                      highlightedColumnKeys?.has(key) &&
                                        "shadow-[0_0_0_2px_#3b82f6]",
                                    )}
                                  >
                                    {/* MAPPING STATE — the connector's own Mapped/Suggested/none
                          lifecycle, never the mapping Property's ReviewStatus; a Column has no
                          review status of its own — see `columnMappingState`'s own doc comment
                          above. Always renders (unlike a Property row, a Column row has no other
                          status dot of its own to fall back to). */}
                                    <span
                                      aria-hidden="true"
                                      title={
                                        columnMapState === "mapped"
                                          ? "Mapped"
                                          : columnMapState === "suggested"
                                            ? "Suggested mapping"
                                            : "No mapping suggestion"
                                      }
                                      className="size-1.5 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor:
                                          columnMapState === "mapped"
                                            ? MAPPING_MAPPED_COLOR
                                            : columnMapState === "suggested"
                                              ? MAPPING_SUGGESTED_COLOR
                                              : MAPPING_NONE_COLOR,
                                      }}
                                    />
                                    {schema ? (
                                      <SampleDataTrigger
                                        table={schema}
                                        columnName={c.column}
                                        className="flex min-w-0 flex-1 items-center gap-1"
                                      >
                                        <span className="min-w-0 flex-1 truncate">{c.column}</span>
                                        <span
                                          className={cn(
                                            "shrink-0 font-mono text-[10.8px] font-normal leading-[16.2px]",
                                            c.mappedBy.length > 0
                                              ? "text-muted-foreground"
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
                                            "shrink-0 font-mono text-[10.8px] font-normal leading-[16.2px]",
                                            c.mappedBy.length > 0
                                              ? "text-muted-foreground"
                                              : "text-[#70757C]/60",
                                          )}
                                        >
                                          {c.type}
                                        </span>
                                      </>
                                    )}
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
                              };
                              return (
                                <>
                                  {mappedCols.length > 0 && (
                                    <div className="flex flex-col gap-1 rounded-[10px] bg-[#eff6ff] p-1">
                                      <PropertyGroupHeader
                                        label="Mapped"
                                        count={mappedCols.length}
                                        open={mappedOpen}
                                        onToggle={() => toggleMappedColumnGroupOpen(table)}
                                      />
                                      {mappedOpen &&
                                        mappedCols
                                          .filter((c) =>
                                            c.mappedBy.some(({ ownerEntityId }) =>
                                              isMappedGroupOpen(ownerEntityId),
                                            ),
                                          )
                                          .map(renderColumn)}
                                    </div>
                                  )}
                                  {unmappedCols.length > 0 && (
                                    <div className="flex flex-col gap-1 rounded-[10px] bg-[#f4f4f4] p-1">
                                      <PropertyGroupHeader
                                        label="Unmapped"
                                        count={unmappedCols.length}
                                        open={unmappedOpen}
                                        onToggle={() => toggleUnmappedColumnGroupOpen(table)}
                                      />
                                      {/* Same pairing as Mapped above — a still-Suggested column
                                          hides until its mapping Property's own Unmapped group is
                                          open too; a column with no mapper at all has nothing to
                                          pair with, so it always shows. */}
                                      {unmappedOpen &&
                                        orderedUnmappedCols
                                          .filter(
                                            (c) =>
                                              c.mappedBy.length === 0 ||
                                              c.mappedBy.some(({ ownerEntityId }) =>
                                                isUnmappedGroupOpen(ownerEntityId),
                                              ),
                                          )
                                          .map(renderColumn)}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
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
              nodeClickActionsRef.current[nodeId] = (mods) =>
                selectOnClick({ kind: "entity", id: other.id }, mods);
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
                      <DropInsertionPlaceholder
                        variant="card"
                        label={satelliteDragPos ? "Add to workspace" : undefined}
                      />
                    </div>
                  )}
                  <div className="relative z-10 flex items-start gap-20">
                    {/* Same `relationGapPx` margin AND `minWidth: NODE_W` as the anchor's own
                      satellite column just above (not recomputed per row) — the margin keeps the
                      satellites<->card gap consistent regardless of whose relation labels happen
                      to be widest, and the min-width keeps this column exactly as wide as a real
                      satellite pill even when this particular row has fewer (or zero) of them, so
                      no row's card ever sits closer to its satellites than any other row's. */}
                    <div
                      className="flex flex-col items-center gap-6 pt-8"
                      style={{ marginRight: Math.max(0, relationGapPx - 80), minWidth: NODE_W }}
                    >
                      {isCollapsed && (
                        <p
                          style={{ width: NODE_W }}
                          className="text-center text-[10.5px] text-muted-foreground"
                        >
                          {satellites.length} related (collapsed)
                        </p>
                      )}
                      {!isCollapsed && satellites.length === 0 && (
                        <p
                          style={{ width: NODE_W }}
                          className="text-center text-[10.5px] text-muted-foreground"
                        >
                          No related entities
                        </p>
                      )}
                      {!isCollapsed &&
                        satellites.map((sat) => {
                          nodeClickActionsRef.current[sat.id] = (mods) =>
                            selectOnClick({ kind: "entity", id: sat.id }, mods);
                          return (
                            <div
                              key={sat.id}
                              ref={(el) => {
                                const key = `${other.id}:${sat.id}`;
                                if (el) extraRelatedRefs.current.set(key, el);
                                else extraRelatedRefs.current.delete(key);
                              }}
                              style={nodeTransform(sat.id)}
                              title="Click for name and description, or drag into the workspace to expand"
                              className={cn(
                                !isReviewItemInScope(
                                  entityStatus(sat),
                                  sat.confidence,
                                  confidenceRange,
                                  statusFilter,
                                ) && "opacity-40",
                              )}
                            >
                              <OntologyNode
                                entity={sat}
                                detailed={zoom > 1}
                                emphasis={selectedMergeIds.has(sat.id) ? "active" : "normal"}
                                onStartMove={(clientX, clientY) =>
                                  startNodeDrag(sat.id, clientX, clientY)
                                }
                                onClick={(e) => selectOnClick({ kind: "entity", id: sat.id }, e)}
                              />
                            </div>
                          );
                        })}
                    </div>

                    <div className="flex flex-col gap-4">
                      <div
                        ref={(el) => {
                          if (el) mainCardRefs.current.set(other.id, el);
                          else mainCardRefs.current.delete(other.id);
                        }}
                        style={nodeTransform(nodeId)}
                        // Selects the whole Entity — same "click anywhere on the card body" as the
                        // anchor's own card above; every interactive child already stops propagation.
                        onClick={(e) => selectOnClick({ kind: "entity", id: other.id }, e)}
                        onScroll={handleScrollableCardScroll}
                        className={cn(
                          "group/entitycard flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 [&>div]:w-full",
                          app.editingIdea === "idea2" &&
                            !isCollapsed &&
                            "max-h-[440px] justify-start overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
                          moveTargetId === other.id
                            ? "shadow-[0_0_0_4px_var(--color-primary)]"
                            : selectedMergeIds.has(other.id)
                              ? "shadow-[0_0_0_2px_#FCFCFC,0_0_0_4px_#3b82f6,0_2px_2px_0_rgba(0,0,0,0.10)]"
                              : "shadow-[0_2px_2px_0_rgba(0,0,0,0.1)]",
                          !isReviewItemInScope(
                            entityStatus(other),
                            other.confidence,
                            confidenceRange,
                            statusFilter,
                          ) && "opacity-40",
                        )}
                      >
                        <div
                          className={cn(
                            "flex w-full items-center gap-1",
                            app.editingIdea === "idea2" && "sticky top-0 z-20 bg-white py-0.5",
                          )}
                        >
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              startNodeDrag(nodeId, e.clientX, e.clientY);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (e.detail === 0)
                                selectOnClick({ kind: "entity", id: other.id }, e);
                            }}
                            title={
                              selectedMergeIds.has(other.id)
                                ? "Selected — click to deselect, or shift-click to add more to the selection"
                                : "Click for name and description, drag to reposition, or shift-click to select for Merge/Delete/Accept/Reject"
                            }
                            className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 truncate rounded-full px-1 pb-1 text-left active:cursor-grabbing"
                          >
                            <StatusBadge
                              status={entityDisplayStatus(other)}
                              confidence={other.confidence}
                              warningReason={other.warningReason}
                              errorReason={entityErrorReason(other)}
                            />
                            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                              {other.name}
                            </span>
                            {/* Gone once Applied ("confirmed") — see the anchor's own card for
                                the full rationale. */}
                            {other.status !== "confirmed" && (
                              <ConfidenceChip confidence={other.confidence} />
                            )}
                          </button>
                          {/* Delete now lives exclusively in the contextual selection control. */}
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
                        {/* Only Identifier and Sort are shown regardless of which side Editing
                            Mode was entered on — see the anchor's own Properties list above for
                            the same change. */}
                        {!isCollapsed && (
                          <div
                            className={cn(
                              "flex w-full items-center justify-between gap-1",
                              app.editingIdea === "idea2" && "sticky top-8 z-10 bg-white py-1",
                            )}
                          >
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleOnlyIdentifier(other.id);
                              }}
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
                          (() => {
                            const props = visibleProperties(other.id, other.properties);
                            const mapped = props.filter(
                              (p) => p.mapping && mappingStatus(p.mapping) === "mapped",
                            );
                            const unmapped = props.filter(
                              (p) => !p.mapping || mappingStatus(p.mapping) === "suggested",
                            );
                            // Identifier first, then Suggested (aligned to reduce crossings), then
                            // no suggestion at all — see `orderUnmappedProperties`'s own doc
                            // comment. Backs off once the user has explicitly sorted this entity.
                            const orderedUnmapped = hasExplicitPropertySort(other.id)
                              ? unmapped
                              : orderUnmappedProperties(unmapped);
                            const mappedOpen = isMappedGroupOpen(other.id);
                            const unmappedOpen = isUnmappedGroupOpen(other.id);
                            const renderProperty = (p: Property) => {
                              const isDropTarget =
                                mapDropTarget?.type === "property" &&
                                mapDropTarget.propertyId === p.id;
                              const isSelected = selectedPropertyIdsFor(other.id).has(p.id);
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
                                    selectOnClick(
                                      { kind: "property", entityId: other.id, propertyId: p.id },
                                      e,
                                    );
                                  }}
                                  onMouseEnter={() => {
                                    if (p.mapping)
                                      setHoveredMapEndpoint({ type: "property", propertyId: p.id });
                                  }}
                                  onMouseLeave={() =>
                                    setHoveredMapEndpoint((cur) =>
                                      cur?.type === "property" && cur.propertyId === p.id
                                        ? null
                                        : cur,
                                    )
                                  }
                                  title="Click for name and description, or shift-click to select for Split/Delete/Accept/Reject"
                                  className={cn(
                                    "group/prop relative flex cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                                    app.editingIdea === "idea2" &&
                                      "rounded-[4px] px-2 py-1.5 shadow-none",
                                    p.mapping
                                      ? "bg-white font-medium text-foreground"
                                      : "bg-white font-normal text-[#555]",
                                    isSelected && "shadow-[0_0_0_1px_#3b82f6]",
                                    isDropTarget && "shadow-[0_0_0_2px_#00ded8]",
                                    (movePropertyDrag?.propertyIds.includes(p.id) ||
                                      !isReviewItemInScope(
                                        propertyStatus(p),
                                        p.confidence,
                                        confidenceRange,
                                        statusFilter,
                                      )) &&
                                      "opacity-40",
                                    highlightedPropertyIds?.has(p.id) &&
                                      "shadow-[0_0_0_2px_#3b82f6]",
                                  )}
                                >
                                  {/* DRAGGABLE — leftmost, moves this Property onto another Entity,
                              or (when part of this row's own selection) the whole selection
                              together — same as the anchor's own properties. */}
                                  <DraggableHandle
                                    onPointerDown={(e) => {
                                      if (e.button !== 0) return;
                                      e.stopPropagation();
                                      startMoveProperty(p.id, other.id, e.clientX, e.clientY);
                                    }}
                                    aria-label={`Drag to move ${p.name} to another entity`}
                                    title="Drag to move to another entity"
                                  />
                                  {/* Selection is already shown by the row's own shadow ring
                                      above — see the anchor's own property list. Always the
                                      Property's own ontology ReviewStatus, same as there. */}
                                  <span
                                    title={reviewStatusLabel(propertyStatus(p))}
                                    className="size-1.5 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: statusBorderColor(propertyStatus(p)),
                                    }}
                                  />
                                  {/* IDENTIFIER — between the status dot and the name — see the
                              anchor's own property list for the same pattern. */}
                                  {isIdentifierProperty(p) && <IdentifierIcon />}
                                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                  {/* Gone once Applied ("confirmed") — see the anchor's own
                                      property list for the full rationale. */}
                                  {p.status !== "confirmed" && (
                                    <ConfidenceChip confidence={p.confidence} />
                                  )}
                                  {/* Delete now lives exclusively in the contextual selection
                                      control. */}
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
                            };
                            return (
                              <>
                                {mapped.length > 0 && (
                                  <div className="flex flex-col gap-1 rounded-[10px] bg-[#eff6ff] p-1">
                                    <PropertyGroupHeader
                                      label="Mapped"
                                      count={mapped.length}
                                      open={mappedOpen}
                                      onToggle={() => toggleMappedGroupOpen(other.id)}
                                    />
                                    {mappedOpen &&
                                      mapped
                                        .filter(
                                          (p) =>
                                            p.mapping && isMappedColumnGroupOpen(p.mapping.table),
                                        )
                                        .map(renderProperty)}
                                  </div>
                                )}
                                {unmapped.length > 0 && (
                                  <div className="flex flex-col gap-1 rounded-[10px] bg-[#f4f4f4] p-1">
                                    <PropertyGroupHeader
                                      label="Unmapped"
                                      count={unmapped.length}
                                      open={unmappedOpen}
                                      onToggle={() => toggleUnmappedGroupOpen(other.id)}
                                    />
                                    {unmappedOpen &&
                                      orderedUnmapped
                                        .filter(
                                          (p) =>
                                            !p.mapping ||
                                            isUnmappedColumnGroupOpen(p.mapping.table),
                                        )
                                        .map(renderProperty)}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        {/* Split/Delete for a Property selection now live in the one contextual
                            selection control instead of this per-card inline bar. */}
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
                          // Tables have no Confidence/ReviewStatus of their own — derived from
                          // whichever Property↔Column Mapping(s) touch it instead (see
                          // `isTableInScope`'s own doc comment). Dims the whole card, never
                          // removes it.
                          const tableInScope = isTableInScope(
                            table,
                            entities,
                            confidenceRange,
                            statusFilter,
                          );
                          return (
                            <div
                              key={table}
                              // Selects the whole Table — same "click anywhere on the card body" as
                              // every other card; every interactive child already stops propagation.
                              onClick={() => {
                                const schema = tableByName(table);
                                if (schema) setContextItem({ kind: "table", table: schema });
                              }}
                              onScroll={handleScrollableCardScroll}
                              ref={(el) => {
                                if (el) tableCardRefs.current.set(table, el);
                                else tableCardRefs.current.delete(table);
                              }}
                              className={cn(
                                "flex w-[268.8px] flex-col items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-[rgba(28,28,24,0.08)] bg-white px-3 pb-3 pt-2 [&>div]:w-full",
                                app.editingIdea === "idea2" &&
                                  !collapsedTables.has(table) &&
                                  "max-h-[440px] justify-start overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
                                contextItem?.kind === "table" && contextItem.table.name === table
                                  ? "shadow-[0_0_0_2px_#FCFCFC,0_0_0_5px_#3b82f6,0_2px_2px_0_rgba(0,0,0,0.10)]"
                                  : "shadow-[0_2px_2px_0_rgba(0,0,0,0.1)]",
                                !tableInScope && "opacity-40",
                              )}
                            >
                              <div
                                className={cn(
                                  "flex w-full items-center gap-1",
                                  app.editingIdea === "idea2" &&
                                    "sticky top-0 z-20 bg-white py-0.5",
                                )}
                              >
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const schema = tableByName(table);
                                    if (schema) setContextItem({ kind: "table", table: schema });
                                  }}
                                  title="Click for name and description"
                                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-full py-1 text-left"
                                >
                                  <MappingStatusBadge
                                    status={tableMappingStatus(table, entities)}
                                    {...tableMappingCompleteness(table, entities)}
                                    size={20}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-[16px] tracking-[-0.076px] text-[#3C3C3C]">
                                    {table}
                                  </span>
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
                                <div
                                  className={cn(
                                    "flex w-full items-center justify-between gap-1",
                                    app.editingIdea === "idea2" &&
                                      "sticky top-8 z-10 bg-white py-1",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleOnlyIdentifierTable(table);
                                    }}
                                    aria-pressed={!!onlyIdentifierByTable[table]}
                                    className={cn(
                                      "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                                      onlyIdentifierByTable[table]
                                        ? "bg-black/[0.08] text-foreground"
                                        : "text-muted-foreground hover:bg-accent",
                                    )}
                                  >
                                    Only Identifier
                                  </button>
                                  <SortBar
                                    sort={columnSortFor(table)}
                                    onChange={(k) => setColumnSortForTable(table, k)}
                                  />
                                </div>
                              )}
                              {!collapsedTables.has(table) &&
                                (() => {
                                  const visible = visibleColumns(table, cols);
                                  const mappedCols = visible.filter(columnHasMapped);
                                  const unmappedCols = visible.filter((c) => !columnHasMapped(c));
                                  // Identifier first, then Suggested (aligned to reduce
                                  // crossings), then no suggestion at all — see
                                  // `orderUnmappedColumns`'s own doc comment. Backs off once the
                                  // user has explicitly sorted this table.
                                  const orderedUnmappedCols = hasExplicitColumnSort(table)
                                    ? unmappedCols
                                    : orderUnmappedColumns(unmappedCols);
                                  const mappedOpen = isMappedColumnGroupOpen(table);
                                  const unmappedOpen = isUnmappedColumnGroupOpen(table);
                                  const renderColumn = (c: ColGroupEntry) => {
                                    const key = `${table}.${c.column}`;
                                    const isDropTarget =
                                      mapDropTarget?.type === "column" &&
                                      mapDropTarget.table === table &&
                                      mapDropTarget.column === c.column;
                                    const schema = tableByName(table);
                                    const colInScope = isColEntryInScope(c);
                                    const columnMapState = columnMappingState(c);
                                    const isMappingSelected = c.mappedBy.some(
                                      ({ ownerEntityId, propertyId, status }) =>
                                        status === "suggested" &&
                                        mappingSelection.has(
                                          mappingSelectionKey(ownerEntityId, propertyId),
                                        ),
                                    );
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
                                          if (
                                            e.shiftKey &&
                                            toggleColumnMappingSelection(c.mappedBy, true)
                                          ) {
                                            return;
                                          }
                                          clearSuggestionSelection();
                                          setMappingSelection(new Set());
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
                                        onMouseEnter={() => {
                                          if (c.mappedBy.length > 0)
                                            setHoveredMapEndpoint({
                                              type: "column",
                                              columnKey: key,
                                            });
                                        }}
                                        onMouseLeave={() =>
                                          setHoveredMapEndpoint((cur) =>
                                            cur?.type === "column" && cur.columnKey === key
                                              ? null
                                              : cur,
                                          )
                                        }
                                        title="Click for name and description"
                                        className={cn(
                                          "group/col relative flex w-full cursor-pointer items-center gap-1 rounded-[10px] px-3 py-2 text-[14px] leading-[16.5px] shadow-[0_0_0_1.2px_rgba(0,0,0,0.08)] transition-shadow",
                                          app.editingIdea === "idea2" &&
                                            "rounded-[4px] px-2 py-1.5 shadow-none",
                                          c.mappedBy.length > 0
                                            ? "bg-white font-medium text-foreground"
                                            : "bg-white font-normal text-[#555]",
                                          isDropTarget && "shadow-[0_0_0_2px_#00ded8]",
                                          isMappingSelected && "shadow-[0_0_0_2px_#3b82f6]",
                                          !colInScope && "opacity-40",
                                          highlightedColumnKeys?.has(key) &&
                                            "shadow-[0_0_0_2px_#3b82f6]",
                                        )}
                                      >
                                        {/* MAPPING STATE — the connector's own Mapped/Suggested/
                                  none lifecycle, never the mapping Property's ReviewStatus — see
                                  `columnMappingState`'s own doc comment above. Always renders. */}
                                        <span
                                          aria-hidden="true"
                                          title={
                                            columnMapState === "mapped"
                                              ? "Mapped"
                                              : columnMapState === "suggested"
                                                ? "Suggested mapping"
                                                : "No mapping suggestion"
                                          }
                                          className="size-1.5 shrink-0 rounded-full"
                                          style={{
                                            backgroundColor:
                                              columnMapState === "mapped"
                                                ? MAPPING_MAPPED_COLOR
                                                : columnMapState === "suggested"
                                                  ? MAPPING_SUGGESTED_COLOR
                                                  : MAPPING_NONE_COLOR,
                                          }}
                                        />
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
                                                "shrink-0 font-mono text-[10.8px] font-normal leading-[16.2px]",
                                                c.mappedBy.length > 0
                                                  ? "text-muted-foreground"
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
                                                "shrink-0 font-mono text-[10.8px] font-normal leading-[16.2px]",
                                                c.mappedBy.length > 0
                                                  ? "text-muted-foreground"
                                                  : "text-[#70757C]/60",
                                              )}
                                            >
                                              {c.type}
                                            </span>
                                          </>
                                        )}
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
                                  };
                                  return (
                                    <>
                                      {mappedCols.length > 0 && (
                                        <div className="flex flex-col gap-1 rounded-[10px] bg-[#eff6ff] p-1">
                                          <PropertyGroupHeader
                                            label="Mapped"
                                            count={mappedCols.length}
                                            open={mappedOpen}
                                            onToggle={() => toggleMappedColumnGroupOpen(table)}
                                          />
                                          {mappedOpen &&
                                            mappedCols
                                              .filter((c) =>
                                                c.mappedBy.some(({ ownerEntityId }) =>
                                                  isMappedGroupOpen(ownerEntityId),
                                                ),
                                              )
                                              .map(renderColumn)}
                                        </div>
                                      )}
                                      {unmappedCols.length > 0 && (
                                        <div className="flex flex-col gap-1 rounded-[10px] bg-[#f4f4f4] p-1">
                                          <PropertyGroupHeader
                                            label="Unmapped"
                                            count={unmappedCols.length}
                                            open={unmappedOpen}
                                            onToggle={() => toggleUnmappedColumnGroupOpen(table)}
                                          />
                                          {unmappedOpen &&
                                            orderedUnmappedCols
                                              .filter(
                                                (c) =>
                                                  c.mappedBy.length === 0 ||
                                                  c.mappedBy.some(({ ownerEntityId }) =>
                                                    isUnmappedGroupOpen(ownerEntityId),
                                                  ),
                                              )
                                              .map(renderColumn)}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              );
            })}
            {centerInsertIndex === mainEntities.length ? (
              <div className="relative z-10 flex items-start gap-20">
                <div style={{ width: NODE_W, marginRight: Math.max(0, relationGapPx - 80) }} />
                <DropInsertionPlaceholder
                  variant="card"
                  label={satelliteDragPos ? "Add to workspace" : undefined}
                />
              </div>
            ) : (
              // No clear relation context down here — this slot sits below every main row, not
              // beside any one of them in particular, same as dropping an EXISTING Entity in this
              // same spot never fabricates a Relation either (see `onDropEntity`'s own doc
              // comment) — so creating here is always a standalone Entity.
              <div className="relative z-10 flex items-start gap-20">
                <div style={{ width: NODE_W, marginRight: Math.max(0, relationGapPx - 80) }} />
                <EntityPlacementSlot
                  variant="card"
                  suppressed={isPlacementDragActive}
                  onCreate={() => setCreationRequest({ source: null })}
                />
              </div>
            )}
          </div>
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
      {creationRequest && (
        <CreateEntityWizard
          sourceEntity={creationRequest.source}
          onCancel={handleCreationCancel}
          onCreate={handleCreationSubmit}
        />
      )}
      {relationDialogSource && relationDialogTarget && (
        <DefineRelationDialog
          sourceEntity={relationDialogSource}
          targetEntity={relationDialogTarget}
          onCancel={handleRelationDialogCancel}
          onCreate={handleRelationDialogCreate}
        />
      )}
    </>
  );
}
