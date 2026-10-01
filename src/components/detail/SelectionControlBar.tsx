import { propertyIssue } from "@/lib/mock-data";
import { useCallback, useMemo, useState } from "react";
import { Copy, SquareSplitHorizontal } from "lucide-react";
import type { Entity, Property, Relation } from "@/lib/mock-data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SelectionBarDeleteIcon,
  SelectionBarDeclineIcon,
  SelectionBarAcceptIcon,
} from "@/components/nav/nav-icons";
import { cn } from "@/lib/utils";

/**
 * Editing Mode's one contextual selection control — every multi-selection action (Merge, Split,
 * Delete, Accept, Reject) lives here now, instead of the several independent floating bars this
 * canvas used to show (a Merge/Delete bar for shift-selected Entity cards, a Split/Delete bar per
 * Entity's own Property selection, a Delete bar for shift-selected Relations, and the generic
 * Accept/Reject `SuggestionSelectionBar`). Rendered only while 2+ objects are selected — a single
 * selection keeps showing the ordinary inspection panel instead (see `DetailShell`'s own render,
 * which chooses between this and that panel) — so this never needs a "1 selected" case of its own.
 *
 * Every action here is scoped to exactly the objects it's actually eligible for, never the whole
 * selection indiscriminately:
 *   - Merge only ever acts on the selected Entities (2+ required) — Properties/Relations selected
 *     alongside them don't block it, but don't participate in it either.
 *   - Split only ever acts on Properties, and only when they all belong to the SAME Entity and
 *     don't happen to be literally all of that Entity's own properties (an Entity can't be split
 *     down to nothing).
 *   - Delete acts only on the selected objects that are already Applied ("confirmed") — a still-
 *     Suggested object is removed via Reject instead, not Delete.
 *   - Reject acts on every selected object that's still Suggested (Warning/Error included, same as
 *     the ontology-wide Reject workflow this already matched before selection was unified).
 *   - Accept acts on every selected object eligible to become Applied (Suggested/Warning, not
 *     Error — same eligibility `acceptSuggestions` already enforces elsewhere).
 * An action's own label only grows a count suffix ("Delete 3") when it does NOT cover the entire
 * current selection — see this file's own `actionLabel` — so a pure, single-status selection reads
 * as a plain "Delete"/"Accept"/"Reject" the same way the single-kind bars used to.
 */
const BAR_BUTTON =
  "flex h-8 min-w-16 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] bg-white px-2 text-[14px] font-medium leading-6 text-[#161919] transition-colors hover:bg-[#f4f4f4]";

export function SelectionControlBar({
  entities,
  properties,
  relations,
  mappingCount = 0,
  onMerge,
  onSplit,
  onDelete,
  deleteCount,
  onAccept,
  acceptCount,
  onReject,
  rejectCount,
  activeAction = null,
}: {
  entities: Entity[];
  properties: { entity: Entity; property: Property }[];
  relations: Relation[];
  mappingCount?: number;
  // The action whose naming card is open above the bar (its button reads as pressed).
  activeAction?: "merge" | "split" | null | undefined;
  /** Present only when 2+ Entities are selected — Merge's only real eligibility rule. */
  onMerge?: (() => void) | undefined;
  /** Present only when every selected Property belongs to one Entity and splitting them off
   * wouldn't empty that Entity out entirely. */
  onSplit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  deleteCount: number;
  onAccept?: (() => void) | undefined;
  acceptCount: number;
  onReject?: (() => void) | undefined;
  rejectCount: number;
}) {
  const total = entities.length + properties.length + relations.length + mappingCount;
  const compositionLabel = useMemo(() => {
    const parts: string[] = [];
    if (entities.length > 0) {
      parts.push(`${entities.length} Entit${entities.length === 1 ? "y" : "ies"}`);
    }
    if (properties.length > 0) {
      parts.push(`${properties.length} Propert${properties.length === 1 ? "y" : "ies"}`);
    }
    if (relations.length > 0) {
      parts.push(`${relations.length} Relation${relations.length === 1 ? "" : "s"}`);
    }
    if (mappingCount > 0) {
      parts.push(`${mappingCount} Mapping${mappingCount === 1 ? "" : "s"}`);
    }
    return parts.join(" · ");
  }, [entities.length, properties.length, relations.length, mappingCount]);

  // Only grows a "(N)" suffix when the action doesn't cover the whole current selection — a pure
  // selection (every object the same status) reads as a plain "Delete"/"Accept"/"Reject".
  const actionLabel = useCallback(
    (label: string, count: number) => (count === total ? label : `${label} ${count}`),
    [total],
  );

  const selectedWarningCount = useMemo(
    () => properties.filter(({ property }) => propertyIssue(property) === "warning").length,
    [properties],
  );
  const [acceptWarningsOpen, setAcceptWarningsOpen] = useState(false);
  const handleAcceptClick = useCallback(() => {
    if (selectedWarningCount > 0) setAcceptWarningsOpen(true);
    else onAccept?.();
  }, [selectedWarningCount, onAccept]);
  const handleAcceptAnyway = useCallback(() => {
    setAcceptWarningsOpen(false);
    onAccept?.();
  }, [onAccept]);

  return (
    <>
      {/* Figma 501:101237: the count, a divider, then the actions (Merge / Split plain, Reject /
          Accept outlined), each with its icon. Clicking the canvas or Esc clears the selection. */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-12 items-center gap-2 rounded-lg border border-[#e3e5e4] bg-white pl-4 pr-2 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]"
      >
        <span className="whitespace-nowrap text-[14px] leading-6 text-[#161919]">
          {compositionLabel} selected
        </span>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-[#e3e5e4]" />
        {onMerge && (
          <button
            type="button"
            onClick={onMerge}
            aria-pressed={activeAction === "merge"}
            className={cn(BAR_BUTTON, activeAction === "merge" && "bg-[#e3e5e4]")}
          >
            <Copy className="size-4 -scale-x-100" strokeWidth={1.5} /> Merge
          </button>
        )}
        {onSplit && (
          <button
            type="button"
            onClick={onSplit}
            aria-pressed={activeAction === "split"}
            className={cn(BAR_BUTTON, activeAction === "split" && "bg-[#e3e5e4]")}
          >
            <SquareSplitHorizontal className="size-4" strokeWidth={1.5} /> Split
          </button>
        )}
        {onDelete && deleteCount > 0 && (
          <button
            type="button"
            onClick={onDelete}
            className={cn(BAR_BUTTON, "border border-[#e3e5e4] text-destructive")}
          >
            <SelectionBarDeleteIcon size={16} /> {actionLabel("Delete", deleteCount)}
          </button>
        )}
        {onReject && rejectCount > 0 && (
          <button
            type="button"
            onClick={onReject}
            className={cn(BAR_BUTTON, "border border-[#e3e5e4]")}
          >
            <SelectionBarDeclineIcon size={16} /> {actionLabel("Reject", rejectCount)}
          </button>
        )}
        {onAccept && acceptCount > 0 && (
          <button
            type="button"
            onClick={handleAcceptClick}
            className={cn(BAR_BUTTON, "border border-[#e3e5e4]")}
          >
            <SelectionBarAcceptIcon size={16} /> {actionLabel("Accept", acceptCount)}
          </button>
        )}
      </div>
      <Dialog open={acceptWarningsOpen} onOpenChange={setAcceptWarningsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Accept selected suggestions</DialogTitle>
            <DialogDescription>
              {selectedWarningCount} selected suggestion{selectedWarningCount === 1 ? "" : "s"} have
              warnings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAcceptWarningsOpen(false)}
              className="shrink-0 rounded-md border border-input px-3 py-1.5 text-[13px] font-medium text-foreground transition-opacity hover:opacity-80"
            >
              Review warnings
            </button>
            <button
              type="button"
              onClick={handleAcceptAnyway}
              className="shrink-0 rounded-md bg-[#00ded8] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Accept anyway
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
