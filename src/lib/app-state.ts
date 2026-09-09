import { useCallback, useState } from "react";
import {
  initialEntities,
  initialRelations,
  tableByName,
  tables,
  type ColumnRef,
  type Entity,
  type Property,
  type Relation,
} from "./mock-data";
import { NODE_W } from "./geometry";

let entityUidCounter = 0;
const entityUid = () => `entity_${Date.now().toString(36)}${(entityUidCounter++).toString(36)}`;
let relationUidCounter = 0;
const relationUid = () => `rel_${Date.now().toString(36)}${(relationUidCounter++).toString(36)}`;
let propUidCounter = 0;
const propUid = () => `prop_${Date.now().toString(36)}${(propUidCounter++).toString(36)}`;

/** The exact `errorReason` a placeholder Relation is created with (see `createPlaceholderRelation`
 * below) — explains *why* this particular unnamed Relation exists (two Entity Types ended up
 * placed next to each other). `renameRelation`'s own Error-clearing rule doesn't check this by
 * name — it clears any Relation Error whose `name` is still blank, since that's the one thing both
 * this and `RELATION_NAME_REQUIRED_REASON` below actually have in common — but this stays a
 * distinct constant because the *reason shown to the reviewer* is legitimately different for the
 * two creation paths. */
export const PLACEHOLDER_RELATION_REASON =
  "This relation was created automatically because these Entity Types were placed next to each other with no existing relation between them — give it a name to resolve this.";

/** The exact `errorReason` a Relation is created with by dragging one Entity Type's connection
 * handle onto another (see `addRelation` below) — creation is immediate on the drag/drop gesture
 * itself ("create structure, then validate, then fix details"), never gated on a name, so every
 * such Relation starts out unnamed and in this Error until the reviewer names it. */
export const RELATION_NAME_REQUIRED_REASON = "Relation name is required.";

export type Selection =
  | { kind: "entity"; id: string }
  | { kind: "table"; id: string }
  | { kind: "relation"; id: string }
  | null;

/** Only Entity Types and Source Tables are valid Detail entry points — Relations stay
 * Inspect-only for now. `focusPropertyId`/`focusColumnName` are one-shot "arrive with this child
 * already highlighted" hints — set only by Overview's own ontology/data search (selecting a
 * Property or Column result), read once by EntityDetailCanvas/TableDetailCanvas to seed their
 * initial contextual-panel selection, and never written back or treated as durable state. */
export type DetailAnchor =
  | { kind: "entity"; id: string; focusPropertyId?: string | undefined }
  | { kind: "table"; id: string; focusColumnName?: string | undefined }
  | null;

export type CanvasView = { x: number; y: number; z: number };

/** The Header's Confidence score range filter — 0-100 (a percent, not the raw 0-1 `confidence`
 * every Entity/Property/Relation carries). Lives here rather than local to the Header since both
 * Overview and Detail read it to dim/hide out-of-range items on their own canvases and toolbox
 * lists. */
export type ConfidenceRange = { min: number; max: number };

// --- Trash ------------------------------------------------------------------------------------
// Delete never permanently destroys anything here — it moves a full snapshot of the item into one
// of these three lists instead, which is what makes Restore possible later. Each snapshot keeps
// everything needed to put the item back exactly as it was (an Entity's own x/y position and every
// property, a Property's original mapping, a Relation's from/to) — restoring is then just "does
// the thing(s) this depends on still exist", never a lossy reconstruction.
export type TrashedEntity = {
  entity: Entity;
  /** Relations that were cascade-deleted alongside this Entity Type (because one end of them was
   * this entity) — restoring the entity also retries these, so a relation whose other endpoint
   * was never touched comes back for free instead of being stranded in the Relations trash. */
  relatedTrashedRelationIds: string[];
  trashedAt: number;
};
export type TrashedProperty = {
  /** The Entity Type this Property is restored back onto — never itself deleted by deleting a
   * Property (only deleting the Entity Type deletes its Properties). */
  entityId: string;
  property: Property;
  trashedAt: number;
};
export type TrashedRelation = {
  relation: Relation;
  trashedAt: number;
};

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
  const [trashedEntities, setTrashedEntities] = useState<TrashedEntity[]>([]);
  const [trashedProperties, setTrashedProperties] = useState<TrashedProperty[]>([]);
  const [trashedRelations, setTrashedRelations] = useState<TrashedRelation[]>([]);

  const [selection, setSelection] = useState<Selection>(null);
  const [detail, setDetail] = useState<DetailAnchor>(null);
  const [view, setView] = useState<CanvasView>({ x: 60, y: 40, z: 0.55 });
  const [confidenceRange, setConfidenceRange] = useState<ConfidenceRange>({ min: 0, max: 100 });

  const select = useCallback((sel: Selection) => setSelection(sel), []);
  const clearSelection = useCallback(() => setSelection(null), []);

  // Opening Detail always keeps `selection` pointed at the same item, whichever of the many
  // paths into Detail triggered it (an Overview click, a toolbox click, or a related-entity
  // satellite click from inside Detail itself) — so Back always re-highlights whatever was last
  // actually viewed, not just whatever was clicked from Overview originally.
  const openDetail = useCallback((kind: "entity" | "table", id: string, focusChildId?: string) => {
    setDetail(
      kind === "entity"
        ? { kind, id, focusPropertyId: focusChildId }
        : { kind, id, focusColumnName: focusChildId },
    );
    setSelection({ kind, id });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  // --- ontology mutations -------------------------------------------------------------------
  // Every one of these applies an immutable patch and re-renders both Overview and Detail from
  // the same updated state, since both read `entities`/`relations` from this same hook.

  const updateEntity = useCallback(
    (id: string, patch: Partial<Omit<Entity, "id" | "properties">>) => {
      setEntities((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },
    [],
  );

  const updateProperty = useCallback(
    (entityId: string, propertyId: string, patch: Partial<Omit<Property, "id">>) => {
      setEntities((es) =>
        es.map((e) =>
          e.id === entityId
            ? {
                ...e,
                properties: e.properties.map((p) => (p.id === propertyId ? { ...p, ...patch } : p)),
              }
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

  // A user typing a brand-new Entity Type into the panel's "+" popover is asserting it's real,
  // not proposing something for review — the opposite situation from every AI-suggested seed
  // entity — so this starts "confirmed" at full confidence rather than "suggested" like schema
  // discovery would produce. `position` defaults to (0, 0) — Detail's own panel-based creation
  // relies on exactly that default, since there the user places it themselves via drag; Overview
  // has no panel to hold it in, so it passes the current viewport's own center instead (see
  // OverviewCanvas's own `handleCreateEntity`) so the new entity is immediately visible.
  const createEntity = useCallback((name: string, position?: { x: number; y: number }) => {
    const id = entityUid();
    const newEntity: Entity = {
      id,
      name: name.trim(),
      description: "",
      confidence: 1,
      status: "confirmed",
      table: "",
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      properties: [],
    };
    setEntities((es) => [...es, newEntity]);
    return id;
  }, []);

  // Same "the user is asserting this, not an AI proposing it" reasoning as createEntity above —
  // "confirmed" at full confidence, and never mapped to a column automatically (an unmapped
  // Property is a perfectly valid, non-Error state — see mock-data's own ReviewFlags note).
  const createProperty = useCallback((entityId: string, name: string) => {
    const id = propUid();
    const newProperty: Property = {
      id,
      name: name.trim(),
      description: "",
      type: "string",
      confidence: 1,
      status: "confirmed",
      mapping: null,
    };
    setEntities((es) =>
      es.map((e) => (e.id === entityId ? { ...e, properties: [...e.properties, newProperty] } : e)),
    );
    return id;
  }, []);

  // Applies the global Confirm dialog's outcome in one atomic pass — every id here already
  // passed the confirmation-eligibility check (see `buildConfirmPlan`), so this never needs to
  // re-check status itself; it only flips exactly the given Entities/Properties/Relations to
  // "confirmed", leaving everything else (including any still-blocked Error items) untouched.
  const confirmItems = useCallback(
    (ids: {
      entityIds: string[];
      propertyIds: { entityId: string; propertyId: string }[];
      relationIds: string[];
    }) => {
      const entitySet = new Set(ids.entityIds);
      const propByEntity = new Map<string, Set<string>>();
      ids.propertyIds.forEach(({ entityId, propertyId }) => {
        const set = propByEntity.get(entityId) ?? new Set<string>();
        set.add(propertyId);
        propByEntity.set(entityId, set);
      });
      setEntities((es) =>
        es.map((e) => {
          const propIds = propByEntity.get(e.id);
          const properties = propIds
            ? e.properties.map((p) =>
                propIds.has(p.id) ? { ...p, status: "confirmed" as const } : p,
              )
            : e.properties;
          if (!entitySet.has(e.id) && properties === e.properties) return e;
          return {
            ...e,
            ...(entitySet.has(e.id) ? { status: "confirmed" as const } : {}),
            properties,
          };
        }),
      );
      const relationSet = new Set(ids.relationIds);
      setRelations((rs) =>
        rs.map((r) => (relationSet.has(r.id) ? { ...r, status: "confirmed" as const } : r)),
      );
    },
    [],
  );

  // Moves one or more properties from one entity to another in a single atomic update (drag a
  // property row — or, when several are selected, the whole selection together — onto a
  // different entity's node/card). No-ops if the target is the same as the source. `items` lets
  // the caller resolve any name conflicts with the destination entity *before* calling this (see
  // the Detail canvas's own conflict-resolution panel) — this function performs exactly the move
  // (and rename) it's told to, with no conflict detection of its own, so a property's id, type,
  // description, status, confidence, and existing column mapping all carry over untouched except
  // for the name.
  const moveProperties = useCallback(
    (fromEntityId: string, toEntityId: string, items: { id: string; name: string }[]) => {
      if (fromEntityId === toEntityId || items.length === 0) return;
      setEntities((es) => {
        const source = es.find((e) => e.id === fromEntityId);
        if (!source) return es;
        const renameById = new Map(items.map((i) => [i.id, i.name]));
        const moved = source.properties
          .filter((p) => renameById.has(p.id))
          .map((p) => ({ ...p, name: renameById.get(p.id)! }));
        if (moved.length === 0) return es;
        return es.map((e) => {
          if (e.id === fromEntityId)
            return { ...e, properties: e.properties.filter((p) => !renameById.has(p.id)) };
          if (e.id === toEntityId) return { ...e, properties: [...e.properties, ...moved] };
          return e;
        });
      });
    },
    [],
  );

  // Connects two entities with a new relation — but if any relation already connects them (in
  // either direction), that existing one is returned instead of creating a redundant second edge
  // between the same pair. The drag gesture itself is sufficient intent to create the Relation —
  // this never opens a naming prompt and never blocks on a missing name: it always creates
  // immediately, unnamed and in Error (see RELATION_NAME_REQUIRED_REASON), exactly like
  // `createPlaceholderRelation` below. Direction follows the drag: `fromId` is always wherever the
  // user grabbed the handle, `toId` wherever they dropped, and nothing here ever re-derives or
  // changes that later — only the separate "Swap direction" action (`updateRelation` on `from`/
  // `to`) may do that.
  const addRelation = useCallback(
    (fromId: string, toId: string) => {
      const existing = relations.find(
        (r) => (r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId),
      );
      if (existing) return existing.id;
      const id = relationUid();
      const newRelation: Relation = {
        id,
        name: "",
        description: "",
        from: fromId,
        to: toId,
        confidence: 0,
        status: "error",
        errorReason: RELATION_NAME_REQUIRED_REASON,
      };
      setRelations((rs) => [...rs, newRelation]);
      return id;
    },
    [relations],
  );

  // Placing an Entity Type next to another in Detail's center card column (dragging a related
  // satellite in, or dropping one straight from the toolbox) only draws a connector when a real
  // Relation already exists — it never fabricates a relationship silently. This is the one
  // exception: when the two placed side by side have no Relation at all yet, this creates an
  // unnamed, Error-status placeholder for that specific pair instead of leaving them looking
  // unrelated forever, so there's something concrete for the reviewer to either name (resolving
  // the Error — see `renameRelation`) or delete outright.
  const createPlaceholderRelation = useCallback((fromId: string, toId: string) => {
    const id = relationUid();
    const newRelation: Relation = {
      id,
      name: "",
      description: "",
      from: fromId,
      to: toId,
      confidence: 0,
      status: "error",
      errorReason: PLACEHOLDER_RELATION_REASON,
    };
    setRelations((rs) => [...rs, newRelation]);
    return id;
  }, []);

  // Renaming a Relation is a plain field update for any other Relation, but one that's still
  // unnamed (whichever of the two "no name yet" creation paths put it in Error — a drag-created
  // Relation via `addRelation`, or a placement-adjacency one via `createPlaceholderRelation`) has
  // its Error purely *because* it has no name, so giving it any real, non-blank name is exactly
  // what resolves that Error — the one rename that also clears status back to "suggested", never
  // touching a Relation whose Error has some other, unrelated cause (which by definition already
  // has a real name, since neither of those two paths ever sets an Error with a name attached).
  const renameRelation = useCallback(
    (id: string, name: string) => {
      const relation = relations.find((r) => r.id === id);
      if (!relation) return;
      const trimmed = name.trim();
      const patch: Partial<Omit<Relation, "id">> = { name: trimmed };
      if (relation.status === "error" && relation.name.trim() === "" && trimmed !== "") {
        patch.status = "suggested";
      }
      setRelations((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [relations],
  );

  // Delete moves the item into Trash rather than destroying it — see the `Trashed*` types above.
  // Removing either connected Entity Type never happens as a side effect of deleting a Relation.
  const deleteRelation = useCallback(
    (id: string) => {
      const relation = relations.find((r) => r.id === id);
      if (!relation) return;
      setRelations((rs) => rs.filter((r) => r.id !== id));
      setTrashedRelations((ts) => [...ts, { relation, trashedAt: Date.now() }]);
      setSelection((s) => (s?.kind === "relation" && s.id === id ? null : s));
    },
    [relations],
  );

  // Deleting an Entity Type takes its own Properties with it (they only ever exist attached to
  // it) and cascades to every Relation connected to it, since a relation can't point at an entity
  // that no longer exists on the active canvas — all of it moves into Trash together so Restore
  // can try to bring the whole group back. Never touches any *other* Entity Type. If Detail is
  // currently anchored on the entity being deleted, there's nothing left to show there, so this
  // backs out to Overview instead of leaving Detail pointed at a nonexistent entity.
  const deleteEntity = useCallback(
    (entityId: string) => {
      const target = entities.find((e) => e.id === entityId);
      if (!target) return;
      const cascaded = relations.filter((r) => r.from === entityId || r.to === entityId);
      setEntities((es) => es.filter((e) => e.id !== entityId));
      setRelations((rs) => rs.filter((r) => r.from !== entityId && r.to !== entityId));
      setTrashedEntities((ts) => [
        ...ts,
        {
          entity: target,
          relatedTrashedRelationIds: cascaded.map((r) => r.id),
          trashedAt: Date.now(),
        },
      ]);
      if (cascaded.length > 0) {
        setTrashedRelations((ts) => [
          ...ts,
          ...cascaded.map((relation) => ({ relation, trashedAt: Date.now() })),
        ]);
      }
      setDetail((d) => (d?.kind === "entity" && d.id === entityId ? null : d));
      setSelection((s) => (s?.kind === "entity" && s.id === entityId ? null : s));
    },
    [entities, relations],
  );

  // Deleting a Property only ever removes it from its one parent Entity Type — the mapping (if
  // any) simply disappears along with it, since a mapping can't outlive the Property it belongs
  // to; no other Property's mapping is touched. The Entity Type itself is never deleted this way.
  const deleteProperty = useCallback(
    (entityId: string, propertyId: string) => {
      const owner = entities.find((e) => e.id === entityId);
      const property = owner?.properties.find((p) => p.id === propertyId);
      if (!property) return;
      setEntities((es) =>
        es.map((e) =>
          e.id === entityId
            ? { ...e, properties: e.properties.filter((p) => p.id !== propertyId) }
            : e,
        ),
      );
      setTrashedProperties((ts) => [...ts, { entityId, property, trashedAt: Date.now() }]);
    },
    [entities],
  );

  // Batch counterpart to deleteEntity — for the multi-select contextual "Delete" action (2+
  // Entity Types selected). Computed against one snapshot of `entities`/`relations` rather than
  // looping the single-item deleteEntity above, so a Relation directly connecting two entities
  // that are BOTH in this same batch is only ever trashed once, not once per side. Same dependency
  // behavior as the single-item version otherwise: every deleted entity's own Properties go with
  // it, and every Relation touching any deleted entity cascades into Trash alongside it.
  const deleteEntities = useCallback(
    (entityIds: string[]) => {
      const idSet = new Set(entityIds);
      const targets = entities.filter((e) => idSet.has(e.id));
      if (targets.length === 0) return;
      const cascaded = relations.filter((r) => idSet.has(r.from) || idSet.has(r.to));
      const now = Date.now();
      setEntities((es) => es.filter((e) => !idSet.has(e.id)));
      setRelations((rs) => rs.filter((r) => !idSet.has(r.from) && !idSet.has(r.to)));
      setTrashedEntities((ts) => [
        ...ts,
        ...targets.map((entity) => ({
          entity,
          relatedTrashedRelationIds: cascaded
            .filter((r) => r.from === entity.id || r.to === entity.id)
            .map((r) => r.id),
          trashedAt: now,
        })),
      ]);
      if (cascaded.length > 0) {
        setTrashedRelations((ts) => [
          ...ts,
          ...cascaded.map((relation) => ({ relation, trashedAt: now })),
        ]);
      }
      setDetail((d) => (d?.kind === "entity" && idSet.has(d.id) ? null : d));
      setSelection((s) => (s?.kind === "entity" && idSet.has(s.id) ? null : s));
    },
    [entities, relations],
  );

  // Batch counterpart to deleteProperty — for the multi-select contextual "Delete" action (2+
  // Properties selected, the same selection Split already uses). Each property is only ever
  // removed from its own parent Entity Type, exactly like the single-item version.
  const deleteProperties = useCallback(
    (items: { entityId: string; propertyId: string }[]) => {
      if (items.length === 0) return;
      const idsByEntity = new Map<string, Set<string>>();
      items.forEach(({ entityId, propertyId }) => {
        const set = idsByEntity.get(entityId) ?? new Set<string>();
        set.add(propertyId);
        idsByEntity.set(entityId, set);
      });
      const now = Date.now();
      const trashedBatch: TrashedProperty[] = [];
      entities.forEach((e) => {
        const ids = idsByEntity.get(e.id);
        if (!ids) return;
        e.properties.forEach((p) => {
          if (ids.has(p.id)) trashedBatch.push({ entityId: e.id, property: p, trashedAt: now });
        });
      });
      if (trashedBatch.length === 0) return;
      setEntities((es) =>
        es.map((e) => {
          const ids = idsByEntity.get(e.id);
          if (!ids) return e;
          return { ...e, properties: e.properties.filter((p) => !ids.has(p.id)) };
        }),
      );
      setTrashedProperties((ts) => [...ts, ...trashedBatch]);
    },
    [entities],
  );

  // Batch counterpart to deleteRelation — for the multi-select contextual "Delete" action (1+
  // Relations selected). Never touches either connected Entity Type, exactly like the single-item
  // version.
  const deleteRelations = useCallback(
    (relationIds: string[]) => {
      const idSet = new Set(relationIds);
      const targets = relations.filter((r) => idSet.has(r.id));
      if (targets.length === 0) return;
      const now = Date.now();
      setRelations((rs) => rs.filter((r) => !idSet.has(r.id)));
      setTrashedRelations((ts) => [
        ...ts,
        ...targets.map((relation) => ({ relation, trashedAt: now })),
      ]);
      setSelection((s) => (s?.kind === "relation" && idSet.has(s.id) ? null : s));
    },
    [relations],
  );

  // Restores a trashed Relation only when both its connected Entity Types currently exist —
  // otherwise it's left exactly where it is in Trash; the Trash UI explains why using the same
  // "does `entities` contain this id" check, so it always agrees with what this function decides.
  const restoreRelation = useCallback(
    (relationId: string) => {
      const trashed = trashedRelations.find((t) => t.relation.id === relationId);
      if (!trashed) return;
      const fromExists = entities.some((e) => e.id === trashed.relation.from);
      const toExists = entities.some((e) => e.id === trashed.relation.to);
      if (!fromExists || !toExists) return;
      setRelations((rs) => (rs.some((r) => r.id === relationId) ? rs : [...rs, trashed.relation]));
      setTrashedRelations((ts) => ts.filter((t) => t.relation.id !== relationId));
    },
    [trashedRelations, entities],
  );

  // Restores a trashed Entity Type (with every one of its Properties, and its previous canvas
  // x/y — both already part of the stored snapshot) and then retries each Relation that was
  // cascade-trashed alongside it, bringing back whichever ones are eligible right now (their other
  // endpoint also currently exists) — checked against `entities` plus this entity itself, since
  // the just-restored entity hasn't landed in `entities` yet at this point in the same call.
  const restoreEntity = useCallback(
    (entityId: string) => {
      const trashed = trashedEntities.find((t) => t.entity.id === entityId);
      if (!trashed) return;
      setEntities((es) => (es.some((e) => e.id === entityId) ? es : [...es, trashed.entity]));
      setTrashedEntities((ts) => ts.filter((t) => t.entity.id !== entityId));
      const nextIds = new Set([...entities.map((e) => e.id), entityId]);
      const eligible = trashedRelations.filter(
        (t) =>
          trashed.relatedTrashedRelationIds.includes(t.relation.id) &&
          nextIds.has(t.relation.from) &&
          nextIds.has(t.relation.to),
      );
      if (eligible.length > 0) {
        setRelations((rs) => [...rs, ...eligible.map((t) => t.relation)]);
        const eligibleIds = new Set(eligible.map((t) => t.relation.id));
        setTrashedRelations((ts) => ts.filter((t) => !eligibleIds.has(t.relation.id)));
      }
    },
    [trashedEntities, entities, trashedRelations],
  );

  // Restores a trashed Property back onto its original Entity Type — only possible while that
  // Entity Type still exists, since a Property never exists un-attached. Its previous mapping
  // comes back too, but only if the column it pointed at is still real; source tables are static
  // in this app so that's effectively always true, but this stays honest about the dependency
  // rather than blindly trusting a stale reference.
  const restoreProperty = useCallback(
    (propertyId: string) => {
      const trashed = trashedProperties.find((t) => t.property.id === propertyId);
      if (!trashed) return;
      const ownerExists = entities.some((e) => e.id === trashed.entityId);
      if (!ownerExists) return;
      const mapping = trashed.property.mapping;
      const mappingStillValid =
        mapping != null &&
        (tableByName(mapping.table)?.columns.some((c) => c.name === mapping.column) ?? false);
      const restored: Property = {
        ...trashed.property,
        mapping: mappingStillValid ? mapping : null,
      };
      setEntities((es) =>
        es.map((e) =>
          e.id === trashed.entityId && !e.properties.some((p) => p.id === propertyId)
            ? { ...e, properties: [...e.properties, restored] }
            : e,
        ),
      );
      setTrashedProperties((ts) => ts.filter((t) => t.property.id !== propertyId));
    },
    [trashedProperties, entities],
  );

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
        x: original.x + NODE_W + 40,
        y: original.y,
        properties: moved,
      };
      setEntities((es) =>
        es.map((e) => (e.id === entityId ? { ...e, properties: kept } : e)).concat(newEntity),
      );
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
          .map((r) => ({
            ...r,
            from: idSet.has(r.from) ? newId : r.from,
            to: idSet.has(r.to) ? newId : r.to,
          }))
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
    trashedEntities,
    trashedProperties,
    trashedRelations,
    updateEntity,
    updateProperty,
    updateMapping,
    updateRelation,
    createEntity,
    createProperty,
    confirmItems,
    moveProperties,
    addRelation,
    createPlaceholderRelation,
    renameRelation,
    deleteEntity,
    deleteProperty,
    deleteRelation,
    deleteEntities,
    deleteProperties,
    deleteRelations,
    restoreEntity,
    restoreProperty,
    restoreRelation,
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
    confidenceRange,
    setConfidenceRange,
  };
}

export type OntologyApp = ReturnType<typeof useOntologyApp>;
