import { useCallback, useState } from "react";
import { initialEntities, initialRelations, tables, type ColumnRef, type Entity, type Property, type Relation } from "./mock-data";

export type Selection =
  | { kind: "entity"; id: string }
  | { kind: "table"; id: string }
  | { kind: "relation"; id: string }
  | null;

/** Only Entity Types and Source Tables are valid Detail entry points — Relations stay
 * Inspect-only for now. */
export type DetailAnchor = { kind: "entity" | "table"; id: string } | null;

export type CanvasView = { x: number; y: number; z: number };

/**
 * Single app-level state hook. This is the ONE source of truth for the ontology (entities,
 * relations — Source Tables stay static reference data, never edited by this app) as well as
 * Overview selection (Inspect), Detail navigation, and the canvas's own pan/zoom.
 *
 * `entities`/`relations` are real React state seeded once from mock-data.ts's initial arrays —
 * mock-data.ts is seed data only from here on, never re-imported at runtime by any component.
 * Every mutation goes through one of the four update* functions below rather than components
 * reaching into this state directly, so a later feature (delete/trash, confirm/reconfirm,
 * undo/redo) only has to change what happens inside these functions, not every call site:
 *   - a "trash" concept is just another field a future patch can set through updateEntity/
 *     updateRelation (e.g. `trashedAt`) — no new plumbing needed to introduce it.
 *   - "confirm"/"reconfirm" is just updateEntity/updateProperty/updateRelation setting `status`.
 *   - undo/redo has one place to hook in: wrapping setEntities/setRelations below with a
 *     snapshot-before-change history stack, the same way every mutation already funnels through
 *     just those two setters.
 * None of that is built yet — only the mutation surface itself.
 */
export function useOntologyApp() {
  const [entities, setEntities] = useState<Entity[]>(initialEntities);
  const [relations, setRelations] = useState<Relation[]>(initialRelations);

  const [selection, setSelection] = useState<Selection>(null);
  const [detail, setDetail] = useState<DetailAnchor>(null);
  const [view, setView] = useState<CanvasView>({ x: 60, y: 40, z: 0.55 });

  const select = useCallback((sel: Selection) => setSelection(sel), []);
  const clearSelection = useCallback(() => setSelection(null), []);

  // Opening Detail always keeps `selection` pointed at the same item, whichever of the many
  // paths into Detail triggered it (an Overview click, a toolbox click, or a related-entity
  // satellite click from inside Detail itself) — so Back always re-highlights whatever was last
  // actually viewed, not just whatever was clicked from Overview originally.
  const openDetail = useCallback((kind: "entity" | "table", id: string) => {
    setDetail({ kind, id });
    setSelection({ kind, id });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  // --- ontology mutations -------------------------------------------------------------------
  // Every one of these applies an immutable patch and re-renders both Overview and Detail from
  // the same updated state, since both read `entities`/`relations` from this same hook.

  const updateEntity = useCallback((id: string, patch: Partial<Omit<Entity, "id" | "properties">>) => {
    setEntities((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const updateProperty = useCallback(
    (entityId: string, propertyId: string, patch: Partial<Omit<Property, "id">>) => {
      setEntities((es) =>
        es.map((e) =>
          e.id === entityId
            ? { ...e, properties: e.properties.map((p) => (p.id === propertyId ? { ...p, ...patch } : p)) }
            : e,
        ),
      );
    },
    [],
  );

  // A named wrapper over updateProperty for the specific "connect/disconnect/reconnect a column"
  // family of future interactions, rather than callers reaching for the more general
  // updateProperty to touch `mapping` directly.
  const updateMapping = useCallback(
    (entityId: string, propertyId: string, mapping: ColumnRef | null) => {
      updateProperty(entityId, propertyId, { mapping });
    },
    [updateProperty],
  );

  const updateRelation = useCallback((id: string, patch: Partial<Omit<Relation, "id">>) => {
    setRelations((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  return {
    entities,
    relations,
    tables,
    updateEntity,
    updateProperty,
    updateMapping,
    updateRelation,
    selection,
    select,
    clearSelection,
    detail,
    openDetail,
    closeDetail,
    view,
    setView,
  };
}

export type OntologyApp = ReturnType<typeof useOntologyApp>;
