import { canConfirmEntity, entityReview, type Entity } from "@/lib/mock-data";
import {
  AcceptButton,
  DeleteButton,
  GoToEditingButton,
  RejectButton,
  SelectionBarShell,
} from "./selection-bar-ui";

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
 * still a suggestion (`entityReview`) — Accept stays disabled while it has an Error.
 * Delete takes their place otherwise (Figma 361:221450 vs 361:221511); Go to Editing Mode is always
 * there.
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
  const isPendingSuggestion = entityReview(entity) === "suggested";

  return (
    <SelectionBarShell label={`${entity.name || "Untitled entity"} selected`}>
      {!isPendingSuggestion && <DeleteButton onClick={onDelete} />}
      {isPendingSuggestion && <RejectButton onClick={onDecline} />}
      {isPendingSuggestion && (
        <AcceptButton
          onClick={onAccept}
          disabledReason={
            canConfirmEntity(entity) ? undefined : "Fix the errors before confirming."
          }
        />
      )}
      <GoToEditingButton onClick={onGoToEditingMode} />
    </SelectionBarShell>
  );
}
