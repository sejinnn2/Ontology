import { entityStatus, type Entity } from "@/lib/mock-data";
import {
  SelectionBarDeleteIcon,
  SelectionBarDeclineIcon,
  SelectionBarAcceptIcon,
  SelectionBarGoToEditingIcon,
} from "./nav-icons";

/**
 * Overview's own single-Entity contextual action bar — replaces the default `AiReviewBar` in the
 * bottom-center floating stack the moment a plain click selects exactly one Entity Type (see
 * OverviewCanvas's own `onUp` doc comment: a click now only selects, it no longer jumps straight
 * into Editing Mode). This is a REPLACEMENT, not an addition — the Confidence/Suggestions control
 * underneath answers "what am I reviewing ontology-wide", a fundamentally different question from
 * "what do I want to do with this one Entity I just clicked", so showing both at once would be
 * confusing about which one a given button actually acts on.
 *
 * Accept/Decline only make sense for an Entity that's still an actual AI suggestion — a Warning
 * still needs its own issue resolved first, and an Error/Confirmed Entity isn't a pending
 * suggestion at all — so this only offers them while `entityStatus` is exactly "suggested".
 * Delete and Go to Editing Mode are always available regardless of status.
 */
export function EntitySelectionBar({
  entity,
  onDelete,
  onAccept,
  onDecline,
  onGoToEditingMode,
}: {
  entity: Entity;
  onDelete: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onGoToEditingMode: () => void;
}) {
  const status = entityStatus(entity);
  const isPendingSuggestion = status === "suggested";

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="flex h-12 items-center gap-4 rounded-[6px] border border-border bg-white pl-4 pr-2 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"
    >
      <span className="max-w-40 truncate whitespace-nowrap text-sm text-foreground">
        {entity.name || "Untitled entity"} selected
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
        <button
          type="button"
          onClick={onGoToEditingMode}
          className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] bg-[#161919] px-2 text-sm font-medium text-[#fafafa] transition-opacity hover:opacity-90"
        >
          Go to Editing Mode <SelectionBarGoToEditingIcon size={16} />
        </button>
      </div>
    </div>
  );
}
