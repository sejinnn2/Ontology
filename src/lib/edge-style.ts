/**
 * Graph edge styles, from Figma "Edge/Explorer" (532:97986). The first three are the class-level
 * relation layers (idle / faded / lit); front, back and further are instance depth layers; records
 * is the dataset-to-records link. Opacity is part of each layer (apply it to the whole path so an
 * arrowhead fades with its line).
 */
export type EdgeLayer = "idle" | "faded" | "lit" | "front" | "back" | "further" | "records";

export const EDGE_STROKE = "#62748E";
export const EDGE_ACCENT = "#0092B8";

export const EDGE_STYLE: Record<
  EdgeLayer,
  { stroke: string; width: number; opacity: number; dash?: string; round?: boolean }
> = {
  idle: { stroke: EDGE_STROKE, width: 1.5, opacity: 0.4 },
  faded: { stroke: EDGE_STROKE, width: 1.5, opacity: 0.2 },
  lit: { stroke: EDGE_ACCENT, width: 3, opacity: 1 },
  front: { stroke: EDGE_STROKE, width: 2.25, opacity: 0.6, round: true },
  back: { stroke: EDGE_STROKE, width: 1.5, opacity: 0.45, dash: "6 4", round: true },
  further: { stroke: EDGE_STROKE, width: 1.25, opacity: 0.4, dash: "1 4", round: true },
  records: { stroke: EDGE_ACCENT, width: 1, opacity: 1, dash: "4 3" },
};
