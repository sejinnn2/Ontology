import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ZOOM_PRESETS = [50, 100, 150, 200];

export type CanvasTool = "select" | "pan";

export const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/**
 * Keyboard shortcuts for the Select/Pan tool switch above — shared by Overview and Detail so both
 * canvases respond identically: `V` selects the Select tool, `H` selects the Pan tool, and holding
 * Space temporarily switches to Pan (matching the same hold-to-pan convention as Figma/design
 * tools) and restores whatever tool was active the moment Space is released. Ignored while a
 * modifier key is held (so it never fights a browser/OS shortcut) or while focus is in a text
 * field (so typing a "v"/"h"/space character never hijacks the canvas tool underneath).
 *
 * Also owns Undo/Redo's own keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) — bundled into this
 * same hook (rather than a separate one) since both are "global canvas keyboard shortcuts" wired
 * identically by Overview and Detail, and both need the exact same "not while typing" guard.
 * `onUndo`/`onRedo` are optional so this hook still works for any future caller that only wants
 * the tool-switch shortcuts.
 */
export function useCanvasToolShortcuts(
  tool: CanvasTool,
  setTool: (tool: CanvasTool) => void,
  onUndo?: () => void,
  onRedo?: () => void,
) {
  const toolRef = useRef(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    let spaceActive = false;
    let toolBeforeSpace: CanvasTool | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Undo/Redo — checked before the modifier-key early-return below (that one exists purely to
      // keep the V/H tool-switch shortcuts from firing while a modifier is held).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo?.();
        else onUndo?.();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.code === "Space") {
        if (!spaceActive) {
          spaceActive = true;
          toolBeforeSpace = toolRef.current;
          setTool("pan");
        }
        e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "v") setTool("select");
      else if (key === "h") setTool("pan");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !spaceActive) return;
      spaceActive = false;
      if (toolBeforeSpace) setTool(toolBeforeSpace);
      toolBeforeSpace = null;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [setTool, onUndo, onRedo]);
}

/**
 * The canvas's ENTIRE set of controls — Select/Pan, Undo/Redo, and Zoom — combined into one
 * compact pill, grouped with a hairline divider between each logical group (tool switch / history
 * / zoom) so it still reads as three things, not one long undifferentiated list of buttons. There
 * is deliberately no standalone "Create Entity Type" button here (or anywhere else in this
 * toolbar) — Entity creation only ever starts from a canvas interaction now (a node's own "+"
 * affordance, or a placement area's click-to-create — see OntologyNode/DetailView's own doc
 * comments), never a toolbar action.
 *
 * `orientation` picks the shape: `"vertical"` (the default) is the tall pill Editing Mode floats
 * at the canvas's own left edge; `"horizontal"` is Overview's own top-right pill, matching its
 * Figma reference (icon sizes, and Select/Pan → Undo/Redo → Zoom as the grouping order) — reusing
 * this app's own `bg-accent`/`border-node-border`/`shadow-node` tokens everywhere Figma's own
 * design-token references land on something this project already defines. Both share the same
 * props/behavior; only the layout differs.
 *
 * `compact` is a second, smaller horizontal sizing (28px buttons/36px pill, uniform rounding) used
 * by Editing Mode's own top toolbar (Figma node 191:53333) once it also moved to this same
 * horizontal layout — visually related to but independently tuned from Overview's own horizontal
 * sizing (32px buttons), so it's its own flag rather than a third `orientation` value. Ignored
 * when `orientation` is `"vertical"`.
 *
 * Undo/Redo are wired to the app's own history stack (see `useOntologyApp`'s `undo`/`redo`/
 * `canUndo`/`canRedo`) — disabled only when that stack is actually empty in that direction, never
 * permanently.
 */
export function CanvasToolStack({
  tool,
  onToolChange,
  zoomPercent,
  onZoomOut,
  onZoomIn,
  onFitToContent,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSetZoomPercent,
  orientation = "vertical",
  compact = false,
  className,
  style,
}: {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  zoomPercent: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitToContent: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Jump straight to an exact zoom level (a preset from the Zoom menu below) — only wired up by
   * callers that pass it (Overview today); when omitted, the `horizontal` toolbar falls back to
   * the same plain Zoom In/Out/Fit buttons the `vertical` (Editing Mode) toolbar always uses. */
  onSetZoomPercent?: (pct: number) => void;
  orientation?: "vertical" | "horizontal";
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const horizontal = orientation === "horizontal";
  // The combined "100% ▾" Zoom menu (Figma node 179:46795) replaces the separate Zoom In/Out/Fit
  // buttons ONLY for the horizontal toolbar, and only once a caller actually wires up
  // `onSetZoomPercent` — narrowing through this single binding (rather than re-checking
  // `onSetZoomPercent` at each call site) is what lets TypeScript treat it as defined everywhere
  // inside the ternary below, closures included.
  const zoomMenuHandler = horizontal ? onSetZoomPercent : undefined;
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setZoomMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [zoomMenuOpen]);

  const toolButton = cn(
    "flex shrink-0 items-center justify-center rounded-[4px] transition-colors",
    horizontal ? (compact ? "size-7" : "size-8") : "size-7",
  );
  const squareButton = cn(
    "flex shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-accent",
    horizontal ? (compact ? "size-7" : "size-8") : "size-7",
  );
  const divider = horizontal ? (
    <div className={cn("mx-0.5 w-px shrink-0", compact ? "h-4 bg-[#e1e3e6]" : "h-6 bg-border")} />
  ) : (
    <div className="my-0.5 h-px w-5 shrink-0 bg-[#e1e3e6]" />
  );
  const selectIconSize = horizontal ? (compact ? "size-6" : "size-[23px]") : "size-4";
  const historyIconSize = horizontal ? (compact ? "size-3.5" : "size-[23px]") : "size-4";

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-[6px] border border-node-border bg-node shadow-[var(--shadow-node)]",
        horizontal ? "w-fit flex-row" : "w-9 flex-col",
        horizontal && compact ? "p-[3px]" : "p-1.5",
        className,
      )}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onToolChange("select")}
        aria-pressed={tool === "select"}
        aria-label="Select tool"
        title="Select"
        className={cn(
          toolButton,
          tool === "select" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
        )}
      >
        <MousePointer2 className={selectIconSize} />
      </button>
      <button
        type="button"
        onClick={() => onToolChange("pan")}
        aria-pressed={tool === "pan"}
        aria-label="Pan tool"
        title="Pan"
        className={cn(
          toolButton,
          tool === "pan" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
        )}
      >
        <Hand className={selectIconSize} />
      </button>
      {divider}
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className={cn(
          squareButton,
          horizontal && !compact && "rounded-[8px]",
          !canUndo && "pointer-events-none opacity-30",
        )}
        aria-label="Undo"
        title="Undo"
      >
        <Undo2 className={historyIconSize} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className={cn(
          squareButton,
          horizontal && !compact && "rounded-[8px]",
          !canRedo && "pointer-events-none opacity-30",
        )}
        aria-label="Redo"
        title="Redo"
      >
        <Redo2 className={historyIconSize} />
      </button>
      {divider}
      {zoomMenuHandler ? (
        <div ref={zoomMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setZoomMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={zoomMenuOpen}
            aria-label="Zoom menu"
            className={cn(
              "flex shrink-0 items-center rounded-[4px] pl-2 pr-1 transition-colors",
              compact ? "h-7" : "h-8",
              zoomMenuOpen ? "bg-accent" : "hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "min-w-[28px] text-foreground",
                compact ? "text-xs leading-5" : "text-sm leading-none",
              )}
            >
              {zoomPercent}%
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
          {zoomMenuOpen && (
            <div
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute right-0 top-full z-30 mt-1 flex w-36 flex-col gap-0.5 rounded-lg border border-node-border bg-node p-1 shadow-[var(--shadow-node-lift)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onZoomIn();
                  setZoomMenuOpen(false);
                }}
                className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent"
              >
                Zoom in
                <span className="text-[10px]">+</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onZoomOut();
                  setZoomMenuOpen(false);
                }}
                className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent"
              >
                Zoom out
                <span className="text-[10px]">−</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onFitToContent();
                  setZoomMenuOpen(false);
                }}
                className="flex items-center rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent"
              >
                Zoom to fit
              </button>
              <div className="my-0.5 h-px w-full shrink-0 bg-border" />
              {ZOOM_PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  role="menuitemradio"
                  aria-checked={zoomPercent === pct}
                  onClick={() => {
                    zoomMenuHandler(pct);
                    setZoomMenuOpen(false);
                  }}
                  className={cn(
                    "flex items-center rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                    zoomPercent === pct
                      ? "bg-black/[0.08] text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {pct}%
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <button type="button" className={squareButton} onClick={onZoomIn} aria-label="Zoom in">
            <Plus className="size-3.5" />
          </button>
          <span
            className={cn(
              "flex shrink-0 items-center justify-center text-center text-muted-foreground",
              horizontal ? "h-8 w-8 text-xs" : "h-7 w-7 font-mono text-[10px]",
            )}
            title="Zoom level"
          >
            {zoomPercent}%
          </span>
          <button type="button" className={squareButton} onClick={onZoomOut} aria-label="Zoom out">
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            className={squareButton}
            onClick={onFitToContent}
            aria-label="Fit to content"
            title="Fit to content"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
