import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Copy, SquareSplitHorizontal } from "lucide-react";
import type { OntologyApp } from "@/lib/app-state";
import { parseSuggestionKey, suggestionKey, type SuggestionRef } from "@/lib/app-state";
import {
  canConfirmEntity,
  canConfirmProperty,
  canConfirmRelation,
  entityReview,
  propertyReview,
  relationReview,
  type Entity,
  type Property,
  type Relation,
} from "@/lib/mock-data";
import { SelectionControlBar } from "@/components/detail/SelectionControlBar";
import { cn } from "@/lib/utils";
import { showCompletionNotice } from "@/components/detail/CompletionToast";

/**
 * The multi-select action bar for the Graph views: shown once 2+ items are selected (shift/⌘/
 * ctrl-click), it offers Merge (2+ Entity Types) and Split (Properties of one Entity Type, not all
 * of them) — each named in a card above the bar (Figma 501:101237 / 501:101238) — and Accept /
 * Reject / Delete for whatever in the selection each applies to. A merge opens the merged Entity
 * Type, selected; a split stays put and hands the new one to `onSplit` (to point it out).
 */
export function SelectionActions({
  app,
  onSplit,
}: {
  app: OntologyApp;
  onSplit?: ((newEntityId: string) => void) | undefined;
}) {
  const selection = app.suggestionSelection;
  const refs = useMemo(() => {
    const list: SuggestionRef[] = [];
    selection.forEach((key) => {
      const ref = parseSuggestionKey(key);
      if (ref) list.push(ref);
    });
    return list;
  }, [selection]);
  const entities = useMemo(
    () =>
      refs
        .filter((r): r is Extract<SuggestionRef, { kind: "entity" }> => r.kind === "entity")
        .map((r) => app.entities.find((e) => e.id === r.id))
        .filter((e): e is Entity => !!e),
    [refs, app.entities],
  );
  const properties = useMemo(
    () =>
      refs
        .filter((r): r is Extract<SuggestionRef, { kind: "property" }> => r.kind === "property")
        .map((r) => {
          const owner = app.entities.find((e) => e.id === r.entityId);
          const property = owner?.properties.find((p) => p.id === r.propertyId);
          return owner && property ? { entity: owner, property } : null;
        })
        .filter((v): v is { entity: Entity; property: Property } => !!v),
    [refs, app.entities],
  );
  const relations = useMemo(
    () =>
      refs
        .filter((r): r is Extract<SuggestionRef, { kind: "relation" }> => r.kind === "relation")
        .map((r) => app.relations.find((relation) => relation.id === r.id))
        .filter((relation): relation is Relation => !!relation),
    [refs, app.relations],
  );

  // Split: Properties of a single Entity Type only, and never all of them.
  const splitOwner = (() => {
    if (entities.length > 0 || properties.length === 0) return null;
    const owner = properties[0]!.entity;
    if (properties.some(({ entity }) => entity.id !== owner.id)) return null;
    return properties.length < owner.properties.length ? owner : null;
  })();

  // The naming card open above the bar, and the name typed (or picked) in it.
  const [naming, setNaming] = useState<"merge" | "split" | null>(null);
  const [name, setName] = useState("");
  const openNaming = (action: "merge" | "split") => {
    setNaming((current) => (current === action ? null : action));
    setName("");
  };
  const closeNaming = () => {
    setNaming(null);
    setName("");
  };
  const mergeSuggestions = useMemo(() => {
    if (entities.length < 2) return [];
    const names = entities.map((e) => e.name || "Entity");
    return Array.from(new Set([names.join(""), names.join(" ")].filter((s) => s.trim())));
  }, [entities]);
  const splitSuggestions = useMemo(
    () =>
      splitOwner
        ? splitNameSuggestions(
            splitOwner,
            properties.map((p) => p.property),
          )
        : [],
    [splitOwner, properties],
  );

  const handleMerge = () => {
    if (!name.trim()) return;
    const newId = app.mergeEntities(
      entities.map((e) => e.id),
      name.trim(),
    );
    closeNaming();
    if (!newId) return;
    showCompletionNotice({
      title: "Merge complete",
      description: `‘${name.trim()}’ created from ${entities.length} entities`,
      entityId: newId,
    });
    app.openDetail("entity", newId);
    // The merged Entity Type opens selected, its details in the panel.
    app.selectSuggestionKeys([suggestionKey({ kind: "entity", id: newId })]);
  };
  const handleSplit = useCallback(() => {
    if (!splitOwner || !name.trim()) return;
    const ids = properties.map(({ property }) => property.id);
    const newId = app.splitEntity(splitOwner.id, ids, name.trim());
    app.clearSuggestionSelection();
    closeNaming();
    if (!newId) return;
    onSplit?.(newId);
    showCompletionNotice({
      title: "Split complete",
      description: `‘${name.trim()}’ created with ${ids.length} ${ids.length === 1 ? "property" : "properties"}`,
      entityId: newId,
    });
  }, [app, splitOwner, properties, name, onSplit]);

  const keyOf = {
    entity: (e: Entity) => suggestionKey({ kind: "entity", id: e.id }),
    property: ({ entity, property }: { entity: Entity; property: Property }) =>
      suggestionKey({ kind: "property", entityId: entity.id, propertyId: property.id }),
    relation: (r: Relation) => suggestionKey({ kind: "relation", id: r.id }),
  };
  // Confirmed items are deleted; suggestions are rejected or accepted (an Error blocks accepting;
  // a Relation waits for its Entity Types — `app.acceptSuggestions` re-checks all of it).
  const entityConfirmed = (e: Entity) => entityReview(e) === "confirmed";
  const propertyConfirmed = ({ property }: { property: Property }) =>
    propertyReview(property) === "confirmed";
  const relationConfirmed = (r: Relation) => relationReview(r) === "confirmed";
  const deletable = [
    ...entities.filter(entityConfirmed).map(keyOf.entity),
    ...properties.filter(propertyConfirmed).map(keyOf.property),
    ...relations.filter(relationConfirmed).map(keyOf.relation),
  ];
  const rejectable = [
    ...entities.filter((e) => !entityConfirmed(e)).map(keyOf.entity),
    ...properties.filter((item) => !propertyConfirmed(item)).map(keyOf.property),
    ...relations.filter((r) => !relationConfirmed(r)).map(keyOf.relation),
  ];
  const acceptable = [
    ...entities.filter((e) => !entityConfirmed(e) && canConfirmEntity(e)).map(keyOf.entity),
    ...properties
      .filter((item) => !propertyConfirmed(item) && canConfirmProperty(item.property))
      .map(keyOf.property),
    ...relations
      .filter((r) => !relationConfirmed(r) && canConfirmRelation(r, app.entities))
      .map(keyOf.relation),
  ];
  const handleDelete = () => {
    const entityIds = entities.filter(entityConfirmed).map((e) => e.id);
    const propertyItems = properties
      .filter(propertyConfirmed)
      .map(({ entity, property }) => ({ entityId: entity.id, propertyId: property.id }));
    const relationIds = relations.filter(relationConfirmed).map((r) => r.id);
    if (entityIds.length > 0) app.deleteEntities(entityIds);
    if (propertyItems.length > 0) app.deleteProperties(propertyItems);
    if (relationIds.length > 0) app.deleteRelations(relationIds);
    app.clearSuggestionSelection();
  };

  if (selection.size < 2) return null;
  const mergeable = entities.length >= 2;
  return (
    <div
      className="flex flex-col items-center gap-2"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {naming === "merge" && mergeable && (
        <NamingCard
          icon={<Copy className="size-4 -scale-x-100" strokeWidth={1.5} />}
          title={`Merge ${entities.length} entities into one`}
          hint={`All properties from ${entities.map((e) => e.name || "Untitled").join(", ")} will be combined. Name the resulting entity:`}
          names={entities.map((e) => e.name).filter(Boolean)}
          suggestions={mergeSuggestions}
          value={name}
          onChange={setName}
          action="Merge"
          onSubmit={handleMerge}
        />
      )}
      {naming === "split" && splitOwner && (
        <NamingCard
          icon={<SquareSplitHorizontal className="size-4" strokeWidth={1.5} />}
          title={`Split ${splitOwner.name || "Untitled"} with ${properties.length} properties`}
          hint="Create a new entity from the selected properties. Name the new entity:"
          names={[]}
          suggestions={splitSuggestions}
          value={name}
          onChange={setName}
          action="Split"
          onSubmit={handleSplit}
        />
      )}
      <SelectionControlBar
        entities={entities}
        properties={properties}
        relations={relations}
        activeAction={naming}
        onMerge={mergeable ? () => openNaming("merge") : undefined}
        onSplit={splitOwner ? () => openNaming("split") : undefined}
        onDelete={deletable.length > 0 ? handleDelete : undefined}
        deleteCount={deletable.length}
        onAccept={acceptable.length > 0 ? () => app.acceptSuggestions(acceptable) : undefined}
        acceptCount={acceptable.length}
        onReject={rejectable.length > 0 ? () => app.declineSuggestions(rejectable) : undefined}
        rejectCount={rejectable.length}
      />
    </div>
  );
}

/** PascalCase from camelCase / snake_case words. */
const pascal = (words: string[]) =>
  words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
const wordsOf = (name: string) => name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [];

/** Names for a split-off Entity Type: the selected Properties' shared leading words (or the first
 * one's), and that prefixed with the Entity Type it came from. */
function splitNameSuggestions(owner: Entity, props: Property[]): string[] {
  const lists = props.map((p) => wordsOf(p.name).map((w) => w.toLowerCase()));
  const common: string[] = [];
  for (let i = 0; lists.every((l) => i < l.length - 1 && l[i] === lists[0]![i]); i++) {
    common.push(lists[0]![i]!);
  }
  const base = pascal(common.length > 0 ? common : wordsOf(props[0]?.name ?? "").slice(0, 2));
  const suggestions = [base, owner.name && base ? `${owner.name}${base}` : ""];
  return Array.from(new Set(suggestions.filter((s) => s.trim())));
}

/**
 * The card above the selection bar that names a Merge / Split result (Figma 542:76791 /
 * 542:81706): a title and hint, the source names (plain chips) and AI suggestions (purple
 * chips) to pick from — picking one fills the field — the field itself, and the action, enabled
 * once there's a name.
 */
function NamingCard({
  icon,
  title,
  hint,
  names,
  suggestions,
  value,
  onChange,
  action,
  onSubmit,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  names: string[];
  suggestions: string[];
  value: string;
  onChange: (value: string) => void;
  action: string;
  onSubmit: () => void;
}) {
  return (
    <div className="flex w-[478px] flex-col gap-4 rounded-lg border border-[#e3e5e4] bg-white p-4 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[14px] font-medium leading-5 text-[#161919]">
          {icon}
          {title}
        </div>
        <p className="text-[12px] leading-4 text-[#6d7472]">{hint}</p>
      </div>
      {(names.length > 0 || suggestions.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {names.map((n) => (
            <button
              key={`name-${n}`}
              type="button"
              onClick={() => onChange(n)}
              className={cn(
                "flex h-6 items-center rounded-full border px-2.5 text-[12px] leading-4 transition-colors",
                value === n
                  ? "border-[#c9cccb] bg-[#f4f4f4] text-[#161919]"
                  : "border-[#e3e5e4] bg-white text-[#6d7472] hover:bg-[#f4f4f4]",
              )}
            >
              {n}
            </button>
          ))}
          {suggestions.map((n) => (
            <button
              key={`ai-${n}`}
              type="button"
              onClick={() => onChange(n)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-full border border-[#e9d5ff] px-2.5 text-[12px] font-medium leading-4 text-[#7e22ce] transition-colors",
                value === n ? "bg-[#e9d5ff]" : "bg-[#faf5ff] hover:bg-[#f3e8ff]",
              )}
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#7e22ce]" />
              {n}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type a name"
          aria-label="Name"
          className="h-9 min-w-0 flex-1 rounded-[4px] border border-[#e3e5e4] bg-white px-3 text-[14px] leading-6 text-[#161919] outline-none placeholder:text-[#9ea3a2] focus:border-[#161919]"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="h-9 shrink-0 rounded-[4px] bg-[#161919] px-4 text-[14px] font-medium leading-6 text-white transition-colors hover:bg-[#252828] disabled:bg-[#9ea3a2]"
        >
          {action}
        </button>
      </form>
    </div>
  );
}
