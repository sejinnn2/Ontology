// Dragging a row straight out of the editing workspace's side panels — "Entity types" (left) or
// "Data tables" (right) — onto the canvas, to add it to THIS workspace. Distinct from
// moving a Property between two Entities (`PROPERTY_MOVE_DND_TYPE` below), so
// the drags never collide.
export const ENTITY_PANEL_DND_TYPE = "application/x-idea4-entity-from-panel";
export const TABLE_PANEL_DND_TYPE = "application/x-idea4-table-from-panel";

// Moving Properties (one, or a multi-selection from one Entity Type) onto another Entity Type:
// the payload is `{ sourceEntityId, propertyIds }` as JSON.
export const PROPERTY_MOVE_DND_TYPE = "application/x-idea4-move-properties";
