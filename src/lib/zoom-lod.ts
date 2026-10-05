/**
 * One semantic-zoom scale for both canvases (Overview's graph and the Editing canvas). Zooming out
 * sheds detail in reverse order of importance — first the extras (props summary, detail lines,
 * drag handles), then the confidence score, then type/status icons — while names grow so they stay
 * readable on screen. Where names would crowd (the Overview graph), only the most connected keep
 * theirs at the two farthest levels.
 */
export type CanvasLod = "full" | "compact" | "minimal" | "name";

export function canvasLod(zoom: number): CanvasLod {
  if (zoom >= 0.85) return "full";
  if (zoom >= 0.6) return "compact";
  if (zoom >= 0.4) return "minimal";
  return "name";
}

/** A name's size at each level (world px — growing as the canvas shrinks). */
export const LOD_NAME_PX: Record<CanvasLod, { size: number; line: number }> = {
  full: { size: 16, line: 24 },
  compact: { size: 16, line: 24 },
  minimal: { size: 20, line: 28 },
  name: { size: 28, line: 36 },
};

/** At these levels a crowded graph keeps only its most connected nodes' names. */
export const LOD_SPARSE_LABELS: ReadonlySet<CanvasLod> = new Set(["minimal", "name"]);
/** How many of the most connected nodes keep their names there. */
export const LOD_LABEL_TOP_N = 10;
