import { useMemo } from "react";
import { ArrowLeft, ArrowUpRight, History as HistoryIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HistoryInspection, HistoryLogEntry, RestoreOutcome } from "@/lib/app-state";
import type { SearchResultRef } from "@/lib/mock-data";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(at: number, now: number): string {
  const diff = now - at;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} min ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hr${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(diff / DAY);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function dayLabel(at: number, now: number): string {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diffDays = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

// ①②③... up to 20 — every batch we actually produce today tops out well under this (the largest,
// "Accepted N suggestions", is realistically a handful at a time); beyond 20 this falls back to a
// plain "(21)" rather than silently running out of glyphs.
const CIRCLED_DIGITS = [
  "①",
  "②",
  "③",
  "④",
  "⑤",
  "⑥",
  "⑦",
  "⑧",
  "⑨",
  "⑩",
  "⑪",
  "⑫",
  "⑬",
  "⑭",
  "⑮",
  "⑯",
  "⑰",
  "⑱",
  "⑲",
  "⑳",
];
// Exported so OverviewCanvas can render the exact same glyph on its own numbered markers — one
// shared numbering scheme between the History panel and the canvas, not two independently
// drifting ones.
export const circledNumber = (n: number) => CIRCLED_DIGITS[n - 1] ?? `(${n})`;

/**
 * The plain, scannable timeline — one row per event, no checkboxes or restore controls anywhere
 * in it (see this feature's own spec: the normal feed stays lightweight). Clicking a row does NOT
 * navigate or restore anything by itself; it enters History Inspection Mode, where the canvas and
 * this same panel (now showing that entry's own detail view instead of this list) take over.
 */
function TimelineRow({
  entry,
  now,
  onInspect,
}: {
  entry: HistoryLogEntry;
  now: number;
  onInspect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onInspect}
      className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
    >
      <span className="text-[13px] font-medium text-foreground">{entry.title}</span>
      {entry.detail && (
        <span className="whitespace-pre-line text-[12px] text-muted-foreground">
          {entry.detail}
        </span>
      )}
      <p className="text-[11px] text-muted-foreground">{relativeTime(entry.at, now)} · You</p>
    </button>
  );
}

/**
 * History Inspection Mode's own detail view — replaces the timeline entirely while one event is
 * being inspected (see `HistoryInspection`'s own doc comment in app-state.ts). This is now the
 * ONE place Selective Restore lives; there is no more per-row nested "Changes" card anywhere in
 * the timeline. Every change here is numbered the same ①②③... the canvas draws next to the
 * matching object, and hovering/selecting either side (this list or the canvas marker) is meant
 * to stay in sync — see `onHoverChange`/`hoveredNumber` and app-state's own
 * `historyInspectionHoveredNumber`.
 */
function InspectionDetail({
  inspection,
  now,
  hoveredNumber,
  onBack,
  onToggleChange,
  onHoverChange,
  onLocate,
  onRestore,
}: {
  inspection: HistoryInspection;
  now: number;
  hoveredNumber: number | null;
  onBack: () => void;
  onToggleChange: (number: number) => void;
  onHoverChange: (number: number | null) => void;
  onLocate: (ref: SearchResultRef) => void;
  onRestore: () => RestoreOutcome;
}) {
  const conflictFor = (childIndex: number | null) =>
    inspection.conflicts.find((c) => c.childIndex === childIndex)?.message;

  const count = inspection.selected.size;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-[rgba(28,28,24,0.08)] px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
      </div>
      <div className="shrink-0 border-b border-[rgba(28,28,24,0.08)] px-3.5 py-3">
        <p className="text-[14px] font-semibold text-foreground">{inspection.title}</p>
        {inspection.detail && (
          <p className="whitespace-pre-line text-[12px] text-muted-foreground">
            {inspection.detail}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {relativeTime(inspection.at, now)} · You
        </p>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-2">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Changes
        </p>
        <div className="flex flex-col gap-0.5">
          {inspection.changes.map((c) => {
            const conflict = conflictFor(c.childIndex);
            const selected = inspection.selected.has(c.number);
            const hovered = hoveredNumber === c.number;
            return (
              <div
                key={c.key}
                onMouseEnter={() => onHoverChange(c.number)}
                onMouseLeave={() => onHoverChange(null)}
                onClick={() => c.restorable && onToggleChange(c.number)}
                className={cn(
                  "flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors",
                  c.restorable ? "cursor-pointer" : "cursor-default",
                  selected && "bg-[#00ded8]/10",
                  !selected && hovered && "bg-black/[0.03]",
                )}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!c.restorable}
                  onChange={() => onToggleChange(c.number)}
                  onClick={(e) => e.stopPropagation()}
                  title={c.restorable ? undefined : "This change can't be restored."}
                  className="mt-[3px] size-3.5 shrink-0 accent-[#00ded8] disabled:opacity-30"
                />
                <span
                  className={cn(
                    "mt-px flex size-4 shrink-0 items-center justify-center text-[11px] leading-none text-muted-foreground",
                    !c.restorable && "opacity-40",
                  )}
                  aria-hidden="true"
                >
                  {circledNumber(c.number)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[12.5px] font-medium text-foreground",
                      !c.restorable && "opacity-60",
                    )}
                  >
                    {c.detail ?? c.title}
                  </span>
                  {c.detail && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.title}
                    </span>
                  )}
                  {conflict && <span className="block text-[11px] text-[#9c461e]">{conflict}</span>}
                </span>
                {c.ref && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLocate(c.ref!);
                    }}
                    title="Locate on the canvas"
                    aria-label="Locate on the canvas"
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowUpRight className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-t border-[rgba(28,28,24,0.08)] p-2">
        <button
          type="button"
          disabled={count === 0}
          onClick={onRestore}
          className="w-full rounded-full bg-[#1c1c18] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {count === 0 ? "Restore selected" : `Restore ${count} change${count === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

/**
 * History Mode — clicking the Header's History button goes STRAIGHT into it (no lightweight
 * popover peek first): a full, persistent right-docked panel (`fixed`, flush with the viewport
 * edge, spanning the full height below the Header — the same structural role Overview's own Data
 * Tables panel plays, not a transient popover) paired with the canvas's own distinct striped/muted
 * background (see OverviewCanvas's own `historyPanelOpen` doc comment). `enterHistoryInspection`
 * always exits Editing back to Overview first, so this only ever shows over the Overview canvas.
 *
 * The panel itself has two views, switched by whether a specific event is open (`inspection`):
 * the plain timeline (every History entry, nothing selectable) and one event's own inspection
 * detail (Selective Restore — see `InspectionDetail`'s own doc comment). "Back" returns from the
 * detail view to the timeline without closing the panel; the panel's own header-row close button
 * (or re-clicking the History button) closes History Mode entirely. Outside clicks never close
 * anything here any more — this is a deliberate mode switch, not a dismissible popover.
 *
 * This panel itself never holds any restore state — `inspection` is owned by app-state
 * (`historyInspection`), since the canvas needs to read the exact same numbered-change list and
 * selection this panel shows. Clicking a normal timeline row calls `onInspectEvent` (enters
 * Inspection Mode — a PREVIEW, not a mutation); nothing here ever changes Current Ontology except
 * `onRestore`, wired straight to app-state's `restoreSelectedHistoryChanges`.
 */
export function HistoryPanel({
  entries,
  panelOpen,
  onPanelOpenChange,
  inspection,
  hoveredNumber,
  onInspectEvent,
  onExitInspection,
  onToggleChange,
  onHoverChange,
  onLocate,
  onRestore,
}: {
  entries: HistoryLogEntry[];
  /** Whether History Mode's panel is showing at all — see app-state's own `historyPanelOpen` doc
   * comment for how this relates to `inspection` below. */
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  /** The event currently open in the panel's own inspection detail view, or `null` for the plain
   * timeline — see app-state's own `HistoryInspection` doc comment. */
  inspection: HistoryInspection | null;
  /** The numbered change currently hovered, from either this panel or its matching canvas
   * marker — see app-state's own `historyInspectionHoveredNumber` doc comment. */
  hoveredNumber: number | null;
  onInspectEvent: (entryId: string) => void;
  onExitInspection: () => void;
  onToggleChange: (number: number) => void;
  onHoverChange: (number: number | null) => void;
  /** "Locate on the canvas" for one change's row — reuses Global Search's own navigation dispatch,
   * without leaving Inspection Mode or closing this panel. */
  onLocate: (ref: SearchResultRef) => void;
  onRestore: () => RestoreOutcome;
}) {
  const handleClose = () => {
    onExitInspection();
    onPanelOpenChange(false);
  };

  // Recomputed once per open rather than on a ticking interval — this is a short-lived panel, not
  // a live dashboard, so "2 min ago" staying accurate to the second isn't worth a timer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [panelOpen]);

  const groups = useMemo(() => {
    const map = new Map<string, HistoryLogEntry[]>();
    entries.forEach((entry) => {
      const label = dayLabel(entry.at, now);
      const list = map.get(label) ?? [];
      list.push(entry);
      map.set(label, list);
    });
    return Array.from(map.entries());
  }, [entries, now]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => onPanelOpenChange(!panelOpen)}
        title="History"
        aria-label="History"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-[4px] text-[#171b22] transition-colors",
          panelOpen ? "bg-accent" : "hover:bg-accent",
        )}
      >
        <HistoryIcon className="size-[18px]" />
      </button>
      {panelOpen && (
        <div className="fixed bottom-0 right-0 top-14 z-30 flex w-[26rem] flex-col overflow-hidden border-l border-[rgba(28,28,24,0.08)] bg-white shadow-[var(--shadow-node-lift)]">
          {inspection ? (
            <InspectionDetail
              inspection={inspection}
              now={now}
              hoveredNumber={hoveredNumber}
              onBack={onExitInspection}
              onToggleChange={onToggleChange}
              onHoverChange={onHoverChange}
              onLocate={onLocate}
              onRestore={onRestore}
            />
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-[rgba(28,28,24,0.08)] px-3.5 py-3">
                <div>
                  <p className="text-[14px] font-semibold text-foreground">History</p>
                  <p className="text-[12px] text-muted-foreground">Changes to this ontology</p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close History"
                  title="Close History"
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
                {entries.length === 0 && (
                  <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                    No changes yet.
                  </p>
                )}
                {groups.map(([label, groupEntries]) => (
                  <div key={label} className="flex flex-col gap-1">
                    <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {groupEntries.map((entry) => (
                        <TimelineRow
                          key={entry.id}
                          entry={entry}
                          now={now}
                          onInspect={() => onInspectEvent(entry.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
