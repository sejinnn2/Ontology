export const NODE_SIZE = 84;
const NODE_R = NODE_SIZE / 2;

export type Pt = { x: number; y: number };

export const nodeCenter = (n: { x: number; y: number }): Pt => ({ x: n.x + NODE_R, y: n.y + NODE_R });

/** Anchor points on each node's circular perimeter, facing each other, plus their midpoint —
 * used to draw a relation line between two entity nodes and place its label. */
export function edgeAnchors(a: { x: number; y: number }, b: { x: number; y: number }): { p1: Pt; p2: Pt; mid: Pt } {
  const ca = nodeCenter(a);
  const cb = nodeCenter(b);
  const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
  const ux = (cb.x - ca.x) / len;
  const uy = (cb.y - ca.y) / len;
  const p1: Pt = { x: ca.x + ux * NODE_R, y: ca.y + uy * NODE_R };
  const p2: Pt = { x: cb.x - ux * NODE_R, y: cb.y - uy * NODE_R };
  return { p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
}

/** A smooth S-curve between two anchor points, horizontal tangents at both ends. */
export const curvePath = (p1: Pt, p2: Pt) => {
  const midX = (p1.x + p2.x) / 2;
  return `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`;
};
