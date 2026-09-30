import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft } from "lucide-react";
import type { OntologyApp } from "@/lib/app-state";
import {
  CanvasToolStack,
  useCanvasToolShortcuts,
  type CanvasTool,
} from "@/components/ontology/CanvasControls";

/**
 * The editing workspace's canvas plumbing, shared by its Graph layouts: pan/zoom over a
 * transformed "world" element, the zoom-based level of detail, and the top bar (back link, layout
 * switch, Select/Pan/Undo/Zoom).
 */

type CanvasView = { x: number; y: number; z: number };
const CANVAS_MIN_ZOOM = 0.25;

/**
 * Level of detail by zoom (see the `[data-canvas-lod]` rules in styles.css). Zooming out sheds
 * detail in reverse order of importance — first everything but the essentials (the "N props ·
 * M tables" line, → buttons, drag handles, list controls), then the confidence score, then the
 * type/status icons — until only each item's name is left, drawn larger so it stays readable.
 */
export type CanvasLod = "full" | "compact" | "minimal" | "name";
function canvasLod(zoom: number): CanvasLod {
  if (zoom >= 0.85) return "full";
  if (zoom >= 0.6) return "compact";
  if (zoom >= 0.4) return "minimal";
  return "name";
}
const CANVAS_MAX_ZOOM = 2;

/**
 * Pan/zoom for the editing canvas (Figma node 427:6577's Select/Pan/Zoom toolbar). The cards live
 * in a `world` element transformed by `translate(x, y) scale(z)` from its top-left corner; the
 * viewport around it stays put, so the review bar and selection bars never move.
 *
 * Panning: drag the canvas background (Select tool), drag anywhere (Pan tool, or hold Space), or
 * scroll the wheel anywhere except over a card list that scrolls (that only ever scrolls the list,
 * even at its end). Zooming:
 * Cmd/Ctrl + wheel around the pointer, or the Zoom menu around the viewport's center.
 */
export function useEditingCanvas(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  worldRef: React.RefObject<HTMLDivElement | null>,
  scaleRef: React.RefObject<number>,
) {
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, z: 1 });
  const [tool, setTool] = useState<CanvasTool>("select");
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  // Whether the last pointer press actually moved the canvas — so the click that ends a pan
  // doesn't also count as a click on empty canvas.
  const pannedRef = useRef(false);
  useCanvasToolShortcuts(tool, setTool);
  useEffect(() => {
    scaleRef.current = view.z;
  }, [scaleRef, view.z]);

  const zoomTo = useCallback(
    (next: (z: number) => number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current;
      const world = worldRef.current;
      const r = viewport?.getBoundingClientRect();
      setView((v) => {
        const z = Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, next(v.z)));
        if (!r || !world || z === v.z) return { ...v, z };
        // Keep the point under the cursor (or the viewport center) fixed while scaling.
        const px = (clientX ?? r.left + r.width / 2) - r.left - world.offsetLeft;
        const py = (clientY ?? r.top + r.height / 2) - r.top - world.offsetTop;
        return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
      });
    },
    [viewportRef, worldRef],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomTo((z) => z * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Over a card list that scrolls, the wheel only ever scrolls that list — reaching its end
      // stops there instead of carrying on into a canvas pan (the list's `overscroll-contain`
      // keeps the page from scrolling either). Panning is for empty canvas, cards whose lists
      // fit, the Pan tool, or Space-drag.
      const scroller = target?.closest<HTMLElement>("[data-canvas-scroll]");
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
        return;
      }
      event.preventDefault();
      setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewportRef, zoomTo]);

  const startPan = (event: React.PointerEvent<HTMLElement>) => {
    panRef.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
    pannedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const movePan = (event: React.PointerEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    if (Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) > 3) {
      pannedRef.current = true;
    }
    setView((v) => ({
      ...v,
      x: pan.x + event.clientX - pan.startX,
      y: pan.y + event.clientY - pan.startY,
    }));
  };
  const endPan = () => {
    panRef.current = null;
    setPanning(false);
  };

  return {
    view,
    tool,
    setTool,
    panning,
    zoomTo,
    reset: () => setView({ x: 0, y: 0, z: 1 }),
    /** Centers world-space `bounds` on the world's anchor point, zoomed out (never in past
     * `maxZoom`) until they fit the viewport. Assumes the world is anchored so that world point
     * (0, 0) sits where the content should center (true for the Graph layout). */
    frame: (bounds: { left: number; right: number; top: number; bottom: number }, maxZoom = 1) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const z = Math.max(
        CANVAS_MIN_ZOOM,
        Math.min(
          maxZoom,
          (viewport.clientWidth - 96) / (bounds.right - bounds.left),
          (viewport.clientHeight - 160) / (bounds.bottom - bounds.top),
        ),
      );
      setView({
        z,
        x: -z * ((bounds.left + bounds.right) / 2),
        y: -z * ((bounds.top + bounds.bottom) / 2),
      });
    },
    /** True (once) when the click being handled ended a pan rather than being a plain click. */
    consumePanClick: () => {
      const panned = pannedRef.current;
      pannedRef.current = false;
      return panned;
    },
    startPan,
    movePan,
    endPan,
    worldTransform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
    lod: canvasLod(view.z),
  };
}

export type EditingCanvas = ReturnType<typeof useEditingCanvas>;

/**
 * Whether the editing workspace's side panels (Entity types, left; Data tables, right) are open.
 * A collapsed panel becomes a floating card in its top corner (Figma 508:35850), so the top bar
 * moves its corner content clear of it. The workspace provides this; each panel reports itself.
 */
export type SidePanels = {
  entityOpen: boolean;
  tableOpen: boolean;
  report: (side: "entity" | "table", open: boolean) => void;
};
export const SidePanelContext = createContext<SidePanels | null>(null);
export function useSidePanels(): SidePanels {
  const [entityOpen, setEntityOpen] = useState(true);
  const [tableOpen, setTableOpen] = useState(true);
  const report = useCallback((side: "entity" | "table", open: boolean) => {
    if (side === "entity") setEntityOpen(open);
    else setTableOpen(open);
  }, []);
  return useMemo(() => ({ entityOpen, tableOpen, report }), [entityOpen, tableOpen, report]);
}
/** A panel's side reports whether it's open (see `SidePanelContext`). */
export function useReportSidePanel(side: "entity" | "table", open: boolean) {
  const panels = useContext(SidePanelContext);
  const report = panels?.report;
  useEffect(() => {
    report?.(side, open);
  }, [report, side, open]);
}
// The floating collapsed card's footprint in its corner: 12px inset + 240px card.
const COLLAPSED_CARD_SPAN = 252;

/** Figma canvas header (node 460:42151): "Back to Ontology view" on the left, and the canvas's
 * Select/Pan · Undo/Redo · Zoom pill (the same `CanvasToolStack` Overview uses) in the middle. */
export function EditingCanvasTopBar({ app, canvas }: { app: OntologyApp; canvas: EditingCanvas }) {
  const panels = useContext(SidePanelContext);
  const leftInset = panels && !panels.entityOpen ? COLLAPSED_CARD_SPAN : 0;
  const rightInset = panels && !panels.tableOpen ? COLLAPSED_CARD_SPAN : 0;
  return (
    // Figma 508:35850: the tool / zoom bar floats at the top center, 12px down; "Back" keeps the
    // top-left, moved clear of a collapsed side panel's floating card in that corner.
    <div
      className="relative z-30 flex h-[60px] shrink-0 items-start justify-between bg-[#fafafa] pt-3"
      style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}
    >
      <button
        type="button"
        onClick={app.closeDetail}
        className="flex h-10 items-center gap-2 text-[14px] font-medium text-[#161919] hover:underline"
      >
        <ArrowLeft className="size-4" /> Back to Ontology view
      </button>
      <CanvasToolStack
        orientation="horizontal"
        compact
        className="absolute left-1/2 top-3 -translate-x-1/2 rounded-[10px] border-[#e3e5e4] bg-white p-1 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]"
        tool={canvas.tool}
        onToolChange={canvas.setTool}
        zoomPercent={Math.round(canvas.view.z * 100)}
        onZoomIn={() => canvas.zoomTo((z) => z * 1.2)}
        onZoomOut={() => canvas.zoomTo((z) => z / 1.2)}
        onFitToContent={canvas.reset}
        onSetZoomPercent={(pct) => canvas.zoomTo(() => pct / 100)}
        onUndo={app.undo}
        onRedo={app.redo}
        canUndo={app.canUndo}
        canRedo={app.canRedo}
      />
    </div>
  );
}

/** Starts a canvas pan from a pointerdown that landed on empty canvas (not on a card or a
 * floating control) — used by the viewport's own handler under the Select tool. */
export function isCanvasBackground(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-canvas-card], button, [role='button'], input, [role='menu']")) {
    return false;
  }
  return !!target.closest("[data-canvas-viewport]");
}
