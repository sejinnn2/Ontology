/** Entity Type nodes are pills (Figma: "Entity Node"), not circles — anchors are derived from the
 * actual box half-width/half-height rather than a single radius, so a wide/short rectangle routes
 * connectors correctly on every side. */
export const NODE_W = 160;
export const NODE_H = 43;
const HALF_W = NODE_W / 2;
const HALF_H = NODE_H / 2;

/** Small stand-off between a node's own border and where its connectors start/end, so lines
 * don't visually touch the pill. */
const NODE_GAP = 8;

export type Pt = { x: number; y: number };

/** An axis-aligned box in the same coordinate space as everything else here — unlike the
 * fixed-size Entity Node type above, this carries its own width/height, so the same anchor math
 * below can serve arbitrary-sized boxes (a Detail Property row, a Column row, a variable-height
 * card) and not just the one fixed pill shape. */
export type Rect = { x: number; y: number; width: number; height: number };

export const nodeCenter = (n: { x: number; y: number }): Pt => ({
  x: n.x + HALF_W,
  y: n.y + HALF_H,
});

export type Side = "top" | "right" | "bottom" | "left";

const rectCenter = (r: Rect): Pt => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

const rectSideAnchor = (r: Rect, gap: number, side: Side): Pt => {
  const c = rectCenter(r);
  switch (side) {
    case "left":
      return { x: r.x - gap, y: c.y };
    case "right":
      return { x: r.x + r.width + gap, y: c.y };
    case "top":
      return { x: c.x, y: r.y - gap };
    case "bottom":
      return { x: c.x, y: r.y + r.height + gap };
  }
};

/** The general, any-size-rect form of `edgeAnchors` below — anchor points on each box's own
 * perimeter, on whichever side (left/right, or top/bottom) faces the other box along the axis
 * their centers differ most on, plus their midpoint and which side each ended up on. This is the
 * ONE piece of "which side should this connector leave from" logic in the app: Overview's own
 * `edgeAnchors` (fixed-size Entity Node pills) is just this function called with each node's
 * NODE_W/NODE_H box, and Detail's row-level connectors (a Property row, a Column row, a
 * variable-height card) call this directly with their own measured rects — so a node/row that
 * moves to a different side of what it's connected to always gets a freshly-recomputed anchor
 * side, never one baked in by which argument was "the property" vs "the column". */
export function edgeAnchorsForRects(
  a: Rect,
  b: Rect,
  gap: number = NODE_GAP,
): { p1: Pt; p2: Pt; mid: Pt; side1: Side; side2: Side } {
  const ca = rectCenter(a);
  const cb = rectCenter(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  let side1: Side;
  let side2: Side;
  if (Math.abs(dx) >= Math.abs(dy)) {
    side1 = dx >= 0 ? "right" : "left";
    side2 = dx >= 0 ? "left" : "right";
  } else {
    side1 = dy >= 0 ? "bottom" : "top";
    side2 = dy >= 0 ? "top" : "bottom";
  }
  const p1 = rectSideAnchor(a, gap, side1);
  const p2 = rectSideAnchor(b, gap, side2);
  return { p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, side1, side2 };
}

/** Anchor points on each node's rectangular perimeter — on whichever side (left/right, or
 * top/bottom) faces the other node along the axis their centers differ most on — plus their
 * midpoint, used to place a relation's label. Axis-aligned anchors (rather than a direct-angle
 * point) are what let the connector between them route as a clean orthogonal elbow instead of a
 * diagonal. A thin fixed-size (NODE_W/NODE_H) wrapper over `edgeAnchorsForRects` above. */
export function edgeAnchors(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { p1: Pt; p2: Pt; mid: Pt } {
  const { p1, p2, mid } = edgeAnchorsForRects(
    { x: a.x, y: a.y, width: NODE_W, height: NODE_H },
    { x: b.x, y: b.y, width: NODE_W, height: NODE_H },
    NODE_GAP,
  );
  return { p1, p2, mid };
}

/** Which of 4 boundary sides (top/right/bottom/left), centered on `center`, faces `toward` — the
 * coordinate-system-agnostic version: works equally for canvas world-space centers or plain
 * screen-space DOM rect centers, since it only looks at the relative sign of the delta. */
export function sideBetween(center: Pt, toward: Pt): Side {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** Whether world-space point `p` falls inside node `n`'s rectangular bounds — the pill's actual
 * hit-box, replacing the old circular-radius check now that nodes aren't circles. */
export function pointInNode(p: Pt, n: { x: number; y: number }): boolean {
  return p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + NODE_H;
}

/** The any-size-rect form of `pointInNode` above — for hit-testing against a node whose footprint
 * isn't the fixed NODE_W/NODE_H pill, e.g. Overview's own circular canvas node. */
export function pointInRect(p: Pt, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Shortest distance from point `p` to the segment `a`-`b` — used to detect when a straight
 * connector would cut through a third node's circle, so it can be bowed around it instead. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
