import { useCallback, useState } from "react";
import { initialEntities, initialRelations, tables, type ColumnRef, type Entity, type Property, type Relation } from "./mock-data";
import { NODE_SIZE } from "./geometry";

let entityUidCounter = 0;
const entityUid = () => `entity_${Date.now().toString(36)}${(entityUidCounter++).toString(36)}`;
let relationUidCounter = 0;
const relationUid = () => `rel_${Date.now().toString(36)}${(relationUidCounter++).toString(36)}`;
let propUidCounter = 0;
const propUid = () => `prop_${Date.now().toString(36)}${(propUidCounter++).toString(36)}`;

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

  // Moves one property from one entity to another (drag a property row onto a different entity's
  // node). No-ops if the target is the same as the source.
  const moveProperty = useCallback((propId: string, fromEntityId: string, toEntityId: string) => {
    if (fromEntityId === toEntityId) return;
    setEntities((es) => {
      const source = es.find((e) => e.id === fromEntityId);
      const prop = source?.properties.find((p) => p.id === propId);
      if (!prop) return es;
      return es.map((e) => {
        if (e.id === fromEntityId) return { ...e, properties: e.properties.filter((p) => p.id !== propId) };
        if (e.id === toEntityId) return { ...e, properties: [...e.properties, prop] };
        return e;
      });
    });
  }, []);

  // Connects two entities with a new relation — but if any relation already connects them (in
  // either direction), that existing one is returned instead of creating a redundant second edge
  // between the same pair.
  const addRelation = useCallback(
    (fromId: string, toId: string) => {
      const existing = relations.find((r) => (r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId));
      if (existing) return existing.id;
      const id = relationUid();
      const newRelation: Relation = { id, name: "relatesTo", from: fromId, to: toId, confidence: 1, status: "confirmed" };
      setRelations((rs) => [...rs, newRelation]);
      return id;
    },
    [relations],
  );

  const deleteRelation = useCallback((id: string) => {
    setRelations((rs) => rs.filter((r) => r.id !== id));
  }, []);

  // Splits an entity's properties into two entities: the original keeps whichever properties
  // weren't selected, a new entity (name left blank for immediate editing later) takes the rest.
  // No-ops if `moveIds` would empty out either side.
  const splitEntity = useCallback(
    (entityId: string, moveIds: string[]) => {
      const original = entities.find((e) => e.id === entityId);
      if (!original) return null;
      const moveSet = new Set(moveIds);
      const moved = original.properties.filter((p) => moveSet.has(p.id));
      const kept = original.properties.filter((p) => !moveSet.has(p.id));
      if (moved.length === 0 || kept.length === 0) return null;
      const newId = entityUid();
      const newEntity: Entity = {
        id: newId,
        name: "",
        description: "",
        confidence: original.confidence,
        status: "confirmed",
        table: original.table,
        x: original.x + NODE_SIZE + 40,
        y: original.y,
        properties: moved,
      };
      setEntities((es) => es.map((e) => (e.id === entityId ? { ...e, properties: kept } : e)).concat(newEntity));
      return newId;
    },
    [entities],
  );

  // Combines two or more entities into one new entity: every property from every source entity
  // carries over (re-keyed to stay unique), and any relation that pointed at a merged entity is
  // repointed at the new one — a relation that would become a self-loop (both ends merged
  // together) is dropped since it no longer describes anything.
  const mergeEntities = useCallback(
    (ids: string[], name: string) => {
      const idSet = new Set(ids);
      const merged = entities.filter((e) => idSet.has(e.id));
      if (merged.length < 2 || !name.trim()) return null;
      const first = merged[0]!;
      const newId = entityUid();
      const properties = merged.flatMap((e) => e.properties.map((p) => ({ ...p, id: propUid() })));
      const x = merged.reduce((n, e) => n + e.x, 0) / merged.length;
      const y = merged.reduce((n, e) => n + e.y, 0) / merged.length;
      const newEntity: Entity = {
        id: newId,
        name: name.trim(),
        description: first.description,
        confidence: Math.min(...merged.map((e) => e.confidence)),
        status: "suggested",
        table: first.table,
        x,
        y,
        properties,
      };
      setEntities((es) => [...es.filter((e) => !idSet.has(e.id)), newEntity]);
      setRelations((rs) =>
        rs
          .map((r) => ({ ...r, from: idSet.has(r.from) ? newId : r.from, to: idSet.has(r.to) ? newId : r.to }))
          .filter((r) => r.from !== r.to),
      );
      return newId;
    },
    [entities],
  );

  return {
    entities,
    relations,
    tables,
    updateEntity,
    updateProperty,
    updateMapping,
    updateRelation,
    moveProperty,
    addRelation,
    deleteRelation,
    splitEntity,
    mergeEntities,
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
