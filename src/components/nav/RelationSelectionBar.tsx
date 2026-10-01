import {
  canConfirmRelation,
  relationLabel,
  relationReview,
  type Entity,
  type Relation,
} from "@/lib/mock-data";
import { AcceptButton, DeleteButton, RejectButton, SelectionBarShell } from "./selection-bar-ui";

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
  entities,
  onDelete,
  onAccept,
  onDecline,
}: {
  relation: Relation;
  entities: Entity[];
  onDelete: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const isPendingSuggestion = relationReview(relation) === "suggested";

  return (
    <SelectionBarShell label={`${relationLabel(relation)} selected`}>
      {!isPendingSuggestion && <DeleteButton onClick={onDelete} />}
      {isPendingSuggestion && <RejectButton onClick={onDecline} />}
      {isPendingSuggestion && (
        <AcceptButton
          onClick={onAccept}
          disabledReason={
            canConfirmRelation(relation, entities)
              ? undefined
              : "Confirm both Entity Types (with no errors) before confirming this Relation."
          }
        />
      )}
    </SelectionBarShell>
  );
}
