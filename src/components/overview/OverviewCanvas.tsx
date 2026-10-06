import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import panelOpenIcon from "@/assets/icons/side-panel-open-16.svg";
import { FigmaIcon } from "@/components/detail/list-controls";
import { ZoomCard } from "@/components/detail/editing-canvas";
import { sideBetween, pointInRect, distanceToSegment } from "@/lib/geometry";
import type { Pt, Rect, Side } from "@/lib/geometry";
import {
  entitiesUsingTable,
  entityReview,
  isReviewItemInScope,
  isTableInScope,
  relationLabel,
  mappingStatus,
  relationReview,
  relationStatus,
  tableColumnUsage,
  tableHighestMappingConfidence,
  tableMappingCompleteness,
  tableMappingStatus,
  tablesUsedByEntity,
  type SearchResultRef,
} from "@/lib/mock-data";
import { CreateEntityButton } from "@/components/ontology/CreateEntityButton";
import { CreateEntityWizard } from "@/components/ontology/CreateEntityWizard";
import { DefineRelationDialog } from "@/components/ontology/DefineRelationDialog";
import { motion } from "motion/react";
import { EDGE_STYLE } from "@/lib/edge-style";
import { canvasLod, LOD_LABEL_TOP_N, LOD_NAME_PX, LOD_SPARSE_LABELS } from "@/lib/zoom-lod";
import { ItemStatusIcon } from "@/components/ontology/ItemStatusIcon";
import {
  OntologyNode,
  ONTOLOGY_NODE_SIZE,
  OVERVIEW_CARD,
  OVERVIEW_NODE_BOX_H,
  OVERVIEW_NODE_BOX_W,
  overviewCardSizeFor,
} from "./OntologyNode";
import { useCanvasToolShortcuts, type CanvasTool } from "@/components/ontology/CanvasControls";
import {
  SortDropdown,
  DEFAULT_SORT,
  nextSortState,
  sortByState,
  type SortState,
} from "@/components/ontology/SortDropdown";
import { suggestionKey, parseSuggestionKey, type OntologyApp } from "@/lib/app-state";
import { MappingStatusBadge } from "./MappingStatusBadge";
import { SuggestionSelectionBar } from "@/components/nav/SuggestionSelectionBar";
import { EntitySelectionBar } from "@/components/nav/EntitySelectionBar";
import { RelationSelectionBar } from "@/components/nav/RelationSelectionBar";
import { AiReviewBar } from "@/components/ontology/AiReviewBar";
import { circledNumber } from "@/components/nav/HistoryPanel";

const MIN_Z = 0.4;
const MAX_Z = 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// A second plain click on the same Entity node within this window resolves as a double-click
// (jump straight into Editing Mode) rather than two independent single-clicks/selections — see
// this file's own `lastEntityClickRef`.
const DOUBLE_CLICK_MS = 400;

// Overview's canvas nodes are drawn in a fixed box (see OntologyNode) that always holds the node
// centered: a Figma card when zoomed in, the 40px circle when zoomed out. `entity.x` / `entity.y`
// are the box's top-left, so a node's center is the same in both forms. Connectors and hit-testing
// anchor to the node's visible footprint (`Footprint`), which depends on the zoom level.
const overviewNodeScaleForRelationCount = (count: number) =>
  count >= 20 ? 1.38 : count >= 10 ? 1.18 : count >= 5 ? 1 : 0.86;
/** A node's visible shape: a `w` × `h` card, or — `round` — a circle of diameter `w`. */
type Footprint = { w: number; h: number; round: boolean };
const FALLBACK_FOOTPRINT: Footprint = { w: ONTOLOGY_NODE_SIZE, h: ONTOLOGY_NODE_SIZE, round: true };
const nodeRect = (n: { x: number; y: number }, fp: Footprint): Rect => {
  const center = ontologyNodeCenter(n);
  return { x: center.x - fp.w / 2, y: center.y - fp.h / 2, width: fp.w, height: fp.h };
};
const ontologyNodeCenter = (n: { x: number; y: number }) => ({
  x: n.x + OVERVIEW_NODE_BOX_W / 2,
  y: n.y + OVERVIEW_NODE_BOX_H / 2,
});
/** How far from a node's center its outline is, heading in direction `dir` (a unit vector). */
const footprintReach = (fp: Footprint, dir: Pt) =>
  fp.round
    ? fp.w / 2
    : Math.min(
        fp.w / 2 / Math.max(Math.abs(dir.x), 1e-6),
        fp.h / 2 / Math.max(Math.abs(dir.y), 1e-6),
      );

// Where a click on a node's connection dot places the new node: straight out from that side.
const GHOST_DISTANCE = 150;
// The editor's spring (see EditingGraph): nodes, lines and labels move together with it.
const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0.1 };
const SIDE_DIR: Record<Side, Pt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
// Nearby nodes move aside for it (see `makeWay`), so the spot itself is fixed.
const ghostCenter = (n: { x: number; y: number }, side: Side, fp?: Footprint): Pt => {
  const c = ontologyNodeCenter(n);
  // Far enough to clear the node's own outline, wherever that is (a card is much wider).
  const dist = fp
    ? Math.max(GHOST_DISTANCE, footprintReach(fp, SIDE_DIR[side]) + 90)
    : GHOST_DISTANCE;
  return { x: c.x + SIDE_DIR[side].x * dist, y: c.y + SIDE_DIR[side].y * dist };
};

// The inverse of `ontologyNodeCenter` above — given the world point a new node's CENTER should
// land on, returns the `x`/`y` to actually store on the Entity (its wrapper's own top-left,
// which is what `x`/`y` mean everywhere else on this canvas).
const wrapperOriginForCenter = (center: Pt) => ({
  x: center.x - OVERVIEW_NODE_BOX_W / 2,
  y: center.y - OVERVIEW_NODE_BOX_H / 2,
});

/** Idea 3: a small hand-rolled force-directed simulation — mutual repulsion between every pair of
 * nodes, spring attraction along each Relation edge toward a target rest length, and a light pull
 * toward the shared centroid so the whole graph doesn't drift apart under repulsion alone. Unlike
 * Idea 1's hub/community heuristic, a disconnected Entity (no Relations at all, e.g. "Actor") just
 * settles wherever the repulsion from every other node leaves it — never bucketed into an
 * unrelated hub's cluster by coincidence.
 *
 * Runs a fixed number of iterations from a seeded starting layout, then bakes the result to
 * static coordinates — deterministic and one-shot, not a continuously animating simulation, the
 * same "compute once, render fixed" contract as the other two ideas. */
function buildForceDirectedLayout<T extends { id: string; x: number; y: number }>(
  entities: T[],
  relations: { from: string; to: string }[],
): T[] {
  if (entities.length < 2) return entities;

  // mulberry32 — a tiny, deterministic PRNG so the simulation starts from the same scattered
  // positions every time instead of a different layout on every reload.
  let seed = 1337;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const originalCenters = entities.map(ontologyNodeCenter);
  const graphCenter = {
    x: originalCenters.reduce((sum, p) => sum + p.x, 0) / originalCenters.length,
    y: originalCenters.reduce((sum, p) => sum + p.y, 0) / originalCenters.length,
  };

  const SCATTER_RADIUS = 2200;
  const positions = new Map<string, Pt>();
  const velocities = new Map<string, Pt>();
  entities.forEach((entity) => {
    const angle = rand() * Math.PI * 2;
    const dist = rand() * SCATTER_RADIUS;
    positions.set(entity.id, {
      x: graphCenter.x + Math.cos(angle) * dist,
      y: graphCenter.y + Math.sin(angle) * dist,
    });
    velocities.set(entity.id, { x: 0, y: 0 });
  });

  const edges = relations.filter(
    (r) => r.from !== r.to && positions.has(r.from) && positions.has(r.to),
  );
  const ids = entities.map((entity) => entity.id);

  // Spaced for the 168-256px cards (the layout is one fixed world, whatever the zoom).
  const REPULSION = 450000;
  const SPRING_LENGTH = 300;
  const SPRING_STRENGTH = 0.03;
  const CENTER_PULL = 0.0015;
  const DAMPING = 0.85;
  const ITERATIONS = 500;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces = new Map<string, Pt>(ids.map((id) => [id, { x: 0, y: 0 }]));

    // Mutual repulsion between every pair — O(n^2), trivial at this node count (dozens, not
    // thousands; a spatial index would only start paying for itself well past this scale).
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions.get(ids[i]!)!;
        const b = positions.get(ids[j]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          distSq = 1;
        }
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(ids[i]!)!.x += fx;
        forces.get(ids[i]!)!.y += fy;
        forces.get(ids[j]!)!.x -= fx;
        forces.get(ids[j]!)!.y -= fy;
      }
    }

    // Spring attraction along real Relation edges only.
    edges.forEach(({ from, to }) => {
      const a = positions.get(from)!;
      const b = positions.get(to)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      forces.get(from)!.x += fx;
      forces.get(from)!.y += fy;
      forces.get(to)!.x -= fx;
      forces.get(to)!.y -= fy;
    });

    // Gentle pull toward the shared centroid — keeps repulsion from pushing the graph apart
    // forever instead of settling.
    ids.forEach((id) => {
      const p = positions.get(id)!;
      forces.get(id)!.x -= (p.x - graphCenter.x) * CENTER_PULL;
      forces.get(id)!.y -= (p.y - graphCenter.y) * CENTER_PULL;
    });

    // Integrate: damped velocity, then position.
    ids.forEach((id) => {
      const v = velocities.get(id)!;
      const f = forces.get(id)!;
      v.x = (v.x + f.x) * DAMPING;
      v.y = (v.y + f.y) * DAMPING;
      const p = positions.get(id)!;
      p.x += v.x;
      p.y += v.y;
    });
  }

  return entities.map((entity) => ({
    ...entity,
    ...wrapperOriginForCenter(positions.get(entity.id)!),
  }));
}

// Hidden for now per product decision (the create-Entity-Type toolbar row reads as an empty bar
// with the design's new header above it) — `CreateEntityButton` and `handleCreateEntity` stay
// fully wired below, just not rendered, so restoring this is a one-line flip back to `true`.
const SHOW_CREATE_ENTITY_TOOLBAR = false;

// Hidden for now per product decision — see this flag's own use at the "Search focus: …" pill's
// render site for what stays wired underneath (searchFocus's pan-to-target/dimming/dismissal
// behavior is all unaffected; only the pill itself is suppressed).
const SHOW_SEARCH_FOCUS_PILL = false;

const RELATION_GAP = 6;
// How close a third node's center may come to a connector before it's treated as an obstacle to
// bow around — the node's own radius plus a visible margin, so the curve clears it by more than
// just touching the edge.
const OBSTACLE_CLEARANCE = ONTOLOGY_NODE_SIZE / 2 + 14;
// Nearby radial bearings share a narrow angular bucket and fan apart by at most five degrees.
// This retains the center-to-center direction while separating connectors that would otherwise
// leave a busy hub at effectively the same point.
const RADIAL_FAN_BUCKET = (12 * Math.PI) / 180;
const MAX_RADIAL_FAN_SPREAD = (14 * Math.PI) / 180;
const MIN_HANDLE = 14;
const MAX_HANDLE = 72;
const MAX_CURVE_BOW = 22;
// Relation labels (Figma Line 362:222575) on the Overview edges.
const SHOW_OVERVIEW_RELATION_NODES = true;

/** A cubic Bezier's own point at parameter `t` — used both to sample the curve for obstacle
 * detection and to place the Relation pill exactly on the rendered path (never off of it). */
const cubicPointAt = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
};

/** One end of a graph edge, already resolved to its node's radial direction — see
 * `EdgeEnd`'s own construction in `relationGeometry` for how `fanIndex`/`fanCount` get assigned. */
type EdgeEnd = {
  center: Pt;
  angle: number;
  fanIndex: number;
  fanCount: number;
  footprint: Footprint;
};

/** The anchor point ALWAYS sits exactly on the node's own circle (never slid off to one side) —
 * fanning nearby edges apart rotates each one's direct bearing subtly around that circle instead
 * of offsetting the point linearly. Returns the
 * direction (the anchor's own outward radial direction, post-rotation) alongside the point so the
 * path can choose a consistent shallow bend while preserving each endpoint's place in the fan. */
const edgeEndAnchor = (end: EdgeEnd): { point: Pt; dir: Pt } => {
  const midpoint = (end.fanCount - 1) / 2;
  const spread =
    end.fanCount > 1
      ? ((end.fanIndex - midpoint) / Math.max(1, midpoint)) * MAX_RADIAL_FAN_SPREAD
      : 0;
  const angle = end.angle + spread;
  const dir: Pt = { x: Math.cos(angle), y: Math.sin(angle) };
  const reach = footprintReach(end.footprint, dir);
  const point: Pt = {
    x: end.center.x + dir.x * (reach + RELATION_GAP),
    y: end.center.y + dir.y * (reach + RELATION_GAP),
  };
  return { point, dir };
};

/** A Relation's connector between two circular nodes — a single, shallow cubic arc. The anchors
 * still rotate subtly around crowded hub nodes, but both control points follow the direct chord
 * and share one small perpendicular offset. That produces one tensioned curve instead of the
 * opposing fixed-side tangents that could form S-curves or dramatic swings. */

function graphEdgePath(
  fromEnd: EdgeEnd,
  toEnd: EdgeEnd,
  others: { id: string; x: number; y: number }[],
  excludeIds: readonly [string, string],
  footprintById: ReadonlyMap<string, Footprint>,
  /** Several relations between the same two nodes: this one's sideways offset (px), measured in
   * the pair's own fixed direction so opposite-direction relations spread apart too. */
  pairOffset = 0,
  pairFlipped = false,
): { d: string; mid: Pt; p1: Pt; p2: Pt } {
  const { point: p1, dir: dir1 } = edgeEndAnchor(fromEnd);
  const { point: p2, dir: dir2 } = edgeEndAnchor(toEnd);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const ux = (p2.x - p1.x) / dist;
  const uy = (p2.y - p1.y) / dist;
  const nx = -uy;
  const ny = ux;
  const handle = Math.min(MAX_HANDLE, Math.max(MIN_HANDLE, dist * 0.28));
  const sourceTurn = ux * dir1.y - uy * dir1.x;
  const targetTurn = -ux * dir2.y + uy * dir2.x;
  const turn = sourceTurn + targetTurn;
  const fallbackSign = (fromEnd.fanIndex + toEnd.fanIndex) % 2 === 0 ? 1 : -1;
  const bendSign = Math.abs(turn) < 0.001 ? fallbackSign : Math.sign(turn);
  const bendStrength = Math.min(1, 0.25 + Math.abs(turn) * 1.5);
  const lengthScale = Math.min(1, dist / 180);
  const bow = Math.min(MAX_CURVE_BOW, dist * 0.04) * lengthScale * bendStrength;

  let c1: Pt = {
    x: p1.x + ux * handle + nx * bow * bendSign,
    y: p1.y + uy * handle + ny * bow * bendSign,
  };
  let c2: Pt = {
    x: p2.x - ux * handle + nx * bow * bendSign,
    y: p2.y - uy * handle + ny * bow * bendSign,
  };

  // Obstacle check against the plain curve's own sampled shape (not just the straight p1-p2
  // segment) — a gentle curve can already clear a node the straight line would have cut through,
  // so this only bows further when the CURVE itself still comes too close.
  const sampleCount = 9;
  const samples: Pt[] = [];
  for (let i = 0; i <= sampleCount; i++)
    samples.push(cubicPointAt(p1, c1, c2, p2, i / sampleCount));

  let minDist = Infinity;
  let minClearance = OBSTACLE_CLEARANCE;
  let obstacle: Pt | null = null;
  for (const o of others) {
    if (o.id === excludeIds[0] || o.id === excludeIds[1]) continue;
    const oc = ontologyNodeCenter(o);
    // The node's outline plus room around it (a circle also leaves room for its name below).
    const ofp = footprintById.get(o.id);
    const clearance = ofp
      ? ofp.round
        ? ofp.w / 2 + 30
        : Math.max(ofp.w, ofp.h) / 2 + 14
      : ONTOLOGY_NODE_SIZE / 2 + 30;
    for (let i = 0; i < samples.length - 1; i++) {
      const dist2 = distanceToSegment(oc, samples[i]!, samples[i + 1]!);
      if (dist2 - clearance < minDist - minClearance) {
        minDist = dist2;
        minClearance = clearance;
        obstacle = oc;
      }
    }
  }

  if (obstacle && minDist < minClearance) {
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    let nx = -(p2.y - p1.y) / dist;
    let ny = (p2.x - p1.x) / dist;
    // Bow away from the obstacle, not toward it.
    if (nx * (obstacle.x - mx) + ny * (obstacle.y - my) > 0) {
      nx = -nx;
      ny = -ny;
    }
    // Deliberately small relative to the curve's own length — just enough to nudge clear of the
    // obstacle, never enough to drag both control points so far sideways that the whole curve
    // reads as "swings over near that other node" rather than "still clearly a connector between
    // its own two endpoints" (each end still anchors exactly on its own node's circle regardless —
    // only the curve's middle moves — but a large bow here used to make that hard to see).
    // The curve's middle moves 3/4 of its control points' shift, so this clears the node.
    const obstacleBow = Math.min(((minClearance - minDist + 8) * 4) / 3, dist * 0.35, 80);
    c1 = { x: c1.x + nx * obstacleBow, y: c1.y + ny * obstacleBow };
    c2 = { x: c2.x + nx * obstacleBow, y: c2.y + ny * obstacleBow };
  }

  if (pairOffset !== 0) {
    // Perpendicular of the pair's direction; the bezier's middle sits at 3/4 of the control
    // points' shift, so they move by 4/3 of the wanted gap.
    const sign = pairFlipped ? -1 : 1;
    const px = -uy * sign * pairOffset * (4 / 3);
    const py = ux * sign * pairOffset * (4 / 3);
    c1 = { x: c1.x + px, y: c1.y + py };
    c2 = { x: c2.x + px, y: c2.y + py };
  }

  return {
    d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
    mid: cubicPointAt(p1, c1, c2, p2, 0.5),
    p1,
    p2,
  };
}

/**
 * The Overview workspace: the ontology graph (pan/zoom, entity nodes, relation lines) alongside a
 * side panel for Source Tables — the Data Tables panel is collapsible (see `tablePanelOpen`
 * below), the Ontology canvas is not. Clicking an Entity or a Table opens Detail directly — no
 * separate confirmation step — via openDetail(), which also updates selection so the click reads
 * as "select and go" in one step. Clicking a Relation only selects it (Inspect) since Relations
 * don't have a Detail view of their own.
 */
export function OverviewCanvas({ app }: { app: OntologyApp }) {
  const {
    entities,
    relations,
    tables,
    selection,
    select,
    openDetail,
    openDetailWithMorph,
    updateEntity,
    createEntity,
    createEntityWithProperties,
    createRelation,
    deleteEntity,
    deleteRelation,
    deleteEntities,
    deleteProperties,
    deleteRelations,
    pushHistory,
    undo,
    redo,
    view,
    setView,
    confidenceRange,
    setConfidenceRange,
    selectSuggestionKeys,
    statusFilter,
    searchFocus,
    clearSearchFocus,
    historyPanelOpen,
    historyInspection,
    toggleHistoryGroupSelected,
    historyInspectionHoveredNumber,
    setHistoryInspectionHoveredNumber,
    historyRestoreHighlight,
    suggestionSelection,
    toggleSuggestionSelected,
    clearSuggestionSelection,
    acceptSuggestions,
    declineSuggestions,
  } = app;

  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // The Select/Pan tool switch in the canvas controls bar below — "select" is the default (a
  // background drag does nothing but deselect); switching to "pan" is what lets a background drag
  // move the view instead. Clicking/dragging any node itself works exactly the same in either
  // tool, regardless of which one is active.
  const [tool, setTool] = useState<CanvasTool>("select");
  useCanvasToolShortcuts(tool, setTool, undo, redo);

  // Relation degree is a visual-density signal only. It never changes graph data or layout:
  // peripheral nodes shrink while hubs grow in four bounded steps, and every stored center stays
  // fixed so the hierarchy doesn't reflow the graph.
  const relationCountByEntity = useMemo(() => {
    const counts = new Map(entities.map((entity) => [entity.id, 0]));
    relations.forEach((relation) => {
      counts.set(relation.from, (counts.get(relation.from) ?? 0) + 1);
      if (relation.to !== relation.from)
        counts.set(relation.to, (counts.get(relation.to) ?? 0) + 1);
    });
    return counts;
  }, [entities, relations]);
  const nodeScaleById = useMemo(
    () =>
      new Map(
        entities.map((entity) => [
          entity.id,
          overviewNodeScaleForRelationCount(relationCountByEntity.get(entity.id) ?? 0),
        ]),
      ),
    [entities, relationCountByEntity],
  );
  // The shared semantic-zoom scale (zoom-lod.ts). Zoomed in (full / compact) a node is a Figma card
  // sized by how connected it is; zoomed out (minimal / name) it is the 40px circle.
  const lod = canvasLod(view.z);
  const cardMode = lod === "full" || lod === "compact";
  const cardSizeById = useMemo(
    () =>
      new Map(
        entities.map((entity) => [
          entity.id,
          overviewCardSizeFor(relationCountByEntity.get(entity.id) ?? 0),
        ]),
      ),
    [entities, relationCountByEntity],
  );
  const footprintById = useMemo(
    () =>
      new Map<string, Footprint>(
        entities.map((entity) => {
          if (cardMode) {
            const card = OVERVIEW_CARD[cardSizeById.get(entity.id) ?? "small"];
            return [entity.id, { w: card.w, h: card.h, round: false }];
          }
          const size = ONTOLOGY_NODE_SIZE * (nodeScaleById.get(entity.id) ?? 1);
          return [entity.id, { w: size, h: size, round: true }];
        }),
      ),
    [entities, cardMode, cardSizeById, nodeScaleById],
  );
  const layoutEntities = useMemo(
    () => buildForceDirectedLayout(entities, relations),
    [entities, relations],
  );

  // The Data Tables panel's own collapse toggle — independent of the Ontology canvas, which is
  // always shown at full width alongside it. Collapsing only hides this panel's own content; it
  // never touches canvas content, selection, or the ontology itself.
  const TABLE_PANEL_OPEN_W = 240;
  const [tablePanelOpen, setTablePanelOpen] = useState(true);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    select(null);
    clearSuggestionSelection();
    // Clicking empty canvas is one of Global Search's own "exit this focus state" gestures (see
    // app-state's `searchFocus` doc comment) — harmless to call unconditionally even when no
    // search focus is active, since clearing an already-null value is a no-op.
    clearSearchFocus();
    if (tool !== "pan") return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Centers and scales the pan/zoom so every entity is visible without any manual panning —
  // run once whenever this canvas mounts (including every time Detail's Back returns here, since
  // that swaps this component back in from scratch) rather than only on the very first load.
  const fitToContent = useCallback(() => {
    const el = ref.current;
    if (!el || layoutEntities.length === 0) return;
    const rect = el.getBoundingClientRect();
    const minX = Math.min(...layoutEntities.map((e) => e.x));
    const minY = Math.min(...layoutEntities.map((e) => e.y));
    // +40 below the node's own footprint gives the name/subtitle label room in the fit, so it
    // never clips at the bottom edge of the canvas.
    const maxX = Math.max(...layoutEntities.map((e) => e.x + OVERVIEW_NODE_BOX_W));
    const maxY = Math.max(...layoutEntities.map((e) => e.y + OVERVIEW_NODE_BOX_H + 40));
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const pad = 72;
    const availW = rect.width - pad * 2;
    const availH = rect.height - pad * 2;
    const z = clamp(Math.min(availW / contentW, availH / contentH), MIN_Z, 1);
    setView({
      z,
      x: pad + (availW - contentW * z) / 2 - minX * z,
      y: pad + (availH - contentH * z) / 2 - minY * z,
    });
  }, [layoutEntities, setView]);

  useLayoutEffect(() => {
    fitToContent();
    // Deliberately mount-only: re-fitting on every entity move/add would fight the user's own
    // pan/zoom while they're actively working the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.x) / view.z,
        y: (clientY - rect.top - view.y) / view.z,
      };
    },
    [view],
  );

  // The canvas-first creation wizard's own request state — set the moment a connect-drag (see
  // `connectDrag` just below) is released over empty canvas, and cleared the moment the wizard
  // closes, however it closes. `source` is `null` for a fully standalone Entity; `centerPosition`
  // is always where the new node's own CIRCLE (not its wrapper) should land, in world space — see
  // `wrapperOriginForCenter`'s own doc comment for why that distinction matters once the wizard
  // actually finishes and calls `createEntityWithProperties`. Nothing here touches Current
  // Ontology on its own — this is purely "which draft is the wizard currently showing."
  const [creationRequest, setCreationRequest] = useState<{
    centerPosition: Pt;
    source: { entityId: string; side: Side } | null;
  } | null>(null);

  // `centerPosition` is always the actual drop point of the connect-drag that triggered this (see
  // `connectDrag`'s own pointer-up handler below) — the new Entity lands exactly where the user
  // released the drag, never a fixed offset from the source.
  const startCreateConnectedEntity = useCallback(
    (sourceId: string, side: Side, centerPosition: Pt) => {
      setCreationRequest({ centerPosition, source: { entityId: sourceId, side } });
    },
    [],
  );

  // Direct-manipulation connector drag — dragging from one entity node's hover-revealed handle
  // (see `OntologyNode`'s own doc comment on `onStartConnect`) resolves to one of two outcomes
  // purely by where it's released: onto an existing Entity, it creates a Relation between the two;
  // onto empty canvas, it opens the creation wizard for a brand-new, connected Entity Type placed
  // at the drop point. Relations can only ever be created or deleted this way, never re-pointed
  // once they exist.
  const [connectDrag, setConnectDrag] = useState<{
    sourceId: string;
    side: Side;
    origin: { x: number; y: number };
  } | null>(null);
  // FigJam-style: the connection dot under the pointer previews, in gray, where a click on it
  // adds a new connected Entity Type.
  const [handleHover, setHandleHover] = useState<{ entityId: string; side: Side } | null>(null);
  // Positions as drawn (the auto layout), for placing the new node where its preview was.
  const drawnPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // The pointer cursor stays on while a connector is being dragged out, wherever it goes.
  useEffect(() => {
    if (!connectDrag) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [connectDrag]);
  const [connectPos, setConnectPos] = useState<{ x: number; y: number } | null>(null);
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);

  const findEntityAt = useCallback(
    (clientX: number, clientY: number, excludeId?: string) => {
      const p = toWorld(clientX, clientY);
      let best: (typeof entities)[number] | null = null;
      let bestDist = Infinity;
      for (const en of entities) {
        if (en.id === excludeId) continue;
        if (!pointInRect(p, nodeRect(en, footprintById.get(en.id) ?? FALLBACK_FOOTPRINT))) continue;
        const c = ontologyNodeCenter(en);
        const dist = Math.hypot(p.x - c.x, p.y - c.y);
        if (dist < bestDist) {
          best = en;
          bestDist = dist;
        }
      }
      return best;
    },
    [entities, footprintById, toWorld],
  );

  const startConnectFromEntity = useCallback(
    (entityId: string, side: Side, clientX: number, clientY: number) => {
      const origin = toWorld(clientX, clientY);
      setConnectDrag({ sourceId: entityId, side, origin });
      setConnectPos(origin);
    },
    [toWorld],
  );

  useEffect(() => {
    if (!connectDrag) return;
    const onMove = (e: PointerEvent) => {
      setConnectPos(toWorld(e.clientX, e.clientY));
      setConnectTargetId(findEntityAt(e.clientX, e.clientY, connectDrag.sourceId)?.id ?? null);
    };
    const onUp = (e: PointerEvent) => {
      const hit = findEntityAt(e.clientX, e.clientY, connectDrag.sourceId);
      const dropPoint = toWorld(e.clientX, e.clientY);
      // `findEntityAt` deliberately excludes the drag's own source (so the hover-highlight above
      // never rings the source's own opposite side while dragging near it) — but a self-relation
      // is explicitly allowed, so the final drop still needs its own check for "landed back on the
      // entity it started from," separate from that general hit-test.
      const sourceEntity = entities.find((en) => en.id === connectDrag.sourceId);
      const droppedOnSource =
        sourceEntity &&
        pointInRect(
          dropPoint,
          nodeRect(sourceEntity, footprintById.get(sourceEntity.id) ?? FALLBACK_FOOTPRINT),
        );
      if (hit) {
        setRelationDialogRequest({ sourceId: connectDrag.sourceId, targetId: hit.id });
      } else if (droppedOnSource) {
        setRelationDialogRequest({
          sourceId: connectDrag.sourceId,
          targetId: connectDrag.sourceId,
        });
      } else {
        // A release that never really left the handle (e.g. a plain click that started a drag by
        // accident) is a no-op, not "create a new Entity Type here" — same 6px click-vs-drag
        // threshold the rest of the canvas uses.
        const dragDistance = Math.hypot(
          dropPoint.x - connectDrag.origin.x,
          dropPoint.y - connectDrag.origin.y,
        );
        if (dragDistance > 6) {
          startCreateConnectedEntity(connectDrag.sourceId, connectDrag.side, dropPoint);
        } else if (sourceEntity) {
          // A click on the dot adds the new node right away, where its gray preview was, related
          // to the node it came from (FigJam-style) — named and refined afterwards.
          const center = ghostCenter(
            drawnPositionsRef.current.get(sourceEntity.id) ?? sourceEntity,
            connectDrag.side,
            footprintById.get(sourceEntity.id),
          );
          const taken = new Set(entities.map((e) => e.name));
          let name = "New entity type";
          for (let i = 2; taken.has(name); i++) name = `New entity type ${i}`;
          const id = createEntityWithProperties({
            name,
            position: wrapperOriginForCenter(center),
            properties: [{ name: "id", type: "string", isIdentifier: true }],
            connection: {
              sourceEntityId: sourceEntity.id,
              relationName: "",
              direction: "fromSource",
            },
          });
          select({ kind: "entity", id });
        }
        setHandleHover(null);
      }
      setConnectDrag(null);
      setConnectPos(null);
      setConnectTargetId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [
    connectDrag,
    toWorld,
    findEntityAt,
    startCreateConnectedEntity,
    entities,
    footprintById,
    createEntityWithProperties,
    select,
  ]);

  // The "Define Relation" dialog's own request state — set the moment a connect-drag (see
  // `connectDrag` just above) is released ON an existing Entity, replacing the old behavior where
  // that same drop created an unnamed Relation immediately. Cleared on Cancel or once `createRelation`
  // actually runs; nothing here touches Current Ontology on its own.
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

  const connectTargetEntity = connectTargetId
    ? entities.find((e) => e.id === connectTargetId)
    : undefined;
  const connectTargetSide =
    connectTargetEntity && connectPos
      ? sideBetween(ontologyNodeCenter(connectTargetEntity), connectPos)
      : null;

  // Every rendered Entity node's own outer DOM wrapper, keyed by entity id — read once, at the
  // moment a click (not a drag) resolves, purely to measure exactly where its status circle and
  // name label currently sit on screen for the Overview→Editing morph transition (see
  // `EntityMorphOrigin`). Never used for anything else (no re-render depends on this ref).
  const nodeElRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Entity pointer tracking owns single/shift/double-click resolution. The topology layout passes
  // `locked: true`, retaining those interactions without letting a drag fight the automatic
  // positions; the movement branch remains available if Overview later restores free placement.
  const nodeDragInfo = useRef<{
    id: string;
    startX: number;
    startY: number;
    sx: number;
    sy: number;
    moved: boolean;
    locked: boolean;
  } | null>(null);

  const startNodeMove = useCallback(
    (id: string, clientX: number, clientY: number, locked = false) => {
      const entity = entities.find((e) => e.id === id);
      if (!entity) return;
      nodeDragInfo.current = {
        id,
        startX: entity.x,
        startY: entity.y,
        sx: clientX,
        sy: clientY,
        moved: false,
        locked,
      };
    },
    [entities],
  );

  // "Go to Editing Mode" — the entity-selection bar's own explicit navigation action (see
  // `onUp` below for why a plain click no longer does this by itself). Reuses the exact same
  // "measure the node's own circle + name label right now, then morph" logic a click used to run
  // inline, just triggered by the button (or a double-click — see `onUp`) instead — falling back
  // to a plain `openDetail` whenever either piece can't be measured, same as before. Declared
  // ahead of the node-drag effect below so that effect can call it directly.
  const goToEditingMode = useCallback(
    (id: string) => {
      const wrapperEl = nodeElRefs.current.get(id);
      const circleEl = wrapperEl?.querySelector(".rounded-full");
      const labelEl = wrapperEl?.querySelector("[data-morph-label]");
      if (circleEl && labelEl) {
        openDetailWithMorph(id, circleEl.getBoundingClientRect(), labelEl.getBoundingClientRect());
      } else {
        openDetail("entity", id);
      }
    },
    [openDetail, openDetailWithMorph],
  );

  // Where a multi-selection's "Go to Editing Mode" opens: the first selected Entity Type, or the
  // one owning the first selected Property / mapping, or the first selected Relation's subject.
  const selectionEditTarget = useMemo(() => {
    for (const key of suggestionSelection) {
      const ref = parseSuggestionKey(key);
      if (!ref) continue;
      const id =
        ref.kind === "entity"
          ? ref.id
          : ref.kind === "relation"
            ? relations.find((r) => r.id === ref.id)?.from
            : ref.entityId;
      if (id && entities.some((e) => e.id === id)) return id;
    }
    return null;
  }, [suggestionSelection, entities, relations]);

  // A second plain click on the SAME Entity within `DOUBLE_CLICK_MS` resolves as a double-click
  // (see `onUp` below) rather than two independent single-clicks — tracked by hand (not the native
  // `dblclick` event) since this canvas already resolves click-vs-drag itself from raw pointer
  // events, and mixing in a second, browser-native gesture recognizer for just this one case would
  // only add a second source of truth to keep in sync with the first.
  const lastEntityClickRef = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const info = nodeDragInfo.current;
      if (!info) return;
      if (info.locked) return;
      const dx = e.clientX - info.sx;
      const dy = e.clientY - info.sy;
      // `updateEntity` deliberately never pushes undo history itself (see its own comment in
      // app-state.ts) since this is exactly the continuous case that would otherwise push one
      // snapshot per pointermove — pushing once here, right as the drag actually starts, gives
      // the whole drag exactly one undo step regardless of how far it travels.
      if (!info.moved && Math.hypot(dx, dy) > 6) {
        info.moved = true;
        pushHistory();
      }
      if (info.moved) {
        updateEntity(info.id, { x: info.startX + dx / view.z, y: info.startY + dy / view.z });
      }
    };
    const onUp = (e: PointerEvent) => {
      const info = nodeDragInfo.current;
      nodeDragInfo.current = null;
      if (!info || info.moved) return;
      const currentKey = suggestionKey({ kind: "entity", id: info.id });
      if (e.shiftKey) {
        if (suggestionSelection.size > 0) {
          toggleSuggestionSelected({ kind: "entity", id: info.id });
          return;
        }
        if (selection?.kind === "entity" && selection.id !== info.id) {
          selectSuggestionKeys([suggestionKey({ kind: "entity", id: selection.id }), currentKey]);
          select(null);
          return;
        }
      }
      // A second plain click on this same Entity within `DOUBLE_CLICK_MS` jumps straight into
      // Editing Mode — the fast path alongside the contextual bar's own explicit "Go to Editing
      // Mode" button, not a replacement for it.
      const last = lastEntityClickRef.current;
      if (last && last.id === info.id && Date.now() - last.at < DOUBLE_CLICK_MS) {
        lastEntityClickRef.current = null;
        goToEditingMode(info.id);
        return;
      }
      lastEntityClickRef.current = { id: info.id, at: Date.now() };
      clearSuggestionSelection();
      // A plain (single) click only SELECTS the Entity — it no longer jumps straight into Editing
      // Mode on its own. Selecting reveals the contextual action bar in place of the default AI
      // Review bar (see the bottom-center stack below), which offers "Go to Editing Mode" as its
      // own explicit action too.
      select({ kind: "entity", id: info.id });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [
    updateEntity,
    select,
    selection,
    suggestionSelection,
    selectSuggestionKeys,
    toggleSuggestionSelected,
    clearSuggestionSelection,
    goToEditingMode,
    view.z,
    pushHistory,
  ]);

  // Composite "Delete" for the multi-select bar (see `SuggestionSelectionBar`'s own doc comment
  // on `onDeleteSuggestions`) — a selection can mix Entities/Properties/Relations at once (e.g.
  // "Select all in range"), so this partitions by kind and calls each kind's own batch delete
  // exactly once, rather than looping single-item deletes (which would re-trash a Relation once
  // per side if both its Entities happen to be in the same batch — see `deleteEntities`'s own doc
  // comment in app-state.ts). Clearing the selection afterward mirrors Accept/Decline, which
  // already implicitly empty it by removing every selected key's own underlying object.
  const deleteSuggestionKeys = useCallback(
    (keys: string[]) => {
      const entityIds: string[] = [];
      const propertyItems: { entityId: string; propertyId: string }[] = [];
      const relationIds: string[] = [];
      keys.forEach((key) => {
        const ref = parseSuggestionKey(key);
        if (!ref) return;
        if (ref.kind === "entity") entityIds.push(ref.id);
        else if (ref.kind === "relation") relationIds.push(ref.id);
        else if (ref.kind === "property") {
          propertyItems.push({ entityId: ref.entityId, propertyId: ref.propertyId });
        }
      });
      if (entityIds.length > 0) deleteEntities(entityIds);
      if (propertyItems.length > 0) deleteProperties(propertyItems);
      if (relationIds.length > 0) deleteRelations(relationIds);
      clearSuggestionSelection();
    },
    [deleteEntities, deleteProperties, deleteRelations, clearSuggestionSelection],
  );

  // The single-Entity contextual bar's own subject — `null` whenever the current `selection`
  // isn't an Entity (a Relation/Table selection, or nothing at all) at all, in which case the
  // bottom-center stack falls back to the default `AiReviewBar` — see the render site below.
  const selectedEntity =
    selection?.kind === "entity" ? (entities.find((e) => e.id === selection.id) ?? null) : null;
  // Same idea, for the single-Relation contextual bar (`RelationSelectionBar`) — `null` whenever
  // `selection` isn't a Relation.
  const selectedRelation =
    selection?.kind === "relation" ? (relations.find((r) => r.id === selection.id) ?? null) : null;
  // Reuse the canvas's existing semantic-zoom value and thresholds. Relation names join the
  // detailed Entity summary above 110%; below 70%, connectors retain the graph's topology while
  // receding behind the nodes. Hover/selection always wins over either zoom treatment.
  // The shared semantic-zoom scale (zoom-lod.ts): farther out, crowded lines bundle.
  const farRelationZoom = LOD_SPARSE_LABELS.has(lod);
  const selectRelationOnClick = useCallback(
    (relationId: string, shiftKey: boolean) => {
      const current = { kind: "relation", id: relationId } as const;
      if (shiftKey) {
        if (suggestionSelection.size > 0) {
          toggleSuggestionSelected(current);
          return;
        }
        if (selection && !(selection.kind === "relation" && selection.id === relationId)) {
          const previousKey =
            selection.kind === "entity"
              ? suggestionKey({ kind: "entity", id: selection.id })
              : selection.kind === "relation"
                ? suggestionKey({ kind: "relation", id: selection.id })
                : null;
          if (previousKey) {
            selectSuggestionKeys([previousKey, suggestionKey(current)]);
            select(null);
            return;
          }
        }
      }
      clearSuggestionSelection();
      select(current);
    },
    [
      selection,
      suggestionSelection,
      select,
      selectSuggestionKeys,
      toggleSuggestionSelected,
      clearSuggestionSelection,
    ],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = rect.width / 2;
      const py = rect.height / 2;
      setView((v) => {
        const next = clamp(v.z * factor, MIN_Z, MAX_Z);
        const k = next / v.z;
        return { z: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    },
    [setView],
  );

  // Jumps straight to an exact zoom level (the zoom card's "100%") instead of the multiplicative
  // `zoomBy` above, but keeps the
  // same viewport-center-preserving math so a preset pick doesn't also re-center the canvas.
  const setZoomPercent = useCallback(
    (pct: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = rect.width / 2;
      const py = rect.height / 2;
      setView((v) => {
        const next = clamp(pct / 100, MIN_Z, MAX_Z);
        const k = next / v.z;
        return { z: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    },
    [setView],
  );

  // Same viewport-anchored math as `zoomBy` above, but around an arbitrary screen point (the
  // cursor) instead of always the viewport center — used by the trackpad-pinch/Cmd+wheel zoom
  // gesture below, so the point under the cursor stays fixed while the rest of the canvas scales
  // around it, matching every other pan/zoom-capable canvas app's own convention.
  const zoomAtPoint = useCallback(
    (px: number, py: number, factor: number) => {
      setView((v) => {
        const next = clamp(v.z * factor, MIN_Z, MAX_Z);
        const k = next / v.z;
        return { z: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    },
    [setView],
  );

  // Trackpad/mouse-wheel pan+zoom — a native, non-passive listener (rather than JSX `onWheel`)
  // since `preventDefault` on a wheel event is only reliable off a listener explicitly registered
  // as non-passive; without it the browser's own page-zoom/back-swipe gestures fight this one.
  // Deliberately NOT gated on `tool`/`historyPanelOpen` — every other pan/zoom-capable canvas app
  // treats wheel/trackpad navigation as always-on regardless of the active tool, and History
  // Inspection already keeps zoom/pan live (see the zoom card's doc comment
  // above) since navigating to look at markers is exactly what Inspection is for.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch (browsers report this as a wheel event with `ctrlKey: true` regardless
        // of whether Ctrl is actually held) and an explicit Cmd/Ctrl+wheel both zoom around the
        // cursor — the same gesture, so the same branch handles both.
        const factor = Math.exp(-e.deltaY * 0.01);
        zoomAtPoint(px, py, factor);
      } else if (e.shiftKey) {
        // Shift+wheel pans horizontally — a plain mouse only ever reports its scroll on deltaY,
        // so that's what Shift retargets to the x-axis; a trackpad with Shift held may already
        // report the motion on deltaX itself, so prefer whichever axis actually moved.
        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx }));
      } else {
        // Plain wheel (mouse: vertical only) or a trackpad two-finger scroll (both axes at once).
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAtPoint, setView]);

  // "In focus" emphasis: whichever entity is hovered (falling back to the current Inspect
  // selection when nothing is hovered, e.g. right after Back returns here) — plus whichever
  // entities it's directly related to. Hover rather than click/selection drives this because a
  // click immediately opens Detail, replacing this whole canvas before the emphasis is even
  // visible; hovering is the only gesture that stays on this canvas long enough to see it.
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);
  const highlightId = hoveredEntityId ?? (selection?.kind === "entity" ? selection.id : null);
  const multiSelectedEntityIds = useMemo(() => {
    const ids = new Set<string>();
    suggestionSelection.forEach((key) => {
      const selected = parseSuggestionKey(key);
      if (selected?.kind === "entity") ids.add(selected.id);
    });
    return ids;
  }, [suggestionSelection]);
  const focusedRelationEntityIds = useMemo(() => {
    const ids = new Set<string>();
    const includeEndpoints = (relationId: string) => {
      const relation = relations.find((candidate) => candidate.id === relationId);
      if (!relation) return;
      ids.add(relation.from);
      ids.add(relation.to);
    };
    if (hoveredRelationId) includeEndpoints(hoveredRelationId);
    if (selection?.kind === "relation") includeEndpoints(selection.id);
    suggestionSelection.forEach((key) => {
      const selected = parseSuggestionKey(key);
      if (selected?.kind === "relation") includeEndpoints(selected.id);
    });
    return ids;
  }, [hoveredRelationId, selection, suggestionSelection, relations]);

  // Same "in focus" emphasis, but from the Data Tables entry point instead of Entity types — the
  // basis for what's highlighted just becomes "which entities map to this table" (via
  // `entitiesUsingTable`) rather than "which entities are related to this one" (via `relations`).
  // Takes priority over an entity hover/selection while active, same as an entity hover already
  // takes priority over a stale Inspect selection above.
  const [hoveredTableName, setHoveredTableName] = useState<string | null>(null);

  // Data Tables panel's own compact sort control (see SortDropdown) — Entity Types has no
  // equivalent panel here anymore. Per-panel local search (Entity Type/Property/Relation here,
  // Table/Column in the Data Tables panel below) has been removed in favor of the Header's own
  // Global Search, which covers the exact same object types across the whole Ontology + Data
  // model at once — see `GlobalSearchPalette`/app-state's `searchFocus` doc comments for why
  // keeping both would just be two ways to do the same search.
  const [tableSort, setTableSort] = useState<SortState>(DEFAULT_SORT);

  // Confidence range and Filter now affect Data Tables the same way they already affect Entity
  // Types — de-emphasized, never removed — so every Table always stays in this list; Confidence
  // dims a Table row (via `isTableInScope`) instead of hiding it. Tables have no Confidence or
  // ReviewStatus of their own — `isTableInScope`/`tableHighestMappingConfidence` derive both from
  // whichever Property↔Column Mapping(s) touch the table instead (see their own doc comments).
  const sortedTables = useMemo(
    () =>
      sortByState(
        tables,
        tableSort,
        (t) => t.name,
        (t) => tableHighestMappingConfidence(t.name, entities),
      ),
    [tables, tableSort, entities],
  );
  // Global Search's connected context (see app-state's own `searchFocus`/`selectSearchResult` doc
  // comments) — null whenever no search result is currently focused. `primaryEntityId` is the one
  // entity `focusEntity`/`focusRelation` below actually centers the camera on; `connectedEntityIds`
  // is that entity plus everything "reveal connected context" calls for (an Entity result's direct
  // relation-neighbors; a Property result's own owning Entity; both endpoints of a Relation result;
  // every Entity mapped to a Table/Column result); `tableNames` is which Data Table row(s) to
  // scroll to and highlight in the panel on the right.
  const searchContext = useMemo(() => {
    if (!searchFocus) return null;
    const connectedEntityIds = new Set<string>();
    const tableNames = new Set<string>();
    let primaryEntityId: string | undefined;

    if (searchFocus.kind === "entity") {
      const entity = entities.find((e) => e.id === searchFocus.id);
      if (!entity) return null;
      primaryEntityId = entity.id;
      connectedEntityIds.add(entity.id);
      relations.forEach((r) => {
        if (r.from === entity.id) connectedEntityIds.add(r.to);
        if (r.to === entity.id) connectedEntityIds.add(r.from);
      });
      tablesUsedByEntity(entity).forEach((t) => tableNames.add(t));
    } else if (searchFocus.kind === "property") {
      const entity = entities.find((e) => e.id === searchFocus.entityId);
      if (!entity) return null;
      primaryEntityId = entity.id;
      connectedEntityIds.add(entity.id);
      const property = entity.properties.find((p) => p.id === searchFocus.propertyId);
      property?.mappings.forEach((m) => tableNames.add(m.table));
    } else if (searchFocus.kind === "relation") {
      const relation = relations.find((r) => r.id === searchFocus.id);
      if (!relation) return null;
      primaryEntityId = relation.from;
      connectedEntityIds.add(relation.from);
      connectedEntityIds.add(relation.to);
    } else if (searchFocus.kind === "table") {
      tableNames.add(searchFocus.name);
      entitiesUsingTable(searchFocus.name, entities).forEach((e) => {
        connectedEntityIds.add(e.id);
        primaryEntityId ??= e.id;
      });
    } else {
      tableNames.add(searchFocus.table);
      const column = tableColumnUsage(searchFocus.table, entities).find(
        (c) => c.name === searchFocus.column,
      );
      column?.mappedBy.forEach((m) => {
        connectedEntityIds.add(m.entityId);
        primaryEntityId ??= m.entityId;
      });
    }

    return { primaryEntityId, connectedEntityIds, tableNames };
  }, [searchFocus, entities, relations]);

  // A hovered table's own "neighbors" are just every entity mapped to it — there's no further
  // "related" tier the way an entity's relation-neighbors form one, so this only ever produces
  // "active" or "muted", never "related". Takes priority over `highlightId` (the entity-hover
  // basis) whenever a table is actively hovered — Global Search's own connected context takes top
  // priority over BOTH, the same way a deliberate search should outrank incidental mouse hover.
  const activeEntityIds = useMemo(() => {
    if (searchContext) {
      return searchContext.primaryEntityId
        ? new Set([searchContext.primaryEntityId])
        : new Set(searchContext.connectedEntityIds);
    }
    if (hoveredTableName)
      return new Set(entitiesUsingTable(hoveredTableName, entities).map((e) => e.id));
    if (highlightId) return new Set([highlightId]);
    return null;
  }, [searchContext, hoveredTableName, highlightId, entities]);
  const entityNeighborhoodActive = !!highlightId && !hoveredTableName && !searchContext;
  // The hovered / selected Entity Type's datasets, for the Data tables panel: Mapped once any of
  // its mappings there is accepted, else Suggested.
  const focusedEntityTables = useMemo(() => {
    const map = new Map<string, "mapped" | "suggested">();
    if (!entityNeighborhoodActive) return map;
    const entity = entities.find((e) => e.id === highlightId);
    entity?.properties.forEach((p) =>
      p.mappings.forEach((m) => {
        if (mappingStatus(m) === "mapped") map.set(m.table, "mapped");
        else if (!map.has(m.table)) map.set(m.table, "suggested");
      }),
    );
    return map;
  }, [entityNeighborhoodActive, highlightId, entities]);

  const neighborIds = useMemo(() => {
    if (searchContext) {
      const set = new Set(searchContext.connectedEntityIds);
      if (searchContext.primaryEntityId) set.delete(searchContext.primaryEntityId);
      return set;
    }
    if (!highlightId || hoveredTableName) return null;
    const set = new Set<string>();
    relations.forEach((r) => {
      if (r.from === highlightId) set.add(r.to);
      if (r.to === highlightId) set.add(r.from);
    });
    return set;
  }, [searchContext, highlightId, relations, hoveredTableName]);

  // Far-zoom labels are intentionally deterministic rather than collision-driven: retain the
  // graph's eight highest-degree hubs, then add every currently hovered/selected Entity and each
  // one's direct neighbors. Entity order is the stable tie-breaker for equal-degree hubs.
  const farZoomEntityLabelIds = useMemo(() => {
    const degree = new Map(entities.map((entity) => [entity.id, 0]));
    relations.forEach((relation) => {
      degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1);
      if (relation.to !== relation.from)
        degree.set(relation.to, (degree.get(relation.to) ?? 0) + 1);
    });

    const visible = new Set(
      entities
        .map((entity, index) => ({ id: entity.id, index, degree: degree.get(entity.id) ?? 0 }))
        .sort((a, b) => b.degree - a.degree || a.index - b.index)
        .slice(0, Math.min(LOD_LABEL_TOP_N, entities.length))
        .map(({ id }) => id),
    );

    const focused = new Set(multiSelectedEntityIds);
    if (hoveredEntityId) focused.add(hoveredEntityId);
    if (selection?.kind === "entity") focused.add(selection.id);
    focused.forEach((id) => visible.add(id));
    relations.forEach((relation) => {
      if (focused.has(relation.from)) visible.add(relation.to);
      if (focused.has(relation.to)) visible.add(relation.from);
    });
    return visible;
  }, [entities, relations, hoveredEntityId, selection, multiSelectedEntityIds]);

  // Each Relation's connector geometry, computed once per render and shared by the SVG path, the
  // Relation pill's position, and focusRelation's camera-centering below — so the line, the pill
  // sitting on it, and "pan to here" all agree on exactly the same curve.
  const labelsAtZoom = !LOD_SPARSE_LABELS.has(lod);
  const showNodeLabel = (id: string) => labelsAtZoom || farZoomEntityLabelIds.has(id);
  // While a connection dot is hovered, nodes near its new-node spot move aside to make room (like
  // the editor's new-relation pill), and settle back when the pointer leaves.
  const makeWay = useMemo(() => {
    const offsets = new Map<string, Pt>();
    if (!handleHover || connectDrag) return offsets;
    const source = layoutEntities.find((e) => e.id === handleHover.entityId);
    if (!source) return offsets;
    const spot = ghostCenter(source, handleHover.side, footprintById.get(source.id));
    const ROOM = cardMode ? 190 : 130;
    layoutEntities.forEach((e) => {
      if (e.id === source.id) return;
      const c = ontologyNodeCenter(e);
      const dx = c.x - spot.x;
      const dy = c.y - spot.y;
      const d = Math.hypot(dx, dy);
      if (d >= ROOM) return;
      const ux = d > 0.5 ? dx / d : -SIDE_DIR[handleHover.side].y;
      const uy = d > 0.5 ? dy / d : SIDE_DIR[handleHover.side].x;
      offsets.set(e.id, { x: ux * (ROOM - d), y: uy * (ROOM - d) });
    });
    return offsets;
  }, [handleHover, connectDrag, layoutEntities, footprintById, cardMode]);
  // Positions as drawn: the layout, with any nodes moved aside. Lines are routed from these, so
  // they move together with their nodes.
  const routedEntities = useMemo(
    () =>
      makeWay.size === 0
        ? layoutEntities
        : layoutEntities.map((e) => {
            const o = makeWay.get(e.id);
            return o ? { ...e, x: e.x + o.x, y: e.y + o.y } : e;
          }),
    [layoutEntities, makeWay],
  );
  const relationGeometry = useMemo(() => {
    const centerOf = new Map<string, Pt>();
    routedEntities.forEach((e) => centerOf.set(e.id, ontologyNodeCenter(e)));

    // Each endpoint starts at the exact center-to-center bearing toward the other Entity. Only
    // bearings within the same narrow angular bucket share a fan group; this prevents stacked
    // connectors at hubs while retaining their original radial direction around the full circle.
    type PendingEnd = { key: string; nodeId: string; angle: number; bucket: number };
    const endKey = (relationId: string, role: "from" | "to") => `${relationId}|${role}`;
    const pendingByKey = new Map<string, PendingEnd>();
    const groups = new Map<string, string[]>();
    relations.forEach((r) => {
      const ca = centerOf.get(r.from);
      const cb = centerOf.get(r.to);
      if (!ca || !cb) return;
      const selfRelation = r.from === r.to;
      const ends: { role: "from" | "to"; nodeId: string; angle: number }[] = [
        {
          role: "from",
          nodeId: r.from,
          angle: selfRelation ? -Math.PI * 0.65 : Math.atan2(cb.y - ca.y, cb.x - ca.x),
        },
        {
          role: "to",
          nodeId: r.to,
          angle: selfRelation ? -Math.PI * 0.35 : Math.atan2(ca.y - cb.y, ca.x - cb.x),
        },
      ];
      ends.forEach(({ role, nodeId, angle }) => {
        const key = endKey(r.id, role);
        const normalizedAngle = (angle + Math.PI * 2) % (Math.PI * 2) || 0;
        const bucket = Math.floor(normalizedAngle / RADIAL_FAN_BUCKET);
        pendingByKey.set(key, { key, nodeId, angle, bucket });
        const groupKey = `${nodeId}|${bucket}`;
        groups.set(groupKey, [...(groups.get(groupKey) ?? []), key]);
      });
    });
    groups.forEach((keys) =>
      keys.sort((ka, kb) => pendingByKey.get(ka)!.angle - pendingByKey.get(kb)!.angle),
    );

    const resolveEnd = (relationId: string, role: "from" | "to"): EdgeEnd | null => {
      const pending = pendingByKey.get(endKey(relationId, role));
      if (!pending) return null;
      const group = groups.get(`${pending.nodeId}|${pending.bucket}`)!;
      return {
        center: centerOf.get(pending.nodeId)!,
        angle: pending.angle,
        fanIndex: group.indexOf(pending.key),
        fanCount: group.length,
        footprint: footprintById.get(pending.nodeId) ?? FALLBACK_FOOTPRINT,
      };
    };

    // Relations sharing the same two nodes (either direction) fan apart, 22px from each other.
    const PAIR_GAP = 22;
    const byPair = new Map<string, string[]>();
    relations.forEach((r) => {
      if (r.from === r.to) return;
      const key = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      byPair.set(key, [...(byPair.get(key) ?? []), r.id]);
    });
    const pairOffsetOf = new Map<string, number>();
    byPair.forEach((ids) => {
      if (ids.length < 2) return;
      ids.forEach((id, i) => pairOffsetOf.set(id, (i - (ids.length - 1) / 2) * PAIR_GAP));
    });

    const map = new Map<string, { d: string; mid: Pt; p1: Pt; p2: Pt }>();
    relations.forEach((r) => {
      const fromEnd = resolveEnd(r.id, "from");
      const toEnd = resolveEnd(r.id, "to");
      if (!fromEnd || !toEnd) return;
      map.set(
        r.id,
        graphEdgePath(
          fromEnd,
          toEnd,
          routedEntities,
          [r.from, r.to],
          footprintById,
          pairOffsetOf.get(r.id) ?? 0,
          r.from > r.to,
        ),
      );
    });
    return map;
  }, [relations, routedEntities, footprintById]);

  // Zoomed-out edge bundling: instead of drawing every Relation as its own thin connector (which,
  // zoomed out, just reads as visual clutter — or worse, several stacked lines that LOOK like one),
  // group connectors that are effectively "the same line" into a single thicker one. Two things
  // bundle together: (1) any two Relations between the exact same pair of Entities (different
  // Relation types on the same edge — those always merge, unconditionally), and (2) Relations
  // between DIFFERENT pairs whose connectors run close together and nearly parallel for a real
  // stretch of their length (a lightweight approximation of force-directed edge bundling — compare
  // each connector's straight start-to-end chord rather than its curved path, since the chord is
  // what "runs alongside" actually means visually). Only used while `farRelationZoom` is active —
  // see the render site below; zoomed in, every Relation still draws (and remains hoverable/
  // selectable) individually, unaffected by any of this.
  const BUNDLE_ANGLE_THRESHOLD = (14 * Math.PI) / 180;
  const BUNDLE_PERP_THRESHOLD = 16;
  const BUNDLE_MIN_OVERLAP_FRACTION = 0.35;
  const relationBundles = useMemo(() => {
    const ids = relations.map((r) => r.id).filter((id) => relationGeometry.has(id));
    const parent = new Map<string, string>(ids.map((id) => [id, id]));
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      while (parent.get(x) !== root) {
        const next = parent.get(x)!;
        parent.set(x, root);
        x = next;
      }
      return root;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    // Any two Relations sharing the same unordered Entity pair always bundle.
    const byPair = new Map<string, string[]>();
    relations.forEach((r) => {
      if (!relationGeometry.has(r.id)) return;
      const key = [r.from, r.to].sort().join("|");
      byPair.set(key, [...(byPair.get(key) ?? []), r.id]);
    });
    byPair.forEach((memberIds) => {
      for (let i = 1; i < memberIds.length; i++) union(memberIds[0]!, memberIds[i]!);
    });

    // Different-pair Relations whose chords run close together and roughly parallel bundle too.
    const angleOf = (p1: Pt, p2: Pt) => Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angleDiff = (a: number, b: number) => {
      const d = Math.abs(a - b) % Math.PI;
      return Math.min(d, Math.PI - d);
    };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idA = ids[i]!;
        const idB = ids[j]!;
        if (find(idA) === find(idB)) continue;
        const a = relationGeometry.get(idA)!;
        const b = relationGeometry.get(idB)!;
        const angA = angleOf(a.p1, a.p2);
        const angB = angleOf(b.p1, b.p2);
        if (angleDiff(angA, angB) > BUNDLE_ANGLE_THRESHOLD) continue;
        const dirA = { x: Math.cos(angA), y: Math.sin(angA) };
        let bp1 = b.p1;
        let bp2 = b.p2;
        const rawDirBx = bp2.x - bp1.x;
        const rawDirBy = bp2.y - bp1.y;
        if (dirA.x * rawDirBx + dirA.y * rawDirBy < 0) {
          const tmp = bp1;
          bp1 = bp2;
          bp2 = tmp;
        }
        const nx = -dirA.y;
        const ny = dirA.x;
        const midB = { x: (bp1.x + bp2.x) / 2, y: (bp1.y + bp2.y) / 2 };
        const perp = Math.abs((midB.x - a.p1.x) * nx + (midB.y - a.p1.y) * ny);
        if (perp > BUNDLE_PERP_THRESHOLD) continue;
        const lenA = Math.hypot(a.p2.x - a.p1.x, a.p2.y - a.p1.y) || 1;
        const proj = (p: Pt) => (p.x - a.p1.x) * dirA.x + (p.y - a.p1.y) * dirA.y;
        const projB1 = proj(bp1);
        const projB2 = proj(bp2);
        const overlapStart = Math.max(0, Math.min(projB1, projB2));
        const overlapEnd = Math.min(lenA, Math.max(projB1, projB2));
        const overlapLen = Math.max(0, overlapEnd - overlapStart);
        const shorterLen = Math.min(lenA, Math.abs(projB2 - projB1) || 1);
        if (overlapLen / shorterLen < BUNDLE_MIN_OVERLAP_FRACTION) continue;
        union(idA, idB);
      }
    }

    const groups = new Map<string, string[]>();
    ids.forEach((id) => {
      const root = find(id);
      groups.set(root, [...(groups.get(root) ?? []), id]);
    });

    const bundles = new Map<string, { memberIds: string[]; d: string; mid: Pt; count: number }>();
    groups.forEach((memberIds, root) => {
      if (memberIds.length === 1) {
        const geo = relationGeometry.get(memberIds[0]!)!;
        bundles.set(root, { memberIds, d: geo.d, mid: geo.mid, count: 1 });
        return;
      }
      // The union's own chord: the two member endpoints furthest apart along the group's shared
      // direction — spans the full extent of the bundle rather than any one member's own length.
      const first = relationGeometry.get(memberIds[0]!)!;
      const firstDx = first.p2.x - first.p1.x;
      const firstDy = first.p2.y - first.p1.y;
      let dirSumX = 0;
      let dirSumY = 0;
      memberIds.forEach((id) => {
        const g = relationGeometry.get(id)!;
        let dx = g.p2.x - g.p1.x;
        let dy = g.p2.y - g.p1.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        if (dx * firstDx + dy * firstDy < 0) {
          dx = -dx;
          dy = -dy;
        }
        dirSumX += dx;
        dirSumY += dy;
      });
      const dirLen = Math.hypot(dirSumX, dirSumY) || 1;
      const dir = { x: dirSumX / dirLen, y: dirSumY / dirLen };
      const origin = first.p1;
      let minProj = Infinity;
      let maxProj = -Infinity;
      let minPt = origin;
      let maxPt = origin;
      memberIds.forEach((id) => {
        const g = relationGeometry.get(id)!;
        [g.p1, g.p2].forEach((p) => {
          const projection = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
          if (projection < minProj) {
            minProj = projection;
            minPt = p;
          }
          if (projection > maxProj) {
            maxProj = projection;
            maxPt = p;
          }
        });
      });
      bundles.set(root, {
        memberIds,
        d: `M ${minPt.x} ${minPt.y} L ${maxPt.x} ${maxPt.y}`,
        mid: { x: (minPt.x + maxPt.x) / 2, y: (minPt.y + maxPt.y) / 2 },
        count: memberIds.length,
      });
    });

    return bundles;
  }, [relations, relationGeometry]);

  // Shared per-Relation visual state (hover/selection emphasis, search/entity focus, out-of-scope
  // muting) — used both by the normal per-Relation connector render and, zoomed out, to decide how
  // a whole bundle should read (emphasized/focused if ANY member is, muted only if EVERY member is
  // — see the bundle render site below).
  const getRelationVisualState = useCallback(
    (r: (typeof relations)[number]) => {
      const isSelected =
        (selection?.kind === "relation" && selection.id === r.id) ||
        suggestionSelection.has(suggestionKey({ kind: "relation", id: r.id }));
      const isHovered = hoveredRelationId === r.id;
      const isZoomEmphasized = isSelected || isHovered;
      const bothSearchConnected = searchContext
        ? searchContext.connectedEntityIds.has(r.from) && searchContext.connectedEntityIds.has(r.to)
        : false;
      const isFocusEdge =
        suggestionSelection.size > 0
          ? false
          : searchContext
            ? bothSearchConnected
            : activeEntityIds && !hoveredTableName
              ? activeEntityIds.has(r.from) || activeEntityIds.has(r.to)
              : false;
      const outOfScope =
        !bothSearchConnected &&
        !isReviewItemInScope(relationReview(r), r.confidence, confidenceRange, statusFilter);
      const isMuted =
        outOfScope || (activeEntityIds !== null && !isFocusEdge && !entityNeighborhoodActive);
      // Hovering / selecting an Entity Type shows only its own relations.
      const isHidden = entityNeighborhoodActive && !isFocusEdge && !isZoomEmphasized;
      return { isZoomEmphasized, isFocusEdge, isMuted, isHidden };
    },
    [
      selection,
      suggestionSelection,
      hoveredRelationId,
      searchContext,
      activeEntityIds,
      hoveredTableName,
      confidenceRange,
      statusFilter,
      entityNeighborhoodActive,
    ],
  );

  // Resolves any of the History/Search `ref` kinds this canvas can actually place to a world-space
  // point — shared by the numbered inspection markers and the post-restore highlight below. A
  // Property/Column ref has no node of its own on this canvas, so it resolves to the owning
  // Entity's node instead, the same "closest thing that IS shown here" fallback `searchContext`
  // above already uses for Property results. A ref this canvas simply can't place (e.g. one whose
  // object was deleted, or a Trash-only object with no node here at all) resolves to `undefined`
  // and is silently skipped, never shown floating at (0,0).
  const centerOfMap = useMemo(() => {
    const map = new Map<string, Pt>();
    layoutEntities.forEach((e) => map.set(e.id, ontologyNodeCenter(e)));
    return map;
  }, [layoutEntities]);
  const pointForRef = useCallback(
    (ref: SearchResultRef): Pt | undefined => {
      if (ref.kind === "entity") return centerOfMap.get(ref.id);
      if (ref.kind === "property") return centerOfMap.get(ref.entityId);
      if (ref.kind === "relation") return relationGeometry.get(ref.id)?.mid;
      return undefined;
    },
    [centerOfMap, relationGeometry],
  );

  // History Inspection Mode's own numbered ①②③... markers (see app-state's own
  // `HistoryInspection` doc comment) — one per change that has a `ref` this canvas can place,
  // without filtering out anything else on the canvas (preserve context, never hide). Each marker
  // doubles as the same select/deselect control as its matching row in the History panel — see
  // the marker's own click handler below.
  const historyMarkers = useMemo(() => {
    if (!historyInspection) return [];
    // One marker per numbered group (an Entity Type with its Properties, or a Relation) — the
    // same number its row has in the History panel.
    const markers: {
      number: number;
      x: number;
      y: number;
      restorable: boolean;
      selected: boolean;
    }[] = [];
    const seen = new Set<number>();
    historyInspection.changes.forEach((c) => {
      if (seen.has(c.group)) return;
      const ref = c.groupRef ?? c.ref;
      if (!ref) return;
      const pt = pointForRef(ref);
      if (!pt) return;
      seen.add(c.group);
      const members = historyInspection.changes.filter((m) => m.group === c.group);
      const restorable = members.filter((m) => m.restorable);
      // Offset to the node's own top-right corner rather than dead center — a marker sitting
      // exactly on top of the node would be camouflaged against it; a Relation marker (already
      // its own free-floating midpoint on the edge) needs no such offset.
      const markerFp = ref.kind === "entity" ? footprintById.get(ref.id) : undefined;
      const badgeX = ref.kind === "relation" ? 0 : (markerFp?.w ?? ONTOLOGY_NODE_SIZE) / 2;
      const badgeY = ref.kind === "relation" ? 0 : (markerFp?.h ?? ONTOLOGY_NODE_SIZE) / 2;
      markers.push({
        number: c.group,
        x: pt.x + badgeX,
        y: pt.y - badgeY,
        restorable: restorable.length > 0,
        selected:
          restorable.length > 0 &&
          restorable.every((m) => historyInspection.selected.has(m.number)),
      });
    });
    return markers;
  }, [historyInspection, pointForRef, footprintById]);

  // Every Entity Type touched by the event currently being inspected — used only to give those
  // nodes a brief "active" emphasis (see `emphasisFor` below) so they stand out from the rest of
  // the (still fully visible, never hidden) canvas while inspecting.
  const historyInspectionEntityIds = useMemo(() => {
    if (!historyInspection) return null;
    const ids = new Set<string>();
    historyInspection.changes.forEach((c) => {
      const changeRef = c.ref;
      if (!changeRef) return;
      if (changeRef.kind === "entity") ids.add(changeRef.id);
      else if (changeRef.kind === "property") ids.add(changeRef.entityId);
      else if (changeRef.kind === "relation") {
        const r = relations.find((x) => x.id === changeRef.id);
        if (r) {
          ids.add(r.from);
          ids.add(r.to);
        }
      }
    });
    return ids;
  }, [historyInspection, relations]);

  // The brief post-restore "this just came back" glow (see app-state's own
  // `historyRestoreHighlight` doc comment) — resolved to canvas points the exact same way the
  // inspection markers above are.
  const restoreHighlightMarkers = useMemo(() => {
    return historyRestoreHighlight.map((ref) => pointForRef(ref)).filter((pt): pt is Pt => !!pt);
  }, [historyRestoreHighlight, pointForRef]);

  // Overlays a patch change's own "before" value on top of Current Ontology's Entity name/
  // description — the only two fields this canvas actually renders text for — so the canvas can
  // show what the ontology looked like at the inspected point without a second, parallel copy of
  // the whole graph (see this feature's own spec on reconstructing "just enough" historical
  // state). Only ever cosmetic: nothing here touches `entities` itself, and it's read fresh from
  // `historyInspection.changes` every time, so it can never drift from what the panel shows for
  // the exact same event.
  const historyValueOverrides = useMemo(() => {
    if (!historyInspection) return null;
    const map = new Map<string, { name?: string; description?: string }>();
    historyInspection.changes.forEach((c) => {
      if (c.restore?.kind !== "entityPatch") return;
      const existing = map.get(c.restore.id) ?? {};
      if (c.restore.before.name !== undefined) existing.name = c.restore.before.name;
      if (c.restore.before.description !== undefined) {
        existing.description = c.restore.before.description;
      }
      map.set(c.restore.id, existing);
    });
    return map;
  }, [historyInspection]);

  const displayEntities = useMemo(() => {
    if (!historyValueOverrides || historyValueOverrides.size === 0) return layoutEntities;
    return layoutEntities.map((e) => {
      const override = historyValueOverrides.get(e.id);
      return override ? { ...e, ...override } : e;
    });
  }, [layoutEntities, historyValueOverrides]);
  drawnPositionsRef.current = new Map(displayEntities.map((e) => [e.id, { x: e.x, y: e.y }]));

  // Pans/centers on the first placeable change the moment a NEW History Inspection starts (never
  // re-fires on a later selection/hover change within the same inspection) — the same "camera
  // moves, nothing about the graph itself does" mechanism `focusEntity`/`focusRelation` already
  // are, just triggered by entering Inspection Mode instead of a Search result.
  const lastPannedInspectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!historyInspection) {
      lastPannedInspectionRef.current = null;
      return;
    }
    if (lastPannedInspectionRef.current === historyInspection.entryId) return;
    lastPannedInspectionRef.current = historyInspection.entryId;
    const primaryRef = historyInspection.changes.find((c) => c.ref)?.ref;
    if (!primaryRef) return;
    const pt = pointForRef(primaryRef);
    const el = ref.current;
    if (!pt || !el) return;
    const rect = el.getBoundingClientRect();
    setView((v) => ({ ...v, x: rect.width / 2 - pt.x * v.z, y: rect.height / 2 - pt.y * v.z }));
  }, [historyInspection, pointForRef, setView]);

  const emphasisFor = (entityId: string) => {
    // History Inspection Mode takes over emphasis entirely while it's active: every Entity Type
    // the inspected event actually touched gets a brief "active" ring, everything else gets the
    // same "dim, never hide" treatment the app already uses for Confidence/Filter scope — nothing
    // is removed from the canvas, so the rest of the graph stays there for context.
    if (historyInspectionEntityIds) {
      return historyInspectionEntityIds.has(entityId) ? ("active" as const) : ("muted" as const);
    }
    if (focusedRelationEntityIds.has(entityId)) return "related" as const;
    // Direct Entity hover/selection is a local emphasis layer, not a graph filter. Its subject and
    // neighbors receive rings; every other Entity keeps its normal context and is never muted by
    // this interaction alone.
    if (entityNeighborhoodActive) {
      if (activeEntityIds?.has(entityId)) return "active" as const;
      if (neighborIds?.has(entityId)) return "related" as const;
      return "muted" as const;
    }
    const entity = entities.find((e) => e.id === entityId);
    // Global Search's connected context is exempt from Confidence/Filter muting entirely — Search
    // "may temporarily reveal/focus relevant context even if that context is currently
    // de-emphasized by the active view" (see app-state's own `searchFocus` doc comment), which is
    // a different question from either one: Search never changes what's IN Confidence range or
    // Filter's own statuses, it just temporarily overrides their VISUAL muting for what it found.
    const searchConnected = searchContext?.connectedEntityIds.has(entityId) ?? false;
    if (
      !searchConnected &&
      entity &&
      !isReviewItemInScope(entityReview(entity), entity.confidence, confidenceRange, statusFilter)
    ) {
      return "muted" as const;
    }
    if (suggestionSelection.size > 0)
      return multiSelectedEntityIds.has(entityId) ? ("active" as const) : ("normal" as const);
    if (!activeEntityIds) return "normal" as const;
    if (activeEntityIds.has(entityId)) return "active" as const;
    if (neighborIds?.has(entityId)) return "related" as const;
    if (entityNeighborhoodActive) return "normal" as const;
    return "muted" as const;
  };

  // Relations have no Detail view of their own (see app-state's DetailAnchor), so an Ontology
  // search Relation result can't "navigate" the way an Entity/Property result does — it can only
  // select it (the same Inspect selection a canvas click already produces) and bring it into view
  // by re-centering the pan, without ever changing zoom or rearranging any node's own position.
  const focusRelation = useCallback(
    (relationId: string) => {
      const el = ref.current;
      const mid = relationGeometry.get(relationId)?.mid;
      if (mid && el) {
        const rect = el.getBoundingClientRect();
        setView((v) => ({
          ...v,
          x: rect.width / 2 - mid.x * v.z,
          y: rect.height / 2 - mid.y * v.z,
        }));
      }
      select({ kind: "relation", id: relationId });
    },
    [relationGeometry, setView, select],
  );

  // An Entity result from the on-demand ontology search stays on Overview (unlike a Property
  // result, which navigates into that Property's parent Entity's Detail view) — it only pans the
  // view to bring that Entity into frame and selects it, the same "camera moves, nothing about
  // the graph itself does" rule as focusRelation above. Selecting it also drives `highlightId`
  // (see above), which is what actually renders the "visually highlight it" requirement.
  const focusEntity = useCallback(
    (entityId: string) => {
      const entity = layoutEntities.find((e) => e.id === entityId);
      const el = ref.current;
      if (entity && el) {
        const center = ontologyNodeCenter(entity);
        const rect = el.getBoundingClientRect();
        setView((v) => ({
          ...v,
          x: rect.width / 2 - center.x * v.z,
          y: rect.height / 2 - center.y * v.z,
        }));
      }
      select({ kind: "entity", id: entityId });
    },
    [layoutEntities, setView, select],
  );

  // Where each Data Tables panel row actually sits in the DOM, keyed by table name — populated by
  // a callback ref on every row below, purely so the effect right after this can scroll the right
  // one into view when Global Search focuses a Table/Column/Property result. Never read for
  // anything else (the visual highlight itself is a plain className check against
  // `searchContext.tableNames`, not this map).
  const tableRowRefs = useRef(new Map<string, HTMLDivElement>());

  // Reacts to a NEW Global Search selection by panning the canvas to it (same camera-move-only
  // mechanism `focusEntity`/`focusRelation` already are) and scrolling the Data Tables panel to
  // whichever table it's connected to — "reveal connected context", not just locate an isolated
  // object (see app-state's `selectSearchResult` doc comment). Guarded on the `searchFocus`
  // reference itself (not `searchContext`, which is also a function of `entities`/`relations` and
  // would otherwise re-fire this on every unrelated edit while a focus is still active) so this
  // only runs once per actual selection, never as a side effect of editing the ontology elsewhere.
  const lastPannedSearchFocusRef = useRef<typeof searchFocus>(null);
  useEffect(() => {
    if (searchFocus === lastPannedSearchFocusRef.current) return;
    lastPannedSearchFocusRef.current = searchFocus;
    if (!searchFocus) return;
    if (searchFocus.kind === "relation") {
      focusRelation(searchFocus.id);
    } else if (searchContext?.primaryEntityId) {
      focusEntity(searchContext.primaryEntityId);
    }
    const tableName = searchContext?.tableNames.values().next().value;
    if (tableName) {
      setTablePanelOpen(true);
      requestAnimationFrame(() => {
        tableRowRefs.current
          .get(tableName)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }, [searchFocus, searchContext, focusRelation, focusEntity]);

  // A short human label for the "Search focus: …" chip below — same per-kind formatting the
  // search palette's own result rows use ("Parent → child" for a Property/Column), just resolved
  // straight from the ref instead of from a fresh `searchOntologyAndData` query.
  const searchFocusLabel = useMemo(() => {
    if (!searchFocus) return null;
    if (searchFocus.kind === "entity") {
      return entities.find((e) => e.id === searchFocus.id)?.name || "Untitled entity";
    }
    if (searchFocus.kind === "property") {
      const entity = entities.find((e) => e.id === searchFocus.entityId);
      const property = entity?.properties.find((p) => p.id === searchFocus.propertyId);
      return entity && property ? `${entity.name} → ${property.name}` : "Property";
    }
    if (searchFocus.kind === "relation") {
      const relation = relations.find((r) => r.id === searchFocus.id);
      return relation ? relationLabel(relation) : "Relation";
    }
    if (searchFocus.kind === "table") return searchFocus.name;
    return `${searchFocus.table} → ${searchFocus.column}`;
  }, [searchFocus, entities, relations]);

  // Escape is one of Global Search's own "exit this focus state" gestures (see app-state's
  // `searchFocus` doc comment) — the palette's own input already stops an Escape it handles itself
  // from bubbling here (closing the palette without necessarily clearing an already-committed
  // focus), so this only ever fires once the palette isn't the one consuming the key.
  useEffect(() => {
    if (!searchFocus) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSearchFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchFocus, clearSearchFocus]);

  // Creating an Entity Type from the Ontology header (there's no side panel to hold it in
  // anymore) places it at the current viewport's own center in world space, so it's immediately
  // visible without the user having to go find it — rather than app-state's own default (0, 0),
  // which Detail's panel-based creation deliberately keeps (there, the user places it themselves
  // via drag, so it's fine for it to start off-canvas).
  const handleCreateEntity = useCallback(
    (name: string) => {
      const el = ref.current;
      if (!el) {
        createEntity(name);
        return;
      }
      const rect = el.getBoundingClientRect();
      const center = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      createEntity(name, center);
    },
    [createEntity, toWorld],
  );

  const creationSourceEntity = creationRequest?.source
    ? (entities.find((e) => e.id === creationRequest.source!.entityId) ?? null)
    : null;

  const handleCreationCancel = useCallback(() => setCreationRequest(null), []);
  const handleCreationSubmit = useCallback(
    (draft: {
      name: string;
      properties: { name: string; type: string; isIdentifier?: boolean }[];
      relationName: string;
      direction: "fromSource" | "toSource";
    }) => {
      if (!creationRequest) return;
      createEntityWithProperties({
        name: draft.name,
        position: wrapperOriginForCenter(creationRequest.centerPosition),
        properties: draft.properties,
        connection: creationRequest.source
          ? {
              sourceEntityId: creationRequest.source.entityId,
              relationName: draft.relationName,
              direction: draft.direction,
            }
          : undefined,
      });
      setCreationRequest(null);
    },
    [creationRequest, createEntityWithProperties],
  );

  return (
    <div className="flex h-full w-full">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-node">
        {SHOW_CREATE_ENTITY_TOOLBAR && (
          <div className="flex shrink-0 items-center justify-end border-b border-node-border px-4 py-2">
            <div className="flex shrink-0 items-center gap-1">
              <CreateEntityButton onCreate={handleCreateEntity} />
            </div>
          </div>
        )}

        {/* Global Search's own "clear this focus state" affordance — the most discoverable of the
            several ways to exit it (see app-state's `searchFocus` doc comment for the others:
            Escape, clearing the search, picking a new result, clicking empty canvas). Floats over
            the canvas the same way the old local search popover used to, just as a dismissible
            pill instead of a whole panel. Hidden during History Mode, whose own docked panel
            (`HistoryPanel`) and striped canvas background already say "you are here" without a
            second floating indicator competing for the same space.
            Temporarily disabled (`SHOW_SEARCH_FOCUS_PILL`) — the rest of `searchFocus`'s behavior
            (pan-to-target, dimming unrelated content, Escape/clear-search/new-result dismissal) is
            unchanged; only this visible pill is suppressed for now. */}
        {SHOW_SEARCH_FOCUS_PILL && searchFocus && !historyPanelOpen && (
          <div className="absolute right-4 top-[52px] z-30 flex max-w-[calc(100%-32px)] items-center gap-1.5 rounded-full border border-[#00ded8]/30 bg-white px-3 py-1.5 text-[12px] font-medium text-[#00ded8] shadow-[var(--shadow-node)]">
            <SearchIcon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">Search focus: {searchFocusLabel}</span>
            <button
              type="button"
              onClick={clearSearchFocus}
              aria-label="Clear search focus"
              className="flex size-4 shrink-0 items-center justify-center rounded-full text-[#00ded8] hover:bg-[#00ded8]/10"
            >
              <X className="size-3" />
            </button>
          </div>
        )}

        <div
          ref={ref}
          className={cn(
            "relative min-h-0 flex-1 select-none overflow-hidden",
            historyPanelOpen ? "canvas-grid-history" : "canvas-grid",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="absolute origin-top-left"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          >
            <svg className="pointer-events-none absolute overflow-visible" width={1} height={1}>
              <defs>
                {/* Arrowhead for relation lines — always visible, pointing at the relation's
                    actual `to` entity (since `graphEdgePath` always returns p2 on the `to`
                    side). `context-stroke` picks up whatever color the referencing path is
                    currently drawn in (muted/normal/selected), so the arrow always matches its
                    own line rather than needing a separate state. */}
                <marker
                  id="relation-arrow"
                  viewBox="0 0 7.5 8.66"
                  refX={7.5}
                  refY={4.33}
                  markerWidth={7.5}
                  markerHeight={8.66}
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  {/* Figma Line cap (362:222575): a filled triangle in the line's own color. */}
                  <path d="M0 0 L7.5 4.33 L0 8.66 Z" fill="context-stroke" stroke="none" />
                </marker>
              </defs>
              {farRelationZoom
                ? Array.from(relationBundles.entries()).map(([bundleId, bundle]) => {
                    const members = bundle.memberIds
                      .map((id) => relations.find((r) => r.id === id))
                      .filter((r): r is (typeof relations)[number] => !!r);
                    if (members.length === 0) return null;
                    const states = members.map(getRelationVisualState);
                    // A bundle reads as emphasized/focused the moment ANY member does (so hovering
                    // or search-focusing one of several bundled Relations still lights up the
                    // shared line), but only mutes once EVERY member is out of scope — otherwise an
                    // in-scope Relation bundled with an out-of-scope one would fade along with it.
                    const isZoomEmphasized = states.some((s) => s.isZoomEmphasized);
                    const isFocusEdge = states.some((s) => s.isFocusEdge);
                    const isMuted = states.every((s) => s.isMuted);
                    const isHidden = states.every((s) => s.isHidden);
                    const blue = isZoomEmphasized || isFocusEdge;
                    // Figma "Edge/Explorer": lit / faded / idle (see `edge-style.ts`).
                    const edge = EDGE_STYLE[blue ? "lit" : isHidden || isMuted ? "faded" : "idle"];
                    return (
                      <path
                        key={bundleId}
                        d={bundle.d}
                        fill="none"
                        strokeLinecap="round"
                        stroke={edge.stroke}
                        className="transition-opacity"
                        opacity={edge.opacity}
                        strokeWidth={
                          blue ? edge.width : Math.min(edge.width + (bundle.count - 1) * 0.8, 5)
                        }
                        markerEnd={bundle.count === 1 ? "url(#relation-arrow)" : undefined}
                      />
                    );
                  })
                : relations.map((r) => {
                    const a = entities.find((e) => e.id === r.from);
                    const b = entities.find((e) => e.id === r.to);
                    const geo = relationGeometry.get(r.id);
                    if (!a || !b || !geo) return null;
                    const { isZoomEmphasized, isFocusEdge, isMuted, isHidden } =
                      getRelationVisualState(r);
                    // Figma Line (362:222575): Default and Suggested are the same solid gray
                    // (the label's dot tells them apart); Deactivated is 0.2; Selected is blue.
                    const blue = isZoomEmphasized || isFocusEdge;
                    const edge = EDGE_STYLE[blue ? "lit" : isHidden || isMuted ? "faded" : "idle"];
                    return (
                      <motion.path
                        key={r.id}
                        initial={false}
                        animate={{ d: geo.d }}
                        transition={SPRING}
                        fill="none"
                        strokeLinecap="round"
                        stroke={edge.stroke}
                        className="transition-opacity"
                        opacity={edge.opacity}
                        strokeWidth={edge.width}
                        markerEnd="url(#relation-arrow)"
                      />
                    );
                  })}
              {/* live preview line while dragging a connector out to a new entity — stays anchored
                  to the exact handle that was grabbed, rather than sliding around the node to
                  chase the pointer. */}
              {/* Figma "Dot Drag": a solid gray line to a blue dot under the pointer. */}
              {connectDrag && connectPos && (
                <>
                  <path
                    d={`M ${connectDrag.origin.x} ${connectDrag.origin.y} L ${connectPos.x} ${connectPos.y}`}
                    fill="none"
                    stroke="#9EA3A2"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={connectPos.x}
                    cy={connectPos.y}
                    r={3.5}
                    fill="#0092b8"
                    stroke="#0092b8"
                  />
                </>
              )}
            </svg>

            {SHOW_OVERVIEW_RELATION_NODES &&
              relations.map((r) => {
                const a = entities.find((e) => e.id === r.from);
                const b = entities.find((e) => e.id === r.to);
                const geo = relationGeometry.get(r.id);
                if (!a || !b || !geo) return null;
                const { mid } = geo;
                const isSelected = selection?.kind === "relation" && selection.id === r.id;
                const isMultiSelected = suggestionSelection.has(
                  suggestionKey({ kind: "relation", id: r.id }),
                );
                const isHovered = hoveredRelationId === r.id;
                const isZoomEmphasized = isSelected || isMultiSelected || isHovered;
                // Same dimming the connector line itself already computes above (confidence/status
                // Filter scope, plus the entity-hover focus dim) — kept identical so the badge and
                // the line it sits on always read as one visually-consistent object, never one dimmed
                // without the other.
                const bothSearchConnected = searchContext
                  ? searchContext.connectedEntityIds.has(r.from) &&
                    searchContext.connectedEntityIds.has(r.to)
                  : false;
                // Same table-hover guard as the connector line above — relations only ever light up
                // for an actual Entity hover/search focus, never for Table hover's own entity set.
                const isFocusEdge =
                  suggestionSelection.size > 0
                    ? false
                    : searchContext
                      ? bothSearchConnected
                      : activeEntityIds && !hoveredTableName
                        ? activeEntityIds.has(r.from) || activeEntityIds.has(r.to)
                        : false;
                // Labels show only in context: on the relation itself, or around the hovered /
                // selected / focused Entity Type — never all at once.
                const revealLabel = isZoomEmphasized || !!isFocusEdge;
                const outOfScope =
                  !bothSearchConnected &&
                  !isReviewItemInScope(
                    relationReview(r),
                    r.confidence,
                    confidenceRange,
                    statusFilter,
                  );
                const isMuted =
                  outOfScope ||
                  (activeEntityIds !== null && !isFocusEdge && !entityNeighborhoodActive);
                return (
                  <motion.div
                    key={r.id}
                    initial={false}
                    animate={{ left: mid.x, top: mid.y }}
                    transition={SPRING}
                    style={{
                      opacity: isZoomEmphasized
                        ? 1
                        : entityNeighborhoodActive && !isFocusEdge
                          ? 0
                          : isMuted
                            ? 0.2
                            : 1,
                    }}
                    onMouseEnter={() => setHoveredRelationId(r.id)}
                    onMouseLeave={() => setHoveredRelationId(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      // History Mode is strictly inspection-only — normal canvas selection (plain or
                      // shift multi-select alike) is switched off for its whole duration, not just
                      // once a specific event is open (see this file's own `historyPanelOpen` gates
                      // elsewhere, e.g. the Entity node click handler right above).
                      if (historyPanelOpen) return;
                      selectRelationOnClick(r.id, e.shiftKey);
                    }}
                    className={cn(
                      "group/relpill absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity",
                      historyPanelOpen ? "cursor-default" : "cursor-pointer",
                      (isSelected || isMultiSelected) && "rounded-[4px] ring-2 ring-[#0092b8]",
                    )}
                  >
                    {/* Icon-only by default; hovering reveals the name as a labeled pill (Figma:
                      "Relation / Default / *" vs "Relation / Hover / *"). No inline delete on this
                      badge any more — Delete now lives on the contextual selection bar (single- or
                      multi-select alike, see the bottom-center stack below), matching how Entity
                      Types already work. */}
                    {/* Figma Line label (362:222575): a status dot and the name on a canvas-
                        colored chip; zoomed out, just the dot until hovered. */}
                    <div
                      title={r.errorReason ?? r.warningReason ?? undefined}
                      className={cn(
                        "inline-flex items-center rounded-[4px] bg-[#f9fafb] px-1 transition-[gap,opacity] group-hover/relpill:gap-1 group-hover/relpill:opacity-100",
                        revealLabel ? "gap-1 opacity-100" : "gap-0 opacity-0",
                      )}
                    >
                      <span className="flex h-4 items-center">
                        <ItemStatusIcon status={relationStatus(r, entities)} size={6} />
                      </span>
                      <span
                        className={cn(
                          "block overflow-hidden whitespace-nowrap text-[11.5px] leading-4 transition-[max-width,opacity] group-hover/relpill:max-w-[160px] group-hover/relpill:opacity-100",
                          isZoomEmphasized ? "text-[#1c1c18]" : "text-[#71717b]",
                          revealLabel ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0",
                        )}
                      >
                        {relationLabel(r)}
                      </span>
                    </div>
                  </motion.div>
                );
              })}

            {handleHover &&
              !connectDrag &&
              !historyPanelOpen &&
              (() => {
                const source = displayEntities.find((e) => e.id === handleHover.entityId);
                if (!source) return null;
                const from = ontologyNodeCenter(source);
                const sourceFp = footprintById.get(source.id);
                const to = ghostCenter(source, handleHover.side, sourceFp);
                const r = ONTOLOGY_NODE_SIZE / 2;
                const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                const dir = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
                // The line leaves the source's own outline (not its center + a circle's radius).
                const fromReach = sourceFp ? footprintReach(sourceFp, dir) : r;
                return (
                  <motion.div
                    key={`${handleHover.entityId}-${handleHover.side}`}
                    className="pointer-events-none absolute left-0 top-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                  >
                    <svg className="absolute overflow-visible" width={1} height={1}>
                      <line
                        x1={from.x + dir.x * (fromReach + 16)}
                        y1={from.y + dir.y * (fromReach + 16)}
                        x2={to.x - dir.x * (r + 6)}
                        y2={to.y - dir.y * (r + 6)}
                        stroke="#c9cccb"
                        strokeWidth={1.5}
                        markerEnd="url(#relation-arrow)"
                      />
                    </svg>
                    <motion.div
                      className="absolute size-10 rounded-full border-2 border-dashed border-[#c9cccb] bg-[#e3e5e4]/60"
                      style={{ left: to.x - r, top: to.y - r }}
                      initial={{ scale: 0.6 }}
                      animate={{ scale: 1 }}
                      transition={SPRING}
                    />
                  </motion.div>
                );
              })()}

            {displayEntities.map((entity) => (
              <motion.div
                key={entity.id}
                ref={(el) => {
                  if (el) nodeElRefs.current.set(entity.id, el);
                  else nodeElRefs.current.delete(entity.id);
                }}
                className="absolute"
                style={{ left: entity.x, top: entity.y }}
                initial={false}
                animate={{ x: makeWay.get(entity.id)?.x ?? 0, y: makeWay.get(entity.id)?.y ?? 0 }}
                transition={SPRING}
                onMouseEnter={() => setHoveredEntityId(entity.id)}
                onMouseLeave={() => setHoveredEntityId((cur) => (cur === entity.id ? null : cur))}
              >
                <OntologyNode
                  entity={entity}
                  detailed={lod === "full" || lod === "compact"}
                  nameSize={LOD_NAME_PX[lod]}
                  nodeScale={nodeScaleById.get(entity.id) ?? 1}
                  card={cardMode ? (cardSizeById.get(entity.id) ?? "small") : null}
                  relationCount={relationCountByEntity.get(entity.id) ?? 0}
                  onHandleHover={(side) =>
                    setHandleHover(side ? { entityId: entity.id, side } : null)
                  }
                  showLabel={showNodeLabel(entity.id)}
                  // While hovering / selecting, only the hovered node keeps its props summary; its neighbors
                  // show name and confidence.
                  showPropertySummary={
                    lod === "full" &&
                    (!entityNeighborhoodActive || !!activeEntityIds?.has(entity.id))
                  }
                  emphasis={emphasisFor(entity.id)}
                  selected={
                    (selection?.kind === "entity" && selection.id === entity.id) ||
                    multiSelectedEntityIds.has(entity.id) ||
                    !!historyInspectionEntityIds?.has(entity.id)
                  }
                  // Editing the canvas while previewing a historical point would silently apply
                  // to CURRENT Ontology underneath — see this feature's own spec on why a preview
                  // must never let that happen — so normal click/drag/connect are switched off for
                  // the whole of History Mode (opening History now goes straight into it, not just
                  // once a specific event is being inspected); only the numbered markers below stay
                  // interactive (to select/deselect a change) once one is, and the panel's own
                  // Back/close/Restore are the only ways out.
                  onClick={historyPanelOpen ? undefined : () => openDetail("entity", entity.id)}
                  // This Overview is auto-laid out by graph topology at every zoom level. Manual
                  // node movement would fight that deterministic projection, so selection remains
                  // available while position dragging is intentionally disabled here.
                  onStartMove={(clientX, clientY) =>
                    startNodeMove(entity.id, clientX, clientY, true)
                  }
                  movementLocked
                  onStartConnect={
                    historyPanelOpen
                      ? undefined
                      : (side, clientX, clientY) =>
                          startConnectFromEntity(entity.id, side, clientX, clientY)
                  }
                  connectSourceSide={connectDrag?.sourceId === entity.id ? connectDrag.side : null}
                  connectTargetSide={connectTargetId === entity.id ? connectTargetSide : null}
                />
              </motion.div>
            ))}

            {/* History Inspection Mode's own numbered ①②③... markers (see app-state's own
                `HistoryInspection` doc comment) — purely a transient overlay: never affects
                hit-testing or the ontology itself, and disappears the moment inspection closes.
                Doubles as the canvas-side half of Selective Restore — clicking a marker (when its
                change is restorable) selects/deselects it, exactly like clicking its row in the
                History panel; both read/write the exact same `selected` set. */}
            {historyMarkers.map((marker) => {
              const hovered = historyInspectionHoveredNumber === marker.number;
              const selected = marker.selected;
              return (
                <div
                  key={marker.number}
                  className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: marker.x, top: marker.y }}
                >
                  <button
                    type="button"
                    disabled={!marker.restorable}
                    onMouseEnter={() => setHistoryInspectionHoveredNumber(marker.number)}
                    onMouseLeave={() =>
                      setHistoryInspectionHoveredNumber((cur) =>
                        cur === marker.number ? null : cur,
                      )
                    }
                    onClick={() => marker.restorable && toggleHistoryGroupSelected(marker.number)}
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[12px] font-semibold shadow-[0_2px_2px_0_rgba(0,0,0,0.1)] transition-transform",
                      marker.restorable ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                      selected
                        ? "border-[#00ded8] bg-[#00ded8] text-white"
                        : "border-[#00DED8]/60 bg-white text-[#00ADB0]",
                      hovered && "scale-125",
                    )}
                  >
                    {circledNumber(marker.number)}
                  </button>
                </div>
              );
            })}

            {/* The brief post-restore highlight — a ring around each just-restored object, purely
                cosmetic and self-clearing (see app-state's own `historyRestoreHighlight` doc
                comment); never a marker/number, since these objects are back in Current Ontology
                proper by the time this shows. */}
            {restoreHighlightMarkers.map((pt, i) => (
              <div
                key={i}
                className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full ring-[3px] ring-[#00ded8]"
                style={{
                  left: pt.x,
                  top: pt.y,
                  width: ONTOLOGY_NODE_SIZE + 12,
                  height: ONTOLOGY_NODE_SIZE + 12,
                }}
              />
            ))}
          </div>

          {/* Bottom-center floating stack — exactly ONE of these three at a time, never stacked:
              a multi-item Suggestion selection (e.g. "Select all in range") outranks a single
              Entity selection, which in turn REPLACES (not sits alongside) the default AI Review
              control — each answers a different question ("what do I want to do with what I just
              selected" vs. "what am I reviewing ontology-wide"), so showing more than one at once
              would leave it ambiguous which control a click actually acts on. See
              `EntitySelectionBar`'s own doc comment for why a plain click no longer jumps straight
              into Editing Mode, and `AiReviewBar`'s own doc comment for why IT is a separate
              control from the Header's Mapping Status pills. */}
          <div
            className={cn(
              "absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-3",
              // History Mode is strictly inspection-only — the entire AI-review surface (accept/
              // decline, suggestion multi-select, Confidence range, Generate Suggestions) is
              // switched off for its whole duration. It stays VISIBLE (context for what review
              // state the ontology is actually in) but inert, rather than disappearing — the same
              // "remain visible, non-interactive" treatment as the canvas's own hover affordances.
              // Any stale selection/suggestionSelection from before History Mode opened is
              // deliberately ignored below (always falls through to the plain `AiReviewBar`), so a
              // leftover selection never shows a live-looking Delete/Accept/Decline bar here.
              historyPanelOpen && "pointer-events-none opacity-50",
            )}
          >
            {!historyPanelOpen && suggestionSelection.size > 0 ? (
              <SuggestionSelectionBar
                entities={entities}
                relations={relations}
                suggestionSelection={suggestionSelection}
                onClearSuggestionSelection={clearSuggestionSelection}
                onAcceptSuggestions={acceptSuggestions}
                onDeclineSuggestions={declineSuggestions}
                onDeleteSuggestions={deleteSuggestionKeys}
                onGoToEditingMode={
                  // Only for a single selection — several items have no one place to edit.
                  selectionEditTarget && suggestionSelection.size === 1
                    ? () => goToEditingMode(selectionEditTarget)
                    : undefined
                }
              />
            ) : !historyPanelOpen && selectedEntity ? (
              <EntitySelectionBar
                entity={selectedEntity}
                onDelete={() => deleteEntity(selectedEntity.id)}
                onAccept={() =>
                  acceptSuggestions([suggestionKey({ kind: "entity", id: selectedEntity.id })])
                }
                onDecline={() =>
                  declineSuggestions([suggestionKey({ kind: "entity", id: selectedEntity.id })])
                }
                onGoToEditingMode={() => goToEditingMode(selectedEntity.id)}
              />
            ) : !historyPanelOpen && selectedRelation ? (
              <RelationSelectionBar
                relation={selectedRelation}
                entities={entities}
                onDelete={() => deleteRelation(selectedRelation.id)}
                onAccept={() =>
                  acceptSuggestions([suggestionKey({ kind: "relation", id: selectedRelation.id })])
                }
                onDecline={() =>
                  declineSuggestions([suggestionKey({ kind: "relation", id: selectedRelation.id })])
                }
              />
            ) : (
              <AiReviewBar
                entities={entities}
                relations={relations}
                tables={tables}
                confidenceRange={confidenceRange}
                onConfidenceRangeChange={setConfidenceRange}
                onSelectSuggestionsInRange={selectSuggestionKeys}
              />
            )}
          </div>

          {/* Figma 350:75161 / 350:75436: zoom in the canvas's top-right corner — beside the open
              Data tables panel, or sharing one card with its expand button once it's collapsed.
              (Select / Pan and Undo / Redo stay on their keyboard shortcuts.) */}
          <ZoomCard
            className="absolute right-3 top-3 z-20"
            zoomPercent={Math.round(view.z * 100)}
            onZoomIn={() => zoomBy(1.2)}
            onZoomOut={() => zoomBy(1 / 1.2)}
            onResetZoom={() => setZoomPercent(100)}
            onFit={fitToContent}
            collapsedPanel={
              tablePanelOpen
                ? undefined
                : { label: "Data tables", onExpand: () => setTablePanelOpen(true) }
            }
          />
        </div>
      </div>
      {creationRequest && (
        <CreateEntityWizard
          sourceEntity={creationSourceEntity}
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
      {tablePanelOpen && (
        <div
          style={{ width: TABLE_PANEL_OPEN_W }}
          className="relative flex shrink-0 flex-col overflow-hidden border-l border-[#E3E5E4] bg-node"
        >
          {/* Figma 350:75161: the collapse button first, then the title. */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#e3e5e4] pl-3 pr-4">
            <button
              type="button"
              onClick={() => setTablePanelOpen(false)}
              aria-label="Collapse Data tables panel"
              className="flex size-6 shrink-0 items-center justify-center rounded-[6px] hover:bg-[#e3e5e4]"
            >
              <FigmaIcon src={panelOpenIcon} />
            </button>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-[#161919]">
              Data tables
            </span>
          </div>
          <>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#e3e5e4] pl-2.5 pr-3">
              <SortDropdown
                sort={tableSort}
                onChange={(k) => setTableSort((s) => nextSortState(s, k))}
                showPrefix={false}
              />
              <SearchIcon className="size-4 shrink-0 text-[#6d7472]" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {sortedTables.map((t) => {
                const isSelected = selection?.kind === "table" && selection.id === t.name;
                const focusLink = focusedEntityTables.get(t.name);
                const isRelated = (searchContext?.tableNames.has(t.name) ?? false) || !!focusLink;
                const entityCount = entitiesUsingTable(t.name, entities).length;
                // Tables have no Confidence/ReviewStatus of their own — derived from whichever
                // Property↔Column Mapping(s) touch it instead (see `isTableInScope`'s own doc
                // comment). Out of scope dims the row; it never removes it from this list, so the
                // full set of Data Tables is always visible regardless of Confidence/Filter.
                const inScope = isTableInScope(t.name, entities, confidenceRange, statusFilter);
                return (
                  <div
                    key={t.name}
                    ref={(el) => {
                      if (el) tableRowRefs.current.set(t.name, el);
                      else tableRowRefs.current.delete(t.name);
                    }}
                    className={cn(!inScope && "opacity-40")}
                  >
                    <button
                      onClick={historyPanelOpen ? undefined : () => openDetail("table", t.name)}
                      onMouseEnter={() => setHoveredTableName(t.name)}
                      onMouseLeave={() =>
                        setHoveredTableName((cur) => (cur === t.name ? null : cur))
                      }
                      className={cn(
                        "flex w-full shrink-0 items-center gap-2 py-1.5 pl-4 pr-2.5 font-normal text-left transition-colors",
                        historyPanelOpen && "cursor-default",
                        // `bg-primary/10` (the app's teal "selected" token) replaces this row's
                        // original `#eff6ff` — a leftover prototype blue from before the Zaimler
                        // re-theme (see CLAUDE.md's Figma accent palette note on migrating those).
                        isSelected ? "bg-primary/10" : isRelated ? "bg-[#f4f4f4]" : "bg-white",
                        !isSelected && !isRelated && !historyPanelOpen && "hover:bg-[#e3e5e4]",
                      )}
                    >
                      <MappingStatusBadge
                        status={tableMappingStatus(t.name, entities)}
                        {...tableMappingCompleteness(t.name, entities)}
                        size={16}
                      />
                      {/* Figma 492:57788 (Panel_Expanded): 14px/20px name over a 12px/16px
                          secondary line in muted-foreground. */}
                      <span className="flex min-w-0 flex-1 flex-col items-start justify-center">
                        <span className="block w-full truncate text-[14px] font-medium leading-5 text-[#161919]">
                          {t.name}
                        </span>
                        <span className="block w-full truncate text-[12px] font-normal leading-4 text-[#6d7472]">
                          {t.columns.length} columns · {entityCount} entit
                          {entityCount === 1 ? "y" : "ies"}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        </div>
      )}
    </div>
  );
}
