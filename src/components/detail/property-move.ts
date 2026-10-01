import type { OntologyApp } from "@/lib/app-state";
import { parseSuggestionKey, suggestionKey } from "@/lib/app-state";
import { PROPERTY_MOVE_DND_TYPE } from "@/components/detail/panel-dnd";

// Moving Properties between Entity Types by drag and drop, shared by every drop target (the
// Graph's Entity Type nodes and the Entity types panel's rows).

// The Entity Type a Property drag started from (drag data can't be read until the drop), so its
// own node / row doesn't light up as a target.
let dragSourceEntityId: string | null = null;
export const setPropertyDragSource = (entityId: string | null) => {
  dragSourceEntityId = entityId;
};

/** Whether this drag is a Property move that `entityId` can take. */
export function acceptsPropertyDrop(event: React.DragEvent, entityId: string): boolean {
  return (
    event.dataTransfer.types.includes(PROPERTY_MOVE_DND_TYPE) && dragSourceEntityId !== entityId
  );
}

/** Starts a Property drag: the Property, or the whole selection of its Entity Type's Properties
 * when it's part of one. */
export function startPropertyDrag(
  app: OntologyApp,
  entityId: string,
  propertyId: string,
  event: React.DragEvent,
) {
  const selectedIds: string[] = [];
  app.suggestionSelection.forEach((key) => {
    const ref = parseSuggestionKey(key);
    if (ref?.kind === "property" && ref.entityId === entityId) selectedIds.push(ref.propertyId);
  });
  const propertyIds =
    selectedIds.includes(propertyId) && selectedIds.length > 1 ? selectedIds : [propertyId];
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(
    PROPERTY_MOVE_DND_TYPE,
    JSON.stringify({ sourceEntityId: entityId, propertyIds }),
  );
  setPropertyDragSource(entityId);
}

/** Drops the dragged Properties on `targetEntityId`: moves them there and selects them in their
 * new place. Returns the moved Properties' ids (they keep their ids), or null if nothing moved. */
export function dropPropertiesOn(
  app: OntologyApp,
  event: React.DragEvent,
  targetEntityId: string,
): string[] | null {
  setPropertyDragSource(null);
  const raw = event.dataTransfer.getData(PROPERTY_MOVE_DND_TYPE);
  if (!raw) return null;
  event.preventDefault();
  event.stopPropagation();
  try {
    const payload = JSON.parse(raw) as { sourceEntityId: string; propertyIds: string[] };
    if (!payload.sourceEntityId || payload.sourceEntityId === targetEntityId) return null;
    const source = app.entities.find((e) => e.id === payload.sourceEntityId);
    const items = (source?.properties ?? [])
      .filter((p) => payload.propertyIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name }));
    if (items.length === 0) return null;
    app.moveProperties(payload.sourceEntityId, targetEntityId, items);
    app.selectSuggestionKeys(
      items.map((item) =>
        suggestionKey({ kind: "property", entityId: targetEntityId, propertyId: item.id }),
      ),
    );
    return items.map((item) => item.id);
  } catch {
    return null; // malformed payload
  }
}

/** Whether a dragleave really left `event.currentTarget`. Chrome often reports no relatedTarget
 * for drag events, so moving between a target's own rows would read as leaving it (and clear its
 * highlight, re-rendering a long list on every row) — the pointer position is the reliable test. */
export function leftDropTarget(event: React.DragEvent): boolean {
  const r = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX <= r.left ||
    event.clientX >= r.right ||
    event.clientY <= r.top ||
    event.clientY >= r.bottom
  );
}

// Properties just created: the Graph view's property list scrolls them into view (see
// `usePropertyMove`'s reveal), the same as Properties just moved there.
export const REVEAL_PROPERTIES_EVENT = "ontology:reveal-properties";
export function revealProperties(entityId: string, ids: string[]) {
  window.dispatchEvent(new CustomEvent(REVEAL_PROPERTIES_EVENT, { detail: { entityId, ids } }));
}
