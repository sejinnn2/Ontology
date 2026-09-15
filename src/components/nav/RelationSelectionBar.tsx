import { relationLabel, type Relation } from "@/lib/mock-data";
import {
  SelectionBarDeleteIcon,
  SelectionBarDeclineIcon,
  SelectionBarAcceptIcon,
} from "./nav-icons";

/**
 * Overview's single-Relation contextual action bar — the exact same slot and replacement rule as
 * `EntitySelectionBar` (see its own doc comment): it takes over the bottom-center stack the moment
 * a plain click selects exactly one Relation, in place of the default `AiReviewBar`. Deliberately
 * has no "Go to Editing Mode" — Relations have no Detail view of their own (see app-state's
 * `DetailAnchor`), so there's nowhere for that button to send the user.
 *
 * Accept/Decline only make sense while the Relation is still an actual pending AI suggestion —
 * exactly the same "suggested" gate `EntitySelectionBar` applies. Delete is always available
 * regardless of status.
 */
export function RelationSelectionBar({
  relation,
  onDelete,
  onAccept,
  onDecline,
}: {
  relation: Relation;
  onDelete: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const isPendingSuggestion = relation.status === "suggested";

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="flex h-12 items-center gap-4 rounded-[6px] border border-border bg-white pl-4 pr-2 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"
    >
      <span className="max-w-40 truncate whitespace-nowrap text-sm text-foreground">
        {relationLabel(relation)} selected
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDelete}
          className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-sm font-medium text-destructive transition-colors hover:bg-accent"
        >
          <SelectionBarDeleteIcon size={16} /> Delete
        </button>
        {isPendingSuggestion && (
          <button
            type="button"
            onClick={onDecline}
            className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] border border-border bg-white px-2 text-sm font-medium text-[#161919] transition-colors hover:bg-accent"
          >
            <SelectionBarDeclineIcon size={16} /> Reject
          </button>
        )}
        {isPendingSuggestion && (
          <button
            type="button"
            onClick={onAccept}
            className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] border border-border bg-white px-2 text-sm font-medium text-[#161919] transition-colors hover:bg-accent"
          >
            <SelectionBarAcceptIcon size={16} /> Accept
          </button>
        )}
      </div>
    </div>
  );
}
