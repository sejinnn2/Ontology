import { useCallback, useMemo, useState } from "react";
import { GitMerge, Scissors } from "lucide-react";
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
export function SelectionControlBar({
  entities,
  properties,
  relations,
  onClear,
  onMerge,
  onSplit,
  onDelete,
  deleteCount,
  onAccept,
  acceptCount,
  onReject,
  rejectCount,
}: {
  entities: Entity[];
  properties: { entity: Entity; property: Property }[];
  relations: Relation[];
  onClear: () => void;
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
  const total = entities.length + properties.length + relations.length;
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
    return parts.join(" · ");
  }, [entities.length, properties.length, relations.length]);

  // Only grows a "(N)" suffix when the action doesn't cover the whole current selection — a pure
  // selection (every object the same status) reads as a plain "Delete"/"Accept"/"Reject".
  const actionLabel = useCallback(
    (label: string, count: number) => (count === total ? label : `${label} ${count}`),
    [total],
  );

  const selectedWarningCount = useMemo(
    () => properties.filter(({ property }) => property.status === "warning").length,
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
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-12 items-center gap-4 rounded-[6px] border border-border bg-white pl-4 pr-2 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"
      >
        <span className="whitespace-nowrap text-sm text-foreground">
          {compositionLabel} selected
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="flex h-8 min-w-[64px] shrink-0 items-center justify-center whitespace-nowrap px-2 text-sm font-medium text-muted-foreground transition-opacity hover:opacity-70"
          >
            Clear selection
          </button>
          {onMerge && (
            <button
              type="button"
              onClick={onMerge}
              className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-sm font-medium text-[#161919] transition-colors hover:bg-accent"
            >
              <GitMerge className="size-3.5" /> Merge
            </button>
          )}
          {onSplit && (
            <button
              type="button"
              onClick={onSplit}
              className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-sm font-medium text-[#161919] transition-colors hover:bg-accent"
            >
              <Scissors className="size-3.5" /> Split
            </button>
          )}
          {onDelete && deleteCount > 0 && (
            <button
              type="button"
              onClick={onDelete}
              className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-sm font-medium text-destructive transition-colors hover:bg-accent"
            >
              <SelectionBarDeleteIcon size={16} /> {actionLabel("Delete", deleteCount)}
            </button>
          )}
          {onReject && rejectCount > 0 && (
            <button
              type="button"
              onClick={onReject}
              className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] border border-border bg-white px-2 text-sm font-medium text-[#161919] transition-colors hover:bg-accent"
            >
              <SelectionBarDeclineIcon size={16} /> {actionLabel("Reject", rejectCount)}
            </button>
          )}
          {onAccept && acceptCount > 0 && (
            <button
              type="button"
              onClick={handleAcceptClick}
              className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] border border-border bg-white px-2 text-sm font-medium text-[#161919] transition-colors hover:bg-accent"
            >
              <SelectionBarAcceptIcon size={16} /> {actionLabel("Accept", acceptCount)}
            </button>
          )}
        </div>
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
