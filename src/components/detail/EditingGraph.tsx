import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Table2, X } from "lucide-react";
import type { OntologyApp } from "@/lib/app-state";
import { parseSuggestionKey, suggestionKey, type SuggestionRef } from "@/lib/app-state";
import {
  entityDisplayStatus,
  entityErrorReason,
  entityReview,
  isColumnInScope,
  isIdentifierProperty,
  isReviewItemInScope,
  isTableInScope,
  mappingStatus,
  propertyReview,
  propertyStatus,
  relationJoins,
  relationLabel,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import searchIcon from "@/assets/icons/magnifying-glass-2-16.svg";
import chevronDownIcon from "@/assets/icons/chevron-down-16.svg";
import { ENTITY_PANEL_DND_TYPE, TABLE_PANEL_DND_TYPE } from "@/components/detail/panel-dnd";
import {
  acceptsPropertyDrop,
  dropPropertiesOn,
  leftDropTarget,
  REVEAL_PROPERTIES_EVENT,
  setPropertyDragSource,
  startPropertyDrag,
} from "@/components/detail/property-move";
import dotGridIcon from "@/assets/icons/dot-grid-2x3-16.svg";
import identifierKeyIcon from "@/assets/icons/key-2-identifier-16.svg";
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
const CENTER_H = 56;
const NODE_W = 280;
const NODE_H = 56;
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
const BRANCH_STROKE = "#b5b9b8";
const ladderTableH = (columns: number) =>
  LADDER_HEAD + Math.max(1, columns) * LADDER_ROW + LADDER_FOOT;

// Curve colours: a suggested (still in review) link vs a settled one.
const SUGGESTED = "#A855F7";
const SETTLED = "#9EA3A2";
const ARROW_SUGGESTED = "editing-graph-arrow-suggested";
const ARROW_SETTLED = "editing-graph-arrow-settled";
const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0.1 };
// A selected node / pill (Figma 542:27924 et al.): a near-black hairline on white.
const SELECTED_NODE = "border-[#161919] bg-white";
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
const DIMMED = "opacity-40";

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
  const dx = (to.x - from.x) / 2;
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y} ${to.x - dx} ${to.y} ${to.x} ${to.y}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A Property's mappings into one dataset (an Identifier can have several there: a composite key).
const mappingsIn = (property: Property, table: string) =>
  property.mappings.filter((m) => m.table === table);
const mapsInto = (property: Property, table: string) =>
  property.mappings.some((m) => m.table === table);

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
  onCreateProperty,
  onCreateRelation,
  onSplit,
}: {
  app: OntologyApp;
  focusEntity: Entity;
  // Opens the detail panel's item in the Edit modal (owned by the Entity mode around this view).
  onEdit?: (key: string) => void;
  // A property panel's + (the create modal is owned by the Entity mode around this view too).
  onCreateProperty?: (entityId: string) => void;
  // Asks for a new Relation (`from` → `to`) in the create modal; `done` hears whether one was
  // made (Create) or not (Cancel).
  onCreateRelation?: (from: string, to: string, done?: (created: boolean) => void) => void;
  // A Split made from the selection bar: the new Entity Type (for the workspace to point out).
  onSplit?: (newEntityId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const canvas = useEditingCanvas(viewportRef, worldRef, scaleRef);
  const move = usePropertyMove(app);

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
  // The Relation opened in place (see `openRelation`). Selecting a Relation opens it (selecting it
  // again closes it); selecting an Entity Type or Property, or closing the detail panel, closes
  // it — but inspecting one of its join tables keeps it open.
  const [openRelationId, setOpenRelationId] = useState<string | null>(null);
  // A related Entity Type's + (on its node's right edge, where its lines start): hovering it
  // previews a placeholder Relation in the pill column (the others make room); clicking it asks
  // for the new Relation (that Entity Type → the selected one); pressing and dragging draws the
  // line, and releasing it on the selected Entity Type does the same (elsewhere, or Esc, cancels).
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
        onCreateRelation?.(relationDraw.fromEntityId, focusEntity.id);
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
  }, [relationDraw, onCreateRelation, focusEntity.id, toWorld]);
  // Whether the open Relation shows all its mappings, past the first `MAPPING_PREVIEW`.
  const [allMappings, setAllMappings] = useState(false);

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
  // make room); dropping opens the create-Relation modal (it → the selected one), the slot held
  // there meanwhile — Create puts the Entity Type exactly where it was dropped, Cancel leaves
  // nothing. A Data Table: added to its column, listed first. Reset per Entity.
  const [dragKind, setDragKind] = useState<"entity" | "table" | null>(null);
  // Where the dragged Entity Type would land: its index among the shown related Entity Types.
  const [entitySlot, setEntitySlot] = useState<number | null>(null);
  // A drop waiting on the create-Relation modal.
  const [pendingDrop, setPendingDrop] = useState<{ entityId: string; index: number } | null>(null);
  // The related Entity Types' order this session, once a drop has placed one (else the data's).
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [addedTableNames, setAddedTableNames] = useState<string[]>([]);
  useEffect(() => {
    setCustomOrder(null);
    setPendingDrop(null);
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
      if (!onCreateRelation) {
        app.createPlaceholderRelation(focusEntity.id, entityId);
        return;
      }
      // Where it lands: before whichever shown Entity Type the slot was in front of.
      const shownIds = leftAll.map((cp) => cp.entity.id).filter((id) => id !== entityId);
      const allIds = counterparts.map((cp) => cp.entity.id);
      setPendingDrop({ entityId, index });
      onCreateRelation(entityId, focusEntity.id, (created) => {
        setPendingDrop(null);
        if (!created) return;
        setCustomOrder((prev) => {
          const order = (prev ?? allIds).filter((id) => id !== entityId);
          const before = shownIds[index];
          const last = shownIds[shownIds.length - 1];
          const at = before ? order.indexOf(before) : last ? order.indexOf(last) + 1 : 0;
          order.splice(at < 0 ? order.length : at, 0, entityId);
          return order;
        });
      });
    } else if (tableName) {
      event.preventDefault();
      setAddedTableNames((names) => [tableName, ...names.filter((n) => n !== tableName)]);
      setFocusedTable(null);
    }
  };

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
      // Each join is ONE table: both sides' columns come from it.
      const mappings = relationJoins(relation, app.entities).map((join, i) => {
        const from = {
          table: join.table,
          columns: join.fromColumns,
          entity: nameOf(relation.from),
        };
        const to = { table: join.table, columns: join.toColumns, entity: nameOf(relation.to) };
        const [left, right] = leftIsFrom ? [from, to] : [to, from];
        return { key: `${join.table}:${i}`, left, right };
      });
      return {
        relation,
        entityId: cp.entity.id,
        pillIndex: cp.relations.indexOf(hit),
        pillCount: cp.relations.length,
        suggested: relationReview(relation) === "suggested",
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

  // The drop slot among the shown related Entity Types: following the pointer while dragging, then
  // held where it was dropped while the create modal is open.
  const slotIndex = dragKind === "entity" ? entitySlot : (pendingDrop?.index ?? null);
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
        Math.max(
          ladderTableH(mapping.left.columns.length),
          ladderTableH(mapping.right.columns.length),
        ) + LADDER_RUNG_GAP;
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

  const centerPropsOpen = open.has("props:center") && !focused && !ladderEnds;

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
      size={16}
    />
  );

  return (
    <ReviewScopeContext.Provider value={reviewScope}>
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
                    empty={openRelation.mappings.length === 0}
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

            {/* The selected Entity Type. */}
            <Node x={CENTER_LEFT} y={-CENTER_H / 2}>
              <div
                data-canvas-card
                role="button"
                tabIndex={0}
                data-graph-center
                {...move.dropProps(focusEntity.id)}
                onClick={() => inspect({ kind: "entity", id: focusEntity.id })}
                className={cn(
                  "flex items-center gap-2 rounded-lg border bg-white px-3 text-left transition-opacity",
                  CARD_SHADOW,
                  !reviewScope.entity(focusEntity) && DIMMED,
                  drawOverCenter
                    ? "border-[#00ded8] bg-[#ecf3f2]"
                    : isSelected({ kind: "entity", id: focusEntity.id })
                      ? SELECTED_NODE
                      : "border-[#3b82f6]",
                  move.dropTargetId === focusEntity.id && DROP_TARGET_CLASS,
                )}
                style={{ width: CENTER_W, height: CENTER_H }}
              >
                <span className="lod-type contents">
                  <StatusBadge
                    status={entityDisplayStatus(focusEntity)}
                    size={16}
                    confidence={focusEntity.confidence}
                    errorReason={entityErrorReason(focusEntity)}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="lod-title truncate text-[16px] font-medium leading-6 text-[#080a09]">
                    {focusEntity.name}
                  </span>
                  <span className="lod-detail truncate text-[12px] leading-4 text-[#6d7472]">
                    {entityDetail(focusEntity)}
                  </span>
                </span>
                {entityReview(focusEntity) === "suggested" && (
                  <span className="lod-confidence contents">
                    <EntityConfidenceChip entity={focusEntity} tone="muted" />
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
              {centerPropsOpen && (
                <div className="absolute left-0 top-full mt-1.5" style={{ width: CENTER_W }}>
                  <PropertyPanel
                    entityId={focusEntity.id}
                    properties={centerProperties}
                    filter={propFilter}
                    onFilterChange={setPropFilter}
                    sort={propSort}
                    onSortChange={(key) => setPropSort((prev) => nextSortState(prev, key))}
                    search={propSearch}
                    onSearchChange={setPropSearch}
                    onCreate={onCreateProperty ? () => onCreateProperty(focusEntity.id) : undefined}
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
                      {onCreateRelation && !ladderEnds && (
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
                            if (event.detail === 0) onCreateRelation(entity.id, focusEntity.id);
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
                        name={entity.name}
                        detail={entityDetail(entity)}
                        dropFor={entity.id}
                        dimmed={!reviewScope.entity(entity)}
                        chip={
                          entityReview(entity) === "suggested" ? (
                            <EntityConfidenceChip entity={entity} tone="muted" />
                          ) : null
                        }
                        selected={isSelected({ kind: "entity", id: entity.id })}
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
                  {relations.map(({ relation }) => (
                    <Node
                      key={relation.id}
                      x={ladderEnds && relation.id === openRelationId ? openPillX : pillX}
                      y={
                        (pillY.get(relation.id) ?? item.y) -
                        (ladderEnds && relation.id === openRelationId ? OPEN_PILL_H : PILL_H) / 2
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
                  ))}
                  {branchTables.map((b) => {
                    const table = tableByName(b.name);
                    if (!table) return null;
                    return (
                      <Node key={b.name} x={bx} y={b.y - NODE_H / 2}>
                        <GraphNode
                          large
                          status={tableStatus(table)}
                          name={table.name}
                          dimmed={!reviewScope.table(table.name)}
                          detail={plural(table.columns.length, "column", "columns")}
                          selected={inspectedTable === table.name && detailItem?.kind === "table"}
                          onClick={() => inspectTable(table.name)}
                        />
                      </Node>
                    );
                  })}
                  {item.branch === "props" && !isOpenEntity && (
                    <Node x={ex} y={item.y + NODE_H / 2 + 6}>
                      <div style={{ width: NODE_W }}>
                        <EntityPropertyPanel
                          entity={entity}
                          onCreate={
                            onCreateProperty ? () => onCreateProperty(entity.id) : undefined
                          }
                          isSelected={(p) =>
                            isSelected({ kind: "property", entityId: entity.id, propertyId: p.id })
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
                  empty={openRelation.mappings.length === 0}
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
                  onOpenTable={inspectTable}
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
                      large
                      selected={inspectedTable === item.table.name && detailItem?.kind === "table"}
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
                          className="lod-detail flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[#6d7472] hover:bg-black/[0.06] hover:text-[#161919]"
                        >
                          <span
                            className={cn("size-4 transition-transform", isFocused && "rotate-180")}
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
              <Node x={CENTER_LEFT} y={CENTER_H / 2 + 6}>
                <MappingPanels
                  key={focused.table.name}
                  app={app}
                  entity={focusEntity}
                  properties={focused.mapped}
                  table={focused.table}
                  width={TABLE_X + NODE_W - CENTER_LEFT}
                  onCreate={onCreateProperty ? () => onCreateProperty(focusEntity.id) : undefined}
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

        {detailItem ? (
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
    </ReviewScopeContext.Provider>
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

function Curve({
  d,
  from,
  suggested,
  bold = false,
  branch = false,
  delay = 0,
  arrow,
  dimmed = false,
}: {
  // Outside the Confidence range / status filter (see `ReviewScope`).
  dimmed?: boolean;
  d: string;
  // Where a newly shown curve grows from (and shrinks back to); otherwise it appears in place.
  from?: string | undefined;
  suggested: boolean;
  bold?: boolean;
  // A light dashed secondary link (an Entity Type down to its source table).
  branch?: boolean;
  delay?: number;
  // A direction arrowhead at the curve's start or end.
  arrow?: "start" | "end" | undefined;
}) {
  const marker = `url(#${suggested ? ARROW_SUGGESTED : ARROW_SETTLED})`;
  return (
    <motion.path
      markerStart={arrow === "start" ? marker : undefined}
      markerEnd={arrow === "end" ? marker : undefined}
      initial={from ? { d: from } : false}
      // Opacity goes through `animate`: motion doesn't re-apply a changed `style.opacity`.
      animate={{ d, opacity: dimmed ? 0.4 : 1 }}
      exit={from ? { d: from, transition: SPRING } : {}}
      transition={{ ...SPRING, delay }}
      fill="none"
      stroke={branch ? BRANCH_STROKE : suggested ? SUGGESTED : SETTLED}
      strokeWidth={branch ? 1 : bold ? 2 : 1.5}
      strokeDasharray={branch ? "3 3" : suggested ? "4 4" : undefined}
    />
  );
}

/** An Entity Type / Data Table node: status icon, name over a detail line, optional chip and a
 * trailing control. */
function GraphNode({
  status,
  name,
  detail,
  chip,
  selected,
  highlighted,
  onClick,
  onDoubleClick,
  trailing,
  large = false,
  dropFor,
  dimmed = false,
}: {
  // Outside the Confidence range / status filter (see `ReviewScope`).
  dimmed?: boolean;
  // An Entity Type node's id: Properties dragged from another Entity Type can be dropped on it.
  dropFor?: string | undefined;
  // A Data Table node's name is set a step larger (16/24) than an Entity Type's (14/20).
  large?: boolean;
  status: ReactNode;
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
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-white px-3 text-left transition-[box-shadow,opacity]",
        CARD_SHADOW,
        dimmed && DIMMED,
        selected
          ? SELECTED_NODE
          : highlighted
            ? "border-[1.5px] border-[#3b82f6] bg-[#eff6ff]"
            : "border-[#e3e5e4] hover:border-[#161919]",
        !!dropFor && move?.dropTargetId === dropFor && DROP_TARGET_CLASS,
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <span className="lod-type contents">{status}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "lod-name truncate font-medium text-[#080a09]",
            large ? "text-[16px] leading-6" : "text-[14px] leading-5",
          )}
        >
          {name}
        </span>
        <span className="lod-detail truncate text-[12px] leading-4 text-[#6d7472]">{detail}</span>
      </span>
      {chip && <span className="lod-confidence contents">{chip}</span>}
      {trailing}
    </div>
  );
}

type MappingSide = { table: string; columns: string[]; entity: string };
type LadderRung = { key: string; left: MappingSide; right: MappingSide; top: number };
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
      <Curve d={leftTrunk.d} from={leftTrunk.from} suggested={suggested} dimmed={dimmed} />
      {!empty && (
        <Curve d={rightTrunk.d} from={rightTrunk.from} suggested={suggested} dimmed={dimmed} />
      )}
      {rungs.map((rung, i) =>
        Array.from(
          { length: Math.min(rung.left.columns.length, rung.right.columns.length) },
          (_, k) => {
            const a = { x: ends.left.x + NODE_W, y: ladderRowY(ends.left, rung, k) };
            const b = { x: ends.right.x + LADDER_INSET, y: ladderRowY(ends.right, rung, k) };
            return (
              <g key={`${rung.key}-${k}`}>
                <Curve
                  d={curve(a, b)}
                  from={curve(a, a)}
                  suggested={suggested}
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
 * The open Relation's source tables: for each join, the table under the related Entity Type
 * (left) and the one under the middle node (right), each holding its own key column(s) — so a
 * column always reads as part of its table. They drop out of their Entity Type and fold back
 * into it on close.
 */
function LadderTables({
  app,
  status,
  ends,
  rungs,
  empty,
  more,
  columnType,
  onOpenTable,
}: {
  app: OntologyApp;
  // The open Relation's review status (its dot on each column row).
  status: ReturnType<typeof relationStatus>;
  ends: LadderEnds;
  rungs: LadderRung[];
  empty: boolean;
  more: { top: number; label: string; onToggle: () => void } | null;
  columnType: (table: string, column: string) => string;
  onOpenTable: (table: string) => void;
}) {
  return (
    <>
      {rungs.map((rung, i) =>
        (
          [
            [ends.left, rung.left],
            [ends.right, rung.right],
          ] as const
        ).map(([end, side], s) => (
          <Drop
            key={`${rung.key}-${s}`}
            end={end}
            x={end.x + LADDER_INSET}
            y={end.y + rung.top}
            delay={0.06 + i * 0.06 + s * 0.04}
          >
            <LadderTable
              app={app}
              status={status}
              side={side}
              columnType={columnType}
              onOpen={() => onOpenTable(side.table)}
            />
          </Drop>
        )),
      )}
      {empty && (
        <Drop
          end={ends.left}
          x={ends.left.x + LADDER_INSET}
          y={ends.left.y + NODE_H / 2 + LADDER_GAP}
        >
          <span className="whitespace-nowrap text-[11.5px] leading-6 text-[#6d7472]">
            No source mapping yet
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
  columnType,
  onOpen,
}: {
  app: OntologyApp;
  side: MappingSide;
  status: ReturnType<typeof relationStatus>;
  columnType: (table: string, column: string) => string;
  onOpen: () => void;
}) {
  return (
    <div
      data-canvas-card
      // 64px tall with its 1px border: 9 + 24 (table) + 24 per column + 5.
      className={cn(
        "rounded-lg border border-[#e3e5e4] bg-white px-4 pb-[5px] pt-[9px]",
        CARD_SHADOW,
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
      </button>
      {side.columns.map((column) => (
        <div key={column} className="flex h-6 min-w-0 items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <span
              className="size-1.5 rounded-full"
              style={{ background: statusDotColor(status) }}
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
      className="lod-detail flex size-6 shrink-0 items-center justify-center rounded-[6px] hover:bg-black/[0.06]"
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
        "flex items-center gap-2 rounded-full border bg-white py-1 pl-3 pr-1.5 text-[12px] leading-4 text-[#161919] transition-[width,height,opacity]",
        CARD_SHADOW,
        dimmed && DIMMED,
        selected ? SELECTED_NODE : "border-[#e3e5e4] hover:border-[#161919]",
      )}
    >
      <span
        className="lod-type size-1.5 shrink-0 rounded-full"
        style={{ background: statusDotColor(status) }}
      />
      <span className="lod-name min-w-0 flex-1 truncate">{relationLabel(relation)}</span>
      {relationReview(relation) === "suggested" && (
        <span className="lod-confidence contents">
          <RelationConfidenceChip relation={relation} tone="muted" />
        </span>
      )}
    </div>
  );
}

const PANEL_LIST_MAX = 350;

function ListGroupHeading({ label, count }: { label: "Mapped" | "Unmapped"; count: number }) {
  return (
    <p className="shrink-0 px-1.5 py-1 text-[14px] leading-[14px] text-[#6d7472]">
      {label} ({count})
    </p>
  );
}

function columnSamples(table: TableSchema, column: string): string[] {
  return [
    ...new Set(
      table.rows.map((row) => row[column]).filter((value) => value != null && value !== ""),
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
  onCreate,
  isSelected,
  onSelect,
  entityId,
}: {
  // The Properties' owner — lets each row be dragged to another Entity Type.
  entityId?: string | undefined;
  properties: Property[];
  filter: ListFilter;
  onFilterChange: (next: ListFilter) => void;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onCreate?: (() => void) | undefined;
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
  const mappedProperties = properties.filter((property) => property.mappings.length > 0);
  const unmappedProperties = properties.filter((property) => property.mappings.length === 0);
  return (
    <div
      data-canvas-card
      {...(move && entityId ? move.dropProps(entityId) : {})}
      className={cn(
        "flex flex-col overflow-hidden rounded-[6px] bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] transition-shadow",
        isTarget && "shadow-[0_0_0_1.5px_#00ded8] !bg-[#e6f9f8]",
      )}
    >
      <ListControls
        className="bg-white px-2"
        filter={filter}
        onFilterChange={onFilterChange}
        sort={sort}
        onSortChange={onSortChange}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search properties…"
        onCreate={onCreate}
        createLabel="New property"
      />
      <div className="relative">
        <div
          ref={scrollRef}
          data-canvas-scroll
          className="flex flex-col gap-1.5 overflow-y-auto overscroll-contain px-2 pb-2"
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
              <Fragment key={label}>
                <ListGroupHeading label={label} count={group.length} />
                {group.map((property) => (
                  <PanelRow
                    key={property.id}
                    name={property.name}
                    dotColor={statusDotColor(propertyStatus(property))}
                    dimmed={!reviewScope.property(property)}
                    identifier={isIdentifierProperty(property)}
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
                ))}
              </Fragment>
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
  onCreate,
  isSelected,
  onSelect,
}: {
  entity: Entity;
  onCreate?: (() => void) | undefined;
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
      onCreate={onCreate}
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

/** One white row in a property / column panel: grip, status dot, name, key, type, confidence. */
function PanelRow({
  name,
  dotColor,
  identifier,
  type,
  chip,
  grip = true,
  selected = false,
  onClick,
  moveFrom,
  highlight,
  sampleValues,
  dimmed = false,
}: {
  dimmed?: boolean;
  name: string;
  // A search query: the matching part of `name` is set semibold (no color change).
  highlight?: string | undefined;
  dotColor: string;
  identifier: boolean;
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
        "relative flex h-[34px] shrink-0 items-center gap-2 rounded-[4px] border py-1 pl-1.5 pr-2 transition-opacity",
        dimmed && DIMMED,
        selected ? SELECTED_NODE : "border-[#e3e5e4] bg-white",
        onClick && !selected && "hover:border-[#161919]",
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
      <span className="lod-type size-1.5 shrink-0 rounded-full" style={{ background: dotColor }} />
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span className="lod-name min-w-0 flex-1 truncate text-[14px] leading-6 text-[#080a09]">
          <HighlightedName name={name} query={highlight} />
        </span>
        {identifier && (
          <span role="img" aria-label="Identifier" className="lod-type shrink-0">
            <FigmaIcon src={identifierKeyIcon} />
          </span>
        )}
        {type && (
          <span className="lod-type contents">
            <PropertyTypeGlyph type={type} color="#6d7472" />
          </span>
        )}
      </span>
      {chip && <span className="lod-confidence contents">{chip}</span>}
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
  onCreate,
  isSelected,
  onSelect,
}: {
  app: OntologyApp;
  // The Properties' owner (the selected Entity Type) — for the mappings' confidence.
  entity: Entity;
  properties: Property[];
  table: TableSchema;
  width: number;
  onCreate?: (() => void) | undefined;
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
  const columnCellPad = scrollbar > 0 ? "pl-2 pr-1" : "px-2";

  // Connecting a Property to a Column: press a Property's + and drag onto a
  // Column, or click it — then the line follows the pointer until the next click, which connects
  // on a Column or, anywhere else, opens the column search right there. Esc cancels.
  const rootRef = useRef<HTMLDivElement>(null);
  const [connect, setConnect] = useState<{
    propertyId: string;
    x1: number;
    y1: number;
    mode: "press" | "click";
    startX: number;
    startY: number;
  } | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
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
  const startConnect = (
    propertyId: string,
    from: Element,
    mode: "press" | "click",
    event?: React.PointerEvent,
  ) => {
    const r = from.getBoundingClientRect();
    const at = toLocal(r.left + r.width / 2, r.top + r.height / 2);
    setLineSearch(null);
    setConnect({
      propertyId,
      x1: at.x,
      y1: at.y,
      mode,
      startX: event?.clientX ?? 0,
      startY: event?.clientY ?? 0,
    });
    setPointer(mode === "click" ? { x: at.x + 48, y: at.y } : at);
  };
  useEffect(() => {
    if (!connect) return;
    const finish = () => {
      setConnect(null);
      setPointer(null);
      setOverColumn(null);
    };
    const connectTo = (column: string) =>
      tryConnectMapping(app, entity.id, connect.propertyId, {
        table: table.name,
        column,
        status: "mapped",
      });
    const onMove = (event: PointerEvent) => {
      setPointer(toLocal(event.clientX, event.clientY));
      setOverColumn(columnAt(event.clientX, event.clientY));
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
        const column = columnAt(event.clientX, event.clientY);
        if (column) connectTo(column);
        else {
          const at = toLocal(event.clientX, event.clientY);
          setLineSearch({ propertyId: connect.propertyId, x1: connect.x1, y1: connect.y1, ...at });
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
        const column = columnAt(event.clientX, event.clientY);
        if (column) connectTo(column);
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
  }, [connect, app, entity.id, table.name, toLocal, columnAt]);
  // While connecting, the other lines step aside and Columns of another data type fade.
  const connecting = !!connect || !!lineSearch;
  const connectable = (column: string) =>
    !connect ||
    canMapPropertyToColumn(app, entity.id, connect.propertyId, { table: table.name, column });
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
    mappingsIn(property, table.name).map((mapping) => ({ property, mapping })),
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
  // Keep a composite Identifier's columns together, even when sorting by Column, so its
  // Property appears once and every Column can connect back to that one row.
  const identifierPairs = sortedPairs.filter((pair) => isIdentifierProperty(pair.property));
  const identifierIds = [...new Set(identifierPairs.map((pair) => pair.property.id))];
  const pairs = [
    ...identifierIds.flatMap((id) => identifierPairs.filter((pair) => pair.property.id === id)),
    ...sortedPairs.filter((pair) => !isIdentifierProperty(pair.property)),
  ];
  const firstIdentifierRow = new Map<string, number>();
  pairs.forEach((pair, index) => {
    if (isIdentifierProperty(pair.property) && !firstIdentifierRow.has(pair.property.id)) {
      firstIdentifierRow.set(pair.property.id, index);
    }
  });
  // The rest of each side, listed on its own under the pairs.
  const mappedIds = new Set(properties.map((p) => p.id));
  const restProperties = filterProperties(
    entity.properties.filter(
      (p) => !mappedIds.has(p.id) && accepts(propFilter, false, isIdentifierProperty(p)),
    ),
    "all",
    propSearch,
    propSort,
  );
  const mappedColumns = new Set(allPairs.map(columnOf));
  const columnQuery = columnSearch.trim().toLowerCase();
  const restColumns = sortByState(
    table.columns.filter(
      (c) =>
        !mappedColumns.has(c.name) &&
        accepts(columnFilter, false, false) &&
        (!columnQuery || c.name.toLowerCase().includes(columnQuery)),
    ),
    columnSort,
    (c) => c.name,
    () => undefined,
  );
  const restRows = Math.max(restProperties.length, restColumns.length);
  const columnType = (name: string) => table.columns.find((c) => c.name === name)?.type;
  const overflows = (pairs.length + restRows) * 40 > PANEL_LIST_MAX;
  const panelBg = "absolute inset-y-0 rounded-[6px] bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]";
  const fade =
    "pointer-events-none absolute bottom-0 h-[30px] bg-gradient-to-b from-white/0 to-white";
  return (
    <div ref={rootRef} data-canvas-card className="relative" style={{ width }}>
      <div aria-hidden className={cn(panelBg, "left-0")} style={{ width: NODE_W }} />
      <div aria-hidden className={cn(panelBg, "right-0")} style={{ width: NODE_W }} />
      <div className="relative flex">
        <div style={{ width: NODE_W }}>
          <ListControls
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
            onCreate={onCreate}
            createLabel="New property"
          />
        </div>
        <div className="flex-1" />
        <div style={{ width: NODE_W }}>
          <ListControls
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
        className="relative flex flex-col gap-1.5 overflow-y-auto overscroll-contain pb-2 [scrollbar-width:thin]"
        style={{ maxHeight: PANEL_LIST_MAX }}
      >
        {pairs.length === 0 && restRows === 0 && (
          <p
            className="py-3 text-[12px] text-[#6d7472]"
            style={{ width: NODE_W, textAlign: "center" }}
          >
            Nothing matches.
          </p>
        )}
        {pairs.length > 0 && (
          <div className="flex shrink-0 items-center">
            <div className="px-2" style={{ width: NODE_W }}>
              <ListGroupHeading
                label="Mapped"
                count={new Set(pairs.map((pair) => pair.property.id)).size}
              />
            </div>
            <div className="flex-1" />
            <div className={columnCellPad} style={{ width: columnCellWidth }}>
              <ListGroupHeading label="Mapped" count={pairs.length} />
            </div>
          </div>
        )}
        {pairs.map((pair, index) => {
          const { property, mapping } = pair;
          const suggested = mappingStatus(mapping) === "suggested";
          const firstRow = firstIdentifierRow.get(property.id);
          const repeatedIdentifier = firstRow !== undefined && firstRow !== index;
          const rowOffset = repeatedIdentifier ? (index - firstRow) * 40 : 0;
          const sourceTop = (pairs.length > 0 ? 28 : 0) + (firstRow ?? index) * 40;
          const sourceVisible =
            sourceTop < listViewport.top + listViewport.height && sourceTop + 34 > listViewport.top;
          return (
            <div key={`${property.id}:${mapping.column}`} className="flex shrink-0 items-center">
              <div className="relative z-10 px-2" style={{ width: NODE_W }}>
                {!repeatedIdentifier && (
                  <div className="group/maprow relative">
                    <PanelRow
                      name={property.name}
                      highlight={propQuery}
                      dotColor={statusDotColor(propertyStatus(property))}
                      dimmed={!reviewScope.property(property)}
                      identifier={isIdentifierProperty(property)}
                      type={property.type}
                      chip={
                        propertyReview(property) === "suggested" ? (
                          <PropertyConfidenceChip property={property} tone="muted" />
                        ) : null
                      }
                      selected={isSelected(property)}
                      onClick={() => onSelect(property)}
                      moveFrom={{ entityId: entity.id, propertyId: property.id }}
                    />
                    {!connecting && (
                      <ConnectPlus
                        label="Connect to another column"
                        color={suggested ? SUGGESTED : SETTLED}
                        onPress={(event) =>
                          startConnect(property.id, event.currentTarget, "press", event)
                        }
                        onActivate={(target) => startConnect(property.id, target, "click")}
                      />
                    )}
                  </div>
                )}
              </div>
              {/* Each composite column connects to the Identifier's single visible row. */}
              <div
                className={cn(
                  "group/mapline relative -mx-2 flex h-5 min-w-0 flex-1 items-center transition-opacity",
                  connecting || (repeatedIdentifier && !sourceVisible)
                    ? "pointer-events-none opacity-0"
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
                      stroke={suggested ? SUGGESTED : SETTLED}
                      strokeWidth={1.5}
                      strokeDasharray={suggested ? "4 4" : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                ) : (
                  <span
                    aria-hidden
                    className="h-[1.5px] w-full"
                    style={
                      suggested
                        ? {
                            backgroundImage: `repeating-linear-gradient(to right, ${SUGGESTED} 0 4px, transparent 4px 8px)`,
                          }
                        : { backgroundColor: SETTLED }
                    }
                  />
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
                className={cn(
                  "transition-opacity",
                  columnCellPad,
                  !connectable(mapping.column) && "opacity-40",
                )}
                style={{ width: columnCellWidth }}
              >
                <PanelRow
                  grip={false}
                  name={mapping.column}
                  sampleValues={columnSamples(table, mapping.column)}
                  dimmed={!reviewScope.column(table.name, mapping.column)}
                  highlight={columnQueryText}
                  dotColor={suggested ? "#7e22ce" : "#0891b2"}
                  identifier={isIdentifierProperty(property)}
                  type={columnType(mapping.column)}
                  chip={
                    suggested ? (
                      <MappingConfidenceChip
                        entity={entity}
                        property={property}
                        mapping={mapping}
                        tone="muted"
                      />
                    ) : null
                  }
                  selected={isSelected(property) || overColumn === mapping.column}
                  onClick={() => onSelect(property)}
                />
              </div>
            </div>
          );
        })}
        {restRows > 0 && (
          <div className="flex shrink-0 items-center">
            <div className="px-2" style={{ width: NODE_W }}>
              <ListGroupHeading label="Unmapped" count={restProperties.length} />
            </div>
            <div className="flex-1" />
            <div className={columnCellPad} style={{ width: columnCellWidth }}>
              <ListGroupHeading label="Unmapped" count={restColumns.length} />
            </div>
          </div>
        )}
        {Array.from({ length: restRows }, (_, i) => {
          const property = restProperties[i];
          const column = restColumns[i];
          return (
            <div key={`rest-${i}`} className="flex shrink-0 items-center">
              <div className="relative z-10 px-2" style={{ width: NODE_W }}>
                {property && (
                  <div className="group/maprow relative">
                    <PanelRow
                      name={property.name}
                      highlight={propQuery}
                      dotColor={statusDotColor(propertyStatus(property))}
                      dimmed={!reviewScope.property(property)}
                      identifier={isIdentifierProperty(property)}
                      type={property.type}
                      chip={
                        propertyReview(property) === "suggested" ? (
                          <PropertyConfidenceChip property={property} tone="muted" />
                        ) : null
                      }
                      selected={isSelected(property)}
                      onClick={() => onSelect(property)}
                      moveFrom={{ entityId: entity.id, propertyId: property.id }}
                    />
                    {!connecting && (
                      <ConnectPlus
                        label={`Connect ${property.name} to a column`}
                        color={SUGGESTED}
                        onPress={(event) =>
                          startConnect(property.id, event.currentTarget, "press", event)
                        }
                        onActivate={(target) => startConnect(property.id, target, "click")}
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1" />
              <div
                data-map-column={column?.name}
                className={cn(
                  "transition-opacity",
                  columnCellPad,
                  column && !connectable(column.name) && "opacity-40",
                )}
                style={{ width: columnCellWidth }}
              >
                {column && (
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
                )}
              </div>
            </div>
          );
        })}
      </div>
      {overflows && (
        <>
          <div aria-hidden className={cn(fade, "left-0")} style={{ width: NODE_W }} />
          <div aria-hidden className={cn(fade, "right-0")} style={{ width: NODE_W }} />
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
      {connect?.mode === "click" && pointer && !overColumn && (
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
                if (mapping) tryConnectMapping(app, entity.id, lineSearch.propertyId, mapping);
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
          [ARROW_SETTLED, SETTLED],
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
  onPress,
  onActivate,
}: {
  label: string;
  color: string;
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
      className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border-[1.5px] bg-white opacity-0 shadow-[0_1px_2px_0_rgba(0,0,0,0.08)] transition-[opacity,background-color] hover:bg-[#f4f4f4] focus-visible:opacity-100 group-hover/maprow:opacity-100"
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
  onCreateProperty,
  onSplit,
}: {
  app: OntologyApp;
  table: TableSchema;
  onEdit?: (key: string) => void;
  onCreateProperty?: (entityId: string) => void;
  onSplit?: (newEntityId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const canvas = useEditingCanvas(viewportRef, worldRef, scaleRef);
  const move = usePropertyMove(app);

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

  const entityNode = (entity: Entity, trailing?: ReactNode) => (
    <GraphNode
      status={
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={16}
          confidence={entity.confidence}
        />
      }
      name={entity.name}
      detail={entityDetail(entity)}
      dropFor={entity.id}
      dimmed={!reviewScope.entity(entity)}
      chip={
        entityReview(entity) === "suggested" ? (
          <EntityConfidenceChip entity={entity} tone="muted" />
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
                                arrow={towardActive ? "end" : undefined}
                              />
                            </motion.g>
                          );
                        }),
                  )}
              </AnimatePresence>
            </svg>

            {/* The selected Data Table. */}
            <Node x={TG_TABLE_X} y={-CENTER_H / 2}>
              <div
                data-canvas-card
                role="button"
                tabIndex={0}
                onClick={() => inspectTable(table.name)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border bg-white px-3 text-left transition-opacity",
                  CARD_SHADOW,
                  !reviewScope.table(table.name) && DIMMED,
                  inspectedTable === table.name && detailItem?.kind === "table"
                    ? SELECTED_NODE
                    : "border-[#3b82f6]",
                )}
                style={{ width: NODE_W, height: CENTER_H }}
              >
                <span className="lod-type contents">
                  <MappingStatusBadge
                    status={tableMappingStatus(table.name, app.entities)}
                    {...tableMappingCompleteness(table.name, app.entities)}
                    size={16}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="lod-title truncate text-[16px] font-medium leading-6 text-[#080a09]">
                    {table.name}
                  </span>
                  <span className="lod-detail truncate text-[12px] leading-4 text-[#6d7472]">
                    {plural(table.columns.length, "column", "columns")} ·{" "}
                    {plural(mappedEntities.length, "entity", "entities")}
                  </span>
                </span>
                <ExpandChevron
                  open={columnsOpen || !!focused}
                  label={focused ? "Close mappings" : columnsOpen ? "Hide columns" : "Show columns"}
                  onClick={() =>
                    focused ? toggleFocus(focused.entity.id) : setColumnsOpen((o) => !o)
                  }
                />
              </div>
              {columnsOpen && !focused && (
                <div className="absolute left-0 top-full mt-1.5" style={{ width: NODE_W }}>
                  <TableColumnsPanel app={app} table={table} />
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
              <Node x={TG_ENTITY_X} y={CENTER_H / 2 + 6}>
                <MappingPanels
                  key={focused.entity.id}
                  app={app}
                  entity={focused.entity}
                  properties={focused.mapped}
                  table={table}
                  width={TG_TABLE_X + NODE_W - TG_ENTITY_X}
                  onCreate={
                    onCreateProperty ? () => onCreateProperty(focused.entity.id) : undefined
                  }
                  isSelected={(p) =>
                    isSelected({ kind: "property", entityId: focused.entity.id, propertyId: p.id })
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
    </ReviewScopeContext.Provider>
  );
}

/**
 * The selected Data Table's columns, under it (the table's counterpart of the selected Entity
 * Type's property panel): Filter (mapped by any Entity Type or not) / Sort / Search, a type icon
 * each; the dot says whether a column is mapped (teal), only suggested (purple), or not (grey).
 */
function TableColumnsPanel({ app, table }: { app: OntologyApp; table: TableSchema }) {
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
      className="overflow-hidden rounded-[6px] bg-white shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]"
    >
      <ListControls
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
          className="flex flex-col gap-1.5 overflow-y-auto overscroll-contain px-2 pb-2"
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
              <Fragment key={label}>
                <ListGroupHeading label={label} count={group.length} />
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
              </Fragment>
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
