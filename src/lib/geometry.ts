export const NODE_SIZE = 84;
const NODE_R = NODE_SIZE / 2;

export type Pt = { x: number; y: number };

export const nodeCenter = (n: { x: number; y: number }): Pt => ({ x: n.x + NODE_R, y: n.y + NODE_R });

const sideAnchor = (c: Pt, r: number, side: "left" | "right" | "top" | "bottom"): Pt => {
  switch (side) {
    case "left":
      return { x: c.x - r, y: c.y };
    case "right":
      return { x: c.x + r, y: c.y };
    case "top":
      return { x: c.x, y: c.y - r };
    case "bottom":
      return { x: c.x, y: c.y + r };
  }
};

/** Anchor points on each node's circular perimeter — on whichever side (left/right, or
 * top/bottom) faces the other node along the axis their centers differ most on — plus their
 * midpoint, used to place a relation's label. Axis-aligned anchors (rather than the old
 * direct-angle point) are what let the connector between them route as a clean orthogonal elbow
 * instead of a diagonal. */
export function edgeAnchors(a: { x: number; y: number }, b: { x: number; y: number }): { p1: Pt; p2: Pt; mid: Pt } {
  const ca = nodeCenter(a);
  const cb = nodeCenter(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  let p1: Pt;
  let p2: Pt;
  if (Math.abs(dx) >= Math.abs(dy)) {
    p1 = sideAnchor(ca, NODE_R, dx >= 0 ? "right" : "left");
    p2 = sideAnchor(cb, NODE_R, dx >= 0 ? "left" : "right");
  } else {
    p1 = sideAnchor(ca, NODE_R, dy >= 0 ? "bottom" : "top");
    p2 = sideAnchor(cb, NODE_R, dy >= 0 ? "top" : "bottom");
  }
  return { p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
}

const CORNER_R = 10;

/** Orthogonal connector between two points: one straight run along whichever axis they differ
 * most on, a single 90-degree bend at the shared midpoint, then a straight run into the end —
 * with quarter-round corners (quadratic Beziers centered on the actual corner) instead of sharp
 * turns. Two connectors that share the same pair of anchor axes bend at the same midpoint, so
 * parallel connections read as a clean bus rather than crossing diagonals. Falls back to a
 * straight line when there's too little room on either side for a rounded corner. */
export function orthogonalPath(p1: Pt, p2: Pt, r: number = CORNER_R): string {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;

  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = (p1.x + p2.x) / 2;
    const rr = Math.max(0, Math.min(r, Math.abs(dy) / 2, Math.abs(midX - p1.x), Math.abs(p2.x - midX)));
    if (rr < 1) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
    return [
      `M ${p1.x} ${p1.y}`,
      `L ${midX - sx * rr} ${p1.y}`,
      `Q ${midX} ${p1.y} ${midX} ${p1.y + sy * rr}`,
      `L ${midX} ${p2.y - sy * rr}`,
      `Q ${midX} ${p2.y} ${midX + sx * rr} ${p2.y}`,
      `L ${p2.x} ${p2.y}`,
    ].join(" ");
  }

  const midY = (p1.y + p2.y) / 2;
  const rr = Math.max(0, Math.min(r, Math.abs(dx) / 2, Math.abs(midY - p1.y), Math.abs(p2.y - midY)));
  if (rr < 1) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  return [
    `M ${p1.x} ${p1.y}`,
    `L ${p1.x} ${midY - sy * rr}`,
    `Q ${p1.x} ${midY} ${p1.x + sx * rr} ${midY}`,
    `L ${p2.x - sx * rr} ${midY}`,
    `Q ${p2.x} ${midY} ${p2.x} ${midY + sy * rr}`,
    `L ${p2.x} ${p2.y}`,
  ].join(" ");
}
