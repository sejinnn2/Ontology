import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import {
  entityDisplayStatus,
  entityErrorReason,
  propertyStatus,
  relationLabel,
  mappingStatus,
  isIdentifierProperty,
  tableByName,
  tablesUsedByEntity,
  type Entity,
  type Property,
  type Relation,
  type TableSchema,
  type ColumnRef,
} from "@/lib/mock-data";
import type { OntologyApp } from "@/lib/app-state";
import { suggestionKey } from "@/lib/app-state";
import type { DetailAnchor } from "@/lib/app-state";
import { StatusBadge, reviewStatusLabel } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import {
  ContextPanelBody,
  type ContextItem,
  contextItemKey,
} from "@/components/detail/ContextPanel";
import { cn } from "@/lib/utils";

/**
 * Idea 3: "Context ← Focus → Context". A deliberately different Editing/Detail interaction model
 * from `DetailView` (Idea 1/2) — NOT a variant of that component, a separate one, so this can be
 * prototyped freely without risking Idea 1/2's behavior at all. Three spatial zones (Related
 * Context, Focus, Data Context) instead of a card-based canvas, with Related Entities/Data Tables
 * collapsed to a single compact row by default and Property<->Column Mapping connectors never
 * drawn as persistent lines at all — see the module-level doc comments below on each zone for what
 * "progressive disclosure" means in each direction.
 *
 * Reuses the same `app` (OntologyApp) mutators DetailView itself calls — updateEntity/
 * updateProperty/updateMapping/acceptSuggestions/declineSuggestions/etc. — and the same
 * `ContextPanelBody` for Name+Description+Accept/Reject, so Entity/Property/Relation review-status
 * semantics, Mapping vs Suggested Mapping, and History all stay the single shared ontology state
 * this file never forks.
 */

function IdentifierIcon() {
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center text-[12px] leading-none"
      title="Identifier"
      aria-label="Identifier"
    >
      🔑
    </span>
  );
}

/** Every Column across every Table, flattened once per render of the picker (not memoized at the
 * component-tree level — this only computes while a picker is actually open, and closes again
 * before the next one, so there's no standing cost). Search matches the column's own name OR its
 * parent table's name, so typing a table name narrows results too. */
function searchColumns(tables: TableSchema[], query: string, limit = 30) {
  const q = query.trim().toLowerCase();
  const results: { table: string; column: string; type: string }[] = [];
  for (const table of tables) {
    for (const col of table.columns) {
      if (!q || col.name.toLowerCase().includes(q) || table.name.toLowerCase().includes(q)) {
        results.push({ table: table.name, column: col.name, type: col.type });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

/** The temporary, node-editor-style Mapping target picker (spec section 4) — appears anchored
 * right under the Property that triggered it, never a permanent side panel. Escape or an outside
 * click cancels without mutating; selecting a Column commits via `onPick` (the caller applies it
 * through `app.updateMapping`, the exact same mutator DetailView's own disconnect/reconnect uses)
 * and this component unmounts. */
function MappingPicker({
  tables,
  currentMapping,
  onPick,
  onClose,
}: {
  tables: TableSchema[];
  currentMapping: ColumnRef | null;
  onPick: (table: string, column: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  const results = useMemo(() => searchColumns(tables, query), [tables, query]);
  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-2xl border border-[rgba(28,28,24,0.08)] bg-white shadow-[var(--shadow-node-lift)]"
    >
      <div className="flex items-center gap-1.5 border-b border-[rgba(28,28,24,0.08)] px-3 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search columns…"
          className="w-full min-w-0 border-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel"
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {results.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-muted-foreground">No matching columns.</p>
        )}
        {results.map((r) => {
          const isCurrent =
            currentMapping?.table === r.table && currentMapping?.column === r.column;
          return (
            <button
              key={`${r.table}.${r.column}`}
              type="button"
              onClick={() => onPick(r.table, r.column)}
              className={cn(
                "flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left hover:bg-accent",
                isCurrent && "bg-black/[0.04]",
              )}
            >
              <span className="text-[13px] font-medium text-foreground">{r.column}</span>
              <span className="text-[10.5px] text-muted-foreground">
                {r.table} · {r.type}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One Property row inside the Focus zone — the only place in Idea 3 with full editing detail.
 * Shows its mapping as plain inline text (never a canvas connector line — see this file's own
 * module doc comment on "no persistent connectors"); clicking the mapping text/button opens the
 * on-demand `MappingPicker` right below this row rather than requiring the user to find or draw a
 * line anywhere. */
function FocusPropertyRow({
  entity,
  property,
  tables,
  isSelected,
  justMapped,
  onSelect,
  onOpenPicker,
  pickerOpen,
  onClosePicker,
  onPick,
}: {
  entity: Entity;
  property: Property;
  tables: TableSchema[];
  isSelected: boolean;
  justMapped: boolean;
  onSelect: () => void;
  onOpenPicker: () => void;
  pickerOpen: boolean;
  onClosePicker: () => void;
  onPick: (table: string, column: string) => void;
}) {
  const mapped = !!property.mapping;
  return (
    <div
      className={cn(
        "group/prop relative flex flex-col gap-0.5 rounded-[10px] px-3 py-2 text-[13px] transition-colors",
        isSelected ? "bg-black/[0.04] shadow-[0_0_0_1px_#3b82f6]" : "hover:bg-accent",
        justMapped && "shadow-[0_0_0_2px_#22c55e]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex w-full min-w-0 items-center gap-1.5 text-left"
      >
        <span
          className="size-1.5 shrink-0 rounded-full"
          title={reviewStatusLabel(propertyStatus(property))}
          style={{ backgroundColor: statusDotColor(propertyStatus(property)) }}
        />
        {isIdentifierProperty(property) && <IdentifierIcon />}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{property.name}</span>
        {property.status !== "confirmed" && <ConfidenceChip confidence={property.confidence} />}
      </button>
      <div className="relative pl-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPicker();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "truncate rounded-md px-1 py-0.5 text-left text-[11px] transition-colors",
            mapped
              ? "text-muted-foreground hover:bg-accent hover:text-foreground"
              : "text-[#7c5eff] hover:bg-accent",
          )}
        >
          {mapped
            ? `→ ${property.mapping!.table}.${property.mapping!.column}${
                mappingStatus(property.mapping!) === "suggested" ? " (suggested)" : ""
              }`
            : "+ Map to column"}
        </button>
        {pickerOpen && (
          <MappingPicker
            tables={tables}
            currentMapping={property.mapping}
            onPick={onPick}
            onClose={onClosePicker}
          />
        )}
      </div>
    </div>
  );
}

function statusDotColor(status: ReturnType<typeof propertyStatus>): string {
  switch (status) {
    case "confirmed":
      return "#0298b2";
    case "warning":
      return "#e6c200";
    case "error":
      return "#f15b15";
    default:
      return "#7c5eff";
  }
}

/** LEFT zone — Related Context. Compact by default (name + status only, per spec section 2): no
 * Properties render until the user explicitly expands a row, and even expanded, only a plain
 * name/status list shows — full Property editing stays exclusive to the Focus zone in the center,
 * matching "the sides should feel like supporting context," not a second workspace. */
function RelatedEntityRow({
  entity,
  relation,
  expanded,
  onToggle,
  onFocus,
}: {
  entity: Entity;
  relation: Relation;
  expanded: boolean;
  onToggle: () => void;
  onFocus: () => void;
}) {
  return (
    <div className="rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.03]"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <StatusBadge
          status={entityDisplayStatus(entity)}
          size={16}
          confidence={entity.confidence}
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          {entity.name}
        </span>
      </button>
      <p className="truncate pl-7 pr-2 text-[10.5px] text-muted-foreground">
        {relationLabel(relation)}
      </p>
      {expanded && (
        <div className="ml-7 mt-1 flex flex-col gap-0.5 border-l border-[rgba(28,28,24,0.08)] pl-2">
          <button
            type="button"
            onClick={onFocus}
            className="mb-1 self-start text-[10.5px] font-medium text-[#0298b2] hover:underline"
          >
            Make this the Focus →
          </button>
          {entity.properties.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 py-0.5 text-[11.5px]">
              <span
                className="size-1 shrink-0 rounded-full"
                style={{ backgroundColor: statusDotColor(propertyStatus(p)) }}
              />
              <span className="min-w-0 flex-1 truncate text-[#555]">{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** RIGHT zone — Data Context. Compact by default (table name + column count only): Columns
 * progressively reveal on expand, same principle as Related Entities on the other side. */
function DataTableRow({
  table,
  expanded,
  onToggle,
}: {
  table: TableSchema;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.03]"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          {table.name}
        </span>
        <span className="shrink-0 text-[10.5px] text-muted-foreground">
          {table.columns.length} col{table.columns.length === 1 ? "" : "s"}
        </span>
      </button>
      {expanded && (
        <div className="ml-7 mt-1 flex max-h-56 flex-col gap-0.5 overflow-y-auto border-l border-[rgba(28,28,24,0.08)] pl-2">
          {table.columns.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between gap-1.5 py-0.5 text-[11.5px]"
            >
              <span className="min-w-0 flex-1 truncate text-[#555]">{c.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{c.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DetailViewIdea3({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
  const { entities, relations, tables } = app;
  const focusEntity =
    anchor?.kind === "entity" ? (entities.find((e) => e.id === anchor.id) ?? null) : null;

  const [expandedRelatedIds, setExpandedRelatedIds] = useState<Set<string>>(new Set());
  const [expandedTableNames, setExpandedTableNames] = useState<Set<string>>(new Set());
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [pickerForPropertyId, setPickerForPropertyId] = useState<string | null>(null);
  const [justMappedPropertyId, setJustMappedPropertyId] = useState<string | null>(null);
  const [contextItem, setContextItem] = useState<ContextItem | null>(null);

  // Reset all per-Entity local UI state when the Focus itself changes (a related Entity was
  // promoted to Focus, or the user navigated to a different one entirely) — nothing here is
  // meaningful to carry over to a different Entity's own workspace.
  useEffect(() => {
    setExpandedRelatedIds(new Set());
    setExpandedTableNames(new Set());
    setSelectedPropertyId(null);
    setPickerForPropertyId(null);
    setContextItem(null);
  }, [focusEntity?.id]);

  const relatedEntities = useMemo(() => {
    if (!focusEntity) return [];
    return relations
      .filter((r) => r.from === focusEntity.id || r.to === focusEntity.id)
      .map((r) => {
        const otherId = r.from === focusEntity.id ? r.to : r.from;
        const other = entities.find((e) => e.id === otherId);
        return other ? { entity: other, relation: r } : null;
      })
      .filter((x): x is { entity: Entity; relation: Relation } => !!x);
  }, [focusEntity, relations, entities]);

  const dataTables = useMemo(() => {
    if (!focusEntity) return [];
    return tablesUsedByEntity(focusEntity)
      .map((name) => tableByName(name))
      .filter((t): t is TableSchema => !!t);
  }, [focusEntity]);

  const toggleRelated = useCallback((id: string) => {
    setExpandedRelatedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleTable = useCallback((name: string) => {
    setExpandedTableNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handlePick = useCallback(
    (propertyId: string, table: string, column: string) => {
      if (!focusEntity) return;
      app.updateMapping(focusEntity.id, propertyId, { table, column });
      setPickerForPropertyId(null);
      setJustMappedPropertyId(propertyId);
      window.setTimeout(() => {
        setJustMappedPropertyId((cur) => (cur === propertyId ? null : cur));
      }, 1200);
    },
    [app, focusEntity],
  );

  const selectedProperty = focusEntity?.properties.find((p) => p.id === selectedPropertyId) ?? null;

  const backButton = (
    <button
      type="button"
      onClick={app.closeDetail}
      className="absolute left-4 top-3 z-20 flex h-9 shrink-0 items-center gap-1 rounded-[4px] border border-border bg-white px-2 text-sm font-medium text-[#161919] shadow-[var(--shadow-node)] transition-colors hover:bg-accent"
    >
      <ArrowLeft className="size-4" /> Back to Ontology view
    </button>
  );

  if (!focusEntity) {
    return (
      <div className="relative flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        {backButton}
        Idea 3 currently only prototypes the Entity-focused workspace — select an Entity Type to try
        it.
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-white">
      {backButton}
      {/* LEFT — Related Context: a quiet supporting surface, not a third equal list. */}
      <div className="flex w-64 shrink-0 flex-col overflow-y-auto bg-zinc-50/70 px-3 pb-4 pt-14">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Related context
        </p>
        {relatedEntities.length === 0 && (
          <p className="px-2 text-[11.5px] text-muted-foreground">No related Entity Types.</p>
        )}
        <div className="flex flex-col gap-0.5">
          {relatedEntities.map(({ entity, relation }) => (
            <RelatedEntityRow
              key={entity.id}
              entity={entity}
              relation={relation}
              expanded={expandedRelatedIds.has(entity.id)}
              onToggle={() => toggleRelated(entity.id)}
              onFocus={() => app.openDetail("entity", entity.id)}
            />
          ))}
        </div>
      </div>

      {/* CENTER — Focus: the current manipulation surface, visually most prominent. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-x border-[rgba(28,28,24,0.06)] bg-white shadow-[0_0_24px_rgba(0,0,0,0.03)]">
        <div className="flex items-center gap-2 border-b border-[rgba(28,28,24,0.06)] px-6 py-4">
          <StatusBadge
            status={entityDisplayStatus(focusEntity)}
            size={28}
            confidence={focusEntity.confidence}
            warningReason={focusEntity.warningReason}
            errorReason={entityErrorReason(focusEntity)}
          />
          <button
            type="button"
            onClick={() => setContextItem({ kind: "entity", entity: focusEntity })}
            className="min-w-0 flex-1 truncate text-left text-[16px] font-semibold text-foreground hover:underline"
          >
            {focusEntity.name}
          </button>
          {focusEntity.status !== "confirmed" && (
            <ConfidenceChip confidence={focusEntity.confidence} />
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {focusEntity.properties.length} properties
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-0.5">
            {focusEntity.properties.map((p) => (
              <FocusPropertyRow
                key={p.id}
                entity={focusEntity}
                property={p}
                tables={tables}
                isSelected={selectedPropertyId === p.id}
                justMapped={justMappedPropertyId === p.id}
                onSelect={() => {
                  setSelectedPropertyId(p.id);
                  setContextItem({ kind: "property", entity: focusEntity, property: p });
                }}
                pickerOpen={pickerForPropertyId === p.id}
                onOpenPicker={() => setPickerForPropertyId(p.id)}
                onClosePicker={() => setPickerForPropertyId(null)}
                onPick={(table, column) => handlePick(p.id, table, column)}
              />
            ))}
          </div>
        </div>
        {contextItem && (
          <div className="flex max-h-64 items-start gap-2 border-t border-[rgba(28,28,24,0.06)] bg-[#FCFCFC] px-4 py-3">
            <div className="min-w-0 flex-1 overflow-y-auto">
              <ContextPanelBody
                key={contextItemKey(contextItem)}
                item={contextItem}
                entities={entities}
                onSwapRelation={(relationId) => {
                  const r = relations.find((x) => x.id === relationId);
                  if (r) app.updateRelation(relationId, { from: r.to, to: r.from });
                }}
                onRenameRelation={(relationId, name) => app.renameRelation(relationId, name)}
                onEditRelationDescription={(relationId, description) =>
                  app.updateRelation(relationId, { description })
                }
                onRenameEntity={(entityId, name) => app.updateEntity(entityId, { name })}
                onEditEntityDescription={(entityId, description) =>
                  app.updateEntity(entityId, { description })
                }
                onRenameProperty={(entityId, propertyId, name) =>
                  app.updateProperty(entityId, propertyId, { name })
                }
                onEditPropertyDescription={(entityId, propertyId, description) =>
                  app.updateProperty(entityId, propertyId, { description })
                }
                onDeleteContextItem={() => {
                  if (contextItem.kind === "entity") app.deleteEntity(contextItem.entity.id);
                  else if (contextItem.kind === "property")
                    app.deleteProperty(contextItem.entity.id, contextItem.property.id);
                  else if (contextItem.kind === "relation")
                    app.deleteRelation(contextItem.relation.id);
                  setContextItem(null);
                }}
                onAcceptContextItem={() => {
                  const key =
                    contextItem.kind === "entity"
                      ? suggestionKey({ kind: "entity", id: contextItem.entity.id })
                      : contextItem.kind === "property"
                        ? suggestionKey({
                            kind: "property",
                            entityId: contextItem.entity.id,
                            propertyId: contextItem.property.id,
                          })
                        : contextItem.kind === "relation"
                          ? suggestionKey({ kind: "relation", id: contextItem.relation.id })
                          : null;
                  if (key) app.acceptSuggestions([key]);
                }}
                onRejectContextItem={() => {
                  const key =
                    contextItem.kind === "entity"
                      ? suggestionKey({ kind: "entity", id: contextItem.entity.id })
                      : contextItem.kind === "property"
                        ? suggestionKey({
                            kind: "property",
                            entityId: contextItem.entity.id,
                            propertyId: contextItem.property.id,
                          })
                        : contextItem.kind === "relation"
                          ? suggestionKey({ kind: "relation", id: contextItem.relation.id })
                          : null;
                  if (key) app.declineSuggestions([key]);
                  setContextItem(null);
                }}
                onAcceptMapping={(entityId, propertyId) => app.confirmMapping(entityId, propertyId)}
                onRejectMapping={(entityId, propertyId) =>
                  app.updateMapping(entityId, propertyId, null)
                }
                onDisconnectMapping={(entityId, propertyId) =>
                  app.updateMapping(entityId, propertyId, null)
                }
              />
            </div>
            <button
              type="button"
              onClick={() => setContextItem(null)}
              aria-label="Close"
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* RIGHT — Data Context: mirrors the left zone's compactness principle. */}
      <div className="flex w-72 shrink-0 flex-col overflow-y-auto bg-zinc-50/70 px-3 pb-4 pt-14">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Data context
        </p>
        {dataTables.length === 0 && (
          <p className="px-2 text-[11.5px] text-muted-foreground">No mapped Data Tables yet.</p>
        )}
        <div className="flex flex-col gap-0.5">
          {dataTables.map((table) => (
            <DataTableRow
              key={table.name}
              table={table}
              expanded={expandedTableNames.has(table.name)}
              onToggle={() => toggleTable(table.name)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
