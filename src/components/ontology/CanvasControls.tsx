import { useEffect, useRef } from "react";

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
