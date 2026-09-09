import { useEffect, useRef } from "react";
import { Hand, Maximize2, Minus, MousePointer2, Plus, Redo2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type CanvasTool = "select" | "pan";

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/**
 * Keyboard shortcuts for the Select/Pan tool switch above — shared by Overview and Detail so both
 * canvases respond identically: `V` selects the Select tool, `H` selects the Pan tool, and holding
 * Space temporarily switches to Pan (matching the same hold-to-pan convention as Figma/design
 * tools) and restores whatever tool was active the moment Space is released. Ignored while a
 * modifier key is held (so it never fights a browser/OS shortcut) or while focus is in a text
 * field (so typing a "v"/"h"/space character never hijacks the canvas tool underneath).
 */
export function useCanvasToolShortcuts(tool: CanvasTool, setTool: (tool: CanvasTool) => void) {
  const toolRef = useRef(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    let spaceActive = false;
    let toolBeforeSpace: CanvasTool | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
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
  }, [setTool]);
}

/**
 * The bottom-center canvas toolbar shared by Overview and Detail — matches the Figma "Canvas
 * Controls" component (node 94:7751) exactly: a Select/Pan tool switch, Zoom out/in + Fit to
 * content, and an Undo/Redo group, each its own pill.
 *
 * Undo/Redo stay permanently disabled — same as the stub DetailView already shipped before this
 * component existed — since there's no undo/redo history anywhere in this app yet; rendering them
 * enabled would be a control that visibly does something but silently doesn't, which is worse
 * than an honest disabled state.
 */
export function CanvasControls({
  tool,
  onToolChange,
  zoomPercent,
  onZoomOut,
  onZoomIn,
  onFitToContent,
  className,
}: {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  zoomPercent: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitToContent: () => void;
  className?: string;
}) {
  const toolButton =
    "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors";
  const squareButton =
    "flex size-7 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent";

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex h-[34px] items-center gap-1 rounded-lg border border-node-border bg-node px-1 py-[3px] shadow-[var(--shadow-node)]">
        <button
          type="button"
          onClick={() => onToolChange("select")}
          aria-pressed={tool === "select"}
          aria-label="Select tool"
          title="Select"
          className={cn(
            toolButton,
            tool === "select"
              ? "bg-black/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <MousePointer2 className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onToolChange("pan")}
          aria-pressed={tool === "pan"}
          aria-label="Pan tool"
          title="Pan"
          className={cn(
            toolButton,
            tool === "pan"
              ? "bg-black/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <Hand className="size-4" />
        </button>
      </div>

      <div className="flex h-[34px] items-center gap-1 rounded-lg border border-node-border bg-node px-1 py-[3px] shadow-[var(--shadow-node)]">
        <button type="button" className={squareButton} onClick={onZoomOut} aria-label="Zoom out">
          <Minus className="size-3.5" />
        </button>
        <span className="w-10 text-center font-mono text-[11px] text-muted-foreground">
          {zoomPercent}%
        </span>
        <button type="button" className={squareButton} onClick={onZoomIn} aria-label="Zoom in">
          <Plus className="size-3.5" />
        </button>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-[#e1e3e6]" />
        <button
          type="button"
          className={squareButton}
          onClick={onFitToContent}
          aria-label="Fit to content"
          title="Fit to content"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      <div className="flex h-[34px] items-center gap-1 rounded-lg border border-node-border bg-node px-1 py-[3px] shadow-[var(--shadow-node)]">
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-30"
          disabled
          aria-label="Undo"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-30"
          disabled
          aria-label="Redo"
        >
          <Redo2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
