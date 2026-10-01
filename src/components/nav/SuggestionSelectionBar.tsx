import { useCallback, useEffect, useMemo, useState } from "react";
import { parseSuggestionKey } from "@/lib/app-state";
import { isTypingTarget } from "@/components/ontology/CanvasControls";
import {
  entityIssue,
  entityReview,
  mappingStatus,
  propertyIssue,
  propertyReview,
  relationIssue,
  relationReview,
  type Entity,
  type Relation,
} from "@/lib/mock-data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AcceptButton,
  DeleteButton,
  GoToEditingButton,
  RejectButton,
  SelectionBarShell,
} from "./selection-bar-ui";

/** The contextual Accept/Decline bar for the AI Suggestions selection workflow — floats above the
 * canvas's own bottom controls (Overview and Detail each render it there, just above their own
 * `CanvasControls`) rather than docked in the Header, since it's an action bar over whichever
 * canvas the user is actually looking at right now, not part of the global review chrome above it.
 * Selection itself stays a GLOBAL concept (see app-state's own `suggestionSelection` comment),
 * reachable from Overview or Detail alike — both render this exact same component. Only ever
 * visible while there's an active selection; the Accept-warnings dialog stays mounted underneath
 * regardless so a close-animation isn't cut short by the bar disappearing mid-transition. */
export function SuggestionSelectionBar({
  entities,
  relations,
  suggestionSelection,
  onClearSuggestionSelection,
  onAcceptSuggestions,
  onDeclineSuggestions,
  onDeleteSuggestions,
  onGoToEditingMode,
}: {
  entities: Entity[];
  relations: Relation[];
  suggestionSelection: Set<string>;
  onClearSuggestionSelection: () => void;
  onAcceptSuggestions: (keys: string[]) => void;
  onDeclineSuggestions: (keys: string[]) => void;
  /** Deletes every currently-selected item outright (an ontology mutation, into Trash like every
   * other delete in this app) — a stronger action than Decline, which only ever applies to actual
   * pending suggestions; Delete works regardless of status (Confirmed/Warning/Error included). */
  onDeleteSuggestions: (keys: string[]) => void;
  /** Figma 361:221554 shows "Go to Editing Mode" here too. A multi-kind selection doesn't always
   * resolve to one Detail anchor, so the caller passes this only when it found one. */
  onGoToEditingMode?: (() => void) | undefined;
}) {
  // A property's own owning Entity Type isn't carried on the selection key itself — this is the
  // one lookup the warning-count check below needs.
  const findPropertyOwner = useCallback(
    (propertyId: string) => {
      for (const e of entities) {
        const p = e.properties.find((x) => x.id === propertyId);
        if (p) return { entity: e, property: p };
      }
      return null;
    },
    [entities],
  );

  // What the selection is actually MADE OF, by kind — shown instead of a bare "N selected", which
  // never said whether that N was Entities, Properties, or Relations (e.g. "Select all in range"
  // can select all three kinds at once). Zero-count kinds are omitted entirely rather than shown
  // as "0 Relations" — see the render site below.
  const composition = useMemo(() => {
    let entityCount = 0;
    let propertyCount = 0;
    let relationCount = 0;
    let mappingCount = 0;
    suggestionSelection.forEach((key) => {
      const ref = parseSuggestionKey(key);
      if (!ref) return;
      if (ref.kind === "entity") entityCount += 1;
      else if (ref.kind === "relation") relationCount += 1;
      else if (ref.kind === "property") propertyCount += 1;
      else mappingCount += 1;
    });
    return { entityCount, propertyCount, relationCount, mappingCount };
  }, [suggestionSelection]);
  const compositionLabel = useMemo(() => {
    const parts: string[] = [];
    if (composition.entityCount > 0) {
      parts.push(`${composition.entityCount} Entit${composition.entityCount === 1 ? "y" : "ies"}`);
    }
    if (composition.propertyCount > 0) {
      parts.push(
        `${composition.propertyCount} Propert${composition.propertyCount === 1 ? "y" : "ies"}`,
      );
    }
    if (composition.relationCount > 0) {
      parts.push(
        `${composition.relationCount} Relation${composition.relationCount === 1 ? "" : "s"}`,
      );
    }
    if (composition.mappingCount > 0) {
      parts.push(`${composition.mappingCount} Mapping${composition.mappingCount === 1 ? "" : "s"}`);
    }
    return parts.join(" · ");
  }, [composition]);

  // How many of the CURRENTLY selected suggestions carry a Warning — Accept gates on this (a
  // lightweight "N have warnings — Review warnings / Accept anyway" step) but Decline never does;
  // Errors don't gate Accept here either since `onAcceptSuggestions` itself silently drops them.
  const selectedWarningCount = useMemo(() => {
    let count = 0;
    suggestionSelection.forEach((key) => {
      const ref = parseSuggestionKey(key);
      if (!ref) return;
      if (ref.kind === "entity") {
        const entity = entities.find((x) => x.id === ref.id);
        if (entity && entityIssue(entity) === "warning") count += 1;
      } else if (ref.kind === "relation") {
        const relation = relations.find((x) => x.id === ref.id);
        if (relation && relationIssue(relation, entities) === "warning") count += 1;
      } else if (ref.kind === "property") {
        const owner = findPropertyOwner(ref.propertyId);
        if (owner && propertyIssue(owner.property) === "warning") count += 1;
      }
    });
    return count;
  }, [suggestionSelection, entities, relations, findPropertyOwner]);

  // Decline/Accept only make sense while AT LEAST ONE selected item is still an actual pending
  // suggestion — matching `EntitySelectionBar`/`RelationSelectionBar`'s own `isPendingSuggestion`
  // gate (Figma's "Confirmed" reference frame, 182:50699, omits both buttons entirely once nothing
  // in the selection is still pending review).
  const hasPendingSuggestion = useMemo(() => {
    for (const key of suggestionSelection) {
      const ref = parseSuggestionKey(key);
      if (!ref) continue;
      if (ref.kind === "entity") {
        const entity = entities.find((x) => x.id === ref.id);
        if (entity && entityReview(entity) === "suggested") return true;
      } else if (ref.kind === "relation") {
        const relation = relations.find((x) => x.id === ref.id);
        if (relation && relationReview(relation) === "suggested") return true;
      } else if (ref.kind === "property") {
        const owner = findPropertyOwner(ref.propertyId);
        if (owner && propertyReview(owner.property) === "suggested") return true;
      } else if (ref.kind === "mapping") {
        const mappings = findPropertyOwner(ref.propertyId)?.property.mappings ?? [];
        const pending = mappings.some(
          (m) =>
            mappingStatus(m) === "suggested" &&
            (!ref.table || (m.table === ref.table && m.column === ref.column)),
        );
        if (pending) return true;
      }
    }
    return false;
  }, [suggestionSelection, entities, relations, findPropertyOwner]);

  // Figma's bar has no "Clear selection" button: Esc clears instead (as does clicking empty canvas).
  const selecting = suggestionSelection.size > 0;
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTypingTarget(event.target)) return;
      onClearSuggestionSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting, onClearSuggestionSelection]);

  const [acceptWarningsOpen, setAcceptWarningsOpen] = useState(false);
  const handleAcceptClick = useCallback(() => {
    if (selectedWarningCount > 0) setAcceptWarningsOpen(true);
    else onAcceptSuggestions(Array.from(suggestionSelection));
  }, [selectedWarningCount, onAcceptSuggestions, suggestionSelection]);
  const handleAcceptAnyway = useCallback(() => {
    setAcceptWarningsOpen(false);
    onAcceptSuggestions(Array.from(suggestionSelection));
  }, [onAcceptSuggestions, suggestionSelection]);

  return (
    <>
      {suggestionSelection.size > 0 && (
        <SelectionBarShell label={`${compositionLabel} selected`}>
          {!hasPendingSuggestion && (
            <DeleteButton onClick={() => onDeleteSuggestions(Array.from(suggestionSelection))} />
          )}
          {hasPendingSuggestion && (
            <RejectButton onClick={() => onDeclineSuggestions(Array.from(suggestionSelection))} />
          )}
          {hasPendingSuggestion && <AcceptButton onClick={handleAcceptClick} />}
          {onGoToEditingMode && <GoToEditingButton onClick={onGoToEditingMode} />}
        </SelectionBarShell>
      )}

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
