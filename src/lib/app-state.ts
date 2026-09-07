import { useCallback, useState } from "react";
import { entities, relations, tables } from "./mock-data";

export type Selection =
  | { kind: "entity"; id: string }
  | { kind: "table"; id: string }
  | { kind: "relation"; id: string }
  | null;

/** Only Entity Types and Source Tables are valid Detail entry points — Relations stay
 * Inspect-only for now. */
export type DetailAnchor = { kind: "entity" | "table"; id: string } | null;

export type CanvasView = { x: number; y: number; z: number };

/**
 * Single app-level state hook covering Overview selection (Inspect), Detail navigation, and the
 * canvas's own pan/zoom. Kept above OverviewCanvas/DetailView (rather than local to either) so
 * that entering and leaving Detail doesn't reset the selection or the canvas viewport — Back
 * should return to the same place the user left, per the "preserve Overview context" navigation
 * requirement.
 */
export function useOntologyApp() {
  const [selection, setSelection] = useState<Selection>(null);
  const [detail, setDetail] = useState<DetailAnchor>(null);
  const [view, setView] = useState<CanvasView>({ x: 60, y: 40, z: 0.55 });

  const select = useCallback((sel: Selection) => setSelection(sel), []);
  const clearSelection = useCallback(() => setSelection(null), []);

  // Opening Detail keeps whatever is currently selected (usually the thing being opened) so
  // Back lands back on the same Inspect state instead of clearing it.
  const openDetail = useCallback((kind: "entity" | "table", id: string) => {
    setDetail({ kind, id });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  return {
    entities,
    relations,
    tables,
    selection,
    select,
    clearSelection,
    detail,
    openDetail,
    closeDetail,
    view,
    setView,
  };
}

export type OntologyApp = ReturnType<typeof useOntologyApp>;
