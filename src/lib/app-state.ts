import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDemoFixture,
  mappingStatus,
  propertyStatus,
  relationLabel,
  tableByName,
  tables,
  type ColumnRef,
  type DemoScenario,
  type Entity,
  type Property,
  type Relation,
  type ReviewStatus,
  type SearchResultRef,
} from "./mock-data";
import { NODE_W } from "./geometry";

let entityUidCounter = 0;
const entityUid = () => `entity_${Date.now().toString(36)}${(entityUidCounter++).toString(36)}`;
let relationUidCounter = 0;
const relationUid = () => `rel_${Date.now().toString(36)}${(relationUidCounter++).toString(36)}`;
let propUidCounter = 0;
const propUid = () => `prop_${Date.now().toString(36)}${(propUidCounter++).toString(36)}`;
let historyLogUidCounter = 0;
const historyLogUid = () =>
  `hist_${Date.now().toString(36)}${(historyLogUidCounter++).toString(36)}`;

/** The exact `errorReason` a placeholder Relation is created with (see `createPlaceholderRelation`
 * below) — explains *why* this particular unnamed Relation exists (two Entity Types ended up
 * placed next to each other). `renameRelation`'s own Error-clearing rule doesn't check this by
 * name — it clears any Relation Error whose `name` is still blank, which is the one thing that can
 * put a Relation in this Error to begin with now that dragging a connector onto another Entity
 * always names it up front via the "Define Relation" dialog instead of creating a blank one. */
export const PLACEHOLDER_RELATION_REASON =
  "This relation was created automatically because these Entity Types were placed next to each other with no existing relation between them — give it a name to resolve this.";

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

/** A plain, serializable stand-in for `DOMRect` (screen px, from `getBoundingClientRect()`) — just
 * the 4 numbers the morph overlay actually needs, not the live, mutable browser object. */
export type MorphRect = { x: number; y: number; width: number; height: number };
/** The Overview node's own status circle and name label, measured SEPARATELY (not just the node's
 * one outer bounding box) — `EntityMorphOverlay` travels each of them independently to its own
 * target sub-position in the Editing card's header, rather than one box scaling as a whole, since
 * the circle moves from "above, centered" to "left, inline" and the name from "below, centered" to
 * "right of the icon" — two genuinely different final positions, not a uniform resize. */
export type EntityMorphOrigin = {
  entityId: string;
  circleRect: MorphRect;
  labelRect: MorphRect;
} | null;

export type CanvasView = { x: number; y: number; z: number };

/** The Header's Confidence score range filter — 0-100 (a percent, not the raw 0-1 `confidence`
 * every Entity/Property/Relation carries). Lives here rather than local to the Header since both
 * Overview and Detail read it to dim/hide out-of-range items on their own canvases and toolbox
 * lists. */
export type ConfidenceRange = { min: number; max: number };

/** A single AI-suggested item eligible for the Accept/Decline selection workflow below — an
 * Entity Type, a Property (a Property's own mapping has no independent status of its own in this
 * data model, so "select a Property ↔ Column mapping" and "select the Property that carries it"
 * are the same action here), or a Relation. Encoded as one string key (`suggestionKey` below) so a
 * single flat `Set<string>` can hold a mixed selection across all three kinds — mirrors the same
 * "one Set, composite membership" shape `selectedMergeIds`/`selectedRelationIds` already use on
 * the Detail canvas, just spanning kinds instead of one. */
export type SuggestionRef =
  | { kind: "entity"; id: string }
  | { kind: "property"; entityId: string; propertyId: string }
  | { kind: "mapping"; entityId: string; propertyId: string }
  | { kind: "relation"; id: string };

const SUGGESTION_KEY_SEP = "|";

export function suggestionKey(ref: SuggestionRef): string {
  return ref.kind === "property" || ref.kind === "mapping"
    ? `${ref.kind}${SUGGESTION_KEY_SEP}${ref.entityId}${SUGGESTION_KEY_SEP}${ref.propertyId}`
    : `${ref.kind}${SUGGESTION_KEY_SEP}${ref.id}`;
}

export function parseSuggestionKey(key: string): SuggestionRef | null {
  const parts = key.split(SUGGESTION_KEY_SEP);
  if (parts[0] === "entity" && parts[1]) return { kind: "entity", id: parts[1] };
  if (parts[0] === "relation" && parts[1]) return { kind: "relation", id: parts[1] };
  if (parts[0] === "property" && parts[1] && parts[2]) {
    return { kind: "property", entityId: parts[1], propertyId: parts[2] };
  }
  if (parts[0] === "mapping" && parts[1] && parts[2]) {
    return { kind: "mapping", entityId: parts[1], propertyId: parts[2] };
  }
  return null;
}

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
// Everything a single undo/redo step needs to restore — the ontology's own mutable data (see
// `useOntologyApp`'s own doc comment above) plus Trash, since a delete/restore is exactly as much
// a "step" as any other edit and leaving Trash out of a snapshot would let an undone delete bring
// an entity back onto the canvas while a stale copy of it stayed sitting in Trash. UI-only state
// (selection, Detail anchor, pan/zoom, the confidence filter) is deliberately NOT part of this —
// undoing an edit shouldn't also yank the user's camera or selection around.
type HistorySnapshot = {
  entities: Entity[];
  relations: Relation[];
  trashedEntities: TrashedEntity[];
  trashedProperties: TrashedProperty[];
  trashedRelations: TrashedRelation[];
};

// --- History log (the GLOBAL "what changed" activity feed — NOT the undo/redo `HistorySnapshot`
// stack above, which is a different, unrelated use of the word "history" already established in
// this file) --------------------------------------------------------------------------------
// One entry per meaningful ontology/mapping change — never canvas navigation, selection, zoom,
// pan, Filter, or Confidence-range changes, which are all VIEW state, not changes to the ontology
// itself (see the Header's own `HistoryPanel`).
//
// Selective Restore (see `RestoreOp` and `restoreHistoryChanges` below): a change carries `restore`
// only when it can be reversed safely and exactly using the SAME mutators every other edit in this
// app already goes through — never a raw snapshot-replace of the whole ontology. A change with no
// `restore` (e.g. Merge — see `mergeEntities`'s own doc comment on why) is inspectable and
// navigable like any other, just not individually restorable; the Restore UI treats "no `restore`"
// and "restore currently blocked by a conflict" as the same disabled state, distinguished only by
// the conflict message shown for the latter.
export type RestoreOp =
  | {
      kind: "entityPatch";
      id: string;
      before: Partial<Pick<Entity, "name" | "description" | "status">>;
    }
  | {
      kind: "propertyPatch";
      entityId: string;
      propertyId: string;
      before: Partial<Pick<Property, "name" | "description" | "status" | "mapping">>;
    }
  | {
      kind: "relationPatch";
      id: string;
      before: Partial<Pick<Relation, "name" | "description" | "status" | "from" | "to">>;
    }
  /** Reverses a Create by moving the created object back to Trash — "restoring" the change means
   * restoring the ontology to how it was BEFORE this create, i.e. as if it never happened. */
  | { kind: "undoEntityCreate"; id: string }
  | { kind: "undoPropertyCreate"; entityId: string; propertyId: string }
  | { kind: "undoRelationCreate"; id: string }
  /** Reverses a Delete (or a Decline, which deletes into Trash the same way) by bringing the
   * trashed object back — exactly `restoreEntity`/`restoreProperty`/`restoreRelation` below, the
   * same Trash-restore path the Trash UI itself already uses. */
  | { kind: "undoEntityDelete"; id: string }
  | { kind: "undoPropertyDelete"; propertyId: string }
  | { kind: "undoRelationDelete"; id: string }
  /** Reverses a Move: moves the same properties back from where they landed to where they came
   * from, restoring their pre-move names. */
  | {
      kind: "undoMoveProperties";
      landedOnEntityId: string;
      cameFromEntityId: string;
      items: { id: string; name: string }[];
    }
  /** Reverses a Split: moves the split-off properties back onto the original entity, then removes
   * the now-empty entity the split created (itself just a Delete, so it lands in Trash like any
   * other delete rather than being destroyed). */
  | {
      kind: "undoSplit";
      newEntityId: string;
      originalEntityId: string;
      moved: { id: string; name: string }[];
    };

/** One change that couldn't be restored — `childIndex: null` means the whole (non-batch) entry
 * itself; a number indexes into that entry's own `children`. `message` is meant to be shown
 * directly, e.g. "Order → Category cannot be restored because Category no longer exists." */
export type RestoreConflict = { childIndex: number | null; message: string };
export type RestoreOutcome = { restoredCount: number; conflicts: RestoreConflict[] };

export type HistoryLogChild = {
  title: string;
  detail?: string;
  /** Reuses Global Search's own navigation ref/dispatch (`selectSearchResult`) — clicking a History
   * event is "locate this object again", the exact same job Search's own result-selection already
   * does, so there's no reason to build a second parallel navigation system. Omitted once the
   * referenced object no longer exists (e.g. a delete) — nothing for a click to navigate to. */
  ref?: SearchResultRef;
  /** Enough information to reverse JUST this one change, independent of every other change in the
   * same batch — see `restoreHistoryChanges`'s own doc comment for how this is validated and
   * applied. Omitted when this specific change type can't be safely, individually reversed (see
   * `RestoreOp`'s own doc comment). */
  restore?: RestoreOp | undefined;
};
export type HistoryLogEntry = HistoryLogChild & {
  id: string;
  /** `Date.now()` at the moment the change happened — grouped into Today/Yesterday/older date
   * headers and shown as relative time ("2 min ago") by the panel that renders these. */
  at: number;
  /** Only present for a batch action (e.g. "Accepted 11 suggestions") — the panel renders these
   * as an expandable sub-list rather than one row per underlying change, so a big batch doesn't
   * flood the feed with 11 separate entries. A batch entry never carries its own top-level
   * `restore` (there's no single "before" for a whole batch) — Restore always operates on
   * individual children; a non-batch (no `children`) entry is itself the one change to restore. */
  children?: HistoryLogChild[];
};

/** One inspectable change, normalized from either a batch entry's own `children` or — for a
 * non-batch entry — the entry itself standing in as its own single change. `number` is the
 * temporary ①②③... shown both in the History panel's inspection view and as the matching canvas
 * marker; `childIndex` is exactly what the low-level restore primitive (`applyRestoreOp`'s caller,
 * `restoreSelectedHistoryChanges`) expects back (`null` for "the entry itself"). Exported so both
 * `HistoryPanel` and the canvas (which draws the numbered markers and, for a simple field patch,
 * overlays the historical value) derive the same list from one `HistoryLogEntry` instead of two
 * independently-drifting copies of this normalization. */
export type HistoryChange = {
  key: string;
  number: number;
  childIndex: number | null;
  title: string;
  detail?: string | undefined;
  ref?: SearchResultRef | undefined;
  restore?: RestoreOp | undefined;
  restorable: boolean;
};

export function historyChangesFor(entry: HistoryLogEntry): HistoryChange[] {
  if (entry.children && entry.children.length > 0) {
    return entry.children.map((c, i) => ({
      key: `${entry.id}:${i}`,
      number: i + 1,
      childIndex: i,
      title: c.title,
      detail: c.detail,
      ref: c.ref,
      restore: c.restore,
      restorable: !!c.restore,
    }));
  }
  return [
    {
      key: `${entry.id}:self`,
      number: 1,
      childIndex: null,
      title: entry.title,
      detail: entry.detail,
      ref: entry.ref,
      restore: entry.restore,
      restorable: !!entry.restore,
    },
  ];
}

/** History Inspection Mode — entered by clicking a History event (`enterHistoryInspection`). This
 * is a PREVIEW, never a mutation: Current Ontology stays exactly as it is underneath, the canvas
 * just overlays each inspected change's own numbered marker (and, for a simple field patch, its
 * historical value in place of the current one — see OverviewCanvas's own `historyValueOverrides`)
 * on top of it. Nothing here touches `entities`/`relations` until the user explicitly checks
 * specific changes and calls `restoreSelectedHistoryChanges`. `selected` holds the `number`s of the
 * changes currently checked for restore; `conflicts` is only populated right after a restore
 * attempt that couldn't apply everything selected (see that function's own doc comment) and is
 * cleared again on the next selection change. */
export type HistoryInspection = {
  entryId: string;
  title: string;
  detail?: string | undefined;
  at: number;
  changes: HistoryChange[];
  selected: Set<number>;
  conflicts: RestoreConflict[];
};

// Seed History so History Mode has something real to inspect/restore from a fresh load, instead
// of an empty "No changes yet." timeline — every `ref`/`restore` below points at an object that
// actually exists in `initialEntities`/`initialRelations`, so both "Locate on the canvas" and an
// actual Restore behave exactly like a real logged change would. Deliberately only ever field
// patches (rename, accept) plus one non-restorable entry (a Merge, which genuinely can't be
// restored — see `mergeEntities`'s own doc comment) — never a mock Create/Delete, which would
// need matching Trash state seeded alongside it to restore correctly. Spans "Today" and
// "Yesterday" so the panel's own day-grouping has more than one group to show right away.
const DEMO_HISTORY_NOW = new Date("2026-09-15T20:00:00-07:00").getTime();
const IN_PROGRESS_HISTORY_LOG: HistoryLogEntry[] = [
  {
    id: "hist_mock_1",
    at: DEMO_HISTORY_NOW - 2 * 60_000,
    title: "Renamed Property",
    detail: "Order.totalAmount → total",
    ref: { kind: "property", entityId: "e_order", propertyId: "p_ord_total" },
    restore: {
      kind: "propertyPatch",
      entityId: "e_order",
      propertyId: "p_ord_total",
      before: { name: "totalAmount" },
    },
  },
  {
    id: "hist_mock_2",
    at: DEMO_HISTORY_NOW - 20 * 60_000,
    title: "Reviewed Customer",
    children: [
      {
        title: "Accepted Entity suggestion",
        detail: "Customer",
        ref: { kind: "entity", id: "e_customer" },
        restore: {
          kind: "entityPatch",
          id: "e_customer",
          before: { status: "suggested" },
        },
      },
      {
        title: "Confirmed Identifier mapping",
        detail: "Customer.id → customers.customer_id",
        ref: { kind: "property", entityId: "e_customer", propertyId: "p_cust_id" },
        restore: {
          kind: "propertyPatch",
          entityId: "e_customer",
          propertyId: "p_cust_id",
          before: {
            mapping: { table: "customers", column: "customer_id", status: "suggested" },
          },
        },
      },
    ],
  },
  {
    id: "hist_mock_3",
    at: DEMO_HISTORY_NOW - 90 * 60_000,
    title: "Disconnected Identifier mapping",
    detail: "Product Details.id",
    ref: { kind: "property", entityId: "e_product_details", propertyId: "p_pd_id" },
    restore: {
      kind: "propertyPatch",
      entityId: "e_product_details",
      propertyId: "p_pd_id",
      before: {
        mapping: { table: "product_details", column: "sku", status: "suggested" },
      },
    },
  },
  {
    id: "hist_mock_4",
    at: DEMO_HISTORY_NOW - 25 * 60 * 60_000,
    title: "Renamed Entity",
    detail: "Purchaser → Customer",
    ref: { kind: "entity", id: "e_customer" },
    restore: { kind: "entityPatch", id: "e_customer", before: { name: "Purchaser" } },
  },
];

export function useOntologyApp() {
  const initialFixture = useRef(createDemoFixture("fresh"));
  const [demoScenario, setDemoScenario] = useState<DemoScenario>("fresh");
  const [entities, setEntities] = useState<Entity[]>(initialFixture.current.entities);
  const [relations, setRelations] = useState<Relation[]>(initialFixture.current.relations);
  // Mirrors `entities`/`relations` for the handful of mutators below (`updateEntity` especially)
  // that need to read the "before" value for History logging WITHOUT taking a dependency on
  // `entities`/`relations` themselves — critical for `updateEntity`, whose referential stability
  // the Overview canvas's hot drag path relies on. Reading "before" from INSIDE the functional
  // `setEntities` updater instead (mutating an outer variable as a side effect) looks tempting but
  // is actually broken: React does not guarantee that updater function runs before the surrounding
  // code continues, so a value written there isn't reliably readable right after — these refs are
  // the correct fix, always current since they're reassigned on every render.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const relationsRef = useRef(relations);
  relationsRef.current = relations;
  const [trashedEntities, setTrashedEntities] = useState<TrashedEntity[]>([]);
  const [trashedProperties, setTrashedProperties] = useState<TrashedProperty[]>([]);
  const [trashedRelations, setTrashedRelations] = useState<TrashedRelation[]>([]);

  // Undo/redo history — see `HistorySnapshot` above. `past`'s last entry is always "the state
  // right before whatever the user just did"; `future` only ever holds anything right after an
  // undo, and is thrown away the moment a NEW edit happens (the standard "you can't redo past a
  // fresh change" rule). `pushHistory` is called once per user-facing action, at the very top of
  // each mutator below, BEFORE that mutator's own setEntities/setRelations/setTrashed* calls — so
  // one action (even one that touches several of those setters at once, like a cascading delete)
  // always produces exactly one undo step, never several.
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);
  const pushHistory = useCallback(() => {
    setPast((p) => [
      ...p,
      { entities, relations, trashedEntities, trashedProperties, trashedRelations },
    ]);
    setFuture([]);
  }, [entities, relations, trashedEntities, trashedProperties, trashedRelations]);
  const restoreSnapshot = useCallback((snap: HistorySnapshot) => {
    setEntities(snap.entities);
    setRelations(snap.relations);
    setTrashedEntities(snap.trashedEntities);
    setTrashedProperties(snap.trashedProperties);
    setTrashedRelations(snap.trashedRelations);
  }, []);
  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1]!;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [
      ...f,
      { entities, relations, trashedEntities, trashedProperties, trashedRelations },
    ]);
    restoreSnapshot(prev);
  }, [
    past,
    entities,
    relations,
    trashedEntities,
    trashedProperties,
    trashedRelations,
    restoreSnapshot,
  ]);
  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[future.length - 1]!;
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [
      ...p,
      { entities, relations, trashedEntities, trashedProperties, trashedRelations },
    ]);
    restoreSnapshot(next);
  }, [
    future,
    entities,
    relations,
    trashedEntities,
    trashedProperties,
    trashedRelations,
    restoreSnapshot,
  ]);

  // The History log itself — see `HistoryLogEntry`'s own doc comment above for how this differs
  // from the undo/redo stack right above it. Newest first; capped so a long session doesn't grow
  // this unboundedly. A plain `useCallback` with no deps (uses the functional `setState` form) so
  // every mutator below can log through it without becoming a new function reference every time
  // `entities`/`relations` change — several of them (`updateEntity` especially) need to stay
  // referentially stable for the Overview canvas's own hot drag path.
  const [historyLog, setHistoryLog] = useState<HistoryLogEntry[]>([]);
  // Set only while `restoreHistoryChanges` below is applying its selected changes — each one goes
  // through the SAME mutators as a normal edit (`updateEntity`, `deleteEntity`, ...), which would
  // otherwise each log their own ordinary entry ("Renamed Entity") right alongside the one, single
  // "Restored N changes" summary entry `restoreHistoryChanges` logs itself once it's done —
  // doubling up on what's really one user action. A ref (not state) since flipping it must never
  // itself trigger a re-render.
  const suppressHistoryLogRef = useRef(false);
  const logHistoryEvent = useCallback((entry: Omit<HistoryLogEntry, "id" | "at">) => {
    if (suppressHistoryLogRef.current) return;
    setHistoryLog((prev) =>
      [{ id: historyLogUid(), at: Date.now(), ...entry }, ...prev].slice(0, 200),
    );
  }, []);

  const [selection, setSelection] = useState<Selection>(null);
  const [detail, setDetail] = useState<DetailAnchor>(null);
  const [view, setView] = useState<CanvasView>({ x: 60, y: 40, z: 0.55 });
  const [confidenceRange, setConfidenceRange] = useState<ConfidenceRange>({ min: 0, max: 100 });
  // The Header's Filter — which review statuses currently show at all, across Overview and
  // Detail alike (a Filter's own "what kinds of things do I want to see" question, independent of
  // Confidence's "what range am I reviewing" one). All 4 start on, matching "everything visible"
  // by default. NOTE: this app's own `ReviewStatus` is a single 4-way enum (an item is Suggested,
  // Confirmed, Warning, OR Error — never independently "Confirmed AND Warning" in the underlying
  // data), so this filters by that same 4-way status directly rather than the two-independent-axes
  // model (Suggested/Accepted crossed with Warning/Error) a richer data model could support.
  const [statusFilter, setStatusFilter] = useState<Set<ReviewStatus>>(
    () => new Set<ReviewStatus>(["suggested", "confirmed", "warning", "error"]),
  );

  // Which AI Suggestions (Entity Types, Properties, Relations) are currently picked for the
  // Accept/Decline workflow — deliberately separate from `confidenceRange` above: the range picks
  // which suggestions are *in scope for review*, this picks which of those the user is actually
  // about to act on. Global (not owned by Overview or Detail) since a suggestion can be reviewed
  // from either — see Header's own "Select suggestions in range" / contextual selection bar.
  const [suggestionSelection, setSuggestionSelection] = useState<Set<string>>(new Set());

  const select = useCallback((sel: Selection) => setSelection(sel), []);
  const clearSelection = useCallback(() => setSelection(null), []);

  const toggleSuggestionSelected = useCallback((ref: SuggestionRef) => {
    const key = suggestionKey(ref);
    setSuggestionSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const clearSuggestionSelection = useCallback(() => setSuggestionSelection(new Set()), []);
  const selectSuggestionKeys = useCallback((keys: string[]) => {
    setSuggestionSelection(new Set(keys));
  }, []);

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

  // The one-shot origin rect for the Overview→Editing "morph" transition (see
  // `EntityMorphOverlay`) — set ONLY by clicking an Entity Type's circular node on the Overview
  // canvas (`openDetailWithMorph`), never by any other path into Detail (Search, History, a
  // related-entity satellite click, a Table entry, etc. all still just call `openDetail` above
  // unchanged) — there's no visible Overview node to morph FROM in those cases. Cleared once the
  // overlay finishes animating to its target and hands off to the real, already-in-place Detail
  // card underneath.
  const [entityMorphOrigin, setEntityMorphOrigin] = useState<EntityMorphOrigin>(null);
  const openDetailWithMorph = useCallback(
    (id: string, circleRect: MorphRect, labelRect: MorphRect) => {
      setEntityMorphOrigin({ entityId: id, circleRect, labelRect });
      openDetail("entity", id);
    },
    [openDetail],
  );
  const clearEntityMorphOrigin = useCallback(() => setEntityMorphOrigin(null), []);

  // The Header's Global Search — where a chosen result currently has the ontology/data model's
  // attention. Global (like `confidenceRange`/`statusFilter` above) since it's set from the Header,
  // reachable from Overview or Editing alike, and stays live across a Back-to-Overview/into-Editing
  // switch rather than resetting — "provide a clear way to exit this focus state" (Escape, clearing
  // the search, clicking empty canvas, or picking a new result) is what actually clears it, not
  // navigating between the two workspaces. Purely a temporary VISUAL pointer: nothing here ever
  // touches `confidenceRange`, `statusFilter`, `entities`/`relations`, or an Entity's own `x`/`y` —
  // Search's whole job is "where is this thing and what does it connect to", never "change what I'm
  // reviewing" (that's Filter/Confidence's job, see their own doc comments). Overview reads this
  // directly to pan its canvas and mute everything NOT connected to the result (see its own
  // `searchFocus`-derived `emphasisFor` override); Editing doesn't read it at all — see
  // `selectSearchResult` below for why.
  const [searchFocus, setSearchFocus] = useState<SearchResultRef | null>(null);
  const clearSearchFocus = useCallback(() => setSearchFocus(null), []);

  // The Issues popover's own "persistent navigation target" — set only when the user clicks a
  // Warning/Error row (see `selectIssue` below), never by Search/History (they only ever touch
  // `searchFocus`). Survives an Overview↔Editing switch on purpose: the whole point is that
  // clicking an issue on Overview, then later entering Editing Mode by whatever path (a toolbox
  // click, double-clicking a node, "Go to Editing Mode"), still lands with that same Entity/
  // Property/Relation selected and its Inspector open showing the Warning/Error — see
  // `EntityDetailCanvas`'s own `contextItem` mount initializer, which is the other half of this.
  // Cleared two ways: explicitly (`clearIssueInspection`), or automatically the moment the user
  // selects something that ISN'T this same issue's object — see the effect right below (the
  // Overview half) and `EntityDetailCanvas`'s matching effect (the Editing half). Never touches
  // `searchFocus`, Error/Warning generation, or counts — purely which object the Inspector/canvas
  // currently has pinned open on the user's behalf.
  const [issueInspection, setIssueInspection] = useState<SearchResultRef | null>(null);
  const clearIssueInspection = useCallback(() => setIssueInspection(null), []);
  // Overview's own "explicit unrelated selection clears the pin" half — Editing's own version of
  // this lives inside `EntityDetailCanvas` (it reads local `contextItem`/`entity`, neither of
  // which this hook has access to). A property issue is considered still "the same object" as
  // long as its OWNING Entity stays selected (Overview has no property-level selection of its
  // own); a relation issue likewise still matches either its own Relation selection or either
  // connected Entity. Skipped entirely while `selection` is `null` — deselecting to nothing is
  // not "selecting another object," so it leaves the pin alone.
  useEffect(() => {
    if (!issueInspection || !selection) return;
    const stillMatches =
      (issueInspection.kind === "entity" &&
        selection.kind === "entity" &&
        selection.id === issueInspection.id) ||
      (issueInspection.kind === "property" &&
        selection.kind === "entity" &&
        selection.id === issueInspection.entityId) ||
      (issueInspection.kind === "relation" &&
        ((selection.kind === "relation" && selection.id === issueInspection.id) ||
          (selection.kind === "entity" &&
            relations.some(
              (r) =>
                r.id === issueInspection.id && (r.from === selection.id || r.to === selection.id),
            ))));
    if (!stillMatches) setIssueInspection(null);
  }, [selection, issueInspection, relations]);

  // History Inspection Mode (see `HistoryInspection`'s own doc comment) — `null` whenever no
  // History event is currently being inspected. The canvas is the primary surface for this, so
  // entering it always drops out of Editing back to Overview first (see `enterHistoryInspection`
  // below); Overview reads `changes` to draw each one's numbered marker/historical-value overlay,
  // and both the History panel and the canvas read/write `selected` and the hover pointer so a
  // row and its marker stay in sync in both directions. Purely a transient VIEW+selection
  // pointer, exactly like `searchFocus` above, right up until `restoreSelectedHistoryChanges` is
  // actually called — nothing here touches the ontology on its own.
  const [historyInspection, setHistoryInspection] = useState<HistoryInspection | null>(null);
  const [historyInspectionHoveredNumber, setHistoryInspectionHoveredNumber] = useState<
    number | null
  >(null);
  // Whether History Mode's own right-docked panel is showing at all — a superset of
  // `historyInspection` (which is only ever set once a specific event has been opened): opening
  // History now goes STRAIGHT into this mode (the panel showing its plain timeline, canvas already
  // switched to its distinct striped/muted background and normal interactions already frozen — see
  // OverviewCanvas's own gates on this flag), rather than a lightweight popover you then have to
  // drill further into. Clicking a timeline row sets `historyInspection` without needing to touch
  // this; "Back" clears `historyInspection` back to the timeline while this stays true; closing the
  // panel entirely (the Header's History button, or the panel's own close control) clears both.
  const [historyPanelOpen, setHistoryPanelOpenRaw] = useState(false);
  // The Header's own toggle (History button / the panel's own close control) goes through this,
  // never the raw setter above directly — History Mode is meant to be a STRICTLY isolated
  // inspection layer (see this feature's own spec), so opening it always exits Editing first, the
  // exact same "the canvas is the one place this happens" rule `enterHistoryInspection` already
  // enforces for a specific event, just applied the moment the panel itself opens instead of
  // waiting for a row click. Closing clears any inspection in progress too, so re-opening always
  // starts back at the plain timeline rather than wherever it was left.
  const setHistoryPanelOpen = useCallback((open: boolean) => {
    if (open) {
      setDetail(null);
      // A selection made just before opening History Mode would otherwise still show its own
      // ring/contextual bar underneath the now-inert AI Review control — clearing both here keeps
      // the canvas from displaying an action-looking bar that's actually disabled.
      setSelection(null);
      setSuggestionSelection(new Set());
      setHistoryPanelOpenRaw(true);
    } else {
      setHistoryInspection(null);
      setHistoryInspectionHoveredNumber(null);
      setHistoryPanelOpenRaw(false);
    }
  }, []);

  /** Enters History Inspection Mode for one timeline event — clicking a History row, never a
   * mutation (see `HistoryInspection`'s own doc comment). Always exits Editing first: the canvas
   * is where inspected changes are actually shown (numbered markers + historical-value overlay),
   * so an entry picked while inside Editing still lands the user on Overview, the same way
   * Global Search results already behave. */
  const enterHistoryInspection = useCallback(
    (entryId: string) => {
      const entry = historyLog.find((h) => h.id === entryId);
      if (!entry) return;
      setDetail(null);
      setHistoryInspection({
        entryId,
        title: entry.title,
        detail: entry.detail,
        at: entry.at,
        changes: historyChangesFor(entry),
        selected: new Set(),
        conflicts: [],
      });
      setHistoryInspectionHoveredNumber(null);
    },
    [historyLog],
  );

  /** "Back" — returns from one event's own inspection detail to the plain timeline, WITHOUT
   * applying anything: no selection state survives, Current Ontology was never touched to begin
   * with, and no History event is created (a preview is never itself a mutation). Deliberately
   * leaves `historyPanelOpen` alone — this is drilling back up one level inside History Mode, not
   * closing it; closing the whole panel is `setHistoryPanelOpen(false)`, called separately by the
   * panel's own close control / the Header's History button. */
  const exitHistoryInspection = useCallback(() => {
    setHistoryInspection(null);
    setHistoryInspectionHoveredNumber(null);
  }, []);

  /** Toggles one change (by its numbered marker/row) in or out of the current restore selection —
   * the user is selecting DIFFERENCES to restore, not historical objects (see this feature's own
   * spec). Available from either the History panel row or its matching canvas marker, so both
   * call this same function. Clears any stale conflict messages, which only ever describe the
   * PREVIOUS restore attempt's selection. */
  const toggleHistoryChangeSelected = useCallback((number: number) => {
    setHistoryInspection((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.selected);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return { ...prev, selected: next, conflicts: [] };
    });
  }, []);

  // The brief "this is what just came back" glow on an object right after a successful restore
  // (see this feature's own spec, "temporarily highlight the restored objects") — a plain
  // transient VIEW pointer, cleared on its own timer, never anything the ontology or History log
  // itself remembers.
  const [historyRestoreHighlight, setHistoryRestoreHighlight] = useState<SearchResultRef[]>([]);
  const restoreHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (restoreHighlightTimeoutRef.current) clearTimeout(restoreHighlightTimeoutRef.current);
    };
  }, []);
  const flashRestoreHighlight = useCallback((refs: SearchResultRef[]) => {
    if (restoreHighlightTimeoutRef.current) clearTimeout(restoreHighlightTimeoutRef.current);
    setHistoryRestoreHighlight(refs);
    restoreHighlightTimeoutRef.current = setTimeout(() => setHistoryRestoreHighlight([]), 3000);
  }, []);

  // What actually happens when a Global Search result is chosen — the one place that decides
  // Overview vs. Editing behavior, so neither the Header (which renders the palette) nor
  // OverviewCanvas/DetailView need to know about each other's half of this. Always records the
  // result as the new `searchFocus` (Overview's canvas reacts to that on its own); ADDITIONALLY
  // navigates the already-open Editing workspace to it via the exact same `openDetail` every other
  // in-workspace click already uses (a toolbox row, a related-entity satellite) — so search feels
  // like navigating within Editing, never a separate search-results mode, per the spec's own
  // "Search should NOT create a new Editing mode" note. A Relation has no Detail view of its own
  // (same limitation as everywhere else in this app — see `DetailAnchor`), so inside Editing it
  // opens one connected Entity Type instead; since EntityDetailCanvas already shows a main row's
  // directly-related entities as satellite cards, the OTHER endpoint typically surfaces right
  // alongside it anyway.
  const selectSearchResult = useCallback(
    (ref: SearchResultRef) => {
      setSearchFocus(ref);
      if (!detail) return;
      switch (ref.kind) {
        case "entity":
          openDetail("entity", ref.id);
          break;
        case "property":
          openDetail("entity", ref.entityId, ref.propertyId);
          break;
        case "table":
          openDetail("table", ref.name);
          break;
        case "column":
          openDetail("table", ref.table, ref.column);
          break;
        case "relation": {
          const relation = relations.find((r) => r.id === ref.id);
          if (relation) openDetail("entity", relation.from);
          break;
        }
      }
    },
    [detail, relations, openDetail],
  );

  // The Issues popover's own click dispatch — does everything `selectSearchResult` already does
  // (Overview highlight/pan, and navigating an already-open Editing workspace to it), PLUS pins
  // it as `issueInspection` so it's still there to select/re-open the Inspector for if the user
  // enters Editing Mode afterward by some OTHER path (see `issueInspection`'s own doc comment
  // above and `EntityDetailCanvas`'s matching mount initializer). Deliberately a separate function
  // from `selectSearchResult` rather than a parameter on it — Search/History results should never
  // pin an issue; only an actual Warning/Error row does. A Property/Relation issue's `ref` is
  // always one of `SearchResultRef`'s "entity" | "property" | "relation" variants (an issue never
  // points at a Table/Column — see `ConfirmIssue`'s own doc comment), so this never needs to
  // special-case those two.
  const selectIssue = useCallback(
    (ref: SearchResultRef) => {
      setIssueInspection(ref);
      selectSearchResult(ref);
    },
    [selectSearchResult],
  );

  // --- ontology mutations -------------------------------------------------------------------
  // Every one of these applies an immutable patch and re-renders both Overview and Detail from
  // the same updated state, since both read `entities`/`relations` from this same hook.

  // Deliberately does NOT push undo history itself — this is the one mutator called both for a
  // single discrete edit (rename/description, committed once on blur) AND continuously while
  // dragging an Entity node on the Overview canvas (once per pointermove). A caller on the
  // continuous path pushes history itself exactly once, right as the drag starts (see
  // OverviewCanvas's own node-drag code); a caller on the discrete path (`handleRenameEntity`/
  // `handleEditEntityDescription` below) pushes right before calling this.
  // Deliberately reads the "before" values from INSIDE the functional setEntities updater (never
  // from the outer `entities` closure) so this stays referentially stable across renders — see
  // `logHistoryEvent`'s own doc comment on why that matters for this specific mutator's hot drag
  // path. Only ever logs a History entry for the discrete rename/description path (`patch.name`/
  // `patch.description` present), never the continuous x/y drag one.
  const updateEntity = useCallback(
    (id: string, patch: Partial<Omit<Entity, "id" | "properties">>) => {
      // Read "before" from the ref, NOT from inside the `setEntities` updater below — see
      // `entitiesRef`'s own doc comment for why that's the one safe way to do this without taking
      // a dependency on `entities` itself.
      const before = entitiesRef.current.find((e) => e.id === id);
      setEntities((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      if (!before) return;
      if (patch.name !== undefined && patch.name !== before.name) {
        logHistoryEvent({
          title: "Renamed Entity",
          detail: `${before.name || "Untitled entity"} → ${patch.name || "Untitled entity"}`,
          ref: { kind: "entity", id },
          restore: { kind: "entityPatch", id, before: { name: before.name } },
        });
      } else if (patch.description !== undefined) {
        logHistoryEvent({
          title: "Edited Entity",
          detail: before.name || "Untitled entity",
          ref: { kind: "entity", id },
          restore: { kind: "entityPatch", id, before: { description: before.description } },
        });
      }
    },
    [logHistoryEvent],
  );

  // Same "read 'before' from the ref first" shape as `updateEntity` above, so the same one
  // function covers Renamed/Edited Property AND all three Mapping History events (Created/
  // Reconnected/Disconnected — see the `"mapping" in patch` branch) without `updateMapping` below
  // needing any logging of its own, since every one of its calls already funnels through here.
  const updateProperty = useCallback(
    (entityId: string, propertyId: string, patch: Partial<Omit<Property, "id">>) => {
      pushHistory();
      const owner = entitiesRef.current.find((e) => e.id === entityId);
      const before = owner?.properties.find((p) => p.id === propertyId);
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
      if (!owner || !before) return;
      const ref = { kind: "property" as const, entityId, propertyId };
      const ownerName = owner.name || "Untitled entity";
      if (patch.name !== undefined && patch.name !== before.name) {
        logHistoryEvent({
          title: "Renamed Property",
          detail: `${ownerName}.${before.name || "Untitled property"} → ${patch.name || "Untitled property"}`,
          ref,
          restore: { kind: "propertyPatch", entityId, propertyId, before: { name: before.name } },
        });
      } else if (patch.description !== undefined) {
        logHistoryEvent({
          title: "Edited Property",
          detail: `${ownerName}.${before.name || "Untitled property"}`,
          ref,
          restore: {
            kind: "propertyPatch",
            entityId,
            propertyId,
            before: { description: before.description },
          },
        });
      } else if ("mapping" in patch) {
        const beforeMapping = before.mapping;
        const afterMapping = patch.mapping ?? null;
        const label = `${ownerName}.${before.name || "Untitled property"}`;
        if (!beforeMapping && afterMapping) {
          logHistoryEvent({
            title: "Created Mapping",
            detail: `${label} ↔ ${afterMapping.table}.${afterMapping.column}`,
            ref,
            restore: {
              kind: "propertyPatch",
              entityId,
              propertyId,
              before: { mapping: null },
            },
          });
        } else if (beforeMapping && !afterMapping) {
          logHistoryEvent({
            title: "Disconnected Mapping",
            detail: `${label} ↔ ${beforeMapping.table}.${beforeMapping.column}`,
            ref,
            restore: {
              kind: "propertyPatch",
              entityId,
              propertyId,
              before: { mapping: beforeMapping },
            },
          });
        } else if (
          beforeMapping &&
          afterMapping &&
          (beforeMapping.table !== afterMapping.table ||
            beforeMapping.column !== afterMapping.column)
        ) {
          logHistoryEvent({
            title: "Reconnected Mapping",
            detail: `${label}\n${beforeMapping.table}.${beforeMapping.column} → ${afterMapping.table}.${afterMapping.column}`,
            ref,
            restore: {
              kind: "propertyPatch",
              entityId,
              propertyId,
              before: { mapping: beforeMapping },
            },
          });
        } else if (
          // Same table/column, only the mapping's own confirmation state changed — see
          // `confirmMapping` below, the one caller that patches `mapping` this way. A genuinely
          // separate case from the three above: nothing about WHICH column this points at
          // changed, only whether it's still a Suggested Mapping or now Mapped.
          beforeMapping &&
          afterMapping &&
          beforeMapping.table === afterMapping.table &&
          beforeMapping.column === afterMapping.column &&
          (beforeMapping.status ?? "suggested") !== (afterMapping.status ?? "suggested")
        ) {
          logHistoryEvent({
            title: afterMapping.status === "mapped" ? "Confirmed Mapping" : "Unconfirmed Mapping",
            detail: `${label} ↔ ${afterMapping.table}.${afterMapping.column}`,
            ref,
            restore: {
              kind: "propertyPatch",
              entityId,
              propertyId,
              before: { mapping: beforeMapping },
            },
          });
        }
      }
    },
    [pushHistory, logHistoryEvent],
  );

  // A named wrapper over updateProperty for the specific "connect/disconnect/reconnect a column"
  // family of interactions, rather than callers reaching for the more general updateProperty to
  // touch `mapping` directly — see updateProperty's own doc comment for where its History logging
  // (Created/Reconnected/Disconnected Mapping) actually lives.
  const updateMapping = useCallback(
    (entityId: string, propertyId: string, mapping: ColumnRef | null) => {
      updateProperty(entityId, propertyId, { mapping });
    },
    [updateProperty],
  );

  // Accepts a Suggested Mapping — "Suggested Mapping → Mapped" (see `ColumnRef`'s own doc
  // comment), WITHOUT touching the owning Property's own ontology `status` at all. Deliberately
  // separate from `acceptSuggestions`: a mapping's own confirmation state and its Property's
  // Suggested/Confirmed lifecycle are two independent facts (see the module-level mapping-state
  // doc), so accepting one must never silently accept the other. A no-op if the Property is
  // already unmapped (nothing to confirm).
  const confirmMapping = useCallback(
    (entityId: string, propertyId: string) => {
      const owner = entitiesRef.current.find((e) => e.id === entityId);
      const property = owner?.properties.find((p) => p.id === propertyId);
      if (!property?.mapping) return;
      updateProperty(entityId, propertyId, {
        mapping: { ...property.mapping, status: "mapped" },
      });
    },
    [updateProperty],
  );

  const updateRelation = useCallback(
    (id: string, patch: Partial<Omit<Relation, "id">>) => {
      pushHistory();
      const before = relationsRef.current.find((r) => r.id === id);
      setRelations((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      if (!before) return;
      if (patch.description !== undefined) {
        logHistoryEvent({
          title: "Edited Relation",
          detail: relationLabel(before),
          ref: { kind: "relation", id },
          restore: { kind: "relationPatch", id, before: { description: before.description } },
        });
      } else if (patch.from !== undefined || patch.to !== undefined) {
        logHistoryEvent({
          title: "Edited Relation",
          detail: `Swapped direction — ${relationLabel(before)}`,
          ref: { kind: "relation", id },
          restore: {
            kind: "relationPatch",
            id,
            before: { from: before.from, to: before.to },
          },
        });
      }
    },
    [pushHistory, logHistoryEvent],
  );

  // A user typing a brand-new Entity Type into the panel's "+" popover is asserting it's real,
  // not proposing something for review — the opposite situation from every AI-suggested seed
  // entity — so this starts "confirmed" at full confidence rather than "suggested" like schema
  // discovery would produce. `position` defaults to (0, 0) — Detail's own panel-based creation
  // relies on exactly that default, since there the user places it themselves via drag; Overview
  // has no panel to hold it in, so it passes the current viewport's own center instead (see
  // OverviewCanvas's own `handleCreateEntity`) so the new entity is immediately visible.
  const createEntity = useCallback(
    (name: string, position?: { x: number; y: number }) => {
      pushHistory();
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
      logHistoryEvent({
        title: "Created Entity",
        detail: newEntity.name || "Untitled entity",
        ref: { kind: "entity", id },
        restore: { kind: "undoEntityCreate", id },
      });
      return id;
    },
    [pushHistory, logHistoryEvent],
  );

  // Same "the user is asserting this, not an AI proposing it" reasoning as createEntity above —
  // "confirmed" at full confidence, and never mapped to a column automatically (an unmapped
  // Property is a perfectly valid, non-Error state — see mock-data's own ReviewFlags note).
  const createProperty = useCallback(
    (entityId: string, name: string) => {
      pushHistory();
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
      // Read the owning entity's name from the ref, not from inside the updater below — see
      // `entitiesRef`'s own doc comment for why.
      const entityName = entitiesRef.current.find((e) => e.id === entityId)?.name;
      setEntities((es) =>
        es.map((e) =>
          e.id === entityId ? { ...e, properties: [...e.properties, newProperty] } : e,
        ),
      );
      logHistoryEvent({
        title: "Created Property",
        detail: `${entityName || "Untitled entity"}.${newProperty.name || "Untitled property"}`,
        ref: { kind: "property", entityId, propertyId: id },
        restore: { kind: "undoPropertyCreate", entityId, propertyId: id },
      });
      return id;
    },
    [pushHistory, logHistoryEvent],
  );

  // --- Canvas-first Entity creation (see the creation wizard's own doc comment) ---------------
  // Everything the wizard collects across its 2-3 steps is applied in exactly ONE call, here —
  // never assembled by calling `createEntity`/`createProperty`/`addRelation` one after another,
  // which would both fragment this into several separate undo steps and log several separate
  // History entries for what the user experiences as one single action ("I created Shipment").
  // `connection` is omitted entirely for a standalone Entity (no source, no Relation, no Step 3);
  // when present, the new Relation is created already-named and "confirmed" (the user typed a
  // real name for it in Step 3), unlike the Error-status placeholder `addRelation`/
  // `createPlaceholderRelation` create for the OTHER, preserved "drag/connect to an existing
  // Entity" gesture — that one still fabricates nothing and still requires a name afterward.
  const createEntityWithProperties = useCallback(
    (params: {
      name: string;
      position: { x: number; y: number };
      properties: { name: string; type: string; isIdentifier?: boolean }[];
      connection?:
        | {
            sourceEntityId: string;
            relationName: string;
            /** "fromSource": the source Entity points at the new one (e.g. Order → Shipment).
             * "toSource": the new Entity points at the source (e.g. Shipment → Order). */
            direction: "fromSource" | "toSource";
          }
        | undefined;
    }) => {
      pushHistory();
      const newEntityId = entityUid();
      const newProperties: Property[] = params.properties.map((p) => ({
        id: propUid(),
        name: p.name.trim(),
        description: "",
        type: p.type,
        confidence: 1,
        status: "confirmed",
        mapping: null,
        ...(p.isIdentifier ? { isIdentifier: true as const } : {}),
      }));
      const newEntity: Entity = {
        id: newEntityId,
        name: params.name.trim(),
        description: "",
        confidence: 1,
        status: "confirmed",
        table: "",
        x: params.position.x,
        y: params.position.y,
        properties: newProperties,
      };
      setEntities((es) => [...es, newEntity]);

      let historyDetail = newEntity.name || "Untitled entity";
      if (params.connection) {
        const { sourceEntityId, relationName, direction } = params.connection;
        const sourceEntity = entitiesRef.current.find((e) => e.id === sourceEntityId);
        const sourceName = sourceEntity?.name || "Untitled entity";
        const newRelation: Relation = {
          id: relationUid(),
          name: relationName.trim(),
          description: "",
          from: direction === "fromSource" ? sourceEntityId : newEntityId,
          to: direction === "fromSource" ? newEntityId : sourceEntityId,
          confidence: 1,
          status: "confirmed",
        };
        setRelations((rs) => [...rs, newRelation]);
        historyDetail = `${historyDetail} — connected to ${sourceName} via "${newRelation.name || "Untitled relation"}"`;
      }

      logHistoryEvent({
        title: "Created Entity",
        detail: historyDetail,
        ref: { kind: "entity", id: newEntityId },
        // Undoing this restores Current Ontology to before the WHOLE operation, not just the
        // Entity itself — `deleteEntity` (what `undoEntityCreate` calls) already cascades any
        // Relation touching the deleted Entity into Trash too, so the Relation this created
        // disappears right along with it with no separate restore op needed for it.
        restore: { kind: "undoEntityCreate", id: newEntityId },
      });
      return newEntityId;
    },
    [pushHistory, logHistoryEvent],
  );

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
      pushHistory();
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
    [pushHistory],
  );

  // Accept for the Suggestion selection workflow (Header's contextual selection bar) — unlike
  // `confirmItems` above (which trusts its caller's own eligibility check, e.g. the Confirm
  // dialog's), this one re-checks each key's live status itself and silently drops anything
  // that's already confirmed or blocked by an Error, since the selection can go stale between
  // when an item was selected and when Accept is actually clicked (someone could have fixed or
  // re-flagged it in between). Error items are never accepted, but are left exactly as they were
  // — still selected, still visible, still requiring attention — never silently declined.
  //
  // Entity/Property lifecycle invariant: a Property can never end up Applied ("confirmed") while
  // its own Entity is still Suggested — "Child Applied → Parent must be Applied." This function is
  // the only place that resolves suggestion keys into the id lists `confirmItems` actually writes,
  // so it's the one place that both enforces and satisfies that invariant:
  //   - A lone Property key is only honored once its Entity is already Applied, or is being
  //     Applied together in this very call — otherwise it's silently dropped, exactly like an
  //     already-confirmed or Errored key.
  //   - Accepting an Entity applies every one of its OWN current Properties right along with it
  //     (Warnings included — only an Error still blocks, the same rule `buildConfirmPlan` already
  //     uses elsewhere), even if the user only selected the Entity itself. This is what "apply the
  //     Entity and the Properties that belong to that accepted Entity proposal together" means in
  //     practice. A Property added later, once the Entity is already Applied, is an independent
  //     future suggestion and is never swept in by this cascade.
  const acceptSuggestions = useCallback(
    (keys: string[]) => {
      const entityIds: string[] = [];
      const relationIds: string[] = [];
      const propertyKeys: { entityId: string; propertyId: string }[] = [];
      const mappingKeys: { entityId: string; propertyId: string }[] = [];
      keys.forEach((key) => {
        const ref = parseSuggestionKey(key);
        if (!ref) return;
        if (ref.kind === "entity") {
          const e = entities.find((x) => x.id === ref.id);
          if (e && e.status !== "error" && e.status !== "confirmed") entityIds.push(ref.id);
        } else if (ref.kind === "relation") {
          const r = relations.find((x) => x.id === ref.id);
          if (r && r.status !== "error" && r.status !== "confirmed") relationIds.push(ref.id);
        } else if (ref.kind === "property") {
          propertyKeys.push({ entityId: ref.entityId, propertyId: ref.propertyId });
        } else {
          const property = entities
            .find((entity) => entity.id === ref.entityId)
            ?.properties.find((item) => item.id === ref.propertyId);
          if (property?.mapping && mappingStatus(property.mapping) === "suggested") {
            mappingKeys.push(ref);
          }
        }
      });

      const acceptingEntitySet = new Set(entityIds);
      const propertyIds: { entityId: string; propertyId: string }[] = [];
      const addedPropertyKeys = new Set<string>();
      const addProperty = (entityId: string, propertyId: string) => {
        const dedupeKey = `${entityId} ${propertyId}`;
        if (addedPropertyKeys.has(dedupeKey)) return;
        addedPropertyKeys.add(dedupeKey);
        propertyIds.push({ entityId, propertyId });
      };
      propertyKeys.forEach(({ entityId, propertyId }) => {
        const owner = entities.find((x) => x.id === entityId);
        const p = owner?.properties.find((x) => x.id === propertyId);
        if (!owner || !p || p.status === "error" || p.status === "confirmed") return;
        if (owner.status !== "confirmed" && !acceptingEntitySet.has(entityId)) return;
        addProperty(entityId, propertyId);
      });
      entityIds.forEach((entityId) => {
        const owner = entities.find((x) => x.id === entityId);
        owner?.properties.forEach((p) => {
          if (p.status === "confirmed" || propertyStatus(p) === "error") return;
          addProperty(entityId, p.id);
        });
      });

      if (
        entityIds.length > 0 ||
        propertyIds.length > 0 ||
        relationIds.length > 0 ||
        mappingKeys.length > 0
      ) {
        const hasOntologyItems =
          entityIds.length > 0 || propertyIds.length > 0 || relationIds.length > 0;
        if (hasOntologyItems) confirmItems({ entityIds, propertyIds, relationIds });
        else pushHistory();
        if (mappingKeys.length > 0) {
          const mappingKeySet = new Set(
            mappingKeys.map(({ entityId, propertyId }) => `${entityId}|${propertyId}`),
          );
          setEntities((current) =>
            current.map((entity) => ({
              ...entity,
              properties: entity.properties.map((property) =>
                property.mapping && mappingKeySet.has(`${entity.id}|${property.id}`)
                  ? { ...property, mapping: { ...property.mapping, status: "mapped" } }
                  : property,
              ),
            })),
          );
        }
        const total =
          entityIds.length + propertyIds.length + relationIds.length + mappingKeys.length;
        const parts: string[] = [];
        if (entityIds.length > 0) {
          parts.push(`${entityIds.length} Entit${entityIds.length === 1 ? "y" : "ies"}`);
        }
        if (propertyIds.length > 0) {
          parts.push(`${propertyIds.length} Propert${propertyIds.length === 1 ? "y" : "ies"}`);
        }
        if (relationIds.length > 0) {
          parts.push(`${relationIds.length} Relation${relationIds.length === 1 ? "" : "s"}`);
        }
        if (mappingKeys.length > 0) {
          parts.push(`${mappingKeys.length} Mapping${mappingKeys.length === 1 ? "" : "s"}`);
        }
        // Prior status (Suggested or Warning — never Error/Confirmed, both already filtered out
        // above) is read from the same pre-`confirmItems` `entities`/`relations` closure as
        // everything else here, and carried into each child's `restore` — nothing else about the
        // item changes on Accept, so "restore" for one of these is exactly setting `status` back.
        const children: HistoryLogChild[] = [
          ...entityIds.map((id) => {
            const e = entities.find((x) => x.id === id);
            return {
              title: "Entity",
              detail: e?.name || "Untitled entity",
              ref: { kind: "entity" as const, id },
              restore: e
                ? { kind: "entityPatch" as const, id, before: { status: e.status } }
                : undefined,
            };
          }),
          ...propertyIds.map(({ entityId, propertyId }) => {
            const owner = entities.find((e) => e.id === entityId);
            const p = owner?.properties.find((x) => x.id === propertyId);
            return {
              title: "Property",
              detail: `${owner?.name || "Untitled entity"}.${p?.name || "Untitled property"}`,
              ref: { kind: "property" as const, entityId, propertyId },
              restore: p
                ? {
                    kind: "propertyPatch" as const,
                    entityId,
                    propertyId,
                    before: { status: p.status },
                  }
                : undefined,
            };
          }),
          ...relationIds.map((id) => {
            const r = relations.find((x) => x.id === id);
            return {
              title: "Relation",
              detail: r ? relationLabel(r) : "Unnamed relation",
              ref: { kind: "relation" as const, id },
              restore: r
                ? { kind: "relationPatch" as const, id, before: { status: r.status } }
                : undefined,
            };
          }),
          ...mappingKeys.map(({ entityId, propertyId }) => {
            const owner = entities.find((entity) => entity.id === entityId);
            const property = owner?.properties.find((item) => item.id === propertyId);
            return {
              title: "Mapping",
              detail: `${owner?.name || "Untitled entity"}.${property?.name || "Untitled property"}`,
              ref: { kind: "property" as const, entityId, propertyId },
              restore: property
                ? {
                    kind: "propertyPatch" as const,
                    entityId,
                    propertyId,
                    before: { mapping: property.mapping },
                  }
                : undefined,
            };
          }),
        ];
        logHistoryEvent({
          title: total === 1 ? "Accepted 1 suggestion" : `Accepted ${total} suggestions`,
          detail: parts.join(" · "),
          children,
        });
      }
      setSuggestionSelection(new Set());
    },
    [entities, relations, confirmItems, pushHistory, logHistoryEvent],
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
      // Read "before" from the ref first — see `entitiesRef`'s own doc comment for why (the
      // functional `setEntities` updater below isn't a safe place to read a value back out of).
      const source = entitiesRef.current.find((e) => e.id === fromEntityId);
      const target = entitiesRef.current.find((e) => e.id === toEntityId);
      if (!source) return;
      const renameById = new Map(items.map((i) => [i.id, i.name]));
      // Pre-move names, captured BEFORE the rename below — this is exactly what a restore needs
      // to move these same properties back to `fromEntityId` under their original names.
      const originalNameById = new Map(
        source.properties.filter((p) => renameById.has(p.id)).map((p) => [p.id, p.name]),
      );
      const moved = source.properties
        .filter((p) => renameById.has(p.id))
        .map((p) => ({ ...p, name: renameById.get(p.id)! }));
      if (moved.length === 0) return;
      pushHistory();
      setEntities((es) =>
        es.map((e) => {
          if (e.id === fromEntityId)
            return { ...e, properties: e.properties.filter((p) => !renameById.has(p.id)) };
          if (e.id === toEntityId) return { ...e, properties: [...e.properties, ...moved] };
          return e;
        }),
      );
      const sourceName = source.name || "Untitled entity";
      const targetName = target?.name || "Untitled entity";
      const restoreItems = moved.map((p) => ({
        id: p.id,
        name: originalNameById.get(p.id) ?? p.name,
      }));
      logHistoryEvent(
        moved.length === 1
          ? {
              title: "Moved Property",
              detail: `${sourceName}.${moved[0]!.name || "Untitled property"} → ${targetName}`,
              ref: { kind: "property", entityId: toEntityId, propertyId: moved[0]!.id },
              restore: {
                kind: "undoMoveProperties",
                landedOnEntityId: toEntityId,
                cameFromEntityId: fromEntityId,
                items: restoreItems,
              },
            }
          : {
              title: `Moved ${moved.length} Properties`,
              detail: `${sourceName} → ${targetName}`,
              children: moved.map((p) => ({
                title: "Property",
                detail: `${sourceName}.${p.name || "Untitled property"}`,
                ref: { kind: "property", entityId: toEntityId, propertyId: p.id },
                restore: {
                  kind: "undoMoveProperties",
                  landedOnEntityId: toEntityId,
                  cameFromEntityId: fromEntityId,
                  items: [{ id: p.id, name: originalNameById.get(p.id) ?? p.name }],
                },
              })),
            },
      );
    },
    [pushHistory, logHistoryEvent],
  );

  // Connects two entities with a new, fully-named Relation — used by the "Define Relation" dialog
  // that now opens whenever a connector is dragged from one Entity onto another (Overview and
  // Detail alike), replacing the old immediate/unnamed-placeholder behavior this function used to
  // have. Deliberately NOT deduplicated against any existing Relation between the same pair, and
  // deliberately allows `fromId === toId` (a self-relation) — each Relation is its own independent
  // object with its own name and direction, so "Order → Customer: placed by" and "Order → Customer:
  // approved by" (or "Order → Order: parent order") must all be able to coexist. Created straight
  // into "confirmed" status at full confidence, since — unlike the old drag-creates-instantly
  // behavior — a name is now always supplied up front via the dialog, so there's nothing left
  // in-flight to review.
  const createRelation = useCallback(
    (fromId: string, toId: string, name: string) => {
      pushHistory();
      const id = relationUid();
      const newRelation: Relation = {
        id,
        name: name.trim(),
        description: "",
        from: fromId,
        to: toId,
        confidence: 1,
        status: "confirmed",
      };
      setRelations((rs) => [...rs, newRelation]);
      logHistoryEvent({
        title: "Created Relation",
        detail: `${entities.find((e) => e.id === fromId)?.name || "Untitled entity"} → ${entities.find((e) => e.id === toId)?.name || "Untitled entity"}${name.trim() ? ` — "${name.trim()}"` : ""}`,
        ref: { kind: "relation", id },
        restore: { kind: "undoRelationCreate", id },
      });
      return id;
    },
    [entities, pushHistory, logHistoryEvent],
  );

  // Placing an Entity Type next to another in Detail's center card column (dragging a related
  // satellite in, or dropping one straight from the toolbox) only draws a connector when a real
  // Relation already exists — it never fabricates a relationship silently. This is the one
  // exception: when the two placed side by side have no Relation at all yet, this creates an
  // unnamed, Error-status placeholder for that specific pair instead of leaving them looking
  // unrelated forever, so there's something concrete for the reviewer to either name (resolving
  // the Error — see `renameRelation`) or delete outright.
  const createPlaceholderRelation = useCallback(
    (fromId: string, toId: string) => {
      pushHistory();
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
      logHistoryEvent({
        title: "Created Relation",
        detail: `${entities.find((e) => e.id === fromId)?.name || "Untitled entity"} → ${entities.find((e) => e.id === toId)?.name || "Untitled entity"}`,
        ref: { kind: "relation", id },
        restore: { kind: "undoRelationCreate", id },
      });
      return id;
    },
    [entities, pushHistory, logHistoryEvent],
  );

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
      pushHistory();
      const trimmed = name.trim();
      const patch: Partial<Omit<Relation, "id">> = { name: trimmed };
      if (relation.status === "error" && relation.name.trim() === "" && trimmed !== "") {
        patch.status = "suggested";
      }
      setRelations((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      if (trimmed !== relation.name.trim()) {
        logHistoryEvent({
          title: "Renamed Relation",
          detail: `${relationLabel(relation)} → ${trimmed || "Unnamed relation"}`,
          ref: { kind: "relation", id },
          // Restoring the old name may also need to put the Relation back into its old Error
          // state (renaming out of "unnamed" clears it — see `patch.status` above), so this
          // carries the full pre-rename name+status, not just the name.
          restore: {
            kind: "relationPatch",
            id,
            before: { name: relation.name, status: relation.status },
          },
        });
      }
    },
    [relations, pushHistory, logHistoryEvent],
  );

  // Delete moves the item into Trash rather than destroying it — see the `Trashed*` types above.
  // Removing either connected Entity Type never happens as a side effect of deleting a Relation.
  const deleteRelation = useCallback(
    (id: string) => {
      const relation = relations.find((r) => r.id === id);
      if (!relation) return;
      pushHistory();
      setRelations((rs) => rs.filter((r) => r.id !== id));
      setTrashedRelations((ts) => [...ts, { relation, trashedAt: Date.now() }]);
      setSelection((s) => (s?.kind === "relation" && s.id === id ? null : s));
      const fromName = entities.find((e) => e.id === relation.from)?.name || "Untitled entity";
      const toName = entities.find((e) => e.id === relation.to)?.name || "Untitled entity";
      // No `ref` — the Relation no longer exists, so there's nothing left for a click to navigate
      // to (see `HistoryLogChild`'s own doc comment).
      logHistoryEvent({
        title: "Deleted Relation",
        detail: `${fromName} → ${relationLabel(relation)} → ${toName}`,
        restore: { kind: "undoRelationDelete", id },
      });
    },
    [relations, entities, pushHistory, logHistoryEvent],
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
      pushHistory();
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
      logHistoryEvent({
        title: "Deleted Entity",
        detail: target.name || "Untitled entity",
        restore: { kind: "undoEntityDelete", id: entityId },
      });
    },
    [entities, relations, pushHistory, logHistoryEvent],
  );

  // Deleting a Property only ever removes it from its one parent Entity Type — the mapping (if
  // any) simply disappears along with it, since a mapping can't outlive the Property it belongs
  // to; no other Property's mapping is touched. The Entity Type itself is never deleted this way.
  const deleteProperty = useCallback(
    (entityId: string, propertyId: string) => {
      const owner = entities.find((e) => e.id === entityId);
      const property = owner?.properties.find((p) => p.id === propertyId);
      if (!property) return;
      pushHistory();
      setEntities((es) =>
        es.map((e) =>
          e.id === entityId
            ? { ...e, properties: e.properties.filter((p) => p.id !== propertyId) }
            : e,
        ),
      );
      setTrashedProperties((ts) => [...ts, { entityId, property, trashedAt: Date.now() }]);
      logHistoryEvent({
        title: "Deleted Property",
        detail: `${owner?.name || "Untitled entity"}.${property.name || "Untitled property"}`,
        restore: { kind: "undoPropertyDelete", propertyId },
      });
    },
    [entities, pushHistory, logHistoryEvent],
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
      pushHistory();
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
      logHistoryEvent(
        targets.length === 1
          ? {
              title: "Deleted Entity",
              detail: targets[0]!.name || "Untitled entity",
              restore: { kind: "undoEntityDelete", id: targets[0]!.id },
            }
          : {
              title: `Deleted ${targets.length} Entities`,
              children: targets.map((e) => ({
                title: "Entity",
                detail: e.name || "Untitled entity",
                restore: { kind: "undoEntityDelete", id: e.id },
              })),
            },
      );
    },
    [entities, relations, pushHistory, logHistoryEvent],
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
      pushHistory();
      setEntities((es) =>
        es.map((e) => {
          const ids = idsByEntity.get(e.id);
          if (!ids) return e;
          return { ...e, properties: e.properties.filter((p) => !ids.has(p.id)) };
        }),
      );
      setTrashedProperties((ts) => [...ts, ...trashedBatch]);
      logHistoryEvent(
        trashedBatch.length === 1
          ? {
              title: "Deleted Property",
              detail: `${entities.find((e) => e.id === trashedBatch[0]!.entityId)?.name || "Untitled entity"}.${trashedBatch[0]!.property.name || "Untitled property"}`,
              restore: { kind: "undoPropertyDelete", propertyId: trashedBatch[0]!.property.id },
            }
          : {
              title: `Deleted ${trashedBatch.length} Properties`,
              children: trashedBatch.map(({ entityId, property }) => ({
                title: "Property",
                detail: `${entities.find((e) => e.id === entityId)?.name || "Untitled entity"}.${property.name || "Untitled property"}`,
                restore: { kind: "undoPropertyDelete", propertyId: property.id },
              })),
            },
      );
    },
    [entities, pushHistory, logHistoryEvent],
  );

  // Batch counterpart to deleteRelation — for the multi-select contextual "Delete" action (1+
  // Relations selected). Never touches either connected Entity Type, exactly like the single-item
  // version.
  const deleteRelations = useCallback(
    (relationIds: string[]) => {
      const idSet = new Set(relationIds);
      const targets = relations.filter((r) => idSet.has(r.id));
      if (targets.length === 0) return;
      pushHistory();
      const now = Date.now();
      setRelations((rs) => rs.filter((r) => !idSet.has(r.id)));
      setTrashedRelations((ts) => [
        ...ts,
        ...targets.map((relation) => ({ relation, trashedAt: now })),
      ]);
      setSelection((s) => (s?.kind === "relation" && idSet.has(s.id) ? null : s));
      logHistoryEvent(
        targets.length === 1
          ? {
              title: "Deleted Relation",
              detail: `${entities.find((e) => e.id === targets[0]!.from)?.name || "Untitled entity"} → ${relationLabel(targets[0]!)} → ${entities.find((e) => e.id === targets[0]!.to)?.name || "Untitled entity"}`,
              restore: { kind: "undoRelationDelete", id: targets[0]!.id },
            }
          : {
              title: `Deleted ${targets.length} Relations`,
              children: targets.map((r) => ({
                title: "Relation",
                detail: `${entities.find((e) => e.id === r.from)?.name || "Untitled entity"} → ${relationLabel(r)} → ${entities.find((e) => e.id === r.to)?.name || "Untitled entity"}`,
                restore: { kind: "undoRelationDelete", id: r.id },
              })),
            },
      );
    },
    [relations, entities, pushHistory, logHistoryEvent],
  );

  // Decline for the Suggestion selection workflow — explicitly rejecting a selected suggestion is
  // NOT the same as merely deselecting it (deselecting leaves it exactly as-is, still Suggested);
  // Decline actually removes it from the active ontology into Trash, the same durable "preserve
  // the decision in History" outcome `deleteEntities`/`deleteProperties`/`deleteRelations` above
  // already give a manual delete — this is that same operation, just entered from the Suggestion
  // selection bar instead, and composed as one atomic pass across all three kinds at once (a
  // Property whose owning Entity Type is ALSO being declined is trashed as part of that Entity's
  // own record, never as a separate duplicate trashed-property entry). Works for Error items too
  // (declining a bad suggestion outright is a legitimate resolution for it), unlike Accept.
  const declineSuggestions = useCallback(
    (keys: string[]) => {
      const entityIds = new Set<string>();
      const propertyRefs: { entityId: string; propertyId: string }[] = [];
      const mappingRefs: { entityId: string; propertyId: string }[] = [];
      const relationIds = new Set<string>();
      keys.forEach((key) => {
        const ref = parseSuggestionKey(key);
        if (!ref) return;
        if (ref.kind === "entity") entityIds.add(ref.id);
        else if (ref.kind === "relation") relationIds.add(ref.id);
        else if (ref.kind === "property") propertyRefs.push(ref);
        else mappingRefs.push(ref);
      });
      const propertyIdsByEntity = new Map<string, Set<string>>();
      propertyRefs.forEach(({ entityId, propertyId }) => {
        if (entityIds.has(entityId)) return; // already covered by the entity's own removal
        const set = propertyIdsByEntity.get(entityId) ?? new Set<string>();
        set.add(propertyId);
        propertyIdsByEntity.set(entityId, set);
      });

      const declinedEntities = entities.filter((e) => entityIds.has(e.id));
      const cascadedRelationIds = relations
        .filter((r) => entityIds.has(r.from) || entityIds.has(r.to))
        .map((r) => r.id);
      const allRelationIds = new Set([...relationIds, ...cascadedRelationIds]);
      const declinedRelations = relations.filter((r) => allRelationIds.has(r.id));
      const declinedMappings = mappingRefs.filter(({ entityId, propertyId }) => {
        if (entityIds.has(entityId) || propertyIdsByEntity.get(entityId)?.has(propertyId)) {
          return false;
        }
        const property = entities
          .find((entity) => entity.id === entityId)
          ?.properties.find((item) => item.id === propertyId);
        return !!property?.mapping && mappingStatus(property.mapping) === "suggested";
      });

      if (
        declinedEntities.length === 0 &&
        propertyIdsByEntity.size === 0 &&
        declinedRelations.length === 0 &&
        declinedMappings.length === 0
      ) {
        setSuggestionSelection(new Set());
        return;
      }
      pushHistory();
      const now = Date.now();

      setEntities((es) =>
        es
          .filter((e) => !entityIds.has(e.id))
          .map((e) => {
            const propIds = propertyIdsByEntity.get(e.id);
            const rejectedMappingIds = new Set(
              declinedMappings
                .filter((mapping) => mapping.entityId === e.id)
                .map((mapping) => mapping.propertyId),
            );
            const properties = propIds
              ? e.properties.filter((p) => !propIds.has(p.id))
              : e.properties;
            return rejectedMappingIds.size > 0
              ? {
                  ...e,
                  properties: properties.map((property) =>
                    rejectedMappingIds.has(property.id) ? { ...property, mapping: null } : property,
                  ),
                }
              : propIds
                ? { ...e, properties }
                : e;
          }),
      );
      setRelations((rs) => rs.filter((r) => !allRelationIds.has(r.id)));

      if (declinedEntities.length > 0) {
        setTrashedEntities((ts) => [
          ...ts,
          ...declinedEntities.map((entity) => ({
            entity,
            relatedTrashedRelationIds: relations
              .filter((r) => r.from === entity.id || r.to === entity.id)
              .map((r) => r.id),
            trashedAt: now,
          })),
        ]);
      }
      if (propertyIdsByEntity.size > 0) {
        const trashedBatch: TrashedProperty[] = [];
        propertyIdsByEntity.forEach((propIds, entityId) => {
          const owner = entities.find((e) => e.id === entityId);
          owner?.properties.forEach((p) => {
            if (propIds.has(p.id)) trashedBatch.push({ entityId, property: p, trashedAt: now });
          });
        });
        setTrashedProperties((ts) => [...ts, ...trashedBatch]);
      }
      if (declinedRelations.length > 0) {
        setTrashedRelations((ts) => [
          ...ts,
          ...declinedRelations.map((relation) => ({ relation, trashedAt: now })),
        ]);
      }
      setDetail((d) => (d?.kind === "entity" && entityIds.has(d.id) ? null : d));
      setSelection((s) => (s?.kind === "entity" && entityIds.has(s.id) ? null : s));
      setSuggestionSelection(new Set());

      const declinedPropertyCount = Array.from(propertyIdsByEntity.values()).reduce(
        (n, set) => n + set.size,
        0,
      );
      const total =
        declinedEntities.length +
        declinedPropertyCount +
        declinedRelations.length +
        declinedMappings.length;
      const parts: string[] = [];
      if (declinedEntities.length > 0) {
        parts.push(
          `${declinedEntities.length} Entit${declinedEntities.length === 1 ? "y" : "ies"}`,
        );
      }
      if (declinedPropertyCount > 0) {
        parts.push(`${declinedPropertyCount} Propert${declinedPropertyCount === 1 ? "y" : "ies"}`);
      }
      if (declinedRelations.length > 0) {
        parts.push(
          `${declinedRelations.length} Relation${declinedRelations.length === 1 ? "" : "s"}`,
        );
      }
      if (declinedMappings.length > 0) {
        parts.push(`${declinedMappings.length} Mapping${declinedMappings.length === 1 ? "" : "s"}`);
      }
      // Declining moves each item into Trash exactly like a manual delete does (see the doc
      // comment above) — so its restore is the same `undo*Delete` op a delete's own History child
      // carries, not a status-flip. No `ref` here either, same reasoning as every delete above:
      // the object no longer exists in the live ontology for a click to navigate to.
      const declinedPropertyChildren: HistoryLogChild[] = [];
      propertyIdsByEntity.forEach((propIds, entityId) => {
        const owner = entities.find((e) => e.id === entityId);
        owner?.properties.forEach((p) => {
          if (propIds.has(p.id)) {
            declinedPropertyChildren.push({
              title: "Property",
              detail: `${owner.name || "Untitled entity"}.${p.name || "Untitled property"}`,
              restore: { kind: "undoPropertyDelete", propertyId: p.id },
            });
          }
        });
      });
      logHistoryEvent({
        title: total === 1 ? "Rejected 1 suggestion" : `Rejected ${total} suggestions`,
        detail: parts.join(" · "),
        children: [
          ...declinedEntities.map((e) => ({
            title: "Entity",
            detail: e.name || "Untitled entity",
            restore: { kind: "undoEntityDelete" as const, id: e.id },
          })),
          ...declinedPropertyChildren,
          ...declinedRelations.map((r) => ({
            title: "Relation",
            detail: relationLabel(r),
            restore: { kind: "undoRelationDelete" as const, id: r.id },
          })),
          ...declinedMappings.map(({ entityId, propertyId }) => {
            const owner = entities.find((entity) => entity.id === entityId);
            const property = owner?.properties.find((item) => item.id === propertyId);
            return {
              title: "Mapping",
              detail: `${owner?.name || "Untitled entity"}.${property?.name || "Untitled property"}`,
              ref: { kind: "property" as const, entityId, propertyId },
              restore: property
                ? {
                    kind: "propertyPatch" as const,
                    entityId,
                    propertyId,
                    before: { mapping: property.mapping },
                  }
                : undefined,
            };
          }),
        ],
      });
    },
    [entities, relations, pushHistory, logHistoryEvent],
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
      pushHistory();
      setRelations((rs) => (rs.some((r) => r.id === relationId) ? rs : [...rs, trashed.relation]));
      setTrashedRelations((ts) => ts.filter((t) => t.relation.id !== relationId));
    },
    [trashedRelations, entities, pushHistory],
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
      pushHistory();
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
    [trashedEntities, entities, trashedRelations, pushHistory],
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
      pushHistory();
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
    [trashedProperties, entities, pushHistory],
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
      pushHistory();
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
      logHistoryEvent({
        title: "Split Entity",
        detail: `${original.name || "Untitled entity"} → ${moved.length} propert${moved.length === 1 ? "y" : "ies"} moved to a new entity`,
        // Points at the original (still exists, just fewer properties) rather than the new
        // entity — the new one has no name yet, so it's a less useful thing to land on.
        ref: { kind: "entity", id: entityId },
        // Unsplitting: move the split-off properties back (they haven't been renamed, so their
        // current names ARE their pre-split names), then remove the now-empty new entity — see
        // `RestoreOp`'s own doc comment on `undoSplit`.
        restore: {
          kind: "undoSplit",
          newEntityId: newId,
          originalEntityId: entityId,
          moved: moved.map((p) => ({ id: p.id, name: p.name })),
        },
      });
      return newId;
    },
    [entities, pushHistory, logHistoryEvent],
  );

  // Combines two or more entities into one new entity: every property from every source entity
  // carries over (re-keyed to stay unique), and any relation that pointed at a merged entity is
  // repointed at the new one — a relation that would become a self-loop (both ends merged
  // together) is dropped since it no longer describes anything.
  //
  // Deliberately has no `restore` on its History entry (see `RestoreOp`'s own doc comment) — unlike
  // every other mutation here, Merge is genuinely lossy in ways no inverse call can undo: every
  // property gets a brand-new id (`propUid()`), discarding the link back to which source entity or
  // original property it came from, and any relation between two entities that were BOTH merged
  // becomes a self-loop and is dropped outright — not trashed, not logged, gone from all state the
  // moment this returns. A safe restore would need its own separate, much larger snapshot captured
  // at merge time (every source entity in full, every dropped relation in full) and new primitives
  // that don't exist yet (creating an entity/property with a SPECIFIC, not fresh, id) — deliberately
  // not built here; seeing this in History and not being able to individually restore it is the
  // correct, honest behavior for now, not a gap to paper over.
  const mergeEntities = useCallback(
    (ids: string[], name: string) => {
      const idSet = new Set(ids);
      const merged = entities.filter((e) => idSet.has(e.id));
      if (merged.length < 2 || !name.trim()) return null;
      pushHistory();
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
      logHistoryEvent({
        title: "Merged Entities",
        detail: `${merged.map((e) => e.name || "Untitled entity").join(" + ")} → ${newEntity.name}`,
        ref: { kind: "entity", id: newId },
      });
      return newId;
    },
    [entities, pushHistory, logHistoryEvent],
  );

  // --- Selective Restore ----------------------------------------------------------------------
  // One History event's individual changes, inspected and restored independently of one another —
  // see `RestoreOp`'s own doc comment for what "restore" means here (never a full snapshot
  // rollback, always the same per-object mutators every other edit in this app already goes
  // through). `childIndex: null` addresses a non-batch entry's own single change; a non-null index
  // addresses one of a batch entry's `children`.
  const applyRestoreOp = useCallback(
    (op: RestoreOp): { ok: true } | { ok: false; reason: string } => {
      switch (op.kind) {
        case "entityPatch": {
          if (!entitiesRef.current.some((e) => e.id === op.id)) {
            return { ok: false, reason: "This Entity Type no longer exists." };
          }
          updateEntity(op.id, op.before);
          return { ok: true };
        }
        case "propertyPatch": {
          const owner = entitiesRef.current.find((e) => e.id === op.entityId);
          const prop = owner?.properties.find((p) => p.id === op.propertyId);
          if (!owner || !prop) {
            return { ok: false, reason: "This Property no longer exists." };
          }
          if (op.before.mapping) {
            const m = op.before.mapping;
            const stillValid =
              tableByName(m.table)?.columns.some((c) => c.name === m.column) ?? false;
            if (!stillValid) {
              return {
                ok: false,
                reason: `${m.table}.${m.column} no longer exists, so this mapping can't be restored.`,
              };
            }
          }
          updateProperty(op.entityId, op.propertyId, op.before);
          return { ok: true };
        }
        case "relationPatch": {
          const relation = relationsRef.current.find((r) => r.id === op.id);
          if (!relation) {
            return { ok: false, reason: "This Relation no longer exists." };
          }
          if (op.before.from && !entitiesRef.current.some((e) => e.id === op.before.from)) {
            return { ok: false, reason: "One of this Relation's Entity Types no longer exists." };
          }
          if (op.before.to && !entitiesRef.current.some((e) => e.id === op.before.to)) {
            return { ok: false, reason: "One of this Relation's Entity Types no longer exists." };
          }
          updateRelation(op.id, op.before);
          return { ok: true };
        }
        case "undoEntityCreate": {
          if (!entitiesRef.current.some((e) => e.id === op.id)) {
            return { ok: false, reason: "This Entity Type no longer exists." };
          }
          deleteEntity(op.id);
          return { ok: true };
        }
        case "undoPropertyCreate": {
          const owner = entitiesRef.current.find((e) => e.id === op.entityId);
          if (!owner || !owner.properties.some((p) => p.id === op.propertyId)) {
            return { ok: false, reason: "This Property no longer exists." };
          }
          deleteProperty(op.entityId, op.propertyId);
          return { ok: true };
        }
        case "undoRelationCreate": {
          if (!relationsRef.current.some((r) => r.id === op.id)) {
            return { ok: false, reason: "This Relation no longer exists." };
          }
          deleteRelation(op.id);
          return { ok: true };
        }
        case "undoEntityDelete": {
          if (!trashedEntities.some((t) => t.entity.id === op.id)) {
            return {
              ok: false,
              reason:
                "This Entity Type can't be restored — it's already back, or no longer in Trash.",
            };
          }
          restoreEntity(op.id);
          return { ok: true };
        }
        case "undoPropertyDelete": {
          const trashed = trashedProperties.find((t) => t.property.id === op.propertyId);
          if (!trashed) {
            return {
              ok: false,
              reason: "This Property can't be restored — it's already back, or no longer in Trash.",
            };
          }
          if (!entitiesRef.current.some((e) => e.id === trashed.entityId)) {
            return {
              ok: false,
              reason: "This Property can't be restored because its Entity Type no longer exists.",
            };
          }
          restoreProperty(op.propertyId);
          return { ok: true };
        }
        case "undoRelationDelete": {
          const trashed = trashedRelations.find((t) => t.relation.id === op.id);
          if (!trashed) {
            return {
              ok: false,
              reason: "This Relation can't be restored — it's already back, or no longer in Trash.",
            };
          }
          const fromEntity = entitiesRef.current.find((e) => e.id === trashed.relation.from);
          const toEntity = entitiesRef.current.find((e) => e.id === trashed.relation.to);
          if (!fromEntity || !toEntity) {
            // The missing endpoint might still be findable in Trash (e.g. it was deleted, which
            // is exactly what cascaded this Relation into Trash in the first place) — worth
            // naming precisely rather than falling back to a bare, unfamiliar id.
            const nameOf = (id: string) =>
              trashedEntities.find((t) => t.entity.id === id)?.entity.name || "Untitled entity";
            const missingName = !fromEntity
              ? nameOf(trashed.relation.from)
              : nameOf(trashed.relation.to);
            return {
              ok: false,
              reason: `${relationLabel(trashed.relation)} cannot be restored because ${missingName} no longer exists.`,
            };
          }
          restoreRelation(op.id);
          return { ok: true };
        }
        case "undoMoveProperties": {
          const source = entitiesRef.current.find((e) => e.id === op.landedOnEntityId);
          const target = entitiesRef.current.find((e) => e.id === op.cameFromEntityId);
          if (!source || !target) {
            return {
              ok: false,
              reason:
                "This move can't be restored because one of its Entity Types no longer exists.",
            };
          }
          if (!op.items.every((i) => source.properties.some((p) => p.id === i.id))) {
            return {
              ok: false,
              reason:
                "This Property has moved again since — it can't be restored to its old location.",
            };
          }
          moveProperties(op.landedOnEntityId, op.cameFromEntityId, op.items);
          return { ok: true };
        }
        case "undoSplit": {
          const newEnt = entitiesRef.current.find((e) => e.id === op.newEntityId);
          const original = entitiesRef.current.find((e) => e.id === op.originalEntityId);
          if (!newEnt || !original) {
            return {
              ok: false,
              reason:
                "This Split can't be undone because one of its Entity Types no longer exists.",
            };
          }
          if (!op.moved.every((i) => newEnt.properties.some((p) => p.id === i.id))) {
            return {
              ok: false,
              reason: "These Properties have changed again since — this Split can't be undone.",
            };
          }
          moveProperties(op.newEntityId, op.originalEntityId, op.moved);
          deleteEntity(op.newEntityId);
          return { ok: true };
        }
        default: {
          const _exhaustive: never = op;
          return _exhaustive;
        }
      }
    },
    [
      updateEntity,
      updateProperty,
      updateRelation,
      deleteEntity,
      deleteProperty,
      deleteRelation,
      restoreEntity,
      restoreProperty,
      restoreRelation,
      moveProperties,
      trashedEntities,
      trashedProperties,
      trashedRelations,
    ],
  );

  const restoreHistoryChanges = useCallback(
    (entryId: string, childIndexes: number[] | null) => {
      const entry = historyLog.find((h) => h.id === entryId);
      if (!entry) return { restoredCount: 0, conflicts: [] as RestoreConflict[] };

      const targets: { childIndex: number | null; child: HistoryLogChild }[] =
        childIndexes === null
          ? [{ childIndex: null, child: entry }]
          : childIndexes
              .map((i) => ({ childIndex: i, child: entry.children?.[i] }))
              .filter((t): t is { childIndex: number; child: HistoryLogChild } => !!t.child);

      const conflicts: RestoreConflict[] = [];
      const restoredLabels: string[] = [];
      // Suppressed for exactly this loop — each `applyRestoreOp` call below goes through a normal
      // mutator (`updateEntity`, `deleteEntity`, ...) that would otherwise log its own ordinary
      // entry too, doubling up on the one "Restored N changes" summary this function logs itself
      // right after turning the suppression back off.
      suppressHistoryLogRef.current = true;
      try {
        targets.forEach(({ childIndex, child }) => {
          if (!child.restore) {
            conflicts.push({ childIndex, message: "This change can't be restored." });
            return;
          }
          const result = applyRestoreOp(child.restore);
          if (!result.ok) {
            conflicts.push({ childIndex, message: result.reason });
            return;
          }
          restoredLabels.push(child.detail ? `${child.title} — ${child.detail}` : child.title);
        });
      } finally {
        suppressHistoryLogRef.current = false;
      }

      if (restoredLabels.length > 0) {
        logHistoryEvent(
          restoredLabels.length === 1
            ? {
                title: "Restored 1 change",
                detail: `From "${entry.title}"`,
              }
            : {
                title: `Restored ${restoredLabels.length} changes`,
                detail: `From "${entry.title}"`,
                children: restoredLabels.map((label) => ({ title: `Restored: ${label}` })),
              },
        );
      }

      return { restoredCount: restoredLabels.length, conflicts };
    },
    [historyLog, applyRestoreOp, logHistoryEvent],
  );

  /** The one entry point the UI actually calls — restores whatever is currently checked in
   * History Inspection Mode (see `HistoryInspection`'s own doc comment), then either leaves
   * Inspection Mode entirely (a clean restore) or keeps it open with only the conflicted changes
   * still selected, each showing its own conflict message (a partial restore) — the same
   * "conflicted stays checked, everything else clears" rule the previous inline implementation
   * used. `restoreHistoryChanges` above is the low-level primitive this wraps; it addresses
   * changes by `childIndex` (its own pre-existing contract), so this translates the panel/canvas's
   * own `number`-keyed selection to and from that before/after calling it. */
  const restoreSelectedHistoryChanges = useCallback((): RestoreOutcome => {
    if (!historyInspection) return { restoredCount: 0, conflicts: [] };
    const { entryId, changes, selected } = historyInspection;
    const selectedChanges = changes.filter((c) => selected.has(c.number));
    if (selectedChanges.length === 0) return { restoredCount: 0, conflicts: [] };

    const isSingle = changes.length === 1 && changes[0]!.childIndex === null;
    const childIndexes = isSingle ? null : selectedChanges.map((c) => c.childIndex as number);
    const outcome = restoreHistoryChanges(entryId, childIndexes);

    const numberFor = (childIndex: number | null) =>
      changes.find((c) => c.childIndex === childIndex)?.number;
    const conflictedNumbers = new Set(
      outcome.conflicts.map((c) => numberFor(c.childIndex)).filter((n): n is number => n != null),
    );

    const restoredRefs = selectedChanges
      .filter((c) => !conflictedNumbers.has(c.number))
      .map((c) => c.ref)
      .filter((r): r is SearchResultRef => !!r);
    if (restoredRefs.length > 0) flashRestoreHighlight(restoredRefs);

    if (outcome.conflicts.length === 0) {
      exitHistoryInspection();
    } else {
      setHistoryInspection((prev) =>
        prev ? { ...prev, selected: conflictedNumbers, conflicts: outcome.conflicts } : prev,
      );
    }

    return outcome;
  }, [historyInspection, restoreHistoryChanges, flashRestoreHighlight, exitHistoryInspection]);

  const resetDemoScenario = useCallback((scenario: DemoScenario) => {
    const fixture = createDemoFixture(scenario);
    setDemoScenario(scenario);
    setEntities(fixture.entities);
    setRelations(fixture.relations);
    setTrashedEntities([]);
    setTrashedProperties([]);
    setTrashedRelations([]);
    setPast([]);
    setFuture([]);
    setHistoryLog(scenario === "fresh" ? [] : IN_PROGRESS_HISTORY_LOG);
    setSelection(null);
    setDetail(null);
    setEntityMorphOrigin(null);
    setView({ x: 60, y: 40, z: 0.55 });
    setConfidenceRange({ min: 0, max: 100 });
    setStatusFilter(new Set<ReviewStatus>(["suggested", "confirmed", "warning", "error"]));
    setSuggestionSelection(new Set());
    setSearchFocus(null);
    setIssueInspection(null);
    setHistoryInspection(null);
    setHistoryInspectionHoveredNumber(null);
    setHistoryPanelOpenRaw(false);
    setHistoryRestoreHighlight([]);
    if (restoreHighlightTimeoutRef.current) {
      clearTimeout(restoreHighlightTimeoutRef.current);
      restoreHighlightTimeoutRef.current = null;
    }
  }, []);

  return {
    demoScenario,
    resetDemoScenario,
    entities,
    relations,
    tables,
    trashedEntities,
    trashedProperties,
    trashedRelations,
    updateEntity,
    updateProperty,
    updateMapping,
    confirmMapping,
    updateRelation,
    createEntity,
    createProperty,
    createEntityWithProperties,
    confirmItems,
    moveProperties,
    createRelation,
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
    pushHistory,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    selection,
    select,
    clearSelection,
    detail,
    openDetail,
    closeDetail,
    entityMorphOrigin,
    openDetailWithMorph,
    clearEntityMorphOrigin,
    view,
    setView,
    confidenceRange,
    setConfidenceRange,
    statusFilter,
    setStatusFilter,
    searchFocus,
    clearSearchFocus,
    selectSearchResult,
    issueInspection,
    clearIssueInspection,
    selectIssue,
    historyLog,
    historyPanelOpen,
    setHistoryPanelOpen,
    historyInspection,
    enterHistoryInspection,
    exitHistoryInspection,
    toggleHistoryChangeSelected,
    historyInspectionHoveredNumber,
    setHistoryInspectionHoveredNumber,
    restoreSelectedHistoryChanges,
    historyRestoreHighlight,
    suggestionSelection,
    toggleSuggestionSelected,
    clearSuggestionSelection,
    selectSuggestionKeys,
    acceptSuggestions,
    declineSuggestions,
  };
}

export type OntologyApp = ReturnType<typeof useOntologyApp>;
