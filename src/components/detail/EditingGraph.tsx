import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, Plus, Table2, X } from "lucide-react";
import type { NewPropertyDraft, OntologyApp } from "@/lib/app-state";
import {
  entityDraftBlocker,
  parseSuggestionKey,
  suggestionKey,
  type SuggestionRef,
} from "@/lib/app-state";
import {
  entityDisplayStatus,
  entityReview,
  identifierKeyIn,
  aliasesIn,
  mappingsNeedingAlias,
  identifiersOf,
  isColumnInScope,
  isIdentifierProperty,
  isReviewItemInScope,
  isTableInScope,
  mappingStatus,
  propertyReview,
  propertyStatus,
  relationJoins,
  relationMappingAcceptBlockers,
  relationLabel,
  relationMappingCandidates,
  relationMappingKey,
  relationReview,
  relationStatus,
  tableByName,
  tableMappingCompleteness,
  tableMappingStatus,
  tablesUsedByEntity,
  type ColumnRef,
  type Entity,
  type Property,
  type Relation,
  type TableSchema,
} from "@/lib/mock-data";
import { StatusBadge, statusDotColor } from "@/components/ontology/StatusBadge";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import {
  EntityConfidenceChip,
  PropertyConfidenceChip,
  MappingConfidenceChip,
  RelationConfidenceChip,
} from "@/components/ontology/ConfidenceChip";
import { AiReviewBar, type SuggestionScope } from "@/components/ontology/AiReviewBar";
import { DetailDock, DetailPanel, resolveDetailItem } from "@/components/detail/DetailPanel";
import { CompletionNoticeSlot } from "@/components/detail/CompletionToast";
import { SelectionActions } from "@/components/detail/SelectionActions";
import {
  CanvasZoomCard,
  isCanvasBackground,
  useEditingCanvas,
} from "@/components/detail/editing-canvas";
import { cn } from "@/lib/utils";
import { canMapPropertyToColumn, tryConnectMapping } from "@/lib/mapping-rules";
import { ColumnSearchList, parseMappingValue } from "@/components/detail/ItemEditorModal";
import {
  AliasCreateForm,
  AliasNavigator,
  AliasPickList,
  BulkAliasBar,
  aliasTone,
} from "@/components/detail/AliasControls";
import {
  PropertyDraftRow,
  PropertyEditRow,
  PropertyInlineEditor,
} from "@/components/detail/PropertyDraftRow";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import searchIcon from "@/assets/icons/magnifying-glass-2-16.svg";
import rejectIcon from "@/assets/icons/controller-button-x-16.svg";
import acceptIcon from "@/assets/icons/check-circle-2-16.svg";
import chevronDownIcon from "@/assets/icons/chevron-down-16.svg";
import { ENTITY_PANEL_DND_TYPE, TABLE_PANEL_DND_TYPE } from "@/components/detail/panel-dnd";
import {
  acceptsPropertyDrop,
  dropPropertiesOn,
  leftDropTarget,
  REVEAL_PROPERTIES_EVENT,
  revealProperties,
  setPropertyDragSource,
  startPropertyDrag,
} from "@/components/detail/property-move";
import dotGridIcon from "@/assets/icons/dot-grid-2x3-16.svg";
import arrowRightIcon from "@/assets/icons/arrow-right-12.svg";
import { ItemStatusIcon, itemStatusDotColor } from "@/components/ontology/ItemStatusIcon";
import { EDGE_STROKE, EDGE_STYLE, type EdgeLayer } from "@/lib/edge-style";
import {
  ClassNodeBody,
  ClassNodeDivider,
  classNodeClass,
  classNodeBodyClass,
  classNodeCounts,
  classNodeMapping,
  tableNodeMapping,
  type ClassNodeMapping,
} from "@/components/detail/class-node";
import keyIcon from "@/assets/icons/key-identifier-12.svg";
import pencilIcon from "@/assets/icons/pencil-16.svg";
import relationPlusIcon from "@/assets/icons/relation-plus-20.svg";
import relationPlusHoverIcon from "@/assets/icons/relation-plus-hover-20.svg";
import {
  FigmaIcon,
  ListControls,
  PropertyTypeGlyph,
  type ListFilter,
} from "@/components/detail/list-controls";
import {
  DEFAULT_SORT,
  nextSortState,
  sortByState,
  type SortKey,
  type SortState,
} from "@/components/ontology/SortDropdown";

/**
 * The editing workspace's Graph layout: the selected Entity Type in the middle, the Entity Types
 * it's related to branching off to the left (each Relation a pill on its curve), and the Data
 * Tables it maps into branching off to the right (each curve carrying how many of its Properties
 * map there).
 *
 * Branches open in place: a related Entity Type's table / property buttons (on its left) grow
 * its Data Tables or its Properties one level further out; the middle node's + opens its
 * Properties; a Data Table's ⌄ pulls that one table level with the middle node and lays their
 * Property → Column mappings out between them, one straight row each. The tree re-lays itself
 * out around whatever is open.
 *
 * Coordinates are canvas ("world") units with the selected node centered on the origin; the
 * world element sits at the viewport's center and is panned/zoomed by `useEditingCanvas`.
 */

// Branches show their first five children, plus a "+ N more" node that opens the rest.
const PREVIEW = 5;
const GAP_Y = 16;

const CENTER_W = 280;
const CENTER_H = 64;
const NODE_W = 280;
const NODE_H = 64;
const MORE_H = 28;
// Horizontal room between a related Entity Type and the middle node: a 180px pill with 60px
// either side (Figma 328:30072).
const LINK_GAP = 300;

const CENTER_LEFT = -CENTER_W / 2;
const CENTER_RIGHT = CENTER_W / 2;
const ENTITY_X = CENTER_LEFT - LINK_GAP - NODE_W;
// A related Entity Type's own Data Tables, meeting at its table button (Figma 507:28844).
const BRANCH_X = ENTITY_X - 84 - NODE_W;
const BRANCH_JOIN_X = ENTITY_X - 22;
const TABLE_X = CENTER_RIGHT + 160;
const GRAPH_MID_X = (ENTITY_X + TABLE_X + NODE_W) / 2;
// A selected Relation opens up in place (see `openRelation`): under each of its two Entity Types
// drops the source table that side's join keys come from, the key column(s) inside it — the
// "entity mapping" — and a link between those columns runs under the Relation, parallel to it —
// the "relation mapping". The related Entity Type below it moves down to make room; nothing else
// moves.
const PILL_W = 180;
const PILL_H = 26;
const PILL_GAP = (LINK_GAP - PILL_W) / 2;
// Between the pills of neighbouring Entity Types, and between one Entity Type's own pills.
const PILL_SLOT = 48;
const PILL_SLOT_SAME = 34;
// The placeholder Relation's slot in the pill column (see `relationPlusFor`).
const GHOST_PILL = "ghost:relation";
const SLOT_PILL = "slot:relation";
// Figma 328:20594 ("Select Relation"): the open Relation's two Entity Types sit 300px apart with
// its pill (180×28) centred between them; under each, its source table cards (270×64, inset 10)
// 20px below the node and 20px apart; the dashed drop line runs 29px in from the node's left.
const OPEN_LINK_GAP = 300;
const OPEN_PILL_W = 180;
const OPEN_PILL_H = 28;
const LADDER_INSET = 10;
const LADDER_GAP = 20;
const LADDER_HEAD = 34; // top border + 9px padding + the table row
const LADDER_ROW = 24;
const LADDER_FOOT = 6; // 5px padding + bottom border
const LADDER_RUNG_GAP = 20;
const LADDER_TRUNK = 29;
const LADDER_TABLE_W = NODE_W - LADDER_INSET;
const MAPPING_PREVIEW = 3;
const ladderTableH = (columns: number) =>
  LADDER_HEAD + Math.max(1, columns) * LADDER_ROW + LADDER_FOOT;

// Curve colours: a suggested (still in review) link vs a settled one.
const SUGGESTED = "#A855F7";
const SETTLED = "#9EA3A2";
// A Relation being created: its card's width (between its two Entity Types), and the room kept
// above the line for it when it opens.
const DRAFT_RELATION_W = 272;
const DRAFT_CARD_ROOM = 300;
const ARROW_SUGGESTED = "editing-graph-arrow-suggested";
const ARROW_SETTLED = "editing-graph-arrow-settled";
const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0.1 };
// A selected node / pill (Figma 542:27924 et al.): a near-black hairline on white.
// Figma "Node-Editing mode" (472:110792): Default gray, Focused blue, Selected near-black — all
// 1px — and Dim at 20%.
const SELECTED_NODE = "border-[#080a09] bg-white";
// A node with its list open reads as ONE card (like a workflow node's settings): the node is its
// header — status in a boxed icon — the list its body, and an ID line its foot, all inside the
// node's own frame (`frameOf`: black when selected, blue for the workspace's focus, else grey).
const frameOf = (selected: boolean, accent = false) =>
  selected ? "border-[#080a09]" : accent ? "border-[#3b82f6]" : "border-[#e3e5e4]";
// Figma 466:86067: the head runs straight into its list, no divider between them.
const ATTACHED_HEAD = "rounded-b-none border-b-0";
// An open Entity Type's list carries its ClassNode border down the card instead (see
// `classFrameOf`): the frame string is then the whole body style, marked with a prefix.
const CLASS_FRAME = "class-frame:";
const classFrameOf = (selected: boolean, focus: boolean) =>
  CLASS_FRAME + classNodeBodyClass({ selected, focus });
const attachedBody = (frame: string) =>
  frame.startsWith(CLASS_FRAME)
    ? frame.slice(CLASS_FRAME.length)
    : cn("rounded-b-lg rounded-t-none border border-t-0 bg-white", CARD_SHADOW, frame);
const CARD_SHADOW = "shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)]";

type Pt = { x: number; y: number };

/**
 * Moving Properties between Entity Types: drag a property row — it carries the whole selection
 * when the row is part of a multi-selection of that Entity Type's Properties — and drop it on
 * another Entity Type's property list, its node, or its row in the Entity types panel, which
 * lights up while it's a target. The moved Properties end up selected, and the list they landed in
 * scrolls to them. See `property-move.ts`.
 */
type PropertyMove = {
  startDrag: (entityId: string, propertyId: string, event: React.DragEvent) => void;
  endDrag: () => void;
  dropTargetId: string | null;
  // The Properties just moved (now selected): their new Entity Type's list scrolls to them.
  reveal: { entityId: string; ids: string[]; nonce: number } | null;
  dropProps: (entityId: string) => {
    onDragEnter: (event: React.DragEvent) => void;
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
  };
};
const PropertyMoveContext = createContext<PropertyMove | null>(null);

/**
 * Which items fall inside the AI Review bar's Confidence range and status filter. Out-of-scope
 * items are dimmed (`opacity-40`), never hidden — the same rule as the Overview (see
 * `isReviewItemInScope` / `isTableInScope` / `isColumnInScope`).
 */
type ReviewScope = {
  entity: (entity: Entity) => boolean;
  relation: (relation: Relation) => boolean;
  property: (property: Property) => boolean;
  table: (tableName: string) => boolean;
  column: (tableName: string, columnName: string) => boolean;
  // A link standing for several mappings: in scope while any of them is (a mapping's scope is its
  // Property's, as in `isColumnInScope`).
  mappings: (properties: Property[]) => boolean;
};
const ALL_IN_SCOPE: ReviewScope = {
  entity: () => true,
  relation: () => true,
  property: () => true,
  table: () => true,
  column: () => true,
  mappings: () => true,
};
const ReviewScopeContext = createContext<ReviewScope>(ALL_IN_SCOPE);
function useReviewScope(app: OntologyApp): ReviewScope {
  const { entities, confidenceRange: range, statusFilter } = app;
  return useMemo(
    () => ({
      entity: (e) => isReviewItemInScope(entityReview(e), e.confidence, range, statusFilter),
      relation: (r) => isReviewItemInScope(relationReview(r), r.confidence, range, statusFilter),
      property: (p) => isReviewItemInScope(propertyReview(p), p.confidence, range, statusFilter),
      table: (name) => isTableInScope(name, entities, range, statusFilter),
      column: (table, column) => isColumnInScope(table, column, entities, range, statusFilter),
      mappings: (properties) =>
        properties.length === 0 ||
        properties.some((p) =>
          isReviewItemInScope(propertyReview(p), p.confidence, range, statusFilter),
        ),
    }),
    [entities, range, statusFilter],
  );
}
const DIMMED = "opacity-20";

function usePropertyMove(app: OntologyApp): PropertyMove {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<PropertyMove["reveal"]>(null);
  useEffect(() => {
    const onReveal = (event: Event) => {
      const { entityId, ids } = (event as CustomEvent<{ entityId: string; ids: string[] }>).detail;
      setReveal({ entityId, ids, nonce: Date.now() });
    };
    window.addEventListener(REVEAL_PROPERTIES_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_PROPERTIES_EVENT, onReveal);
  }, []);
  return {
    dropTargetId,
    reveal,
    startDrag: (entityId, propertyId, event) => {
      event.stopPropagation();
      startPropertyDrag(app, entityId, propertyId, event);
      // The whole row follows the pointer.
      const row = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-property-row]");
      if (row) event.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2);
    },
    endDrag: () => {
      setPropertyDragSource(null);
      setDropTargetId(null);
    },
    dropProps: (entityId) => {
      // Accepting a drop takes cancelling both dragenter and dragover (some browsers need both).
      const accept = (event: React.DragEvent) => {
        if (!acceptsPropertyDrop(event, entityId)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTargetId(entityId);
      };
      return {
        onDragEnter: accept,
        onDragOver: accept,
        onDragLeave: (event) => {
          if (!leftDropTarget(event)) return;
          setDropTargetId((current) => (current === entityId ? null : current));
        },
        onDrop: (event) => {
          setDropTargetId(null);
          const ids = dropPropertiesOn(app, event, entityId);
          if (ids) setReveal({ entityId, ids, nonce: Date.now() });
        },
      };
    },
  };
}

const DROP_TARGET_CLASS = "!border-[#00ded8] !bg-[#00ded8]/10 shadow-[0_0_0_1.5px_#00ded8]";

/** A left-to-right cubic curve between two horizontal anchors. */
function curve(from: Pt, to: Pt): string {
  // Figma "Edge/Explorer": horizontal tangents, control distance = max(dx * 0.55, 24).
  const dx = Math.max(Math.abs(to.x - from.x) * 0.55, 24) * (to.x >= from.x ? 1 : -1);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y} ${to.x - dx} ${to.y} ${to.x} ${to.y}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A Property's mappings into one dataset (an Identifier can have several there: a composite key).
const mappingsIn = (property: Property, table: string) =>
  property.mappings.filter((m) => m.table === table);
const mapsInto = (property: Property, table: string) =>
  property.mappings.some((m) => m.table === table);

/** "367 columns · 19 entities" — a Data Table node's counts. */
function tableNodeCounts(table: TableSchema, entities: Entity[]) {
  const mapped = entities.filter((e) => e.properties.some((p) => mapsInto(p, table.name))).length;
  return `${plural(table.columns.length, "column", "columns")} · ${plural(mapped, "entity", "entities")}`;
}

function entityDetail(entity: Entity) {
  const tables = new Set(entity.properties.flatMap((p) => p.mappings.map((m) => m.table)));
  return `${plural(entity.properties.length, "prop", "props")} · ${plural(tables.size, "table", "tables")}`;
}

type Counterpart = {
  entity: Entity;
  relations: { relation: Relation; outgoing: boolean }[];
};

type Placed<T> = T & { y: number; h: number };

/** Stacks items of known heights, centered on `centerY`. */
/** Stacks items top to bottom around `centerY`; `padTop` / `padBottom` reserve extra room on one
 * side of an item without moving its own centre off its `h`. */
function stack<T extends { h: number; padTop?: number; padBottom?: number }>(
  items: T[],
  centerY: number,
): Placed<T>[] {
  const span = (item: T) => (item.padTop ?? 0) + item.h + (item.padBottom ?? 0);
  const total =
    items.reduce((sum, item) => sum + span(item), 0) + GAP_Y * Math.max(0, items.length - 1);
  let top = centerY - total / 2;
  return items.map((item) => {
    const placed = { ...item, y: top + (item.padTop ?? 0) + item.h / 2 };
    top += span(item) + GAP_Y;
    return placed;
  });
}

export function EditingGraphView({
  app,
  focusEntity,
  onEdit,
  onSplit,
}: {
  app: OntologyApp;
  focusEntity: Entity;
  // Opens the detail panel's item in the Edit modal (owned by the Entity mode around this view).
  onEdit?: (key: string) => void;
  // A Split made from the selection bar: the new Entity Type (for the workspace to point out).
  onSplit?: (newEntityId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const canvas = useEditingCanvas(viewportRef, worldRef, scaleRef);
  const move = usePropertyMove(app);
  const [handleLayer, setHandleLayer] = useState<SVGGElement | null>(null);

  // Open branches: `tables:<entityId>` / `props:<entityId>` for a related Entity Type (one at a
  // time per entity), `props:center`, and the "+ N more" toggles.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleEntityBranch = useCallback((entityId: string, kind: "tables" | "props") => {
    setOpen((current) => {
      const next = new Set(current);
      const key = `${kind}:${entityId}`;
      const other = `${kind === "tables" ? "props" : "tables"}:${entityId}`;
      next.delete(other);
      const wasOpen = next.has(key);
      // One related Entity Type's properties at a time (they bring it level with the middle).
      if (kind === "props") {
        [...next].forEach((k) => k.startsWith("props:") && k !== "props:center" && next.delete(k));
      }
      if (wasOpen) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // The Data Table pulled level with the middle node, its mappings laid out in between.
  const [focusedTable, setFocusedTable] = useState<string | null>(null);
  const focusTable = useCallback((name: string | null) => {
    setFocusedTable((current) => (current === name ? null : name));
    setOpen((current) => {
      const next = new Set(current);
      next.delete("props:center");
      return next;
    });
  }, []);
  const [inspectedTable, setInspectedTable] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Whether the open Relation shows all its mappings, past the first `MAPPING_PREVIEW`.
  const [allMappings, setAllMappings] = useState(false);
  // The Relation opened in place (see `openRelation`). Selecting a Relation opens it (selecting it
  // again closes it); selecting an Entity Type or Property, or closing the detail panel, closes
  // it — but inspecting one of its join tables keeps it open.
  const [openRelationId, setOpenRelationId] = useState<string | null>(null);
  // A related Entity Type's + (on its node's right edge, where its lines start): hovering it
  // previews a placeholder Relation in the pill column (the others make room); clicking it creates
  // the new Relation (that Entity Type → the selected one) and opens it to be named and mapped;
  // pressing and dragging draws the line, and releasing it on the selected Entity Type does the
  // same (elsewhere, or Esc, cancels).
  const [relationPlusFor, setRelationPlusFor] = useState<string | null>(null);
  const [relationDraw, setRelationDraw] = useState<{
    fromEntityId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const [drawPos, setDrawPos] = useState<Pt | null>(null);
  const [drawOverCenter, setDrawOverCenter] = useState(false);
  const ghostFor = relationDraw?.fromEntityId ?? relationPlusFor;
  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const r = worldRef.current?.getBoundingClientRect();
    const scale = scaleRef.current || 1;
    return { x: (clientX - (r?.left ?? 0)) / scale, y: (clientY - (r?.top ?? 0)) / scale };
  }, []);
  // A new Relation (`fromId` → the selected Entity Type) is created right away, unnamed, and
  // opened: the detail panel names it, the ladder shows the datasets it could be mapped through.
  const createRelation = useCallback(
    (fromId: string) => {
      const id = app.startRelationDraft(fromId, focusEntity.id);
      if (!id) return null;
      setInspectedTable(null);
      setFocusedTable(null);
      setAllMappings(false);
      setOpenRelationId(id);
      return id;
    },
    [app, focusEntity.id],
  );
  useEffect(() => {
    if (!relationDraw) return;
    const overCenter = (x: number, y: number) =>
      !!document.elementFromPoint(x, y)?.closest("[data-graph-center]");
    const clear = () => {
      setRelationDraw(null);
      setDrawPos(null);
      setDrawOverCenter(false);
    };
    const onMove = (event: PointerEvent) => {
      setDrawPos(toWorld(event.clientX, event.clientY));
      setDrawOverCenter(overCenter(event.clientX, event.clientY));
    };
    const onUp = (event: PointerEvent) => {
      const moved = Math.hypot(
        event.clientX - relationDraw.startX,
        event.clientY - relationDraw.startY,
      );
      if (moved < 4 || overCenter(event.clientX, event.clientY)) {
        createRelation(relationDraw.fromEntityId);
      }
      clear();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [relationDraw, createRelation, toWorld]);

  // Shift/⌘/ctrl held on the last press on the canvas: that click adds to (or removes from) the
  // multi-selection instead of inspecting (see `SelectionActions`).
  const multiRef = useRef(false);
  const inspect = useCallback(
    (ref: SuggestionRef) => {
      setInspectedTable(null);
      if (multiRef.current) {
        app.toggleSuggestionSelected(ref);
        return;
      }
      setOpenRelationId(ref.kind === "relation" ? ref.id : null);
      setAllMappings(false);
      if (ref.kind === "relation") setFocusedTable(null);
      app.selectSuggestionKeys([suggestionKey(ref)]);
    },
    [app],
  );
  const inspectTable = useCallback(
    (name: string) => {
      app.clearSuggestionSelection();
      setInspectedTable(name);
    },
    [app],
  );
  const closeDetail = useCallback(() => {
    setInspectedTable(null);
    setOpenRelationId(null);
    app.clearSuggestionSelection();
  }, [app]);

  // Dragging from the side panels (see `panel-dnd`). An Entity Type: the related Entity Types'
  // column lights up as the drop zone, and a dashed slot follows the pointer through it (the rows
  // make room); dropping creates a Relation (it → the selected one), opened to be named, with the
  // Entity Type exactly where it was dropped. A Data Table: added to its column, listed first.
  // Reset per Entity.
  const [dragKind, setDragKind] = useState<"entity" | "table" | null>(null);
  // Where the dragged Entity Type would land: its index among the shown related Entity Types.
  const [entitySlot, setEntitySlot] = useState<number | null>(null);
  // The related Entity Types' order this session, once a drop has placed one (else the data's).
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [addedTableNames, setAddedTableNames] = useState<string[]>([]);
  useEffect(() => {
    setCustomOrder(null);
    setAddedTableNames([]);
  }, [focusEntity.id]);
  useEffect(() => {
    const end = () => {
      setDragKind(null);
      setEntitySlot(null);
    };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
  const dragKindOf = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(ENTITY_PANEL_DND_TYPE)
      ? ("entity" as const)
      : event.dataTransfer.types.includes(TABLE_PANEL_DND_TYPE)
        ? ("table" as const)
        : null;
  const handlePanelDrop = (event: React.DragEvent) => {
    const entityId = event.dataTransfer.getData(ENTITY_PANEL_DND_TYPE);
    const tableName = event.dataTransfer.getData(TABLE_PANEL_DND_TYPE);
    const index = entitySlot;
    setDragKind(null);
    setEntitySlot(null);
    if (entityId) {
      // Only the related Entity Types' column takes it.
      if (index === null) return;
      event.preventDefault();
      if (!createRelation(entityId)) return;
      // Where it lands: before whichever shown Entity Type the slot was in front of.
      const shownIds = leftAll.map((cp) => cp.entity.id).filter((id) => id !== entityId);
      const allIds = counterparts.map((cp) => cp.entity.id);
      setCustomOrder((prev) => {
        const order = (prev ?? allIds).filter((id) => id !== entityId);
        const before = shownIds[index];
        const last = shownIds[shownIds.length - 1];
        const at = before ? order.indexOf(before) : last ? order.indexOf(last) + 1 : 0;
        order.splice(at < 0 ? order.length : at, 0, entityId);
        return order;
      });
    } else if (tableName) {
      event.preventDefault();
      setAddedTableNames((names) => [tableName, ...names.filter((n) => n !== tableName)]);
      setFocusedTable(null);
    }
  };

  // A Relation being created is always the open one (its ladder is where it gets mapped).
  const draftRelationId = app.creation?.kind === "relation" ? app.creation.id : null;
  useEffect(() => {
    if (draftRelationId) setOpenRelationId(draftRelationId);
  }, [draftRelationId]);
  // An opened Relation's ladder hangs below it: make room for it above the detail panel. One
  // being created also has its card above the line (`RelationDraftCard`), and no detail panel.
  const { liftAnchorTo, placeAnchorAt } = canvas;
  useEffect(() => {
    if (!openRelationId) return;
    if (openRelationId === draftRelationId) placeAnchorAt(DRAFT_CARD_ROOM);
    else liftAnchorTo(0.14);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a Relation opens
  }, [openRelationId]);

  // --- Data -------------------------------------------------------------------------------
  const counterparts = useMemo<Counterpart[]>(() => {
    const byId = new Map<string, Counterpart>();
    app.relations.forEach((relation) => {
      if (relation.from !== focusEntity.id && relation.to !== focusEntity.id) return;
      const outgoing = relation.from === focusEntity.id;
      const otherId = outgoing ? relation.to : relation.from;
      if (otherId === focusEntity.id) return; // self relations aren't a branch
      const entity = app.entities.find((e) => e.id === otherId);
      if (!entity) return;
      const entry = byId.get(entity.id) ?? { entity, relations: [] };
      entry.relations.push({ relation, outgoing });
      byId.set(entity.id, entry);
    });
    const list = [...byId.values()];
    if (!customOrder) return list;
    const rank = (id: string) => {
      const i = customOrder.indexOf(id);
      return i === -1 ? customOrder.length : i;
    };
    return list.sort((a, b) => rank(a.entity.id) - rank(b.entity.id));
  }, [app.relations, app.entities, focusEntity.id, customOrder]);

  const tables = useMemo(() => {
    const used = tablesUsedByEntity(focusEntity);
    const names = [...addedTableNames, ...used.filter((name) => !addedTableNames.includes(name))];
    return names
      .map((name) => tableByName(name))
      .filter((table): table is TableSchema => !!table)
      .map((table) => ({
        table,
        mapped: focusEntity.properties.filter((p) => mapsInto(p, table.name)),
      }))
      .sort((a, b) => {
        // Tables added from the panel stay on top (most recent first); the rest by mappings.
        const ai = addedTableNames.indexOf(a.table.name);
        const bi = addedTableNames.indexOf(b.table.name);
        if (ai !== -1 || bi !== -1)
          return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
        return b.mapped.length - a.mapped.length;
      });
  }, [focusEntity, addedTableNames]);

  // --- Layout -----------------------------------------------------------------------------
  // A related Entity Type with its properties open is shown on its own, level with the middle
  // node, its property panel under it (Figma 507:27168); the others step aside until it closes.
  const propsEntityId =
    counterparts.find((cp) => open.has(`props:${cp.entity.id}`))?.entity.id ?? null;
  const leftAll = propsEntityId
    ? counterparts.filter((cp) => cp.entity.id === propsEntityId)
    : open.has("more:left")
      ? counterparts
      : counterparts.slice(0, PREVIEW);
  // The opened Relation: its counterpart, and table by table the source columns its join keys
  // come from — ordered left ↔ right like the graph (the related Entity Type's side, then the
  // selected one's), never as `Entity[column]`, since these are table columns, not properties.
  const openRelation = (() => {
    if (!openRelationId) return null;
    for (const cp of leftAll) {
      const hit = cp.relations.find(({ relation }) => relation.id === openRelationId);
      if (!hit) continue;
      const { relation } = hit;
      const nameOf = (id: string) => app.entities.find((e) => e.id === id)?.name || "Untitled";
      const leftIsFrom = relation.from === cp.entity.id;
      const fromEntity = app.entities.find((e) => e.id === relation.from);
      const toEntity = app.entities.find((e) => e.id === relation.to);
      // One rung per dataset, each ONE table both sides' columns come from: the saved mappings,
      // then the datasets it could still be mapped through — both Identifiers mapped there
      // (one click maps it), or only one (the other side's identifier column is picked first).
      const rungOf = (
        table: string,
        fromColumns: string[],
        toColumns: string[],
        kind: LadderRung["kind"],
        missing?: { from: Property[]; to: Property[] },
        aliases?: { from?: string | undefined; to?: string | undefined },
      ) => {
        const from: MappingSide = {
          table,
          columns: fromColumns,
          entity: nameOf(relation.from),
          entityId: relation.from,
          ...(aliases?.from ? { alias: aliases.from } : {}),
          ...(missing ? { missing: missing.from } : {}),
        };
        const to: MappingSide = {
          table,
          columns: toColumns,
          entity: nameOf(relation.to),
          entityId: relation.to,
          ...(aliases?.to ? { alias: aliases.to } : {}),
          ...(missing ? { missing: missing.to } : {}),
        };
        const [left, right] = leftIsFrom ? [from, to] : [to, from];
        const key = relationMappingKey({ table, fromAlias: aliases?.from, toAlias: aliases?.to });
        return { key: `${kind}:${key}`, left, right, kind };
      };
      const joins = relationJoins(relation, app.entities);
      // One candidate per pair of occurrences (a dataset with aliases offers one per alias).
      const candidates = relationMappingCandidates(fromEntity, toEntity).filter(
        (c) => !joins.some((j) => relationMappingKey(j) === relationMappingKey(c)),
      );
      const mappings = [
        ...joins.map((join) => ({
          ...rungOf(join.table, join.fromColumns, join.toColumns, "saved", undefined, {
            from: join.fromAlias,
            to: join.toAlias,
          }),
          join,
        })),
        ...candidates.map((c) =>
          rungOf(c.table, c.fromColumns, c.toColumns, "candidate", undefined, {
            from: c.fromAlias,
            to: c.toAlias,
          }),
        ),
      ];
      return {
        relation,
        entityId: cp.entity.id,
        pillIndex: cp.relations.indexOf(hit),
        pillCount: cp.relations.length,
        suggested: relationReview(relation) === "suggested",
        saved: joins.length,
        mappings,
        shown: allMappings ? mappings : mappings.slice(0, MAPPING_PREVIEW),
        hidden: allMappings ? 0 : Math.max(0, mappings.length - MAPPING_PREVIEW),
      };
    }
    return null;
  })();
  const ex = ENTITY_X;
  const bx = BRANCH_X;
  const jx = BRANCH_JOIN_X;
  // Relation pills get their own column (Figma 508:37232): 80px past the Entity Types, stacked in
  // Entity Type order around the middle node's height — tighter than the Entity Types themselves —
  // so every entity → pill and pill → middle curve fans in without crossing another.
  const pillX = ENTITY_X + NODE_W + PILL_GAP;

  // The drop slot among the shown related Entity Types, following the pointer while dragging.
  const slotIndex = dragKind === "entity" ? entitySlot : null;
  const entityEntries = [
    ...leftAll.map((cp) => {
      const branch = open.has(`tables:${cp.entity.id}`)
        ? ("tables" as const)
        : open.has(`props:${cp.entity.id}`)
          ? ("props" as const)
          : null;
      const branchTables = branch === "tables" ? tablesUsedByEntity(cp.entity) : [];
      const branchH = branch === "tables" ? branchTables.length * (NODE_H + GAP_Y) - GAP_Y : 0;
      return {
        kind: "entity" as const,
        key: `entity:${cp.entity.id}`,
        cp,
        branch,
        branchTables,
        branchH,
        h: Math.max(NODE_H, cp.relations.length * 26, branchH),
      };
    }),
  ];
  const leftEntries = [
    ...(slotIndex === null
      ? entityEntries
      : [
          ...entityEntries.slice(0, slotIndex),
          { kind: "ghost" as const, key: "ghost:left", h: NODE_H },
          ...entityEntries.slice(slotIndex),
        ]),
    ...(counterparts.length > PREVIEW && !propsEntityId
      ? [
          {
            kind: "more" as const,
            key: "more:left",
            h: MORE_H,
            hidden: counterparts.length - PREVIEW,
          },
        ]
      : []),
  ];
  // The open Relation's "ladder": one rung per join — a source table under each Entity Type, tops
  // measured from that Entity Type's centre, the same on both sides so the column link runs
  // parallel to the Relation above it.
  const ladder = (() => {
    if (!openRelation) return null;
    let top = NODE_H / 2 + LADDER_GAP;
    const rungs = openRelation.shown.map((mapping) => {
      const rung = { ...mapping, top };
      top +=
        Math.max(ladderTableH(sideRows(mapping.left)), ladderTableH(sideRows(mapping.right))) +
        LADDER_RUNG_GAP;
      return rung;
    });
    const toggleable = openRelation.mappings.length > MAPPING_PREVIEW;
    const bottom = rungs.length === 0 ? top + 24 : top - LADDER_RUNG_GAP + (toggleable ? 30 : 0);
    return { rungs, moreTop: top - LADDER_RUNG_GAP + 6, toggleable, bottom };
  })();
  // The open Relation's Entity Type reserves room under itself for its half of the ladder; the
  // stack is then shifted so that Entity Type (and everything above it) stays exactly where it
  // was, and only what's below moves down.
  // While a Relation is open, the other related Entity Types step aside (hidden, in place) and its
  // own Entity Type springs level with the middle node, so the Relation reads as one straight
  // line with its pill centred on it and its ladder square underneath.
  const leftItems = (() => {
    const base = stack(leftEntries, 0);
    if (!openRelation || !ladder) return base;
    return base.map((item) =>
      item.kind === "entity" && item.cp.entity.id === openRelation.entityId
        ? { ...item, y: 0 }
        : item,
    );
  })();
  // The related Entity Types' column as a drop zone (world coordinates), padded around its rows.
  const dropZone = (() => {
    const rows = leftItems.filter((i) => i.kind !== "more");
    const top = rows.length ? Math.min(...rows.map((i) => i.y - i.h / 2)) : -NODE_H / 2;
    const bottom = rows.length ? Math.max(...rows.map((i) => i.y + i.h / 2)) : NODE_H / 2;
    return { x: ex - 16, y: top - 16, w: NODE_W + 32, h: bottom - top + 32 };
  })();
  const openItem = openRelation
    ? leftItems.find((i) => i.kind === "entity" && i.cp.entity.id === openRelation.entityId)
    : undefined;
  // The two ends of the ladder: the related Entity Type's node (moved in to `OPEN_LINK_GAP`) and
  // the middle node.
  const openEntityX = CENTER_LEFT - OPEN_LINK_GAP - NODE_W;
  const ladderEnds =
    openRelation && ladder && openItem
      ? { left: { x: openEntityX, y: openItem.y }, right: { x: CENTER_LEFT, y: 0 } }
      : null;
  // The open Relation's pill, centred between its two Entity Types.
  const openPillX = openEntityX + NODE_W + (OPEN_LINK_GAP - OPEN_PILL_W) / 2;
  // Where an Entity Type's node sits: the open Relation's moves in; the rest stay in their column.
  const entityXOf = (entityId: string) =>
    ladderEnds && openRelation?.entityId === entityId ? openEntityX : ex;
  // While a Relation is open, everything else — the other related Entity Types, their Relations,
  // the Data Tables — is hidden in place, and comes back when it closes.
  const isOtherEntity = (key: string) => !!ladderEnds && key !== `entity:${openRelation?.entityId}`;
  const faded = (key: string) =>
    isOtherEntity(key) ? "pointer-events-none opacity-0" : "opacity-100";

  // Each Relation pill's centre y. While a Relation is open, it sits on the straight line between its
  // two Entity Types (y 0); the others keep their slots (hidden).
  const pillY = (() => {
    const ids: { id: string; entityId: string }[] = [];
    for (const item of leftItems) {
      // The drop slot's row keeps an empty pill slot, where its new Relation will appear.
      if (item.kind === "ghost") {
        ids.push({ id: SLOT_PILL, entityId: SLOT_PILL });
        continue;
      }
      if (item.kind !== "entity") continue;
      for (const { relation } of item.cp.relations)
        ids.push({ id: relation.id, entityId: item.cp.entity.id });
      if (!ladderEnds && ghostFor === item.cp.entity.id) {
        ids.push({ id: GHOST_PILL, entityId: item.cp.entity.id });
      }
    }
    const ys: number[] = [];
    ids.forEach((r, i) => {
      const prev = ids[i - 1];
      ys.push(!prev ? 0 : ys[i - 1]! + (prev.entityId === r.entityId ? PILL_SLOT_SAME : PILL_SLOT));
    });
    const mid = ys.length ? (ys[0]! + ys[ys.length - 1]!) / 2 : 0;
    const map = new Map(ids.map((r, i) => [r.id, ys[i]! - mid]));
    if (ladderEnds && openRelation) map.set(openRelation.relation.id, 0);
    return map;
  })();

  const focused = focusedTable ? tables.find((t) => t.table.name === focusedTable) : undefined;
  const rightAll = open.has("more:right") ? tables : tables.slice(0, PREVIEW);
  const rightItems = focused
    ? [{ kind: "table" as const, key: `table:${focused.table.name}`, ...focused, h: NODE_H, y: 0 }]
    : stack(
        [
          ...(dragKind === "table"
            ? [{ kind: "ghost" as const, key: "ghost:right", h: NODE_H }]
            : []),
          ...rightAll.map((t) => ({
            kind: "table" as const,
            key: `table:${t.table.name}`,
            ...t,
            h: NODE_H,
          })),
          ...(tables.length > PREVIEW
            ? [
                {
                  kind: "more" as const,
                  key: "more:right",
                  h: MORE_H,
                  hidden: tables.length - PREVIEW,
                },
              ]
            : []),
        ],
        0,
      );

  const leftView = leftItems;
  const rightView = rightItems;

  // A new Entity Type being created here: named on its own node, its Properties added in the panel
  // under it (always open), and created or dropped from the bar at the bottom.
  const draftEntity =
    app.creation?.kind === "entity" && app.creation.id === focusEntity.id ? focusEntity : null;
  const centerPropsOpen = open.has("props:center") && !draftEntity && !focused && !ladderEnds;
  // The middle node with a list open under it (its Properties, or a focused table's mappings).
  const centerAttached = centerPropsOpen || !!focused;

  // The selected Entity Type's property panel: Filter / Sort / Search, the same rules as the
  // other Property lists (reset when the Entity Type changes).
  const [propFilter, setPropFilter] = useState<ListFilter>("all");
  const [propSort, setPropSort] = useState<SortState>(DEFAULT_SORT);
  const [propSearch, setPropSearch] = useState("");
  useEffect(() => {
    setPropFilter("all");
    setPropSort(DEFAULT_SORT);
    setPropSearch("");
  }, [focusEntity.id]);
  const centerProperties = useMemo(
    () => filterProperties(focusEntity.properties, propFilter, propSearch, propSort),
    [focusEntity.properties, propFilter, propSearch, propSort],
  );

  // --- Selection / detail panel ------------------------------------------------------------
  const selected = app.suggestionSelection;
  const isSelected = (ref: SuggestionRef) => selected.has(suggestionKey(ref));
  const detailItem = resolveDetailItem(app, inspectedTable);
  const shownProps = focused ? focused.mapped : centerPropsOpen ? centerProperties : [];
  const queue = [
    ...leftAll
      .filter(({ entity }) => entityReview(entity) === "suggested")
      .map(({ entity }) => suggestionKey({ kind: "entity", id: entity.id })),
    ...leftAll.flatMap(({ relations }) =>
      relations
        .filter(({ relation }) => relationReview(relation) === "suggested")
        .map(({ relation }) => suggestionKey({ kind: "relation", id: relation.id })),
    ),
    ...(entityReview(focusEntity) === "suggested"
      ? [suggestionKey({ kind: "entity", id: focusEntity.id })]
      : []),
    ...shownProps
      .filter((p) => propertyReview(p) === "suggested")
      .map((p) => suggestionKey({ kind: "property", entityId: focusEntity.id, propertyId: p.id })),
  ];

  // The review bar counts what this graph is about: the selected Entity Type, the Entity Types
  // and Relations around it, its Properties, and their mappings.
  const reviewScope = useReviewScope(app);
  const scope = useMemo<SuggestionScope>(() => {
    const entityIds = new Set([focusEntity.id, ...counterparts.map((cp) => cp.entity.id)]);
    const relationIds = new Set(
      counterparts.flatMap((cp) => cp.relations.map(({ relation }) => relation.id)),
    );
    return {
      entity: (entity) => entityIds.has(entity.id),
      property: (owner) => owner.id === focusEntity.id,
      relation: (relation) => relationIds.has(relation.id),
      mapping: (owner) => owner.id === focusEntity.id,
    };
  }, [focusEntity.id, counterparts]);

  // Hover emphasis: a hovered node lights up its own curve(s) and fades the rest.
  const lit = (edgeKey: string) =>
    ladderEnds ? edgeKey === `entity:${openRelation?.entityId}` : !hovered || hovered === edgeKey;
  const hoverProps = (key: string) => ({
    onMouseEnter: () => setHovered(key),
    onMouseLeave: () => setHovered((h) => (h === key ? null : h)),
  });

  const tableStatus = (table: TableSchema) => (
    <MappingStatusBadge
      status={tableMappingStatus(table.name, app.entities)}
      {...tableMappingCompleteness(table.name, app.entities)}
      size={20}
    />
  );

  return (
    <ReviewScopeContext.Provider value={reviewScope}>
      <HandleLayerContext.Provider value={handleLayer}>
        <PropertyMoveContext.Provider value={move}>
          <CanvasZoomCard canvas={canvas} />
          <div
            ref={viewportRef}
            data-canvas-viewport
            onPointerDownCapture={(event) => {
              multiRef.current = event.shiftKey || event.metaKey || event.ctrlKey;
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 && event.button !== 1) return;
              if (canvas.tool === "pan" || event.button === 1 || isCanvasBackground(event.target)) {
                canvas.startPan(event);
              }
            }}
            onPointerMove={(event) => canvas.panning && canvas.movePan(event)}
            onPointerUp={canvas.endPan}
            onPointerCancel={canvas.endPan}
            onClick={(event) => {
              if (!canvas.consumePanClick() && isCanvasBackground(event.target)) closeDetail();
            }}
            onDragOver={(event) => {
              const kind = dragKindOf(event);
              if (!kind) return;
              if (dragKind !== kind) setDragKind(kind);
              if (kind === "entity") {
                // Only over the related Entity Types' column: the slot goes in front of the first
                // shown Entity Type below the pointer.
                const p = toWorld(event.clientX, event.clientY);
                const inZone =
                  p.x >= dropZone.x - 40 &&
                  p.x <= dropZone.x + dropZone.w + 40 &&
                  p.y >= dropZone.y - 40 &&
                  p.y <= dropZone.y + dropZone.h + 40;
                if (!inZone) {
                  if (entitySlot !== null) setEntitySlot(null);
                  return;
                }
                const index = leftItems.filter((i) => i.kind === "entity" && i.y < p.y).length;
                if (entitySlot !== index) setEntitySlot(index);
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDragKind(null);
              setEntitySlot(null);
            }}
            onDrop={handlePanelDrop}
            className={cn(
              // A canvas, not a document: clicks (and shift-clicks) never select text.
              "relative min-h-0 flex-1 cursor-default select-none overflow-hidden [&_input]:select-text [&_textarea]:select-text",
              canvas.panning && "cursor-grabbing",
            )}
            style={{
              backgroundImage: "radial-gradient(circle, #e3e5e4 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          >
            <div
              ref={worldRef}
              data-canvas-lod={canvas.lod}
              className="absolute top-[40%] origin-top-left"
              // Centered on the graph as a whole (Entity Types → Data Tables), not on the middle node,
              // which sits left of centre now that the related Entity Types are further out.
              style={{ left: `calc(50% - ${GRAPH_MID_X}px)`, transform: canvas.worldTransform }}
            >
              {/* Curves (under the nodes). */}
              <svg
                className="pointer-events-none absolute left-0 top-0 overflow-visible"
                width={1}
                height={1}
              >
                <ArrowMarkers />
                {dragKind === "table" && rightView[0]?.kind === "ghost" && (
                  <path
                    d={curve({ x: CENTER_RIGHT, y: 0 }, { x: TABLE_X, y: rightView[0].y })}
                    fill="none"
                    stroke={SETTLED}
                    strokeWidth={1.5}
                  />
                )}
                {leftView.map((item) => {
                  if (item.kind !== "entity") return null;
                  const entityLeft = { x: ex, y: item.y };
                  const branchTables = stack(
                    item.branchTables.map((name) => ({ name, h: NODE_H })),
                    item.y,
                  );
                  return (
                    <g
                      key={`edge-${item.key}`}
                      style={{
                        opacity: isOtherEntity(item.key) ? 0 : lit(item.key) ? 1 : 0.2,
                        transition: "opacity 300ms",
                      }}
                    >
                      {ghostFor === item.cp.entity.id && pillY.has(GHOST_PILL) && (
                        <g stroke="#d3d5d4" strokeWidth={1.5} opacity={0.7} fill="none">
                          <path
                            d={curve(
                              { x: ex + NODE_W, y: item.y },
                              { x: pillX, y: pillY.get(GHOST_PILL)! },
                            )}
                          />
                          <path
                            d={curve(
                              { x: pillX + PILL_W, y: pillY.get(GHOST_PILL)! },
                              { x: CENTER_LEFT, y: 0 },
                            )}
                          />
                        </g>
                      )}
                      {relationDraw?.fromEntityId === item.cp.entity.id && drawPos && (
                        <path
                          d={`M ${ex + NODE_W} ${item.y} L ${drawPos.x} ${drawPos.y}`}
                          fill="none"
                          stroke={SETTLED}
                          strokeWidth={2}
                        />
                      )}
                      {item.cp.relations.map(({ relation }) => {
                        const y = pillY.get(relation.id) ?? item.y;
                        const isOpen = !!ladderEnds && relation.id === openRelationId;
                        const relSuggested = relationReview(relation) === "suggested";
                        return (
                          <g
                            key={relation.id}
                            style={{
                              opacity: ladderEnds && !isOpen ? 0 : 1,
                              transition: "opacity 300ms",
                            }}
                          >
                            {/* The arrow points at the Relation's `to` side: into the middle node,
                            or — when the middle node is its subject — back at this Entity Type. */}
                            <Curve
                              d={curve(
                                { x: entityXOf(item.cp.entity.id) + NODE_W, y: item.y },
                                { x: isOpen ? openPillX : pillX, y },
                              )}
                              suggested={relSuggested}
                              bold={hovered === item.key || isOpen}
                              dimmed={!reviewScope.relation(relation)}
                              handles="start"
                              arrow={relation.from === focusEntity.id ? "start" : undefined}
                            />
                            <Curve
                              d={curve(
                                { x: isOpen ? openPillX + OPEN_PILL_W : pillX + PILL_W, y },
                                { x: CENTER_LEFT, y: 0 },
                              )}
                              suggested={relSuggested}
                              bold={hovered === item.key || isOpen}
                              dimmed={!reviewScope.relation(relation)}
                              handles="end"
                              arrow={relation.from === focusEntity.id ? undefined : "end"}
                            />
                          </g>
                        );
                      })}
                      {branchTables.map((b) => (
                        <Curve
                          key={b.name}
                          d={curve({ x: bx + NODE_W, y: b.y }, { x: jx, y: item.y })}
                          dimmed={
                            !reviewScope.mappings(
                              item.cp.entity.properties.filter((p) => mapsInto(p, b.name)),
                            )
                          }
                          suggested={item.cp.entity.properties.some((p) =>
                            mappingsIn(p, b.name).some((m) => mappingStatus(m) === "suggested"),
                          )}
                        />
                      ))}
                      {branchTables.length > 0 && (
                        <Curve
                          d={`M ${jx} ${item.y} L ${entityLeft.x} ${entityLeft.y}`}
                          suggested={false}
                        />
                      )}
                    </g>
                  );
                })}
                <AnimatePresence>
                  {ladderEnds && openRelation && ladder && (
                    <LadderLinks
                      key={`ladder-${openRelation.relation.id}`}
                      ends={ladderEnds}
                      rungs={ladder.rungs}
                      empty={ladder.rungs.length === 0}
                      suggested={openRelation.suggested}
                      dimmed={!reviewScope.relation(openRelation.relation)}
                    />
                  )}
                </AnimatePresence>
                {rightView.map((item) => {
                  // Only a table the selected Entity Type maps (or is suggested to map) into is linked.
                  if (item.kind !== "table" || item.mapped.length === 0) return null;
                  const suggested = item.mapped.some((p) =>
                    mappingsIn(p, item.table.name).some((m) => mappingStatus(m) === "suggested"),
                  );
                  return (
                    <g
                      key={`edge-${item.key}`}
                      style={{
                        opacity: isOtherEntity(item.key) ? 0 : lit(item.key) ? 1 : 0.2,
                        transition: "opacity 300ms",
                      }}
                    >
                      <Curve
                        d={curve({ x: CENTER_RIGHT, y: 0 }, { x: TABLE_X, y: item.y })}
                        suggested={suggested}
                        dimmed={!reviewScope.mappings(item.mapped)}
                        bold={hovered === item.key}
                      />
                    </g>
                  );
                })}
              </svg>
              <HandleLayer onLayer={setHandleLayer} />

              {/* The selected Entity Type. */}
              <Node x={CENTER_LEFT} y={-CENTER_H / 2}>
                {draftEntity ? (
                  <EntityDraftCard app={app} entity={draftEntity} />
                ) : (
                  <div
                    data-canvas-card
                    role="button"
                    tabIndex={0}
                    data-graph-center
                    {...move.dropProps(focusEntity.id)}
                    onClick={() => inspect({ kind: "entity", id: focusEntity.id })}
                    className={cn(
                      classNodeClass({
                        selected: isSelected({ kind: "entity", id: focusEntity.id }),
                        focus: !isSelected({ kind: "entity", id: focusEntity.id }),
                        dimmed: !reviewScope.entity(focusEntity),
                        attached: centerAttached,
                      }),
                      "pr-2",
                      drawOverCenter && "border-[#00ded8] bg-[#ecf3f2]",
                      move.dropTargetId === focusEntity.id && DROP_TARGET_CLASS,
                    )}
                    style={{ width: CENTER_W, height: CENTER_H }}
                  >
                    <ClassNodeBody
                      icon={
                        entityDisplayStatus(focusEntity) === "suggested" ? undefined : (
                          <ItemStatusIcon status={entityDisplayStatus(focusEntity)} size={20} />
                        )
                      }
                      name={focusEntity.name || "New entity type"}
                      lodName="lod-title"
                      nameClassName={focusEntity.name ? undefined : "text-[#9ea3a2]"}
                      counts={classNodeCounts(focusEntity)}
                      mapping={classNodeMapping(focusEntity)}
                    />
                    {centerAttached && <ClassNodeDivider />}
                    {entityReview(focusEntity) === "suggested" && (
                      <span className="lod-confidence contents">
                        <EntityConfidenceChip entity={focusEntity} tone="muted" size="node" />
                      </span>
                    )}
                    <ExpandChevron
                      open={centerPropsOpen || !!focused}
                      label={centerPropsOpen || focused ? "Hide properties" : "Show properties"}
                      onClick={() =>
                        focused ? focusTable(focused.table.name) : toggle("props:center")
                      }
                    />
                  </div>
                )}
                {centerPropsOpen && (
                  <div className="absolute left-0 top-full" style={{ width: CENTER_W }}>
                    <PropertyPanel
                      frame={classFrameOf(
                        isSelected({ kind: "entity", id: focusEntity.id }),
                        !isSelected({ kind: "entity", id: focusEntity.id }),
                      )}
                      entityId={focusEntity.id}
                      properties={centerProperties}
                      filter={propFilter}
                      onFilterChange={setPropFilter}
                      sort={propSort}
                      onSortChange={(key) => setPropSort((prev) => nextSortState(prev, key))}
                      search={propSearch}
                      onSearchChange={setPropSearch}
                      onCreateProperty={(draft) => createPropertyIn(app, focusEntity.id, draft)}
                      onUpdateProperty={(id, patch) =>
                        app.updateProperty(focusEntity.id, id, patch)
                      }
                      identifierName={identifierNames(focusEntity)}
                      keyPartOf={(p) => keyPartOf(focusEntity, p)}
                      isSelected={(p) =>
                        isSelected({ kind: "property", entityId: focusEntity.id, propertyId: p.id })
                      }
                      onSelect={(p) =>
                        inspect({ kind: "property", entityId: focusEntity.id, propertyId: p.id })
                      }
                    />
                  </div>
                )}
              </Node>

              {/* Related Entity Types, each with its Relation pills on the curve. */}
              {leftView.map((item) => {
                if (item.kind === "ghost") {
                  return (
                    <Node key={item.key} x={ex} y={item.y - NODE_H / 2}>
                      <DropSlot
                        tone="relation"
                        label={dragKind === "entity" ? "Drop to add a relation" : "New relation"}
                      />
                    </Node>
                  );
                }
                if (item.kind === "more") {
                  return (
                    <Node key={item.key} x={ex + NODE_W / 2} y={item.y - MORE_H / 2}>
                      <div
                        className={cn(
                          "transition-opacity duration-300",
                          ladderEnds && "pointer-events-none opacity-0",
                        )}
                      >
                        <MoreButton
                          centered
                          label={open.has("more:left") ? "Show less" : `+ ${item.hidden} more`}
                          onClick={() => toggle("more:left")}
                        />
                      </div>
                    </Node>
                  );
                }
                const { entity, relations } = item.cp;
                // Its pills sit in the pill column (see `pillY`).
                const isOpenEntity = !!ladderEnds && openRelation?.entityId === entity.id;

                const branchTables = stack(
                  item.branchTables.map((name) => ({ name, h: NODE_H })),
                  item.y,
                );
                return (
                  <div
                    key={item.key}
                    {...hoverProps(item.key)}
                    className={cn("transition-opacity duration-300", faded(item.key))}
                  >
                    <Node x={entityXOf(entity.id)} y={item.y - NODE_H / 2}>
                      <div className="group/gnode relative">
                        {!ladderEnds && (
                          <button
                            type="button"
                            aria-label={`Create a relation from ${entity.name} to ${focusEntity.name}`}
                            onMouseEnter={() => setRelationPlusFor(entity.id)}
                            onMouseLeave={() =>
                              setRelationPlusFor((current) =>
                                current === entity.id ? null : current,
                              )
                            }
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              event.preventDefault();
                              setRelationDraw({
                                fromEntityId: entity.id,
                                startX: event.clientX,
                                startY: event.clientY,
                              });
                              setDrawPos(toWorld(event.clientX, event.clientY));
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (event.detail === 0) createRelation(entity.id);
                            }}
                            className={cn(
                              "group/relplus absolute left-full top-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-opacity focus-visible:opacity-100",
                              relationDraw?.fromEntityId === entity.id
                                ? "opacity-100"
                                : "opacity-0 group-hover/gnode:opacity-100",
                            )}
                          >
                            {/* Figma 356:184372 / 356:184367: white at rest, blue under the pointer. */}
                            {relationDraw?.fromEntityId === entity.id ? (
                              <FigmaIcon src={relationPlusHoverIcon} size={20} />
                            ) : (
                              <>
                                <FigmaIcon
                                  src={relationPlusIcon}
                                  size={20}
                                  className="group-hover/relplus:hidden"
                                />
                                <FigmaIcon
                                  src={relationPlusHoverIcon}
                                  size={20}
                                  className="hidden group-hover/relplus:block"
                                />
                              </>
                            )}
                          </button>
                        )}
                        {/* The Data Tables button, floating on the node's left: shown on hover — and
                        kept while its tables are open, since their lines meet at it. (Properties
                        open from the node's own chevron.) */}
                        <div
                          className={cn(
                            "absolute right-full top-1/2 mr-2 flex -translate-y-1/2 gap-1 transition-opacity",
                            item.branch === "tables"
                              ? "opacity-100"
                              : "opacity-0 group-hover/gnode:opacity-100 focus-within:opacity-100",
                          )}
                        >
                          <BranchButton
                            active={item.branch === "tables"}
                            label={`Show ${entity.name}'s data tables`}
                            onClick={() => toggleEntityBranch(entity.id, "tables")}
                          >
                            <Table2 className="size-4" strokeWidth={1.5} />
                          </BranchButton>
                        </div>
                        <GraphNode
                          status={
                            <StatusBadge
                              status={entityDisplayStatus(entity)}
                              size={16}
                              confidence={entity.confidence}
                            />
                          }
                          attachedStatus={
                            <ItemStatusIcon status={entityDisplayStatus(entity)} size={20} />
                          }
                          name={entity.name}
                          detail={entityDetail(entity)}
                          classNode={{
                            mapping: classNodeMapping(entity),
                            counts: classNodeCounts(entity),
                            sparkle: entityDisplayStatus(entity) === "suggested",
                          }}
                          dropFor={entity.id}
                          dimmed={!reviewScope.entity(entity)}
                          chip={
                            entityReview(entity) === "suggested" ? (
                              <EntityConfidenceChip entity={entity} tone="muted" size="node" />
                            ) : null
                          }
                          selected={isSelected({ kind: "entity", id: entity.id })}
                          attached={item.branch === "props" && !isOpenEntity}
                          onClick={() => inspect({ kind: "entity", id: entity.id })}
                          // Double-click makes it the selected Entity Type (the middle of the graph).
                          onDoubleClick={() => app.openDetail("entity", entity.id)}
                          trailing={
                            <ExpandChevron
                              open={item.branch === "props"}
                              label={
                                item.branch === "props"
                                  ? `Hide ${entity.name}'s properties`
                                  : `Show ${entity.name}'s properties`
                              }
                              onClick={() => toggleEntityBranch(entity.id, "props")}
                            />
                          }
                        />
                      </div>
                    </Node>
                    {ghostFor === entity.id && pillY.has(GHOST_PILL) && (
                      <Node x={pillX} y={pillY.get(GHOST_PILL)! - PILL_H / 2}>
                        <GhostRelationPill />
                      </Node>
                    )}
                    {relations.map(({ relation }) =>
                      ladderEnds && relation.id === draftRelationId ? (
                        // Being created: the pill opens up into its editor, above the line.
                        <Node
                          key={relation.id}
                          x={openEntityX + NODE_W + (OPEN_LINK_GAP - DRAFT_RELATION_W) / 2}
                          y={(pillY.get(relation.id) ?? item.y) + OPEN_PILL_H / 2}
                        >
                          <div className="absolute bottom-0 left-0">
                            <RelationDraftCard app={app} relation={relation} />
                          </div>
                        </Node>
                      ) : (
                        <Node
                          key={relation.id}
                          x={ladderEnds && relation.id === openRelationId ? openPillX : pillX}
                          y={
                            (pillY.get(relation.id) ?? item.y) -
                            (ladderEnds && relation.id === openRelationId ? OPEN_PILL_H : PILL_H) /
                              2
                          }
                        >
                          <div
                            className={cn(
                              "transition-opacity duration-300",
                              ladderEnds && relation.id !== openRelationId
                                ? "pointer-events-none opacity-0"
                                : "opacity-100",
                            )}
                          >
                            <RelationPill
                              relation={relation}
                              status={relationStatus(relation, app.entities)}
                              selected={isSelected({ kind: "relation", id: relation.id })}
                              dimmed={!reviewScope.relation(relation)}
                              open={!!ladderEnds && relation.id === openRelationId}
                              onClick={() =>
                                openRelationId === relation.id
                                  ? closeDetail()
                                  : inspect({ kind: "relation", id: relation.id })
                              }
                            />
                          </div>
                        </Node>
                      ),
                    )}
                    {branchTables.map((b) => {
                      const table = tableByName(b.name);
                      if (!table) return null;
                      return (
                        <Node key={b.name} x={bx} y={b.y - NODE_H / 2}>
                          <GraphNode
                            status={tableStatus(table)}
                            name={table.name}
                            dimmed={!reviewScope.table(table.name)}
                            detail={plural(table.columns.length, "column", "columns")}
                            classNode={{
                              mapping: tableNodeMapping(
                                tableMappingStatus(table.name, app.entities),
                              ),
                              counts: tableNodeCounts(table, app.entities),
                              sparkle: false,
                            }}
                            selected={inspectedTable === table.name && detailItem?.kind === "table"}
                            onClick={() => inspectTable(table.name)}
                          />
                        </Node>
                      );
                    })}
                    {item.branch === "props" && !isOpenEntity && (
                      <Node x={ex} y={item.y + NODE_H / 2}>
                        <div style={{ width: NODE_W }}>
                          <EntityPropertyPanel
                            entity={entity}
                            frame={classFrameOf(
                              isSelected({ kind: "entity", id: entity.id }),
                              false,
                            )}
                            onCreateProperty={(draft) => createPropertyIn(app, entity.id, draft)}
                            onUpdateProperty={(id, patch) =>
                              app.updateProperty(entity.id, id, patch)
                            }
                            isSelected={(p) =>
                              isSelected({
                                kind: "property",
                                entityId: entity.id,
                                propertyId: p.id,
                              })
                            }
                            onSelect={(p) =>
                              inspect({ kind: "property", entityId: entity.id, propertyId: p.id })
                            }
                          />
                        </div>
                      </Node>
                    )}
                  </div>
                );
              })}

              {/* The open Relation's source tables, under its two Entity Types. */}
              <AnimatePresence>
                {ladderEnds && openRelation && ladder && (
                  <LadderTables
                    key={`ladder-${openRelation.relation.id}`}
                    app={app}
                    status={relationStatus(openRelation.relation, app.entities)}
                    ends={ladderEnds}
                    rungs={ladder.rungs}
                    empty={ladder.rungs.length === 0}
                    // No dataset maps both identifiers: nothing to map it through, so nothing shown.
                    emptyLabel=""
                    onMap={(rung) => {
                      const join = openRelation.mappings.find((m) => m.key === rung.key);
                      if (!join) return;
                      const leftIsFrom = openRelation.relation.from === openRelation.entityId;
                      const [from, to] = leftIsFrom
                        ? [join.left, join.right]
                        : [join.right, join.left];
                      app.connectRelationMapping(openRelation.relation.id, {
                        table: from.table,
                        fromColumns: from.columns,
                        toColumns: to.columns,
                        ...(from.alias ? { fromAlias: from.alias } : {}),
                        ...(to.alias ? { toAlias: to.alias } : {}),
                        status: "mapped",
                      });
                    }}
                    onDecide={(rung, accept) => {
                      if (!rung.join) return;
                      if (accept) app.acceptRelationMapping(openRelation.relation.id, rung.join);
                      else app.disconnectRelationMapping(openRelation.relation.id, rung.join);
                    }}
                    blockersOf={(rung) =>
                      rung.join
                        ? relationMappingAcceptBlockers(
                            openRelation.relation,
                            rung.join,
                            app.entities,
                          )
                        : []
                    }
                    onPickIdentifier={(rung, side, part, column) => {
                      // The side picked for is the one whose key isn't (fully) mapped here yet.
                      const relation = openRelation.relation;
                      const leftIsFrom = relation.from === openRelation.entityId;
                      const pickedIsFrom = (side === "left") === leftIsFrom;
                      const entity = app.entities.find(
                        (e) => e.id === (pickedIsFrom ? relation.from : relation.to),
                      );
                      if (!entity) return false;
                      const table = rung.left.table;
                      if (
                        !tryConnectMapping(app, entity.id, part.id, {
                          table,
                          column,
                          status: "mapped",
                        })
                      )
                        return false;
                      // Its whole key now mapped here: the Relation is mapped through it too.
                      const columns = identifiersOf(entity).map((p) =>
                        p.id === part.id
                          ? column
                          : p.mappings.find((m) => m.table === table)?.column,
                      );
                      if (columns.every((c): c is string => !!c)) {
                        const other = side === "left" ? rung.right : rung.left;
                        app.connectRelationMapping(relation.id, {
                          table,
                          fromColumns: pickedIsFrom ? columns : other.columns,
                          toColumns: pickedIsFrom ? other.columns : columns,
                          ...(other.alias
                            ? pickedIsFrom
                              ? { toAlias: other.alias }
                              : { fromAlias: other.alias }
                            : {}),
                          status: "mapped",
                        });
                      }
                      return true;
                    }}
                    more={
                      ladder.toggleable
                        ? {
                            top: ladder.moreTop,
                            label: allMappings ? "Show fewer" : `+ ${openRelation.hidden} more`,
                            onToggle: () => setAllMappings((all) => !all),
                          }
                        : null
                    }
                    columnType={(table, column) =>
                      tableByName(table)?.columns.find((c) => c.name === column)?.type ?? ""
                    }
                    // While it's being created, opening a table would leave the draft.
                    onOpenTable={
                      app.creation?.kind === "relation" &&
                      app.creation.id === openRelation.relation.id
                        ? () => {}
                        : inspectTable
                    }
                  />
                )}
              </AnimatePresence>

              {/* Data Tables. */}
              {rightView.map((item) => {
                if (item.kind === "ghost") {
                  return (
                    <Node key={item.key} x={TABLE_X} y={item.y - NODE_H / 2}>
                      <DropSlot label="Drop to add a data table" />
                    </Node>
                  );
                }
                if (item.kind === "more") {
                  return (
                    <Node key={item.key} x={TABLE_X + NODE_W / 2} y={item.y - MORE_H / 2}>
                      <div className={cn("transition-opacity duration-300", faded(item.key))}>
                        <MoreButton
                          centered
                          label={open.has("more:right") ? "Show less" : `+ ${item.hidden} more`}
                          onClick={() => toggle("more:right")}
                        />
                      </div>
                    </Node>
                  );
                }
                const isFocused = focused?.table.name === item.table.name;
                return (
                  <div
                    key={item.key}
                    {...hoverProps(item.key)}
                    className={cn("transition-opacity duration-300", faded(item.key))}
                  >
                    {item.mapped.length > 0 && (
                      // Figma 353:161537: centred on the link while that table is open, otherwise
                      // right-aligned 10px short of the table.
                      <Node
                        x={isFocused ? (CENTER_RIGHT + TABLE_X) / 2 : TABLE_X - 10}
                        y={item.y - 9}
                      >
                        <MappingCountChips
                          mappings={item.mapped.flatMap((p) => mappingsIn(p, item.table.name))}
                          dimmed={!reviewScope.mappings(item.mapped)}
                          align={isFocused ? "center" : "right"}
                          label="Show each mapping"
                          onClick={() => focusTable(item.table.name)}
                        />
                      </Node>
                    )}
                    <Node x={TABLE_X} y={item.y - NODE_H / 2}>
                      <GraphNode
                        status={tableStatus(item.table)}
                        name={item.table.name}
                        dimmed={!reviewScope.table(item.table.name)}
                        detail={plural(item.table.columns.length, "column", "columns")}
                        classNode={{
                          mapping: tableNodeMapping(
                            tableMappingStatus(item.table.name, app.entities),
                          ),
                          counts: tableNodeCounts(item.table, app.entities),
                          sparkle: false,
                        }}
                        selected={
                          inspectedTable === item.table.name && detailItem?.kind === "table"
                        }
                        attached={isFocused}
                        onClick={() => inspectTable(item.table.name)}
                        onDoubleClick={() => focusTable(item.table.name)}
                        trailing={
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              focusTable(item.table.name);
                            }}
                            aria-label={isFocused ? "Close mappings" : "Show each mapping"}
                            title={isFocused ? "Close mappings" : "Show each mapping"}
                            className="lod-detail flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[#6d7472] hover:bg-black/[0.06] hover:text-[#161919]"
                          >
                            <span
                              className={cn(
                                "size-4 transition-transform",
                                isFocused && "rotate-180",
                              )}
                            >
                              <img src={chevronDownIcon} alt="" className="block size-full" />
                            </span>
                          </button>
                        }
                      />
                    </Node>
                  </div>
                );
              })}

              {/* A focused Data Table: its Property → Column mappings, one straight row each,
              between the middle node and the table. */}
              {focused && (
                <Node x={CENTER_LEFT} y={CENTER_H / 2}>
                  <MappingPanels
                    key={focused.table.name}
                    app={app}
                    entity={focusEntity}
                    frames={{
                      left: classFrameOf(
                        isSelected({ kind: "entity", id: focusEntity.id }),
                        !isSelected({ kind: "entity", id: focusEntity.id }),
                      ),
                      right: classFrameOf(
                        inspectedTable === focused.table.name && detailItem?.kind === "table",
                        false,
                      ),
                    }}
                    properties={focused.mapped}
                    table={focused.table}
                    width={TABLE_X + NODE_W - CENTER_LEFT}
                    isSelected={(p) =>
                      isSelected({ kind: "property", entityId: focusEntity.id, propertyId: p.id })
                    }
                    onSelect={(p) =>
                      inspect({ kind: "property", entityId: focusEntity.id, propertyId: p.id })
                    }
                  />
                </Node>
              )}
            </div>
            {canvas.tool === "pan" && (
              <div
                aria-hidden
                className={cn(
                  "absolute inset-0 z-[18]",
                  canvas.panning ? "cursor-grabbing" : "cursor-grab",
                )}
              />
            )}
          </div>

          {draftEntity || draftRelationId ? null : detailItem ? (
            <DetailDock defaultCap={detailItem.kind === "table" ? 240 : null}>
              <CompletionNoticeSlot app={app} />
              <DetailPanel
                key={detailItem.key}
                app={app}
                item={detailItem}
                queue={queue}
                focusEntityId={focusEntity.id}
                onSelectKey={(key) => {
                  const ref = parseSuggestionKey(key);
                  if (ref) inspect(ref);
                }}
                onClose={closeDetail}
                onDeletedFocus={app.closeDetail}
                onEdit={onEdit}
              />
            </DetailDock>
          ) : app.suggestionSelection.size >= 2 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
              <div className="pointer-events-auto relative">
                <CompletionNoticeSlot app={app} />
                <SelectionActions app={app} onSplit={onSplit} />
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
              <div className="pointer-events-auto relative">
                <CompletionNoticeSlot app={app} />
                <AiReviewBar
                  entities={app.entities}
                  relations={app.relations}
                  tables={app.tables}
                  confidenceRange={app.confidenceRange}
                  onConfidenceRangeChange={app.setConfidenceRange}
                  onSelectSuggestionsInRange={app.selectSuggestionKeys}
                  scope={scope}
                />
              </div>
            </div>
          )}
        </PropertyMoveContext.Provider>
      </HandleLayerContext.Provider>
    </ReviewScopeContext.Provider>
  );
}

/**
 * A new Entity Type's node while it's being created: the node itself opens up into its editor —
 * name and description in its header, its Properties listed under them in the order they're
 * added (each still editable: name, Identifier key, type), Add property, and Cancel / Create
 * across its foot. Enter moves on: name → description → a first Property.
 */
function EntityDraftCard({ app, entity }: { app: OntologyApp; entity: Entity }) {
  const descriptionRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const identifierName = identifierNames(entity);
  const blocker = entityDraftBlocker(entity, app.entities);
  // The foot's short version of `blocker` (the full sentence is Create's tooltip).
  const hint = !blocker
    ? "Ready to create"
    : !entity.name.trim()
      ? "Needs a name"
      : identifierName
        ? "Name already taken"
        : blocker.startsWith("An entity type named")
          ? "Name already taken"
          : "Needs an identifier";
  const field =
    "h-8 w-full rounded-[4px] border border-[#e3e5e4] bg-white px-2.5 outline-none transition-colors placeholder:text-[#9ea3a2] hover:border-[#c9cccb] focus:border-[#161919]";
  return (
    <div
      data-canvas-card
      data-graph-center
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-[#3b82f6] bg-white shadow-[0_0_0_3px_rgba(59,130,246,0.2)]",
      )}
      style={{ width: CENTER_W }}
    >
      <div className="flex items-start gap-3 p-3">
        <span aria-hidden className="mt-0.5 size-7 shrink-0 rounded-full bg-[#e3e5e4]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input
            autoFocus
            value={entity.name}
            // Typed straight into the Entity Type (the draft is one undo step either way).
            onChange={(event) => app.updateEntity(entity.id, { name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                descriptionRef.current?.focus();
              }
            }}
            placeholder="Entity type name"
            aria-label="Entity type name"
            className={cn(field, "text-[14px] font-medium leading-5 text-[#080a09]")}
          />
          <input
            ref={descriptionRef}
            value={entity.description}
            onChange={(event) => app.updateEntity(entity.id, { description: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setAdding(true);
              }
            }}
            placeholder="Description (optional)"
            aria-label="Entity type description"
            className={cn(field, "text-[12px] leading-4 text-[#3c3c3c]")}
          />
        </div>
      </div>
      <div className="border-t border-[#e3e5e4] px-3 pb-3 pt-2">
        <p className="pb-1.5 text-[12px] leading-4 text-[#6d7472]">
          Properties · {entity.properties.length}
        </p>
        <div
          data-canvas-scroll
          className="flex flex-col gap-1.5 overflow-y-auto overscroll-contain"
          style={{ maxHeight: PANEL_LIST_MAX }}
        >
          {entity.properties.map((property) => (
            <PropertyEditRow
              key={property.id}
              property={property}
              part={keyPartOf(entity, property)}
              currentIdentifier={identifierName}
              onChange={(patch) => app.updateProperty(entity.id, property.id, patch)}
              onRemove={() => app.deleteProperty(entity.id, property.id)}
            />
          ))}
          {adding ? (
            <PropertyDraftRow
              onSubmit={(draft) => app.createProperties(entity.id, [draft])}
              onClose={() => setAdding(false)}
              currentIdentifier={identifierName}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-[4px] border border-dashed border-[#c9cccb] text-[14px] font-medium leading-5 text-[#3c3c3c] transition-colors hover:border-[#161919] hover:bg-[#f4f4f4] hover:text-[#161919]"
            >
              <Plus className="size-4" strokeWidth={1.75} />
              Add property
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-[#e3e5e4] bg-[#fafafa] px-3 py-2">
        <span
          className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[#6d7472]"
          title={blocker}
        >
          {hint}
        </span>
        <button
          type="button"
          onClick={() => app.cancelCreation()}
          className="flex h-7 shrink-0 items-center rounded-[4px] border border-[#e3e5e4] bg-white px-2.5 text-[13px] font-medium leading-5 text-[#161919] transition-colors hover:bg-[#f4f4f4]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!!blocker}
          title={blocker}
          onClick={() => {
            const name = entity.name.trim();
            if (name !== entity.name) app.updateEntity(entity.id, { name });
            app.finishCreation();
          }}
          className="flex h-7 shrink-0 items-center rounded-[4px] bg-[#161919] px-2.5 text-[13px] font-medium leading-5 text-[#fafafa] transition-colors hover:bg-[#4e5553] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#161919]"
        >
          Create
        </button>
      </div>
    </div>
  );
}

/**
 * A Relation being created: its pill opens up into its editor, upward from the line between its
 * two Entity Types (the ladder of datasets hangs below it) — name and description, its direction
 * (swappable), the datasets it's mapped through so far (picked in the ladder: + Map, or a side's
 * identifier column), and Cancel / Create. Name and description apply on blur and on Create; Esc
 * cancels.
 */
function RelationDraftCard({ app, relation }: { app: OntologyApp; relation: Relation }) {
  const [name, setName] = useState(relation.name);
  const [description, setDescription] = useState(relation.description);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const apply = () => {
    if (name.trim() !== relation.name) app.renameRelation(relation.id, name);
    if (description.trim() !== relation.description) {
      app.updateRelation(relation.id, { description: description.trim() });
    }
  };
  const nameOf = (id: string) => app.entities.find((e) => e.id === id)?.name || "Untitled";
  const subject = nameOf(relation.from);
  const object = nameOf(relation.to);
  const joins = relationJoins(relation, app.entities);
  const blocker = name.trim() ? undefined : "Name the relation first.";
  const create = () => {
    if (blocker) return;
    apply();
    app.finishCreation();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, next: () => void) => {
    if (event.key === "Enter") {
      event.preventDefault();
      next();
    } else if (event.key === "Escape") {
      event.preventDefault();
      app.cancelCreation();
    }
  };
  const field =
    "h-8 w-full rounded-[4px] border border-[#e3e5e4] bg-white px-2.5 outline-none transition-colors placeholder:text-[#9ea3a2] hover:border-[#c9cccb] focus:border-[#161919]";
  return (
    <div
      data-canvas-card
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="flex flex-col overflow-hidden rounded-lg border border-[#3b82f6] bg-white shadow-[0_0_0_3px_rgba(59,130,246,0.2)]"
      style={{ width: DRAFT_RELATION_W }}
    >
      <div className="flex flex-col gap-1.5 p-3">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => onKeyDown(event, () => descriptionRef.current?.focus())}
          placeholder="Relation name"
          aria-label="Relation name"
          className={cn(field, "text-[14px] font-medium leading-5 text-[#080a09]")}
        />
        <input
          ref={descriptionRef}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => onKeyDown(event, create)}
          placeholder="Description (optional)"
          aria-label="Relation description"
          className={cn(field, "text-[12px] leading-4 text-[#3c3c3c]")}
        />
        <div className="flex min-w-0 items-center gap-1.5 pt-0.5 text-[12px] leading-4 text-[#6d7472]">
          <span className="min-w-0 truncate font-medium text-[#161919]">{subject}</span>
          <FigmaIcon src={arrowRightIcon} size={12} />
          <span className="min-w-0 truncate">{name.trim() || "…"}</span>
          <FigmaIcon src={arrowRightIcon} size={12} />
          <span className="min-w-0 truncate font-medium text-[#161919]">{object}</span>
          <button
            type="button"
            aria-label="Swap subject and object"
            title="Swap subject and object"
            onClick={() =>
              app.updateRelation(relation.id, {
                from: relation.to,
                to: relation.from,
                ...(relation.mappings
                  ? {
                      mappings: relation.mappings.map((m) => ({
                        ...m,
                        fromColumns: m.toColumns,
                        toColumns: m.fromColumns,
                      })),
                    }
                  : {}),
              })
            }
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[#e3e5e4] bg-white text-[#6d7472] transition-colors hover:border-[#c9cccb] hover:bg-[#f4f4f4] hover:text-[#161919]"
          >
            <ArrowLeftRight className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="border-t border-[#e3e5e4] px-3 pb-3 pt-2">
        <p className="pb-1.5 text-[12px] leading-4 text-[#6d7472]">Mapping · {joins.length}</p>
        {joins.length === 0 ? (
          <p className="text-[12px] leading-4 text-[#9ea3a2]">
            Pick a dataset in the ladder below — or create it unmapped for now.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {joins.map((join) => {
              const keys = `${subject}${join.fromAlias ? `@${join.fromAlias}` : ""}[${join.fromColumns.join(", ")}] → ${object}${join.toAlias ? `@${join.toAlias}` : ""}[${join.toColumns.join(", ")}]`;
              return (
                <div
                  key={relationMappingKey(join)}
                  title={keys}
                  className="group/draftmap flex h-7 min-w-0 items-center gap-1.5 rounded-[4px] border border-[#e3e5e4] pl-2 pr-1 text-[12px] leading-4"
                >
                  <span className="shrink-0 font-medium text-[#161919]">{join.table}</span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      join.broken ? "text-[#dc2626]" : "text-[#6d7472]",
                    )}
                  >
                    {keys}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove the ${join.table} mapping`}
                    title="Remove"
                    onClick={() => app.disconnectRelationMapping(relation.id, join)}
                    className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[#6d7472] opacity-0 transition-opacity hover:bg-[#f4f4f4] hover:text-[#161919] focus-visible:opacity-100 group-hover/draftmap:opacity-100"
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-[#e3e5e4] bg-[#fafafa] px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[#6d7472]">
          {blocker ? "Needs a name" : joins.length ? "Ready to create" : "No mapping yet"}
        </span>
        <button
          type="button"
          onClick={() => app.cancelCreation()}
          className="flex h-7 shrink-0 items-center rounded-[4px] border border-[#e3e5e4] bg-white px-2.5 text-[13px] font-medium leading-5 text-[#161919] transition-colors hover:bg-[#f4f4f4]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!!blocker}
          title={blocker}
          onClick={create}
          className="flex h-7 shrink-0 items-center rounded-[4px] bg-[#161919] px-2.5 text-[13px] font-medium leading-5 text-[#fafafa] transition-colors hover:bg-[#4e5553] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#161919]"
        >
          Create
        </button>
      </div>
    </div>
  );
}

/** A node positioned in world coordinates; moves smoothly when the layout changes. */
function Node({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={false}
      animate={{ x, y }}
      transition={SPRING}
    >
      {children}
    </motion.div>
  );
}

/** Where Curve handles are drawn: a layer above the nodes (the curves themselves run under them),
 * so a handle sits on top of its node's edge. */
const HandleLayerContext = createContext<SVGGElement | null>(null);

/** The handle layer's SVG, placed once in each graph's world. */
function HandleLayer({ onLayer }: { onLayer: (layer: SVGGElement | null) => void }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible"
      width={1}
      height={1}
    >
      <g ref={onLayer} />
    </svg>
  );
}

/** The first and last point of a `curve()` / line path. */
function curveEnds(d: string) {
  const n = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  return {
    start: { x: n[0] ?? 0, y: n[1] ?? 0 },
    end: { x: n[n.length - 2] ?? 0, y: n[n.length - 1] ?? 0 },
  };
}

function Curve({
  d,
  from,
  suggested,
  bold = false,
  branch = false,
  delay = 0,
  handles = "both",
  arrow,
  dimmed = false,
  potential = false,
}: {
  // Outside the Confidence range / status filter (see `ReviewScope`).
  dimmed?: boolean;
  // A link that isn't made yet, only possible (an open Relation's candidate dataset).
  potential?: boolean;
  d: string;
  // Where a newly shown curve grows from (and shrinks back to); otherwise it appears in place.
  from?: string | undefined;
  suggested: boolean;
  bold?: boolean;
  // A light dashed secondary link (an Entity Type down to its source table).
  branch?: boolean;
  delay?: number;
  // Figma "Edge/Explorer": a 6px handle dot on a node end. A curve that runs into its label
  // (rather than a node) leaves that end bare.
  handles?: "both" | "start" | "end" | "none";
  // The end whose handle is an arrowhead instead of a dot: where a Relation points (its `to`).
  arrow?: "start" | "end" | undefined;
}) {
  // Suggested and settled links share the solid gray line (the status dot tells them apart).
  // Figma "Edge/Explorer" layers: a candidate link is "further" (dotted), a secondary table link
  // "back" (dashed), a highlighted one "lit", an out-of-scope one "faded", the rest "idle".
  const layer: EdgeLayer = potential
    ? "further"
    : branch
      ? "back"
      : bold
        ? "lit"
        : dimmed
          ? "faded"
          : "idle";
  const edge = EDGE_STYLE[layer];
  const handleLayer = useContext(HandleLayerContext);
  const ends = curveEnds(d);
  const fromEnds = from ? curveEnds(from) : null;
  const handle = (at: "start" | "end") => {
    if (handles !== "both" && handles !== at) return null;
    const to = ends[at];
    const origin = fromEnds?.[at];
    if (arrow === at) {
      // A 7.5×8.7 triangle whose tip sits on the node's edge, pointing into the node.
      const rightward = ends.end.x >= ends.start.x;
      const pointsRight = at === "end" ? rightward : !rightward;
      return (
        <motion.g
          key={at}
          initial={origin ? { x: origin.x, y: origin.y } : false}
          animate={{ x: to.x, y: to.y }}
          exit={origin ? { x: origin.x, y: origin.y, transition: SPRING } : {}}
          transition={{ ...SPRING, delay }}
        >
          <path
            d="M 0 0 L -7.5 -4.33 L -7.5 4.33 Z"
            fill={EDGE_STROKE}
            transform={pointsRight ? undefined : "scale(-1 1)"}
          />
        </motion.g>
      );
    }
    return (
      <motion.circle
        key={at}
        r={3}
        fill={EDGE_STROKE}
        initial={origin ? { cx: origin.x, cy: origin.y } : false}
        animate={{ cx: to.x, cy: to.y }}
        exit={origin ? { cx: origin.x, cy: origin.y, transition: SPRING } : {}}
        transition={{ ...SPRING, delay }}
      />
    );
  };
  return (
    <>
      <motion.path
        initial={from ? { d: from } : false}
        // Opacity goes through `animate`: motion doesn't re-apply a changed `style.opacity`.
        animate={{ d, opacity: edge.opacity }}
        exit={from ? { d: from, transition: SPRING } : {}}
        transition={{ ...SPRING, delay }}
        fill="none"
        stroke={edge.stroke}
        strokeWidth={edge.width}
        strokeDasharray={edge.dash}
        strokeLinecap={edge.round ? "round" : undefined}
      />
      {handleLayer ? (
        createPortal(
          <>
            {handle("start")}
            {handle("end")}
          </>,
          handleLayer,
        )
      ) : (
        <>
          {handle("start")}
          {handle("end")}
        </>
      )}
    </>
  );
}

/** An Entity Type / Data Table node: status icon, name over a detail line, optional chip and a
 * trailing control. */
function GraphNode({
  status,
  attachedStatus,
  name,
  detail,
  chip,
  selected,
  highlighted,
  onClick,
  onDoubleClick,
  trailing,
  dropFor,
  dimmed = false,
  attached = false,
  classNode,
}: {
  // An Entity Type drawn as the Figma "ClassNode" card (see `class-node.tsx`).
  classNode?: { mapping: ClassNodeMapping; counts: string; sparkle: boolean } | undefined;
  // Its list is open under it: the node is that card's header (see `frameOf`).
  attached?: boolean;
  // Outside the Confidence range / status filter (see `ReviewScope`).
  dimmed?: boolean;
  // An Entity Type node's id: Properties dragged from another Entity Type can be dropped on it.
  dropFor?: string | undefined;
  status: ReactNode;
  // The status as the open card's head shows it (Figma 466:86067), when it differs.
  attachedStatus?: ReactNode;
  name: string;
  detail: string;
  chip?: ReactNode;
  selected?: boolean;
  highlighted?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  trailing?: ReactNode;
}) {
  const move = useContext(PropertyMoveContext);
  return (
    <div
      data-canvas-card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...(move && dropFor ? move.dropProps(dropFor) : {})}
      className={
        classNode
          ? cn(
              classNodeClass({ selected, focus: highlighted, dimmed, attached }),
              "pr-2",
              !!dropFor && move?.dropTargetId === dropFor && DROP_TARGET_CLASS,
            )
          : cn(
              // Figma 466:93516 / 466:93646: 56px, pl-12 pr-8, a 24px status, name over its detail.
              "flex items-center gap-1 rounded-lg border bg-white pl-3 pr-2 text-left transition-[box-shadow,opacity]",
              CARD_SHADOW,
              dimmed && DIMMED,
              selected
                ? SELECTED_NODE
                : highlighted
                  ? "border-[#3b82f6]"
                  : attached
                    ? "border-[#e3e5e4]"
                    : "border-[#e3e5e4] hover:border-[#3b82f6]",
              attached && ATTACHED_HEAD,
              !!dropFor && move?.dropTargetId === dropFor && DROP_TARGET_CLASS,
            )
      }
      style={{ width: NODE_W, height: NODE_H }}
    >
      {classNode ? (
        <>
          <ClassNodeBody
            icon={classNode.sparkle ? undefined : (attachedStatus ?? status)}
            name={name}
            counts={classNode.counts}
            mapping={classNode.mapping}
          />
          {attached && <ClassNodeDivider />}
        </>
      ) : (
        <>
          <span className="lod-type flex shrink-0">{attachedStatus ?? status}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1.5">
            <span className="lod-name truncate text-[16px] font-medium leading-none text-[#080a09]">
              {name}
            </span>
            <span className="lod-detail truncate text-[12px] leading-4 text-[#6d7472]">
              {detail}
            </span>
          </span>
        </>
      )}
      {chip && <span className="lod-confidence contents">{chip}</span>}
      {trailing}
    </div>
  );
}

type MappingSide = {
  table: string;
  // The occurrence, where the dataset holds several of that Entity Type.
  alias?: string | undefined;
  // The key columns mapped on this side (in key part order) …
  columns: string[];
  entity: string;
  entityId?: string;
  // … and, on a "half" rung, the key parts still to be mapped here.
  missing?: Property[];
};
// A ladder table's rows: its key columns, plus a row per key part still to pick.
const sideRows = (side: MappingSide) => side.columns.length + (side.missing?.length ?? 0);
// "saved": the Relation is mapped through it; "candidate": both Identifiers are mapped there, so it
// could be; "half": only one is, the other side's identifier column is still to be picked.
type LadderRung = {
  key: string;
  left: MappingSide;
  right: MappingSide;
  top: number;
  kind: "saved" | "candidate" | "half";
  // A saved rung's Relation mapping (its own review status).
  join?: ReturnType<typeof relationJoins>[number];
};
type LadderEnds = { left: Pt; right: Pt };

// Where a ladder table's column rows sit, from its end's (Entity Type node's) centre.
const ladderRowY = (end: Pt, rung: LadderRung, k: number) =>
  end.y + rung.top + LADDER_HEAD + k * LADDER_ROW + LADDER_ROW / 2;
// The dashed "entity mapping" line runs down from each Entity Type into its table's column tree.
const ladderTrunkX = (end: Pt) => end.x + LADDER_TRUNK;

/** The open Relation's lines: each Entity Type down to its source tables (dashed), and each
 * rung's column link under the Relation — drawn after the tables drop in. */
function LadderLinks({
  ends,
  rungs,
  empty,
  suggested,
  dimmed,
}: {
  ends: LadderEnds;
  rungs: LadderRung[];
  empty: boolean;
  suggested: boolean;
  dimmed: boolean;
}) {
  const last = rungs[rungs.length - 1];
  const trunk = (end: Pt) => {
    const x = ladderTrunkX(end);
    const top = end.y + NODE_H / 2;
    const bottom = last ? end.y + last.top : top + LADDER_GAP;
    return { d: `M ${x} ${top} L ${x} ${bottom}`, from: `M ${x} ${top} L ${x} ${top}` };
  };
  const leftTrunk = trunk(ends.left);
  const rightTrunk = trunk(ends.right);
  return (
    <motion.g initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      {!empty && (
        <>
          <Curve d={leftTrunk.d} from={leftTrunk.from} suggested={suggested} dimmed={dimmed} />
          <Curve d={rightTrunk.d} from={rightTrunk.from} suggested={suggested} dimmed={dimmed} />
        </>
      )}
      {rungs.map((rung, i) =>
        Array.from(
          {
            length:
              rung.kind === "half"
                ? 0
                : Math.min(rung.left.columns.length, rung.right.columns.length),
          },
          (_, k) => {
            const a = { x: ends.left.x + NODE_W, y: ladderRowY(ends.left, rung, k) };
            const b = { x: ends.right.x + LADDER_INSET, y: ladderRowY(ends.right, rung, k) };
            return (
              <g key={`${rung.key}-${k}`}>
                <Curve
                  d={curve(a, b)}
                  from={curve(a, a)}
                  suggested={suggested}
                  potential={rung.kind !== "saved"}
                  dimmed={dimmed}
                  delay={0.18 + i * 0.06}
                />
              </g>
            );
          },
        ),
      )}
    </motion.g>
  );
}

/**
 * The open Relation's source tables: for each dataset, the table under the related Entity Type
 * (left) and the one under the middle node (right), each holding its own key column(s) — so a
 * column always reads as part of its table. They drop out of their Entity Type and fold back
 * into it on close. Datasets it isn't mapped through yet are drawn faint: where both Identifiers
 * are mapped, Map (between the two) maps it; where only one is, the other side picks its
 * identifier column in that table first.
 */
function LadderTables({
  app,
  status,
  ends,
  rungs,
  empty,
  emptyLabel,
  more,
  columnType,
  onOpenTable,
  onMap,
  onDecide,
  blockersOf,
  onPickIdentifier,
}: {
  app: OntologyApp;
  // The open Relation's review status (its dot on each column row).
  status: ReturnType<typeof relationStatus>;
  ends: LadderEnds;
  rungs: LadderRung[];
  empty: boolean;
  emptyLabel: string;
  more: { top: number; label: string; onToggle: () => void } | null;
  columnType: (table: string, column: string) => string;
  onOpenTable: (table: string) => void;
  onMap: (rung: LadderRung) => void;
  // A suggested mapping's Accept / Reject on its line, and why Accept is off (empty when it isn't).
  onDecide: (rung: LadderRung, accept: boolean) => void;
  blockersOf: (rung: LadderRung) => string[];
  // Maps that side's key part `part` to `column` in the rung's table (and, once its whole key is
  // mapped there, the Relation through it); false when the column's type doesn't fit.
  onPickIdentifier: (
    rung: LadderRung,
    side: "left" | "right",
    part: Property,
    column: string,
  ) => boolean;
}) {
  return (
    <>
      {rungs.map((rung, i) =>
        (
          [
            [ends.left, rung.left, "left"],
            [ends.right, rung.right, "right"],
          ] as const
        ).map(([end, side, sideName], s) => (
          <Drop
            key={`${rung.key}-${s}`}
            end={end}
            x={end.x + LADDER_INSET}
            y={end.y + rung.top}
            delay={0.06 + i * 0.06 + s * 0.04}
          >
            {rung.kind === "half" && (side.missing?.length || side.columns.length === 0) ? (
              <MissingIdentifierTable
                app={app}
                side={side}
                onPick={(part, column) => onPickIdentifier(rung, sideName, part, column)}
              />
            ) : (
              <LadderTable
                app={app}
                status={status}
                side={side}
                potential={rung.kind !== "saved"}
                columnType={columnType}
                onOpen={() => onOpenTable(side.table)}
              />
            )}
          </Drop>
        )),
      )}
      {rungs
        .filter((rung) => rung.kind === "candidate")
        .map((rung) => (
          <Drop
            key={`${rung.key}-map`}
            end={ends.left}
            x={(ends.left.x + NODE_W + ends.right.x + LADDER_INSET) / 2}
            y={ladderRowY(ends.left, rung, 0)}
            delay={0.24}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMap(rung);
              }}
              aria-label={`Map the relation through ${rung.left.table}`}
              title={`Map the relation through ${rung.left.table}`}
              className="flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-[#161919] bg-white pl-1.5 pr-2.5 text-[12px] font-medium leading-4 text-[#161919] shadow-[0_1px_2px_0_rgba(0,0,0,0.08)] transition-colors hover:bg-[#f4f4f4]"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              Map
            </button>
          </Drop>
        ))}
      {rungs
        .filter(
          (rung) => rung.kind === "saved" && rung.join?.status !== "mapped" && !rung.join?.broken,
        )
        .map((rung) => (
          <Drop
            key={`${rung.key}-decide`}
            end={ends.left}
            x={(ends.left.x + NODE_W + ends.right.x + LADDER_INSET) / 2}
            y={ladderRowY(ends.left, rung, 0)}
            delay={0.24}
          >
            <SuggestedMappingDecision
              table={rung.left.table}
              blockers={blockersOf(rung)}
              onDecide={(accept) => onDecide(rung, accept)}
            />
          </Drop>
        ))}
      {empty && emptyLabel && (
        <Drop
          end={ends.left}
          x={ends.left.x + LADDER_INSET}
          y={ends.left.y + NODE_H / 2 + LADDER_GAP}
        >
          <span className="whitespace-nowrap text-[11.5px] leading-6 text-[#6d7472]">
            {emptyLabel}
          </span>
        </Drop>
      )}
      {more && (
        <Drop end={ends.left} x={ends.left.x + LADDER_INSET} y={ends.left.y + more.top}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              more.onToggle();
            }}
            className="whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-medium leading-6 text-[#6d7472] hover:bg-black/[0.04] hover:text-[#161919]"
          >
            {more.label}
          </button>
        </Drop>
      )}
    </>
  );
}

/** On a suggested Relation mapping's line: Reject / Accept. Accept stays off — with the reason on
 * its hover — until both Entity Types are accepted and their Identifiers mapped in that dataset;
 * nothing is accepted on its behalf. */
function SuggestedMappingDecision({
  table,
  blockers,
  onDecide,
}: {
  table: string;
  blockers: string[];
  onDecide: (accept: boolean) => void;
}) {
  const blocked = blockers.length > 0;
  const button =
    "flex size-6 items-center justify-center rounded-full transition-colors hover:bg-[#f4f4f4]";
  return (
    <div
      onPointerDown={(event) => event.stopPropagation()}
      className="flex h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full border border-[#c9cccb] bg-white px-0.5 shadow-[0_1px_2px_0_rgba(0,0,0,0.08)]"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Reject the ${table} mapping`}
            onClick={(event) => {
              event.stopPropagation();
              onDecide(false);
            }}
            className={button}
          >
            <FigmaIcon src={rejectIcon} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Reject</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Accept the ${table} mapping`}
            aria-disabled={blocked}
            onClick={(event) => {
              event.stopPropagation();
              if (!blocked) onDecide(true);
            }}
            className={cn(button, blocked && "cursor-not-allowed opacity-40 hover:bg-transparent")}
          >
            <FigmaIcon src={acceptIcon} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px]">
          {blocked ? (
            <span className="flex flex-col gap-1">
              {blockers.map((blocker) => (
                <span key={blocker}>{blocker}</span>
              ))}
            </span>
          ) : (
            "Accept"
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** A dataset only the other side's whole key is mapped in: this side picks the column for each
 * of its key parts still missing there (its Identifier gets that mapping; once its whole key is
 * mapped, the Relation is mapped through it). */
function MissingIdentifierTable({
  app,
  side,
  onPick,
}: {
  app: OntologyApp;
  side: MappingSide;
  onPick: (part: Property, column: string) => boolean;
}) {
  const missing = side.missing ?? [];
  return (
    <div
      data-canvas-card
      className="rounded-lg border border-dashed border-[#c9cccb] bg-white/70 px-4 pb-[5px] pt-[9px]"
      style={{ width: LADDER_TABLE_W }}
    >
      <div className="flex h-6 min-w-0 items-center gap-2 opacity-60">
        <MappingStatusBadge
          status={tableMappingStatus(side.table, app.entities)}
          {...tableMappingCompleteness(side.table, app.entities)}
          size={16}
        />
        <span className="truncate text-[16px] font-medium leading-6 text-[#080a09]">
          {side.table}
        </span>
      </div>
      {side.columns.map((column) => (
        <div key={column} className="flex h-6 min-w-0 items-center gap-2 opacity-60">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <span className="size-1.5 rounded-full bg-[#c9cccb]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-[#080a09]">
            {column}
          </span>
        </div>
      ))}
      {missing.length === 0 && side.columns.length === 0 ? (
        <p className="truncate text-[13px] leading-6 text-[#6d7472]">
          {side.entity} has no identifier yet
        </p>
      ) : (
        missing.map((part) => (
          <KeyPartPicker
            key={part.id}
            app={app}
            side={side}
            part={part}
            composite={missing.length + side.columns.length > 1}
            onPick={(column) => onPick(part, column)}
          />
        ))
      )}
    </div>
  );
}

/** "Pick X's identifier column": the column search for one key part, in one dataset. */
function KeyPartPicker({
  app,
  side,
  part,
  composite,
  onPick,
}: {
  app: OntologyApp;
  side: MappingSide;
  part: Property;
  // Part of a composite identifier: the part is named.
  composite: boolean;
  onPick: (column: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRejected(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          title={`${side.entity}'s ${part.name} isn't mapped in ${side.table} yet`}
          className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-[4px] text-left text-[13px] leading-6 text-[#3b82f6] hover:underline"
        >
          <Plus className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">
            {composite ? `Pick ${part.name}'s column` : `Pick ${side.entity}'s identifier column`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onPointerDown={(event) => event.stopPropagation()}
        className="w-[340px] rounded-[10px] border-[#e3e5e4] bg-white p-0 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.16)]"
      >
        <p className="border-b border-[#e3e5e4] px-3 py-2 text-[12px] leading-4 text-[#6d7472]">
          Which column in <span className="font-medium text-[#161919]">{side.table}</span> holds{" "}
          {side.entity}'s {part.name}?
        </p>
        <ColumnSearchList
          app={app}
          onlyTable={side.table}
          onPick={(value) => {
            const mapping = parseMappingValue(value);
            if (!mapping) return;
            if (onPick(mapping.column)) setOpen(false);
            else setRejected(mapping.column);
          }}
        />
        {rejected && (
          <p className="border-t border-[#e3e5e4] px-3 py-2 text-[12px] leading-4 text-[#9c461e]">
            {rejected}'s type doesn't fit {part.name} ({part.type}).
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Something revealed by an open Relation: drops out of its Entity Type (`end`) to (`x`, `y`) and
 * folds back into it on close. */
function Drop({
  end,
  x,
  y,
  delay = 0,
  children,
}: {
  end: Pt;
  x: number;
  y: number;
  delay?: number;
  children: ReactNode;
}) {
  const hidden = { x, y: end.y, opacity: 0 };
  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={hidden}
      animate={{ x, y, opacity: 1 }}
      exit={{ ...hidden, transition: SPRING }}
      transition={{ ...SPRING, delay }}
    >
      {children}
    </motion.div>
  );
}

/** One source table card in an open Relation's ladder (Figma 328:20594): the table's mapping
 * status and name, then its key column(s) — each with the Relation's status dot and its type. */
function LadderTable({
  app,
  side,
  status,
  potential = false,
  columnType,
  onOpen,
}: {
  app: OntologyApp;
  side: MappingSide;
  status: ReturnType<typeof relationStatus>;
  // A dataset it could be mapped through, not one it is: faint, dashed, with no status dot.
  potential?: boolean;
  columnType: (table: string, column: string) => string;
  onOpen: () => void;
}) {
  return (
    <div
      data-canvas-card
      // 64px tall with its 1px border: 9 + 24 (table) + 24 per column + 5.
      className={cn(
        "rounded-lg border px-4 pb-[5px] pt-[9px]",
        potential
          ? "border-dashed border-[#c9cccb] bg-white/70 [&>*]:opacity-60"
          : cn("border-[#e3e5e4] bg-white", CARD_SHADOW),
      )}
      style={{ width: LADDER_TABLE_W }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        className="flex h-6 w-full min-w-0 items-center gap-2 text-left"
      >
        <MappingStatusBadge
          status={tableMappingStatus(side.table, app.entities)}
          {...tableMappingCompleteness(side.table, app.entities)}
          size={16}
        />
        <span className="truncate text-[16px] font-medium leading-6 text-[#080a09] hover:underline">
          {side.table}
        </span>
        {side.alias && (
          <span className="shrink-0 text-[13px] leading-6 text-[#6d7472]">@{side.alias}</span>
        )}
      </button>
      {side.columns.map((column) => (
        <div key={column} className="flex h-6 min-w-0 items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <span
              className="size-1.5 rounded-full"
              style={{ background: potential ? "#c9cccb" : statusDotColor(status) }}
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-[#080a09]">
            {column}
          </span>
          <PropertyTypeGlyph type={columnType(side.table, column)} color="#6d7472" />
        </div>
      ))}
    </div>
  );
}

/** Where an item dragged in from a side panel will land: an Entity Type's is Figma 353:154753's
 * blue slot; a data table's keeps the app's teal drop-target accent. */
function DropSlot({ label, tone = "table" }: { label: string; tone?: "relation" | "table" }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg px-3",
        tone === "relation"
          ? "border border-[#3b82f6] bg-[#eff6ff] text-[14px] font-medium leading-5 text-[#3b82f6] shadow-[0_0_0_3px_rgba(59,130,246,0.4)]"
          : "border-[1.5px] border-dashed border-[#00DED8] bg-[rgba(0,222,216,0.05)] text-[13px] font-medium text-[#007287]",
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <span className="truncate">{label}</span>
    </div>
  );
}

/** A node's trailing chevron (Figma 507:26081): opens / closes what hangs off the node. */
function ExpandChevron({
  open,
  label,
  onClick,
}: {
  open: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-expanded={open}
      aria-label={label}
      className="flex size-5 shrink-0 items-center justify-center rounded-[6px] hover:bg-black/[0.06]"
    >
      <span className={cn("size-4 transition-transform", open && "rotate-180")}>
        <img src={chevronDownIcon} alt="" className="block size-full" />
      </span>
    </button>
  );
}

/** The table / property buttons that grow a related Entity Type's branch. */
function BranchButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-full border bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] transition-colors",
        active
          ? "border-[#3b82f6] bg-[#eff6ff] text-[#161919]"
          : "border-[#e3e5e4] text-[#6d7472] hover:border-[#161919] hover:text-[#161919]",
      )}
    >
      {children}
    </button>
  );
}

function RelationPill({
  relation,
  status,
  selected,
  open = false,
  onClick,
  dimmed = false,
}: {
  dimmed?: boolean;
  relation: Relation;
  status: ReturnType<typeof relationStatus>;
  selected: boolean;
  // Opened (its mappings laid out under it): the taller 180×28 pill of Figma 328:20594.
  open?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      data-canvas-card
      role="button"
      tabIndex={0}
      onClick={onClick}
      style={{
        width: open ? OPEN_PILL_W : PILL_W,
        height: open ? OPEN_PILL_H : PILL_H,
      }}
      className={cn(
        // Figma Edge/Explorer label (536:347610): 4px corners, 4/9 padding, 4px gap.
        "flex items-center gap-1 rounded-[4px] border bg-white px-[9px] py-1 text-[12px] leading-4 text-[#080a09] transition-[width,height,opacity]",
        CARD_SHADOW,
        dimmed && DIMMED,
        selected ? SELECTED_NODE : "border-[#e3e5e4] hover:border-[#161919]",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className="lod-type size-1.5 shrink-0 rounded-full"
          style={{ background: statusDotColor(status) }}
        />
        <span className="lod-name min-w-0 flex-1 truncate">{relationLabel(relation)}</span>
      </span>
      {relationReview(relation) === "suggested" && (
        <span className="lod-confidence contents">
          <RelationConfidenceChip relation={relation} tone="muted" />
        </span>
      )}
    </div>
  );
}

const PANEL_LIST_MAX = 350;

/** A Mapped / Unmapped group in a property or column panel (Figma 328:36487). */
function ListGroup({
  label,
  count,
  children,
}: {
  label: "Mapped" | "Unmapped";
  count: number;
  children: ReactNode;
}) {
  // Figma 328:36487: no tint — a 12px mono heading (name, count) over the rows, 4px apart.
  return (
    <div className="flex shrink-0 flex-col gap-1 rounded-[4px]">
      <div className="flex items-center justify-between gap-2.5 pb-0.5 font-mono text-[12px] leading-4">
        <span className="text-[#080a09]">{label}</span>
        <span className="tabular-nums text-[#6d7472]">{count}</span>
      </div>
      {children}
    </div>
  );
}

/** One side's cell of a Mapped / Unmapped group in the side-by-side mapping view: the same tinted
 * box as `ListGroup` (Figma 466:86067), drawn one row at a time so both sides' rows stay level. */
function GroupCell({
  tone,
  first = false,
  last = false,
  width,
  pad = "px-2.5",
  children,
}: {
  tone: "Mapped" | "Unmapped";
  first?: boolean;
  last?: boolean;
  width: number;
  pad?: string;
  children?: ReactNode;
}) {
  return (
    <div className={pad} style={{ width }}>
      <div
        className={cn(
          "px-2.5",
          tone === "Mapped" ? "bg-[#edf3f2]" : "bg-[#fafafa]",
          first && "rounded-t-[8px]",
          last ? "rounded-b-[8px] pb-2.5" : "pb-1.5",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A group's head row in the side-by-side view: its label and count. */
function GroupCellHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between pt-2.5 text-[14px] leading-[14px]">
      <span className="text-[#080a09]">{label}</span>
      <span className="tabular-nums text-[#6d7472]">{count}</span>
    </div>
  );
}

// The side-by-side mapping view's rhythm: a group's head, and one row (32px + its 6px gap).
const GROUP_HEAD_H = 30;
const MAP_ROW_STEP = 38;

function columnSamples(table: TableSchema, column: string): string[] {
  return [
    ...new Set(
      table.rows
        .map((row) => row[column])
        .filter((value): value is string => value != null && value !== ""),
    ),
  ].slice(0, 3);
}

/**
 * The selected Entity Type's properties (Figma 507:23720): a grey panel under its card with the
 * Filter / Sort / + / Search bar and white property rows — grip, status dot, name, identifier
 * key, type, confidence — scrolling past 350px under a fade.
 */
function PropertyPanel({
  properties,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  onCreateProperty,
  identifierName,
  keyPartOf: partOf,
  isSelected,
  onSelect,
  entityId,
  frame,
  onUpdateProperty,
}: {
  // Editing a row in place (its pencil): name, Identifier and type.
  onUpdateProperty?:
    | ((
        propertyId: string,
        patch: { name?: string; type?: string; isIdentifier?: boolean },
      ) => void)
    | undefined;
  // A Property's key part number in a composite identifier.
  keyPartOf?: ((property: Property) => number | undefined) | undefined;
  // Its node's frame: the panel is that node card's body (see `frameOf`).
  frame?: string | undefined;
  // The Properties' owner — lets each row be dragged to another Entity Type.
  entityId?: string | undefined;
  properties: Property[];
  filter: ListFilter;
  onFilterChange: (next: ListFilter) => void;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  // The list's +: a blank row at the top (`PropertyDraftRow`), added through this.
  onCreateProperty?: ((draft: NewPropertyDraft) => void) | undefined;
  // The owner's current Identifier (a new one takes over from it).
  identifierName?: string | undefined;
  isSelected: (property: Property) => boolean;
  onSelect: (property: Property) => void;
}) {
  const reviewScope = useContext(ReviewScopeContext);
  const move = useContext(PropertyMoveContext);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Properties just moved into this list: scroll it (and only it — not the canvas) to the first.
  const reveal = move?.reveal;
  useEffect(() => {
    if (!reveal || !entityId || reveal.entityId !== entityId) return;
    const frame = requestAnimationFrame(() => {
      const list = scrollRef.current;
      const row = list?.querySelector<HTMLElement>(`[data-property-id="${reveal.ids[0]}"]`);
      if (!list || !row) return;
      // Screen distances are zoomed; the list's own scroll units aren't.
      const scale = list.getBoundingClientRect().height / list.offsetHeight || 1;
      const offset = (row.getBoundingClientRect().top - list.getBoundingClientRect().top) / scale;
      list.scrollTo({
        top: list.scrollTop + offset - list.clientHeight / 2 + row.offsetHeight / 2,
        behavior: "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, entityId]);
  const isTarget = !!entityId && move?.dropTargetId === entityId;
  const [drafting, setDrafting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const mappedProperties = properties.filter((property) => property.mappings.length > 0);
  const unmappedProperties = properties.filter((property) => property.mappings.length === 0);
  return (
    <div
      data-canvas-card
      {...(move && entityId ? move.dropProps(entityId) : {})}
      className={cn(
        "flex flex-col overflow-hidden transition-shadow",
        frame
          ? attachedBody(frame)
          : "rounded-[6px] bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]",
        isTarget && "shadow-[0_0_0_1.5px_#00ded8] !bg-[#e6f9f8]",
      )}
    >
      <ListControls
        compact
        className="bg-white px-2"
        filter={filter}
        onFilterChange={onFilterChange}
        sort={sort}
        onSortChange={onSortChange}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search properties…"
        onCreate={onCreateProperty ? () => setDrafting(true) : undefined}
        createLabel="New property"
      />
      {drafting && onCreateProperty && (
        <div className="px-2 pb-1.5">
          <PropertyDraftRow
            onSubmit={onCreateProperty}
            onClose={() => setDrafting(false)}
            currentIdentifier={identifierName}
          />
        </div>
      )}
      <div className="relative">
        <div
          ref={scrollRef}
          data-canvas-scroll
          className="flex flex-col gap-3 overflow-y-auto overscroll-contain px-2.5 pb-2 [scrollbar-width:thin]"
          style={{ maxHeight: PANEL_LIST_MAX }}
        >
          {properties.length === 0 && (
            <p className="py-3 text-center text-[12px] text-[#6d7472]">No properties match.</p>
          )}
          {(
            [
              ["Mapped", mappedProperties],
              ["Unmapped", unmappedProperties],
            ] as const
          ).map(([label, group]) =>
            group.length > 0 ? (
              <ListGroup key={label} label={label} count={group.length}>
                {group.map((property) =>
                  editingId === property.id && onUpdateProperty ? (
                    <PropertyInlineEditor
                      key={property.id}
                      property={property}
                      onApply={(patch) => onUpdateProperty(property.id, patch)}
                      onClose={() => setEditingId(null)}
                    />
                  ) : (
                    <PanelRow
                      key={property.id}
                      onEdit={onUpdateProperty ? () => setEditingId(property.id) : undefined}
                      name={property.name}
                      dotColor={itemStatusDotColor(propertyStatus(property))}
                      dimmed={!reviewScope.property(property)}
                      identifier={isIdentifierProperty(property)}
                      identifierPart={partOf?.(property)}
                      type={property.type}
                      chip={
                        propertyReview(property) === "suggested" ? (
                          <PropertyConfidenceChip property={property} tone="muted" />
                        ) : null
                      }
                      selected={isSelected(property)}
                      onClick={() => onSelect(property)}
                      moveFrom={entityId ? { entityId, propertyId: property.id } : undefined}
                    />
                  ),
                )}
              </ListGroup>
            ) : null,
          )}
        </div>
        {properties.length * 38 > PANEL_LIST_MAX && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[30px] bg-gradient-to-b from-white/0 to-white"
          />
        )}
      </div>
    </div>
  );
}

/** The Filter / Sort / Search rules of a property panel, over any list of Properties. */
function filterProperties(
  properties: Property[],
  filter: ListFilter,
  search: string,
  sort: SortState | null,
  nameOf: (property: Property) => string = (p) => p.name,
) {
  let list = properties;
  if (filter === "mapped") list = list.filter((p) => p.mappings.length > 0);
  else if (filter === "unmapped") list = list.filter((p) => p.mappings.length === 0);
  else if (filter === "identifier") list = list.filter((p) => isIdentifierProperty(p));
  const query = search.trim().toLowerCase();
  if (query) list = list.filter((p) => nameOf(p).toLowerCase().includes(query));
  if (!sort) return list;
  // The list always follows its Sort; identifiers stay pinned on top (as in every Figma frame).
  const sorted = sortByState(list, sort, nameOf, (p) => p.confidence);
  return [
    ...sorted.filter((p) => isIdentifierProperty(p)),
    ...sorted.filter((p) => !isIdentifierProperty(p)),
  ];
}

/** A property panel that keeps its own Filter / Sort / Search (a related Entity Type's). */
function EntityPropertyPanel({
  entity,
  onCreateProperty,
  onUpdateProperty,
  isSelected,
  onSelect,
  frame,
}: {
  entity: Entity;
  frame?: string | undefined;
  onCreateProperty?: ((draft: NewPropertyDraft) => void) | undefined;
  onUpdateProperty?:
    | ((
        propertyId: string,
        patch: { name?: string; type?: string; isIdentifier?: boolean },
      ) => void)
    | undefined;
  isSelected: (property: Property) => boolean;
  onSelect: (property: Property) => void;
}) {
  const [filter, setFilter] = useState<ListFilter>("all");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [search, setSearch] = useState("");
  return (
    <PropertyPanel
      entityId={entity.id}
      properties={filterProperties(entity.properties, filter, search, sort)}
      filter={filter}
      onFilterChange={setFilter}
      sort={sort}
      onSortChange={(key) => setSort((prev) => nextSortState(prev, key))}
      search={search}
      onSearchChange={setSearch}
      onCreateProperty={onCreateProperty}
      onUpdateProperty={onUpdateProperty}
      identifierName={identifierNames(entity)}
      keyPartOf={(p) => keyPartOf(entity, p)}
      frame={frame}
      isSelected={isSelected}
      onSelect={onSelect}
    />
  );
}

/**
 * The count chips on an Entity Type ↔ table link (Figma Chip_#ofMappedColumns): a gray chip for
 * the confirmed mappings, then a purple one for the suggested ones — each only when non-zero.
 */
function MappingCountChips({
  mappings,
  align,
  label,
  onClick,
  dimmed = false,
}: {
  dimmed?: boolean;
  // The link's mappings (a composite identifier counts once per column).
  mappings: ColumnRef[];
  align: "left" | "right" | "center";
  label: string;
  onClick: () => void;
}) {
  const suggestedN = mappings.filter((m) => mappingStatus(m) === "suggested").length;
  const mappedN = mappings.length - suggestedN;
  const chip =
    "flex h-[18px] min-w-[26px] items-center justify-center rounded-full border px-1.5 text-[12px] font-medium leading-4 tabular-nums";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center gap-1 transition-opacity",
        dimmed && DIMMED,
        align === "right" && "-translate-x-full",
        align === "center" && "-translate-x-1/2",
      )}
    >
      {mappedN > 0 && (
        <span
          className={cn(chip, "border-[#c9cccb] bg-[#f4f4f4] text-[#080a09] hover:bg-[#e3e5e4]")}
        >
          {mappedN}
        </span>
      )}
      {suggestedN > 0 && (
        <span
          className={cn(chip, "border-[#A855F7] bg-[#faf5ff] text-[#7e22ce] hover:bg-[#f3e8ff]")}
        >
          {suggestedN}
        </span>
      )}
    </button>
  );
}

/** `name` with the first case-insensitive match of `query` set semibold. */
function HighlightedName({ name, query }: { name: string; query?: string | undefined }) {
  const q = query?.trim().toLowerCase();
  const at = q ? name.toLowerCase().indexOf(q) : -1;
  if (!q || at === -1) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <span className="font-semibold">{name.slice(at, at + q.length)}</span>
      {name.slice(at + q.length)}
    </>
  );
}

/** "a + b": an Entity Type's Identifier(s), for "composite with …" (undefined with none). */
const identifierNames = (entity: Entity) =>
  identifiersOf(entity)
    .map((p) => p.name)
    .join(" + ") || undefined;
/** A Property's key part number (1, 2, …) — only in a composite identifier. */
function keyPartOf(entity: Entity, property: Property): number | undefined {
  const parts = identifiersOf(entity);
  const at = parts.findIndex((p) => p.id === property.id);
  return parts.length > 1 && at !== -1 ? at + 1 : undefined;
}

/** A Property typed into a list's blank row: added to `entityId` and scrolled into view. */
function createPropertyIn(app: OntologyApp, entityId: string, draft: NewPropertyDraft) {
  const [id] = app.createProperties(entityId, [draft]);
  if (id) revealProperties(entityId, [id]);
}

/** One white row in a property / column panel: grip, status dot, name, key, type, confidence. */
/** "Contact +2": the other Entity Types a column is mapped to (all of them on hover). */
function OtherEntitiesChip({ entities }: { entities: string[] }) {
  const [first, ...rest] = entities;
  return (
    <span
      title={`Mapped to ${entities.join(", ")}`}
      className="max-w-[88px] shrink truncate rounded-full bg-[#f4f4f4] px-1.5 text-[11px] leading-4 text-[#6d7472]"
    >
      {first}
      {rest.length > 0 && ` +${rest.length}`}
    </span>
  );
}

function PanelRow({
  name,
  dotColor,
  identifier,
  identifierPart,
  type,
  chip,
  grip = true,
  selected = false,
  onClick,
  moveFrom,
  highlight,
  sampleValues,
  dimmed = false,
  onEdit,
}: {
  // Shows a pencil on hover that edits the row in place.
  onEdit?: (() => void) | undefined;
  dimmed?: boolean;
  name: string;
  // A search query: the matching part of `name` is set semibold (no color change).
  highlight?: string | undefined;
  dotColor: string;
  identifier: boolean;
  // Its key part number, in a composite identifier (shown on its key).
  identifierPart?: number | undefined;
  type: string | undefined;
  chip?: ReactNode;
  sampleValues?: string[];
  // Only Property rows have the drag grip; Column rows don't move.
  grip?: boolean;
  selected?: boolean;
  onClick?: () => void;
  // A Property row's own identity: its grip drags it to another Entity Type (`usePropertyMove`).
  moveFrom?: { entityId: string; propertyId: string } | undefined;
}) {
  const move = useContext(PropertyMoveContext);
  const movable = !!(move && moveFrom);
  const row = (
    <div
      data-property-row
      data-property-id={moveFrom?.propertyId}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      // The whole row drags (to move the Property to another Entity Type), not just its grip.
      draggable={movable}
      onDragStart={(event) =>
        move && moveFrom && move.startDrag(moveFrom.entityId, moveFrom.propertyId, event)
      }
      onDragEnd={() => move?.endDrag()}
      style={movable ? ({ WebkitUserDrag: "element" } as React.CSSProperties) : undefined}
      className={cn(
        // Figma 466:86067: 32px, 6px corners; hover fills it gray (and shows the pencil).
        "group/panelrow relative flex h-8 shrink-0 items-center gap-1 rounded-[4px] border py-1.5 pl-1.5 pr-2 transition-[opacity,background-color]",
        dimmed && DIMMED,
        selected ? SELECTED_NODE : "border-[#e3e5e4] bg-white",
        onClick && !selected && "hover:bg-[#e3e5e4]",
        !grip && "pl-3",
      )}
    >
      {grip && (
        <span
          className={cn(
            "lod-detail flex shrink-0",
            movable && "cursor-grab active:cursor-grabbing",
          )}
        >
          <FigmaIcon src={dotGridIcon} />
        </span>
      )}
      {/* Figma Item (472:108647): the dot and name 6px apart, then the key / type icons 4px apart,
          both at full color. */}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="lod-type size-1.5 shrink-0 rounded-full"
            style={{ background: dotColor }}
          />
          <span className="lod-name min-w-0 flex-1 truncate text-[14px] leading-5 text-[#080a09]">
            <HighlightedName name={name} query={highlight} />
          </span>
        </span>
        {identifier && (
          <span
            role="img"
            aria-label={identifierPart ? `Identifier part ${identifierPart}` : "Identifier"}
            title={identifierPart ? `Identifier part ${identifierPart} (composite)` : undefined}
            className="lod-type flex h-4 shrink-0 items-center justify-center"
          >
            <span className="flex size-4 items-center justify-center">
              <img alt="" src={keyIcon} className="block size-[12.667px]" />
            </span>
            {identifierPart && (
              <span className="text-[10px] font-medium leading-3 text-[#967700]">
                {identifierPart}
              </span>
            )}
          </span>
        )}
        {type && (
          <span className="lod-type flex size-4 shrink-0 items-center justify-center">
            <PropertyTypeGlyph type={type} color="#6d7472" />
          </span>
        )}
      </span>
      {chip && <span className="lod-confidence contents">{chip}</span>}
      {onEdit && (
        <button
          type="button"
          aria-label={`Edit ${name}`}
          title="Edit"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="hidden size-5 shrink-0 items-center justify-center rounded-[6px] mix-blend-multiply hover:bg-[#d3d5d4] active:bg-[#c9cccb] group-hover/panelrow:flex"
        >
          <FigmaIcon src={pencilIcon} />
        </button>
      )}
    </div>
  );
  if (!sampleValues) return row;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">Sample data</p>
        {sampleValues.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1 text-[#b8bdc4]">
            {sampleValues.map((value) => (
              <li key={value} className="flex gap-2">
                <span aria-hidden>•</span>
                <span className="break-all">{value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[#b8bdc4]">No sample values</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A focused Data Table's mappings (Figma 507:26438): the selected Entity Type's Properties in a
 * panel under it, the table's Columns in a panel under the table. Mapped pairs come first, one row
 * each joined by a line — dashed while the mapping is still a suggestion; below them, the rest of
 * each side (Properties not mapped to this table, Columns not mapped to this Entity Type), with no
 * line. Both panels scroll as one, so every pair stays level; each has its own Filter / Sort /
 * Search (by Property, by Column), and Mapped / Unmapped means mapped to the other side here.
 */
function MappingPanels({
  app,
  entity,
  properties,
  table,
  width,
  isSelected,
  onSelect,
  frames,
}: {
  // The two nodes' frames: each panel is its node card's body (see `frameOf`), with an ID foot.
  frames?: { left: string; right: string } | undefined;
  app: OntologyApp;
  // The Properties' owner (the selected Entity Type) — for the mappings' confidence.
  entity: Entity;
  properties: Property[];
  table: TableSchema;
  width: number;
  isSelected: (property: Property) => boolean;
  onSelect: (property: Property) => void;
}) {
  const reviewScope = useContext(ReviewScopeContext);
  const [propFilter, setPropFilter] = useState<ListFilter>("all");
  const [propSearch, setPropSearch] = useState("");
  const [propSort, setPropSort] = useState<SortState>(DEFAULT_SORT);
  const [columnFilter, setColumnFilter] = useState<ListFilter>("all");
  const [columnSearch, setColumnSearch] = useState("");
  const [columnSort, setColumnSort] = useState<SortState>(DEFAULT_SORT);
  // The side whose Sort was changed last orders the pairs.
  const [sortSide, setSortSide] = useState<"property" | "column">("property");
  // A new Property being named (the Properties side's +), over the lists.
  const [drafting, setDrafting] = useState(false);

  const inTable = (m: ColumnRef) => m.table === table.name;

  // Aliases (see `ColumnRef.alias`): several of this Entity Type in this table — they start when
  // its Identifier gets a second column here. Each mapping carries its alias; the view can show one
  // alias at a time (`aliasView`, just navigation), and hovering / selecting one brings out its
  // lines and names.
  const aliases = aliasesIn(entity, table.name);
  const pairKey = (propertyId: string, column: string) => `${propertyId}|${column}`;
  const needing = new Set(
    mappingsNeedingAlias(entity, table.name).map(({ property, mapping }) =>
      pairKey(property.id, mapping.column),
    ),
  );
  const keyedAlias = (alias: string) =>
    identifierKeyIn(entity, table.name, alias).columns.length > 0;
  const [aliasViewRaw, setAliasView] = useState("all");
  const aliasView =
    aliasViewRaw === "all" ||
    (aliasViewRaw === "needs" && needing.size > 0) ||
    aliases.includes(aliasViewRaw)
      ? aliasViewRaw
      : "all";
  const [hoverAlias, setHoverAlias] = useState<string | null>(null);
  const [pinnedAlias, setPinnedAlias] = useState<string | null>(null);
  const focusAlias =
    hoverAlias ?? (pinnedAlias && aliases.includes(pinnedAlias) ? pinnedAlias : null);
  // Mapped columns picked (⌘/Shift-click) to assign to one alias at once.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [aliasCreate, setAliasCreate] = useState<{
    propertyId: string;
    existingColumn: string;
    newColumn: string;
    x: number;
    y: number;
  } | null>(null);
  const [aliasPick, setAliasPick] = useState<{
    propertyId: string;
    column: string;
    x: number;
    y: number;
  } | null>(null);

  // The list scrolls at its right edge, over the Columns panel: the Column rows give up the
  // scrollbar's width, so they fill the panel up to it instead of running under it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollbar, setScrollbar] = useState(0);
  const [listViewport, setListViewport] = useState({ top: 0, height: PANEL_LIST_MAX });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setScrollbar(el.offsetWidth - el.clientWidth);
      setListViewport({ top: el.scrollTop, height: el.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const columnCellWidth = NODE_W - scrollbar;
  const columnCellPad = scrollbar > 0 ? "pl-2.5 pr-1" : "px-2.5";

  // Connecting a Property and a Column, from either end: press a Property's (or a Column's) +
  // and drag onto a Column (or a Property), or click it — then the line follows the pointer until
  // the next click, which connects on the other side or, from a Property anywhere else, opens the
  // column search right there. Esc cancels.
  const rootRef = useRef<HTMLDivElement>(null);
  const [connect, setConnect] = useState<{
    from: "property" | "column";
    // The Property's id, or the Column's name.
    id: string;
    x1: number;
    y1: number;
    mode: "press" | "click";
    startX: number;
    startY: number;
  } | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [overProperty, setOverProperty] = useState<string | null>(null);
  // An Identifier dropped on a second column of this table: replace, or add a key part?
  const [keyChoice, setKeyChoice] = useState<{
    propertyId: string;
    column: string;
    current: string;
    x: number;
    y: number;
  } | null>(null);
  // Connecting a Property to a Column here. With aliases here, which one it belongs to is asked
  // first. Without: an Identifier already keyed by another column here asks — replace it, add a
  // composite key part, or another occurrence (aliases); anything else connects right away.
  const requestConnect = (propertyId: string, column: string, at: Pt) => {
    const property = entity.properties.find((p) => p.id === propertyId);
    if (!property) return;
    const here = property.mappings.filter(inTable);
    if (here.some((m) => m.column === column)) return;
    if (aliases.length > 0) {
      setAliasPick({ propertyId, column, ...at });
      return;
    }
    const current = isIdentifierProperty(property) ? here[0] : undefined;
    if (current) {
      setKeyChoice({ propertyId, column, current: current.column, ...at });
      return;
    }
    tryConnectMapping(app, entity.id, propertyId, { table: table.name, column, status: "mapped" });
  };
  const requestConnectRef = useRef(requestConnect);
  requestConnectRef.current = requestConnect;
  const [lineSearch, setLineSearch] = useState<{
    propertyId: string;
    x1: number;
    y1: number;
    x: number;
    y: number;
  } | null>(null);
  // Client → this panel's own (unscaled) coordinates, whatever the canvas zoom.
  const toLocal = useCallback((clientX: number, clientY: number): Pt => {
    const el = rootRef.current;
    const r = el?.getBoundingClientRect();
    const scale = r && el?.offsetWidth ? r.width / el.offsetWidth : 1;
    return { x: (clientX - (r?.left ?? 0)) / scale, y: (clientY - (r?.top ?? 0)) / scale };
  }, []);
  const columnAt = useCallback((clientX: number, clientY: number) => {
    const hit = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-map-column]");
    return hit && rootRef.current?.contains(hit) ? (hit.dataset["mapColumn"] ?? null) : null;
  }, []);
  const propertyAt = useCallback((clientX: number, clientY: number) => {
    const hit = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-map-property]");
    return hit && rootRef.current?.contains(hit) ? (hit.dataset["mapProperty"] ?? null) : null;
  }, []);
  const startConnect = (
    from: "property" | "column",
    id: string,
    handle: Element,
    mode: "press" | "click",
    event?: React.PointerEvent,
  ) => {
    const r = handle.getBoundingClientRect();
    const at = toLocal(r.left + r.width / 2, r.top + r.height / 2);
    setLineSearch(null);
    setConnect({
      from,
      id,
      x1: at.x,
      y1: at.y,
      mode,
      startX: event?.clientX ?? 0,
      startY: event?.clientY ?? 0,
    });
    setPointer(mode === "click" ? { x: at.x + (from === "property" ? 48 : -48), y: at.y } : at);
  };
  useEffect(() => {
    if (!connect) return;
    const finish = () => {
      setConnect(null);
      setPointer(null);
      setOverColumn(null);
      setOverProperty(null);
    };
    // The other end under the pointer: a Column from a Property, a Property from a Column.
    const targetAt = (event: PointerEvent) =>
      connect.from === "property"
        ? columnAt(event.clientX, event.clientY)
        : propertyAt(event.clientX, event.clientY);
    const connectTo = (target: string, event: PointerEvent) => {
      const at = toLocal(event.clientX, event.clientY);
      if (connect.from === "property") requestConnectRef.current(connect.id, target, at);
      else requestConnectRef.current(target, connect.id, at);
    };
    const onMove = (event: PointerEvent) => {
      setPointer(toLocal(event.clientX, event.clientY));
      if (connect.from === "property") setOverColumn(columnAt(event.clientX, event.clientY));
      else setOverProperty(propertyAt(event.clientX, event.clientY));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    let stop: () => void;
    if (connect.mode === "click") {
      // The next press connects (on a Column) or opens the search there — and does nothing else.
      const swallow = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };
      const onDown = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, true), 400);
        const target = targetAt(event);
        if (target) connectTo(target, event);
        else if (connect.from === "property") {
          const at = toLocal(event.clientX, event.clientY);
          setLineSearch({ propertyId: connect.id, x1: connect.x1, y1: connect.y1, ...at });
        }
        finish();
      };
      window.addEventListener("pointerdown", onDown, true);
      stop = () => window.removeEventListener("pointerdown", onDown, true);
    } else {
      const onUp = (event: PointerEvent) => {
        // Released where it was pressed: it was a click, so aim with the pointer instead.
        if (Math.hypot(event.clientX - connect.startX, event.clientY - connect.startY) < 4) {
          setConnect({ ...connect, mode: "click" });
          return;
        }
        const target = targetAt(event);
        if (target) connectTo(target, event);
        finish();
      };
      window.addEventListener("pointerup", onUp);
      stop = () => window.removeEventListener("pointerup", onUp);
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, [connect, toLocal, columnAt, propertyAt]);
  // While connecting, the other lines step aside and Columns of another data type fade.
  const connecting = !!connect || !!lineSearch;
  const connectable = (column: string) =>
    connect?.from !== "property" ||
    canMapPropertyToColumn(app, entity.id, connect.id, { table: table.name, column });
  // From a Column: the Properties it can't map to (another data type) fade.
  const propertyConnectable = (property: Property) =>
    connect?.from !== "column" ||
    canMapPropertyToColumn(app, entity.id, property.id, { table: table.name, column: connect.id });
  const connectProperty = (property: Property, label: string) => (
    <ConnectPlus
      label={label}
      color={SUGGESTED}
      onPress={(event) =>
        startConnect("property", property.id, event.currentTarget, "press", event)
      }
      onActivate={(target) => startConnect("property", property.id, target, "click")}
    />
  );
  const connectColumn = (column: string, label: string) => (
    <ConnectPlus
      side="left"
      label={label}
      color={SUGGESTED}
      onPress={(event) => startConnect("column", column, event.currentTarget, "press", event)}
      onActivate={(target) => startConnect("column", column, target, "click")}
    />
  );
  // One row per mapping into this table — an Identifier with a composite key there has several.
  type Pair = { property: Property; mapping: ColumnRef };
  const columnOf = (pair: Pair) => pair.mapping.column;
  const accepts = (filter: ListFilter, mapped: boolean, identifier: boolean) =>
    filter === "all" ||
    (filter === "mapped" && mapped) ||
    (filter === "unmapped" && !mapped) ||
    (filter === "identifier" && identifier);
  // Search keeps matching mapped pairs aligned across both panels; each side filters its
  // Unmapped section independently. Both sections retain their Mapped/Unmapped counts.
  const propQuery = propSearch.trim().toLowerCase();
  const columnQueryText = columnSearch.trim().toLowerCase();
  const searching = !!(propQuery || columnQueryText);
  const allPairs: Pair[] = properties.flatMap((property) =>
    property.mappings
      .filter(inTable)
      .filter((mapping) =>
        aliasView === "all"
          ? true
          : aliasView === "needs"
            ? needing.has(pairKey(property.id, mapping.column))
            : mapping.alias === aliasView,
      )
      .map((mapping) => ({ property, mapping })),
  );
  const matching = allPairs.filter(
    (pair) =>
      accepts(propFilter, true, isIdentifierProperty(pair.property)) &&
      accepts(columnFilter, true, isIdentifierProperty(pair.property)) &&
      (!searching ||
        (!!propQuery && pair.property.name.toLowerCase().includes(propQuery)) ||
        (!!columnQueryText && columnOf(pair).toLowerCase().includes(columnQueryText))),
  );
  // The pairs follow the side being sorted; the Identifier's rows stay pinned on top.
  const sortedPairs =
    sortSide === "property"
      ? sortByState(
          matching,
          propSort,
          (pair) => pair.property.name,
          (pair) => pair.property.confidence,
        )
      : sortByState(matching, columnSort, columnOf, () => undefined);
  // Keep a Property's connections together (a composite Identifier's columns, one Property's
  // column per occurrence), even when sorting by Column, so the Property appears once and each of
  // its Columns connects back to that one row. Identifiers stay on top.
  const order = [...new Set(sortedPairs.map((pair) => pair.property.id))];
  const isIdentifierId = (id: string) =>
    isIdentifierProperty(entity.properties.find((p) => p.id === id) ?? { name: "" });
  const pairs = [
    ...order.filter(isIdentifierId),
    ...order.filter((id) => !isIdentifierId(id)),
  ].flatMap((id) => sortedPairs.filter((pair) => pair.property.id === id));
  const firstRowOf = new Map<string, number>();
  pairs.forEach((pair, index) => {
    if (!firstRowOf.has(pair.property.id)) firstRowOf.set(pair.property.id, index);
  });
  // The rest of each side, listed on its own under the pairs.
  // Mapped here at all (in any alias) — the alias view narrows the pairs, never "Unmapped".
  const tablePairs = properties.flatMap((property) =>
    property.mappings.filter(inTable).map((mapping) => ({ property, mapping })),
  );
  const mappedIds = new Set(tablePairs.map((pair) => pair.property.id));
  const restProperties = filterProperties(
    entity.properties.filter(
      (p) => !mappedIds.has(p.id) && accepts(propFilter, false, isIdentifierProperty(p)),
    ),
    "all",
    propSearch,
    propSort,
  );
  const mappedColumns = new Set(tablePairs.map(columnOf));
  // Columns this Entity Type doesn't map but other Entity Types do (confirmed or only suggested).
  const mappedElsewhere = new Map<string, { entities: string[]; status: "mapped" | "suggested" }>();
  app.entities.forEach((other) => {
    if (other.id === entity.id) return;
    other.properties.forEach((p) =>
      mappingsIn(p, table.name).forEach((m) => {
        const found = mappedElsewhere.get(m.column) ?? { entities: [], status: "suggested" };
        if (!found.entities.includes(other.name)) found.entities.push(other.name);
        if (mappingStatus(m) === "mapped") found.status = "mapped";
        mappedElsewhere.set(m.column, found);
      }),
    );
  });
  const columnQuery = columnSearch.trim().toLowerCase();
  const matchesColumnSearch = (name: string) =>
    !columnQuery || name.toLowerCase().includes(columnQuery);
  // Mapped to other Entity Types: part of the Mapped group, but with no line — a line means
  // "mapped to this Entity Type".
  const elsewhereColumns = sortByState(
    table.columns.filter(
      (c) =>
        !mappedColumns.has(c.name) &&
        mappedElsewhere.has(c.name) &&
        accepts(columnFilter, true, false) &&
        matchesColumnSearch(c.name),
    ),
    columnSort,
    (c) => c.name,
    () => undefined,
  );
  const restColumns = sortByState(
    table.columns.filter(
      (c) =>
        !mappedColumns.has(c.name) &&
        !mappedElsewhere.has(c.name) &&
        accepts(columnFilter, false, false) &&
        matchesColumnSearch(c.name),
    ),
    columnSort,
    (c) => c.name,
    () => undefined,
  );
  const restRows = Math.max(restProperties.length, restColumns.length);
  const columnType = (name: string) => table.columns.find((c) => c.name === name)?.type;
  const overflows =
    (pairs.length + elsewhereColumns.length + restRows) * MAP_ROW_STEP + 2 * GROUP_HEAD_H >
    PANEL_LIST_MAX;
  const panelBg = "absolute inset-y-0 rounded-[6px] bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]";
  const panelClass = (side: "left" | "right") =>
    frames ? cn("absolute inset-y-0", attachedBody(frames[side])) : panelBg;
  const fade =
    "pointer-events-none absolute bottom-0 h-[30px] bg-gradient-to-b from-white/0 to-white";
  return (
    <div ref={rootRef} data-canvas-card className="relative" style={{ width }}>
      <div aria-hidden className={cn(panelClass("left"), "left-0")} style={{ width: NODE_W }} />
      <div aria-hidden className={cn(panelClass("right"), "right-0")} style={{ width: NODE_W }} />
      <div className="relative flex">
        <div style={{ width: NODE_W }}>
          <ListControls
            compact
            className="bg-transparent px-2"
            filter={propFilter}
            onFilterChange={setPropFilter}
            sort={propSort}
            onSortChange={(key) => {
              setPropSort((prev) => nextSortState(prev, key));
              setSortSide("property");
            }}
            search={propSearch}
            onSearchChange={setPropSearch}
            searchPlaceholder="Search properties…"
            onCreate={() => setDrafting(true)}
            createLabel="New property"
          />
        </div>
        <div className="flex-1" />
        <div style={{ width: NODE_W }}>
          <ListControls
            compact
            className="bg-transparent px-2"
            filter={columnFilter}
            onFilterChange={setColumnFilter}
            sort={columnSort}
            onSortChange={(key) => {
              setColumnSort((prev) => nextSortState(prev, key));
              setSortSide("column");
            }}
            search={columnSearch}
            onSearchChange={setColumnSearch}
            searchPlaceholder="Search columns…"
          />
        </div>
      </div>
      {drafting && (
        <div className="relative px-2 pb-1.5" style={{ width: NODE_W }}>
          <PropertyDraftRow
            onSubmit={(draft) => createPropertyIn(app, entity.id, draft)}
            onClose={() => setDrafting(false)}
            currentIdentifier={identifierNames(entity)}
          />
        </div>
      )}
      {aliases.length > 0 && (
        <AliasNavigator
          aliases={aliases}
          view={aliasView}
          onView={setAliasView}
          keyed={keyedAlias}
          needing={needing.size}
          onHover={setHoverAlias}
        />
      )}
      <div
        ref={scrollRef}
        data-canvas-scroll
        aria-label="Mappings"
        onScroll={(event) =>
          setListViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
        }
        className="relative flex flex-col overflow-y-auto overscroll-contain pb-2.5 [scrollbar-width:thin]"
        style={{ maxHeight: PANEL_LIST_MAX }}
      >
        {pairs.length === 0 && elsewhereColumns.length === 0 && restRows === 0 && (
          <p
            className="py-3 text-[12px] text-[#6d7472]"
            style={{ width: NODE_W, textAlign: "center" }}
          >
            Nothing matches.
          </p>
        )}
        {pairs.length + elsewhereColumns.length > 0 && (
          <div className="flex shrink-0 items-stretch">
            <GroupCell tone="Mapped" first width={NODE_W}>
              <GroupCellHead
                label="Mapped"
                count={new Set(pairs.map((pair) => pair.property.id)).size}
              />
            </GroupCell>
            <div className="flex-1" />
            <GroupCell tone="Mapped" first width={columnCellWidth} pad={columnCellPad}>
              <GroupCellHead label="Mapped" count={pairs.length + elsewhereColumns.length} />
            </GroupCell>
          </div>
        )}
        {pairs.map((pair, index) => {
          const { property, mapping } = pair;
          const suggested = mappingStatus(mapping) === "suggested";
          const firstRow = firstRowOf.get(property.id);
          const repeatedIdentifier = firstRow !== undefined && firstRow !== index;
          const rowOffset = repeatedIdentifier ? (index - firstRow) * MAP_ROW_STEP : 0;
          const sourceTop = GROUP_HEAD_H + (firstRow ?? index) * MAP_ROW_STEP;
          const sourceVisible =
            sourceTop < listViewport.top + listViewport.height && sourceTop + 32 > listViewport.top;
          const lastPair = index === pairs.length - 1 && elsewhereColumns.length === 0;
          const key = pairKey(property.id, mapping.column);
          const needsAlias = needing.has(key);
          const inFocus = !!focusAlias && mapping.alias === focusAlias;
          const faded = !!focusAlias && !inFocus;
          const tone = aliasTone(aliases, mapping.alias);
          // Figma "Edge/Explorer" idle layer for an ordinary mapping line (the alias / needs-alias
          // states keep their own colors).
          const idleLine = !inFocus && !needsAlias;
          const lineColor = inFocus ? tone : needsAlias ? "#f15b15" : EDGE_STROKE;
          const lineOpacity = idleLine ? EDGE_STYLE.idle.opacity : 1;
          return (
            <div
              key={`${property.id}:${mapping.column}`}
              className="relative flex shrink-0 items-stretch"
            >
              {/* Figma "Edge/Explorer" handles: a 6px dot on each panel's edge, above the rows. */}
              <span
                aria-hidden
                className="pointer-events-none absolute z-40 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#62748E]"
                style={{ left: NODE_W, top: repeatedIdentifier ? 16 - rowOffset : 16 }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute z-40 size-1.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#62748E]"
                style={{ right: NODE_W, top: 16 }}
              />
              <GroupCell tone="Mapped" last={index === pairs.length - 1} width={NODE_W}>
                {repeatedIdentifier ? (
                  <div className="h-8" />
                ) : (
                  <div
                    data-map-property={property.id}
                    className={cn(
                      "group/maprow relative z-30 transition-opacity",
                      !propertyConnectable(property) && "opacity-40",
                    )}
                  >
                    <PanelRow
                      name={property.name}
                      highlight={propQuery}
                      dotColor={statusDotColor(propertyStatus(property))}
                      dimmed={!reviewScope.property(property)}
                      identifier={isIdentifierProperty(property)}
                      identifierPart={keyPartOf(entity, property)}
                      type={property.type}
                      chip={
                        propertyReview(property) === "suggested" ? (
                          <PropertyConfidenceChip property={property} tone="muted" />
                        ) : null
                      }
                      selected={isSelected(property) || overProperty === property.id}
                      onClick={() => onSelect(property)}
                      moveFrom={{ entityId: entity.id, propertyId: property.id }}
                    />
                    {!connecting && (
                      <ConnectPlus
                        label="Connect to another column"
                        color={suggested ? SUGGESTED : SETTLED}
                        onPress={(event) =>
                          startConnect("property", property.id, event.currentTarget, "press", event)
                        }
                        onActivate={(target) =>
                          startConnect("property", property.id, target, "click")
                        }
                      />
                    )}
                  </div>
                )}
              </GroupCell>
              {/* Each composite column connects to the Identifier's single visible row. Drawn over
                  the groups' tint, under the rows, so it reaches each row's edge. */}
              <div
                onMouseEnter={() => mapping.alias && setHoverAlias(mapping.alias)}
                onMouseLeave={() => setHoverAlias(null)}
                onClick={() =>
                  mapping.alias &&
                  setPinnedAlias((current) => (current === mapping.alias ? null : mapping.alias!))
                }
                className={cn(
                  "group/mapline relative z-20 -mx-5 mt-1.5 flex h-5 min-w-0 flex-1 items-center self-start transition-opacity",
                  mapping.alias && "cursor-pointer",
                  connecting || (repeatedIdentifier && !sourceVisible)
                    ? "pointer-events-none opacity-0"
                    : faded
                      ? "opacity-25"
                      : !reviewScope.property(property) && DIMMED,
                )}
              >
                {repeatedIdentifier ? (
                  <svg
                    aria-hidden
                    className="absolute inset-0 h-full w-full overflow-visible"
                    viewBox="0 0 100 20"
                    preserveAspectRatio="none"
                  >
                    <path
                      d={`M 0 ${10 - rowOffset} C 35 ${10 - rowOffset} 65 10 100 10`}
                      fill="none"
                      stroke={lineColor}
                      strokeOpacity={lineOpacity}
                      strokeWidth={inFocus ? 2 : 1.5}
                      strokeDasharray={needsAlias ? "3 3" : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                ) : (
                  <span
                    aria-hidden
                    className={cn("w-full", inFocus ? "h-[2px]" : "h-[1.5px]")}
                    style={
                      needsAlias
                        ? {
                            backgroundImage: `repeating-linear-gradient(to right, ${lineColor} 0 3px, transparent 3px 6px)`,
                          }
                        : { backgroundColor: lineColor, opacity: lineOpacity }
                    }
                  />
                )}

                {/* Its alias name: only while that alias is hovered or selected. */}
                {inFocus && (
                  <span
                    className="pointer-events-none absolute left-[30%] top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-white px-1.5 text-[11px] font-medium leading-4"
                    style={{ borderColor: tone, color: tone }}
                  >
                    @{mapping.alias}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Disconnect ${property.name} from ${mapping.column}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    app.disconnectMapping(entity.id, property.id, mapping);
                  }}
                  className="absolute left-1/2 top-1/2 flex size-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#c9cccb] bg-white text-[#3c4140] opacity-0 transition-[opacity,background-color,border-color,color] hover:border-[#f15b15] hover:bg-[#ffe6db] hover:text-[#9c461e] focus-visible:opacity-100 group-hover/mapline:opacity-100"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </div>
              <div
                data-map-column={mapping.column}
                onMouseEnter={() => mapping.alias && setHoverAlias(mapping.alias)}
                onMouseLeave={() => setHoverAlias(null)}
                onClickCapture={(event) => {
                  // ⌘ / Shift-click picks mapped columns to assign to one alias together.
                  if (aliases.length === 0 || !(event.metaKey || event.shiftKey || event.ctrlKey))
                    return;
                  event.stopPropagation();
                  event.preventDefault();
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                }}
                className={cn(
                  "transition-opacity",
                  !connectable(mapping.column) && "opacity-40",
                  faded && "opacity-35",
                )}
                style={{ width: columnCellWidth }}
              >
                <GroupCell
                  tone="Mapped"
                  last={lastPair}
                  width={columnCellWidth}
                  pad={columnCellPad}
                >
                  <div
                    className={cn(
                      "group/maprow relative z-30 rounded-[6px]",
                      picked.has(key) && "ring-2 ring-[#3b82f6] ring-offset-1",
                    )}
                  >
                    {!connecting && connectColumn(mapping.column, "Connect to another property")}
                    {/* Its alias's mark (or, still needing one, a red dashed one). */}
                    {(mapping.alias || needsAlias) && (
                      <span
                        aria-hidden
                        className="absolute -left-1.5 bottom-1 top-1 w-[3px] rounded-full"
                        style={
                          needsAlias
                            ? {
                                backgroundImage:
                                  "repeating-linear-gradient(to bottom, #f15b15 0 3px, transparent 3px 5px)",
                              }
                            : { backgroundColor: tone }
                        }
                      />
                    )}
                    <PanelRow
                      grip={false}
                      name={mapping.column}
                      sampleValues={columnSamples(table, mapping.column)}
                      dimmed={!reviewScope.column(table.name, mapping.column)}
                      highlight={columnQueryText}
                      dotColor={suggested ? "#7e22ce" : "#0891b2"}
                      identifier={isIdentifierProperty(property)}
                      identifierPart={keyPartOf(entity, property)}
                      type={columnType(mapping.column)}
                      chip={
                        <>
                          {needsAlias && (
                            <span className="shrink-0 rounded-full bg-[#ffe6db] px-1.5 text-[11px] font-medium leading-4 text-[#9c461e]">
                              Needs alias
                            </span>
                          )}
                          {suggested && (
                            <MappingConfidenceChip
                              entity={entity}
                              property={property}
                              mapping={mapping}
                              tone="muted"
                            />
                          )}
                        </>
                      }
                      selected={isSelected(property) || overColumn === mapping.column}
                      onClick={() => onSelect(property)}
                    />
                  </div>
                </GroupCell>
              </div>
            </div>
          );
        })}
        {elsewhereColumns.map((column, i) => {
          const other = mappedElsewhere.get(column.name)!;
          const last = i === elsewhereColumns.length - 1;
          return (
            <div key={`elsewhere-${column.name}`} className="flex shrink-0 items-stretch">
              {/* No property here: the left group has already ended, so this is just a spacer. */}
              <div style={{ width: NODE_W }} />
              <div className="flex-1" />
              <div
                data-map-column={column.name}
                className={cn("transition-opacity", !connectable(column.name) && "opacity-40")}
                style={{ width: columnCellWidth }}
              >
                <GroupCell tone="Mapped" last={last} width={columnCellWidth} pad={columnCellPad}>
                  <div className="group/maprow relative z-30">
                    <PanelRow
                      grip={false}
                      name={column.name}
                      sampleValues={columnSamples(table, column.name)}
                      highlight={columnQueryText}
                      dimmed={!reviewScope.column(table.name, column.name)}
                      dotColor={itemStatusDotColor(
                        other.status === "mapped" ? "confirmed" : "suggested",
                      )}
                      identifier={false}
                      type={column.type}
                      chip={<OtherEntitiesChip entities={other.entities} />}
                      selected={overColumn === column.name}
                    />
                    {!connecting &&
                      connectColumn(column.name, `Connect ${column.name} to a property`)}
                  </div>
                </GroupCell>
              </div>
            </div>
          );
        })}
        {restRows > 0 && (
          <div
            className={cn(
              "flex shrink-0 items-stretch",
              pairs.length + elsewhereColumns.length > 0 && "mt-2",
            )}
          >
            <GroupCell tone="Unmapped" first width={NODE_W}>
              <GroupCellHead label="Unmapped" count={restProperties.length} />
            </GroupCell>
            <div className="flex-1" />
            <GroupCell tone="Unmapped" first width={columnCellWidth} pad={columnCellPad}>
              <GroupCellHead label="Unmapped" count={restColumns.length} />
            </GroupCell>
          </div>
        )}
        {Array.from({ length: restRows }, (_, i) => {
          const property = restProperties[i];
          const column = restColumns[i];
          return (
            <div key={`rest-${i}`} className="flex shrink-0 items-stretch">
              <GroupCell tone="Unmapped" last={i === restRows - 1} width={NODE_W}>
                {property ? (
                  <div
                    data-map-property={property.id}
                    className={cn(
                      "group/maprow relative z-30 transition-opacity",
                      !propertyConnectable(property) && "opacity-40",
                    )}
                  >
                    <PanelRow
                      name={property.name}
                      highlight={propQuery}
                      dotColor={statusDotColor(propertyStatus(property))}
                      dimmed={!reviewScope.property(property)}
                      identifier={isIdentifierProperty(property)}
                      identifierPart={keyPartOf(entity, property)}
                      type={property.type}
                      chip={
                        propertyReview(property) === "suggested" ? (
                          <PropertyConfidenceChip property={property} tone="muted" />
                        ) : null
                      }
                      selected={isSelected(property) || overProperty === property.id}
                      onClick={() => onSelect(property)}
                      moveFrom={{ entityId: entity.id, propertyId: property.id }}
                    />
                    {!connecting &&
                      connectProperty(property, `Connect ${property.name} to a column`)}
                  </div>
                ) : (
                  <div className="h-8" />
                )}
              </GroupCell>
              <div className="flex-1" />
              <div
                data-map-column={column?.name}
                className={cn(
                  "transition-opacity",
                  column && !connectable(column.name) && "opacity-40",
                )}
                style={{ width: columnCellWidth }}
              >
                <GroupCell
                  tone="Unmapped"
                  last={i === restRows - 1}
                  width={columnCellWidth}
                  pad={columnCellPad}
                >
                  {column ? (
                    <div className="group/maprow relative z-30">
                      <PanelRow
                        grip={false}
                        name={column.name}
                        sampleValues={columnSamples(table, column.name)}
                        highlight={columnQueryText}
                        dimmed={!reviewScope.column(table.name, column.name)}
                        dotColor="#c9cccb"
                        identifier={false}
                        type={column.type}
                        selected={overColumn === column.name}
                      />
                      {!connecting &&
                        connectColumn(column.name, `Connect ${column.name} to a property`)}
                    </div>
                  ) : (
                    <div className="h-8" />
                  )}
                </GroupCell>
              </div>
            </div>
          );
        })}
      </div>
      {overflows && (
        <>
          <div aria-hidden className={cn(fade, "left-0")} style={{ width: NODE_W, bottom: 0 }} />
          <div aria-hidden className={cn(fade, "right-0")} style={{ width: NODE_W, bottom: 0 }} />
        </>
      )}
      {/* The line being drawn, from the Property's + to the pointer (or to the open search). */}
      {(connect || lineSearch) && (
        <svg
          className="pointer-events-none absolute left-0 top-0 z-20 overflow-visible"
          width={1}
          height={1}
        >
          {connect && pointer && (
            <path
              d={`M ${connect.x1} ${connect.y1} L ${pointer.x} ${pointer.y}`}
              fill="none"
              stroke={SETTLED}
              strokeWidth={2}
            />
          )}
          {lineSearch && (
            <path
              d={`M ${lineSearch.x1} ${lineSearch.y1} L ${lineSearch.x} ${lineSearch.y}`}
              fill="none"
              stroke={SETTLED}
              strokeWidth={2}
            />
          )}
        </svg>
      )}
      {/* Click-to-connect: a search button rides the line's end (hidden over a Column, where a
          click connects instead). */}
      {connect?.from === "property" && connect.mode === "click" && pointer && !overColumn && (
        <span
          aria-hidden
          className={cn(
            CONNECT_ACTION,
            "pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2",
          )}
          style={{ left: pointer.x, top: pointer.y }}
        >
          <FigmaIcon src={searchIcon} />
        </span>
      )}
      {keyChoice &&
        (() => {
          const property = entity.properties.find((p) => p.id === keyChoice.propertyId);
          const target = {
            table: table.name,
            column: keyChoice.column,
            status: "mapped" as const,
          };
          const canReplace = canMapPropertyToColumn(app, entity.id, keyChoice.propertyId, target);
          const choice =
            "flex w-full flex-col items-start gap-0.5 rounded-[6px] px-2.5 py-2 text-left transition-colors hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
          return (
            <Popover open onOpenChange={(isOpen) => !isOpen && setKeyChoice(null)}>
              <PopoverTrigger asChild>
                <span
                  aria-hidden
                  className="absolute size-0"
                  style={{ left: keyChoice.x, top: keyChoice.y }}
                />
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={8}
                onPointerDown={(event) => event.stopPropagation()}
                className="w-[280px] rounded-[10px] border-[#e3e5e4] bg-white p-1 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.16)]"
              >
                <p className="px-2.5 pb-1 pt-2 text-[12px] leading-4 text-[#6d7472]">
                  {property?.name} is already keyed by{" "}
                  <span className="font-medium text-[#161919]">{keyChoice.current}</span> here.
                </p>
                <button
                  type="button"
                  disabled={!canReplace}
                  title={canReplace ? undefined : `${keyChoice.column}'s type doesn't fit`}
                  onClick={() => {
                    tryConnectMapping(app, entity.id, keyChoice.propertyId, target);
                    setKeyChoice(null);
                  }}
                  className={choice}
                >
                  <span className="text-[13px] font-medium leading-5 text-[#161919]">
                    Replace with {keyChoice.column}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    app.addIdentifierPart(entity.id, target);
                    setKeyChoice(null);
                  }}
                  className={choice}
                >
                  <span className="text-[13px] font-medium leading-5 text-[#161919]">
                    Add {keyChoice.column} as an identifier part
                  </span>
                  <span className="text-[12px] leading-4 text-[#6d7472]">
                    Makes the identifier composite: records are told apart by both together.
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!canReplace}
                  onClick={() => {
                    setAliasCreate({
                      propertyId: keyChoice.propertyId,
                      existingColumn: keyChoice.current,
                      newColumn: keyChoice.column,
                      x: keyChoice.x,
                      y: keyChoice.y,
                    });
                    setKeyChoice(null);
                  }}
                  className={choice}
                >
                  <span className="text-[13px] font-medium leading-5 text-[#161919]">
                    Another {entity.name || "one"} in each row
                  </span>
                  <span className="text-[12px] leading-4 text-[#6d7472]">
                    Two {entity.name ? `${entity.name}s` : "occurrences"} per row, told apart by
                    aliases (e.g. departure / arrival).
                  </span>
                </button>
              </PopoverContent>
            </Popover>
          );
        })()}
      {aliasCreate && (
        <Popover open onOpenChange={(isOpen) => !isOpen && setAliasCreate(null)}>
          <PopoverTrigger asChild>
            <span
              aria-hidden
              className="absolute size-0"
              style={{ left: aliasCreate.x, top: aliasCreate.y }}
            />
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            onPointerDown={(event) => event.stopPropagation()}
            className="w-[300px] rounded-[10px] border-[#e3e5e4] bg-white p-0 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.16)]"
          >
            {(() => {
              const create = aliasCreate;
              const others = entity.properties.flatMap((p) =>
                p.mappings
                  .filter((m) => inTable(m) && !(p.id === create.propertyId))
                  .map((m) => pairKey(p.id, m.column)),
              );
              return (
                <AliasCreateForm
                  entityName={entity.name || "Entity type"}
                  table={table.name}
                  existingColumn={create.existingColumn}
                  newColumn={create.newColumn}
                  othersCount={others.length}
                  onCancel={() => setAliasCreate(null)}
                  onCreate={(first, second) => {
                    app.applyAliases(
                      entity.id,
                      table.name,
                      [
                        {
                          propertyId: create.propertyId,
                          column: create.existingColumn,
                          alias: first,
                        },
                      ],
                      {
                        propertyId: create.propertyId,
                        mapping: {
                          table: table.name,
                          column: create.newColumn,
                          status: "mapped",
                          alias: second,
                        },
                      },
                      "Created aliases",
                    );
                    setAliasCreate(null);
                    // Next: the other mappings here, picked and shown, to assign in one go.
                    if (others.length > 0) {
                      setPicked(new Set(others));
                      setAliasView("needs");
                    }
                  }}
                />
              );
            })()}
          </PopoverContent>
        </Popover>
      )}
      {aliasPick &&
        (() => {
          const pick = aliasPick;
          const property = entity.properties.find((p) => p.id === pick.propertyId);
          if (!property) return null;
          const taken = property.mappings
            .filter((m) => inTable(m) && m.alias)
            .map((m) => m.alias as string);
          return (
            <Popover open onOpenChange={(isOpen) => !isOpen && setAliasPick(null)}>
              <PopoverTrigger asChild>
                <span
                  aria-hidden
                  className="absolute size-0"
                  style={{ left: pick.x, top: pick.y }}
                />
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={8}
                onPointerDown={(event) => event.stopPropagation()}
                className="w-[260px] rounded-[10px] border-[#e3e5e4] bg-white p-0 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.16)]"
              >
                <AliasPickList
                  entityName={entity.name || "Entity type"}
                  propertyName={property.name}
                  column={pick.column}
                  aliases={aliases}
                  taken={taken}
                  allowNew={isIdentifierProperty(property)}
                  onPick={(alias) => {
                    const mapping: ColumnRef = {
                      table: table.name,
                      column: pick.column,
                      status: "mapped",
                      ...(alias ? { alias } : {}),
                    };
                    if (canMapPropertyToColumn(app, entity.id, property.id, mapping)) {
                      app.applyAliases(
                        entity.id,
                        table.name,
                        [],
                        { propertyId: property.id, mapping },
                        "Created Mapping",
                      );
                    }
                    setAliasPick(null);
                  }}
                />
              </PopoverContent>
            </Popover>
          );
        })()}
      {picked.size > 0 && aliases.length > 0 && (
        <div className="absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2">
          <BulkAliasBar
            count={picked.size}
            aliases={aliases}
            onClear={() => setPicked(new Set())}
            onAssign={(alias) => {
              app.applyAliases(
                entity.id,
                table.name,
                [...picked].map((k) => {
                  const [propertyId, column] = k.split("|") as [string, string];
                  return { propertyId, column, alias };
                }),
                undefined,
                "Assigned alias",
              );
              setPicked(new Set());
            }}
          />
        </div>
      )}
      {lineSearch && (
        <Popover open onOpenChange={(isOpen) => !isOpen && setLineSearch(null)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Search columns"
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                CONNECT_ACTION,
                "absolute z-30 -translate-x-1/2 -translate-y-1/2 border-[#161919] text-[#161919]",
              )}
              style={{ left: lineSearch.x, top: lineSearch.y }}
            >
              <FigmaIcon src={searchIcon} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            onPointerDown={(event) => event.stopPropagation()}
            className="w-[340px] rounded-[10px] border-[#e3e5e4] bg-white p-0 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.16)]"
          >
            <ColumnSearchList
              app={app}
              preferTable={table.name}
              onPick={(value) => {
                const mapping = parseMappingValue(value);
                if (mapping?.table === table.name) {
                  requestConnect(lineSearch.propertyId, mapping.column, {
                    x: lineSearch.x,
                    y: lineSearch.y,
                  });
                } else if (mapping) {
                  tryConnectMapping(app, entity.id, lineSearch.propertyId, mapping);
                }
                setLineSearch(null);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Arrowheads for a Relation's direction (from → to), shared by both Graph views' curves. */
function ArrowMarkers() {
  return (
    <defs>
      {(
        [
          [ARROW_SUGGESTED, SUGGESTED],
          [ARROW_SETTLED, EDGE_STROKE],
        ] as const
      ).map(([id, color]) => (
        <marker
          key={id}
          id={id}
          viewBox="0 0 8 8"
          refX={8}
          refY={4}
          markerWidth={8}
          markerHeight={8}
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M 0 0.5 L 8 4 L 0 7.5 Z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}

/** The placeholder where a Relation being created will appear (Figma 356:184345; see
 * `relationPlusFor`). */
function GhostRelationPill() {
  return (
    <div
      aria-hidden
      className="flex h-[26px] items-center gap-2 rounded-full border border-[#d3d5d4] bg-[#f4f4f4] py-1 pl-3 pr-1.5 text-[12px] leading-4 text-[#6d7472] opacity-70"
      style={{ width: PILL_W }}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-[#6d7472]" />
      <span className="truncate">New relation</span>
    </div>
  );
}

const CONNECT_ACTION =
  "flex size-5 items-center justify-center rounded-full border-[1.5px] border-[#A855F7] bg-white text-[#A855F7] shadow-[0_1px_2px_0_rgba(0,0,0,0.08)]";

/**
 * The + where a Property's line starts (its row's right edge), shown while the row is hovered:
 * press and drag it onto a Column, or click it to aim the line with the pointer.
 */
function ConnectPlus({
  label,
  color,
  side = "right",
  onPress,
  onActivate,
}: {
  label: string;
  color: string;
  // The row edge it sits on: a Property's right, a Column's left (facing each other).
  side?: "left" | "right";
  onPress: (event: React.PointerEvent<HTMLButtonElement>) => void;
  // The keyboard's way in (a click from the pointer is handled by the press).
  onActivate: (target: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onPress(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail === 0) onActivate(event.currentTarget);
      }}
      className={cn(
        "absolute top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] bg-white opacity-0 shadow-[0_1px_2px_0_rgba(0,0,0,0.08)] transition-[opacity,background-color] hover:bg-[#f4f4f4] focus-visible:opacity-100 group-hover/maprow:opacity-100",
        side === "right" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
      )}
      style={{ borderColor: color, color }}
    >
      <Plus className="size-3" strokeWidth={2} />
    </button>
  );
}

function MoreButton({
  label,
  onClick,
  centered = false,
}: {
  label: string;
  onClick: () => void;
  // Centered on its position (under a column of nodes) rather than starting there.
  centered?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-[#e3e5e4] bg-white px-3 text-[12px] font-medium text-[#6d7472] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] transition-colors hover:border-[#161919] hover:text-[#161919]",
        centered && "-translate-x-1/2",
      )}
    >
      {label}
    </button>
  );
}

// --- Data-table-triggered Graph ---------------------------------------------------------------

// The selected Data Table is the main node (Figma 521:22974): the Entity Types mapped (or
// suggested to be mapped) into it stack on its left, each line carrying how many of their
// Properties map there. World origin is the middle of the two columns.
const TG_TABLE_X = 81;
const TG_ENTITY_X = -81 - NODE_W;
// An Entity Type's own Relations (Figma 521:24681) open one column further out on the left.
const TG_RELATED_X = TG_ENTITY_X - LINK_GAP - NODE_W;
const TG_PILL_X = TG_RELATED_X + NODE_W + PILL_GAP;

type MappedEntity = { entity: Entity; mapped: Property[] };

/**
 * The Graph layout for Data-table-triggered editing: the table in the middle-right, the Entity
 * Types that map into it on its left (5 at a time, "+ N more" for the rest). An Entity Type's ⌄
 * (or its count) lays its Property → Column mappings out between it and the table, where they can
 * be connected / disconnected (`MappingPanels`). Hovering an Entity Type previews the Entity Types
 * it's related to one column further out, with its Relation pills in between; clicking it pins
 * that (and opens its details) until the canvas is clicked.
 */
export function TableGraphView({
  app,
  table,
  onEdit,
  onSplit,
}: {
  app: OntologyApp;
  table: TableSchema;
  onEdit?: (key: string) => void;
  onSplit?: (newEntityId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const canvas = useEditingCanvas(viewportRef, worldRef, scaleRef);
  const move = usePropertyMove(app);
  const [handleLayer, setHandleLayer] = useState<SVGGElement | null>(null);

  const [showAll, setShowAll] = useState(false);
  const [showAllRelated, setShowAllRelated] = useState(false);
  // The Entity Type whose mappings are laid out between it and the table.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The Entity Type whose Relations are shown: pinned by a click, or previewed while hovered.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [inspectedTable, setInspectedTable] = useState<string | null>(null);

  // --- Data -------------------------------------------------------------------------------
  const mappedEntities = useMemo<MappedEntity[]>(
    () =>
      app.entities
        .map((entity) => ({
          entity,
          mapped: entity.properties.filter((p) => mapsInto(p, table.name)),
        }))
        .filter((m) => m.mapped.length > 0)
        .sort((a, b) => b.mapped.length - a.mapped.length),
    [app.entities, table.name],
  );
  const focused = focusedId ? mappedEntities.find((m) => m.entity.id === focusedId) : undefined;
  const activeId = focused ? null : (pinnedId ?? hoveredId);
  const shownEntities = focused
    ? [focused]
    : showAll
      ? mappedEntities
      : mappedEntities.slice(0, PREVIEW);
  const entityItems = focused
    ? [{ kind: "entity" as const, key: `entity:${focused.entity.id}`, ...focused, h: NODE_H, y: 0 }]
    : stack(
        [
          ...shownEntities.map((m) => ({
            kind: "entity" as const,
            key: `entity:${m.entity.id}`,
            ...m,
            h: NODE_H,
          })),
          ...(mappedEntities.length > PREVIEW
            ? [
                {
                  kind: "more" as const,
                  key: "more:entities",
                  h: MORE_H,
                  hidden: mappedEntities.length - PREVIEW,
                },
              ]
            : []),
        ],
        0,
      );
  const activeItem = activeId
    ? entityItems.find((i) => i.kind === "entity" && i.entity.id === activeId)
    : undefined;
  const activeY = activeItem?.y ?? 0;

  // The active Entity Type's related Entity Types (self Relations aren't a branch).
  const related = useMemo<Counterpart[]>(() => {
    if (!activeId) return [];
    const byId = new Map<string, Counterpart>();
    app.relations.forEach((relation) => {
      if (relation.from !== activeId && relation.to !== activeId) return;
      const outgoing = relation.from === activeId;
      const otherId = outgoing ? relation.to : relation.from;
      if (otherId === activeId) return;
      const entity = app.entities.find((e) => e.id === otherId);
      if (!entity) return;
      const entry = byId.get(entity.id) ?? { entity, relations: [] };
      entry.relations.push({ relation, outgoing });
      byId.set(entity.id, entry);
    });
    return [...byId.values()];
  }, [activeId, app.relations, app.entities]);
  const relatedShown = showAllRelated ? related : related.slice(0, PREVIEW);
  const relatedItems = stack(
    [
      ...relatedShown.map((cp) => ({
        kind: "entity" as const,
        key: `related:${cp.entity.id}`,
        cp,
        h: NODE_H,
      })),
      ...(related.length > PREVIEW
        ? [
            {
              kind: "more" as const,
              key: "more:related",
              h: MORE_H,
              hidden: related.length - PREVIEW,
            },
          ]
        : []),
    ],
    activeY,
  );
  // Relation pills in their own column, in related-Entity order around the active Entity Type.
  const pillY = (() => {
    const ids: { id: string; entityId: string }[] = [];
    relatedItems.forEach((item) => {
      if (item.kind !== "entity") return;
      item.cp.relations.forEach(({ relation }) =>
        ids.push({ id: relation.id, entityId: item.cp.entity.id }),
      );
    });
    const ys: number[] = [];
    ids.forEach((r, i) => {
      const prev = ids[i - 1];
      ys.push(!prev ? 0 : ys[i - 1]! + (prev.entityId === r.entityId ? PILL_SLOT_SAME : PILL_SLOT));
    });
    const mid = ys.length ? (ys[0]! + ys[ys.length - 1]!) / 2 : 0;
    return new Map(ids.map((r, i) => [r.id, ys[i]! - mid + activeY]));
  })();

  // Pinning an Entity Type brings its Relations into view (never zooming in).
  useEffect(() => {
    if (!pinnedId) return;
    canvas.frame(
      {
        left: TG_RELATED_X - 24,
        right: TG_TABLE_X + NODE_W + 24,
        top: -Math.max(160, entityItems.length * (NODE_H + GAP_Y)) / 2,
        bottom: Math.max(160, entityItems.length * (NODE_H + GAP_Y)) / 2,
      },
      canvas.view.z,
    );
    // Only when the pin changes, not on every re-layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedId]);

  const hoverEntity = (id: string | null) => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (id) setHoveredId(id);
    // Leaving waits a moment, so the pointer can travel to the Relations it revealed.
    else hoverTimer.current = window.setTimeout(() => setHoveredId(null), 250);
  };
  const keepHover = () => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  // --- Selection / detail panel ------------------------------------------------------------
  // Shift/⌘/ctrl held on the last press: that click toggles the item in the multi-selection.
  const multiRef = useRef(false);
  const inspect = useCallback(
    (ref: SuggestionRef) => {
      setInspectedTable(null);
      if (multiRef.current) app.toggleSuggestionSelected(ref);
      else app.selectSuggestionKeys([suggestionKey(ref)]);
    },
    [app],
  );
  const inspectTable = useCallback(
    (name: string) => {
      app.clearSuggestionSelection();
      setInspectedTable(name);
    },
    [app],
  );
  const closeDetail = useCallback(() => {
    setInspectedTable(null);
    setPinnedId(null);
    app.clearSuggestionSelection();
  }, [app]);
  const toggleFocus = (id: string) => {
    setFocusedId((current) => (current === id ? null : id));
    setPinnedId(null);
    setHoveredId(null);
    setColumnsOpen(false);
  };
  const selected = app.suggestionSelection;
  const isSelected = (ref: SuggestionRef) => selected.has(suggestionKey(ref));
  const detailItem = resolveDetailItem(app, inspectedTable);
  const queue = [
    ...shownEntities
      .filter(({ entity }) => entityReview(entity) === "suggested")
      .map(({ entity }) => suggestionKey({ kind: "entity", id: entity.id })),
    ...related.flatMap(({ relations }) =>
      relations
        .filter(({ relation }) => relationReview(relation) === "suggested")
        .map(({ relation }) => suggestionKey({ kind: "relation", id: relation.id })),
    ),
    ...(focused
      ? focused.mapped
          .filter((p) => propertyReview(p) === "suggested")
          .map((p) =>
            suggestionKey({ kind: "property", entityId: focused.entity.id, propertyId: p.id }),
          )
      : []),
  ];
  // The review bar counts what this graph is about: the Entity Types mapping into the table and
  // their mappings into it.
  const reviewScope = useReviewScope(app);
  const scope = useMemo<SuggestionScope>(() => {
    const ids = new Set(mappedEntities.map((m) => m.entity.id));
    return {
      entity: (entity) => ids.has(entity.id),
      property: (owner, property) => ids.has(owner.id) && mapsInto(property, table.name),
      relation: (relation) => ids.has(relation.from) || ids.has(relation.to),
      mapping: (owner, property) => ids.has(owner.id) && mapsInto(property, table.name),
    };
  }, [mappedEntities, table.name]);

  const tableSelected = inspectedTable === table.name && detailItem?.kind === "table";
  const entityNode = (entity: Entity, trailing?: ReactNode, attached = false) => (
    <GraphNode
      attached={attached}
      status={
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={16}
          confidence={entity.confidence}
        />
      }
      attachedStatus={<ItemStatusIcon status={entityDisplayStatus(entity)} size={20} />}
      name={entity.name}
      detail={entityDetail(entity)}
      classNode={{
        mapping: classNodeMapping(entity),
        counts: classNodeCounts(entity),
        sparkle: entityDisplayStatus(entity) === "suggested",
      }}
      dropFor={entity.id}
      dimmed={!reviewScope.entity(entity)}
      chip={
        entityReview(entity) === "suggested" ? (
          <EntityConfidenceChip entity={entity} tone="muted" size="node" />
        ) : null
      }
      selected={isSelected({ kind: "entity", id: entity.id })}
      onClick={() => inspect({ kind: "entity", id: entity.id })}
      // Double-click opens that Entity Type's own editing workspace.
      onDoubleClick={() => app.openDetail("entity", entity.id)}
      trailing={trailing}
    />
  );

  return (
    <ReviewScopeContext.Provider value={reviewScope}>
      <HandleLayerContext.Provider value={handleLayer}>
        <PropertyMoveContext.Provider value={move}>
          <CanvasZoomCard canvas={canvas} />
          <div
            ref={viewportRef}
            data-canvas-viewport
            onPointerDownCapture={(event) => {
              multiRef.current = event.shiftKey || event.metaKey || event.ctrlKey;
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 && event.button !== 1) return;
              if (canvas.tool === "pan" || event.button === 1 || isCanvasBackground(event.target)) {
                canvas.startPan(event);
              }
            }}
            onPointerMove={(event) => canvas.panning && canvas.movePan(event)}
            onPointerUp={canvas.endPan}
            onPointerCancel={canvas.endPan}
            onClick={(event) => {
              if (!canvas.consumePanClick() && isCanvasBackground(event.target)) closeDetail();
            }}
            className={cn(
              // A canvas, not a document: clicks (and shift-clicks) never select text.
              "relative min-h-0 flex-1 cursor-default select-none overflow-hidden [&_input]:select-text [&_textarea]:select-text",
              canvas.panning && "cursor-grabbing",
            )}
            style={{
              backgroundImage: "radial-gradient(circle, #e3e5e4 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          >
            <div
              ref={worldRef}
              data-canvas-lod={canvas.lod}
              className="absolute left-1/2 top-[40%] origin-top-left"
              style={{ transform: canvas.worldTransform }}
            >
              <svg
                className="pointer-events-none absolute left-0 top-0 overflow-visible"
                width={1}
                height={1}
              >
                <ArrowMarkers />
                {/* Each Entity Type → the table. */}
                {entityItems.map((item) => {
                  if (item.kind !== "entity") return null;
                  const suggested = item.mapped.some((p) =>
                    mappingsIn(p, table.name).some((m) => mappingStatus(m) === "suggested"),
                  );
                  const dim = !!activeId && item.entity.id !== activeId;
                  return (
                    <g
                      key={`edge-${item.key}`}
                      style={{ opacity: dim ? 0.2 : 1, transition: "opacity 300ms" }}
                    >
                      <Curve
                        d={curve({ x: TG_ENTITY_X + NODE_W, y: item.y }, { x: TG_TABLE_X, y: 0 })}
                        suggested={suggested}
                        dimmed={!reviewScope.mappings(item.mapped)}
                        bold={item.entity.id === activeId}
                      />
                    </g>
                  );
                })}
                {/* The active Entity Type's Relations: related Entity Type → pill → it. */}
                <AnimatePresence>
                  {activeItem &&
                    relatedItems.flatMap((item) =>
                      item.kind !== "entity"
                        ? []
                        : item.cp.relations.map(({ relation }) => {
                            const y = pillY.get(relation.id) ?? item.y;
                            const relSuggested = relationReview(relation) === "suggested";
                            const towardActive = relation.to === activeId;
                            const origin = curve(
                              { x: TG_ENTITY_X, y: activeY },
                              { x: TG_ENTITY_X, y: activeY },
                            );
                            return (
                              <motion.g
                                key={relation.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                              >
                                <Curve
                                  d={curve(
                                    { x: TG_RELATED_X + NODE_W, y: item.y },
                                    { x: TG_PILL_X, y },
                                  )}
                                  from={origin}
                                  suggested={relSuggested}
                                  dimmed={!reviewScope.relation(relation)}
                                  handles="start"
                                  arrow={towardActive ? undefined : "start"}
                                />
                                <Curve
                                  d={curve(
                                    { x: TG_PILL_X + PILL_W, y },
                                    { x: TG_ENTITY_X, y: activeY },
                                  )}
                                  from={origin}
                                  suggested={relSuggested}
                                  dimmed={!reviewScope.relation(relation)}
                                  handles="end"
                                  arrow={towardActive ? "end" : undefined}
                                />
                              </motion.g>
                            );
                          }),
                    )}
                </AnimatePresence>
              </svg>
              <HandleLayer onLayer={setHandleLayer} />

              {/* The selected Data Table. */}
              <Node x={TG_TABLE_X} y={-CENTER_H / 2}>
                <div
                  data-canvas-card
                  role="button"
                  tabIndex={0}
                  onClick={() => inspectTable(table.name)}
                  className={cn(
                    classNodeClass({
                      selected: tableSelected,
                      focus: !tableSelected,
                      dimmed: !reviewScope.table(table.name),
                      attached: columnsOpen || !!focused,
                    }),
                    "pr-2",
                  )}
                  style={{ width: NODE_W, height: CENTER_H }}
                >
                  <ClassNodeBody
                    icon={
                      <MappingStatusBadge
                        status={tableMappingStatus(table.name, app.entities)}
                        {...tableMappingCompleteness(table.name, app.entities)}
                        size={20}
                      />
                    }
                    name={table.name}
                    lodName="lod-title"
                    counts={tableNodeCounts(table, app.entities)}
                    mapping={tableNodeMapping(tableMappingStatus(table.name, app.entities))}
                  />
                  {(columnsOpen || !!focused) && <ClassNodeDivider />}
                  <ExpandChevron
                    open={columnsOpen || !!focused}
                    label={
                      focused ? "Close mappings" : columnsOpen ? "Hide columns" : "Show columns"
                    }
                    onClick={() =>
                      focused ? toggleFocus(focused.entity.id) : setColumnsOpen((o) => !o)
                    }
                  />
                </div>
                {columnsOpen && !focused && (
                  <div className="absolute left-0 top-full" style={{ width: NODE_W }}>
                    <TableColumnsPanel
                      app={app}
                      table={table}
                      frame={classFrameOf(tableSelected, !tableSelected)}
                    />
                  </div>
                )}
              </Node>

              {/* The Entity Types mapping into it. */}
              {entityItems.map((item) => {
                if (item.kind === "more") {
                  return (
                    <Node key={item.key} x={TG_ENTITY_X + NODE_W / 2} y={item.y - MORE_H / 2}>
                      <div
                        className={cn("transition-opacity duration-300", activeId && "opacity-40")}
                      >
                        <MoreButton
                          centered
                          label={showAll ? "Show less" : `+ ${item.hidden} more`}
                          onClick={() => setShowAll((all) => !all)}
                        />
                      </div>
                    </Node>
                  );
                }
                const { entity, mapped } = item;
                const dim = !!activeId && entity.id !== activeId;
                const isFocused = focused?.entity.id === entity.id;
                return (
                  <div
                    key={item.key}
                    className={cn("transition-opacity duration-300", dim && "opacity-40")}
                    onMouseEnter={() => !focused && hoverEntity(entity.id)}
                    onMouseLeave={() => !focused && hoverEntity(null)}
                    onClickCapture={(event) =>
                      !focused &&
                      !(event.shiftKey || event.metaKey || event.ctrlKey) &&
                      setPinnedId(entity.id)
                    }
                  >
                    <Node x={TG_ENTITY_X} y={item.y - NODE_H / 2}>
                      {entityNode(
                        entity,
                        <ExpandChevron
                          open={isFocused}
                          label={isFocused ? "Close mappings" : "Show each mapping"}
                          onClick={() => toggleFocus(entity.id)}
                        />,
                        isFocused,
                      )}
                    </Node>
                    <Node x={TG_ENTITY_X + NODE_W + 10} y={item.y - 9}>
                      <MappingCountChips
                        mappings={mapped.flatMap((p) => mappingsIn(p, table.name))}
                        dimmed={!reviewScope.mappings(mapped)}
                        align="left"
                        label={`Show ${entity.name}'s mappings`}
                        onClick={() => toggleFocus(entity.id)}
                      />
                    </Node>
                  </div>
                );
              })}

              {/* The active Entity Type's related Entity Types and Relation pills. */}
              <div onMouseEnter={keepHover} onMouseLeave={() => !pinnedId && hoverEntity(null)}>
                <AnimatePresence>
                  {activeItem &&
                    relatedItems.map((item) =>
                      item.kind === "more" ? (
                        <Drop
                          key={item.key}
                          end={{ x: TG_RELATED_X, y: activeY }}
                          x={TG_RELATED_X + NODE_W / 2}
                          y={item.y - MORE_H / 2}
                        >
                          <MoreButton
                            centered
                            label={showAllRelated ? "Show less" : `+ ${item.hidden} more`}
                            onClick={() => setShowAllRelated((all) => !all)}
                          />
                        </Drop>
                      ) : (
                        <Drop
                          key={item.key}
                          end={{ x: TG_ENTITY_X, y: activeY }}
                          x={TG_RELATED_X}
                          y={item.y - NODE_H / 2}
                        >
                          {entityNode(item.cp.entity)}
                        </Drop>
                      ),
                    )}
                  {activeItem &&
                    relatedItems.flatMap((item) =>
                      item.kind !== "entity"
                        ? []
                        : item.cp.relations.map(({ relation }) => (
                            <Drop
                              key={`pill-${relation.id}`}
                              end={{ x: TG_ENTITY_X, y: activeY }}
                              x={TG_PILL_X}
                              y={(pillY.get(relation.id) ?? item.y) - PILL_H / 2}
                            >
                              <RelationPill
                                relation={relation}
                                status={relationStatus(relation, app.entities)}
                                selected={isSelected({ kind: "relation", id: relation.id })}
                                dimmed={!reviewScope.relation(relation)}
                                onClick={() => inspect({ kind: "relation", id: relation.id })}
                              />
                            </Drop>
                          )),
                    )}
                </AnimatePresence>
              </div>

              {/* A focused Entity Type: its Property → Column mappings, between it and the table. */}
              {focused && (
                <Node x={TG_ENTITY_X} y={CENTER_H / 2}>
                  <MappingPanels
                    key={focused.entity.id}
                    app={app}
                    entity={focused.entity}
                    frames={{
                      left: classFrameOf(
                        isSelected({ kind: "entity", id: focused.entity.id }),
                        false,
                      ),
                      right: classFrameOf(tableSelected, !tableSelected),
                    }}
                    properties={focused.mapped}
                    table={table}
                    width={TG_TABLE_X + NODE_W - TG_ENTITY_X}
                    isSelected={(p) =>
                      isSelected({
                        kind: "property",
                        entityId: focused.entity.id,
                        propertyId: p.id,
                      })
                    }
                    onSelect={(p) =>
                      inspect({ kind: "property", entityId: focused.entity.id, propertyId: p.id })
                    }
                  />
                </Node>
              )}
            </div>
            {canvas.tool === "pan" && (
              <div
                aria-hidden
                className={cn(
                  "absolute inset-0 z-[18]",
                  canvas.panning ? "cursor-grabbing" : "cursor-grab",
                )}
              />
            )}
          </div>

          {detailItem ? (
            <DetailDock defaultCap={detailItem.kind === "table" ? 240 : null}>
              <CompletionNoticeSlot app={app} />
              <DetailPanel
                key={detailItem.key}
                app={app}
                item={detailItem}
                queue={queue}
                focusEntityId={focused?.entity.id}
                onSelectKey={(key) => {
                  const ref = parseSuggestionKey(key);
                  if (ref) inspect(ref);
                }}
                onClose={closeDetail}
                onDeletedFocus={closeDetail}
                onEdit={onEdit}
              />
            </DetailDock>
          ) : app.suggestionSelection.size >= 2 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
              <div className="pointer-events-auto relative">
                <CompletionNoticeSlot app={app} />
                <SelectionActions app={app} onSplit={onSplit} />
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
              <div className="pointer-events-auto relative">
                <CompletionNoticeSlot app={app} />
                <AiReviewBar
                  entities={app.entities}
                  relations={app.relations}
                  tables={app.tables}
                  confidenceRange={app.confidenceRange}
                  onConfidenceRangeChange={app.setConfidenceRange}
                  onSelectSuggestionsInRange={app.selectSuggestionKeys}
                  scope={scope}
                />
              </div>
            </div>
          )}
        </PropertyMoveContext.Provider>
      </HandleLayerContext.Provider>
    </ReviewScopeContext.Provider>
  );
}

/**
 * The selected Data Table's columns, under it (the table's counterpart of the selected Entity
 * Type's property panel): Filter (mapped by any Entity Type or not) / Sort / Search, a type icon
 * each; the dot says whether a column is mapped (teal), only suggested (purple), or not (grey).
 */
function TableColumnsPanel({
  app,
  table,
  frame,
}: {
  app: OntologyApp;
  table: TableSchema;
  // Its node's frame: the panel is that node card's body, with an ID foot (see `frameOf`).
  frame?: string | undefined;
}) {
  const reviewScope = useContext(ReviewScopeContext);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [search, setSearch] = useState("");
  const stateOf = useMemo(() => {
    const map = new Map<string, "mapped" | "suggested">();
    app.entities.forEach((entity) =>
      entity.properties.forEach((p) => {
        mappingsIn(p, table.name).forEach((m) => {
          const status = mappingStatus(m);
          if (status === "mapped" || !map.has(m.column)) map.set(m.column, status);
        });
      }),
    );
    return map;
  }, [app.entities, table.name]);
  const query = search.trim().toLowerCase();
  const columns = sortByState(
    table.columns.filter(
      (c) =>
        (filter === "all" ||
          (filter === "mapped" && stateOf.has(c.name)) ||
          (filter === "unmapped" && !stateOf.has(c.name))) &&
        (!query || c.name.toLowerCase().includes(query)),
    ),
    sort,
    (c) => c.name,
    () => undefined,
  );
  const mappedColumns = columns.filter((column) => stateOf.has(column.name));
  const unmappedColumns = columns.filter((column) => !stateOf.has(column.name));
  return (
    <div
      data-canvas-card
      className={cn(
        "overflow-hidden",
        frame
          ? attachedBody(frame)
          : "rounded-[6px] bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]",
      )}
    >
      <ListControls
        compact
        className="bg-transparent px-2"
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={(key) => setSort((prev) => nextSortState(prev, key))}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search columns…"
      />
      <div className="relative">
        <div
          data-canvas-scroll
          className="flex flex-col gap-2 overflow-y-auto overscroll-contain px-2.5 pb-2.5"
          style={{ maxHeight: PANEL_LIST_MAX }}
        >
          {columns.length === 0 && (
            <p className="py-3 text-center text-[12px] text-[#6d7472]">No columns match.</p>
          )}
          {(
            [
              ["Mapped", mappedColumns],
              ["Unmapped", unmappedColumns],
            ] as const
          ).map(([label, group]) =>
            group.length > 0 ? (
              <ListGroup key={label} label={label} count={group.length}>
                {group.map((column) => {
                  const state = stateOf.get(column.name);
                  return (
                    <PanelRow
                      key={column.name}
                      grip={false}
                      name={column.name}
                      sampleValues={columnSamples(table, column.name)}
                      dimmed={!reviewScope.column(table.name, column.name)}
                      dotColor={
                        state === "mapped"
                          ? "#0891b2"
                          : state === "suggested"
                            ? "#7e22ce"
                            : "#c9cccb"
                      }
                      identifier={false}
                      type={column.type}
                    />
                  );
                })}
              </ListGroup>
            ) : null,
          )}
        </div>
        {columns.length * 40 > PANEL_LIST_MAX && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30px] bg-gradient-to-b from-white/0 to-white" />
        )}
      </div>
    </div>
  );
}
