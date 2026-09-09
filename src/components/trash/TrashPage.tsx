import { Link } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw } from "lucide-react";
import type { Entity } from "@/lib/mock-data";
import type { TrashedEntity, TrashedProperty, TrashedRelation } from "@/lib/app-state";

/** One row in a Trash section — a name, an optional reason it can't be restored yet, and a
 * Restore button that's disabled exactly when that reason is present. Shared by all three
 * sections since the shape ("what it is" + "can it come back right now") is identical for an
 * Entity Type, a Property, or a Relation. */
function TrashRow({
  label,
  blockedReason,
  onRestore,
}: {
  label: string;
  blockedReason?: string | undefined;
  onRestore: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-node-border bg-white px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium text-[#171b22]">{label}</p>
        {blockedReason && (
          <p className="text-[12.5px] leading-[1.35] text-[#9c461e]">{blockedReason}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRestore}
        disabled={!!blockedReason}
        className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-primary hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
      >
        <RotateCcw className="size-3.5" /> Restore
      </button>
    </li>
  );
}

/** The single Trash entry point for every deleted ontology item — a real page (`/trash`) rather
 * than a dialog stacked on the canvas, since a delete on the Ontology canvas takes you straight
 * back to whatever you were doing, so Trash needs its own place to actually sit and look at.
 * Entity Types, Properties, and Relations each get their own section (matching the spec's exact
 * grouping), sorted most-recently deleted first. Delete never destroys anything (see app-state's
 * `deleteEntity`/`deleteProperty`/`deleteRelation`); this is the only place those snapshots are
 * ever visible again, and Restore is the only way out of it — there is no permanent-delete action
 * here or anywhere else.
 *
 * A Property or Relation can outlive the Entity Type(s) it depends on (that Entity Type might get
 * deleted afterward, or simply not be restored yet) — `entities` is read live here so each row's
 * Restore eligibility (and, when blocked, the reason shown) always reflects the *current* canvas,
 * not whatever it was at the moment the item was trashed. */
export function TrashPage({
  entities,
  trashedEntities,
  trashedProperties,
  trashedRelations,
  onRestoreEntity,
  onRestoreProperty,
  onRestoreRelation,
}: {
  entities: Entity[];
  trashedEntities: TrashedEntity[];
  trashedProperties: TrashedProperty[];
  trashedRelations: TrashedRelation[];
  onRestoreEntity: (entityId: string) => void;
  onRestoreProperty: (propertyId: string) => void;
  onRestoreRelation: (relationId: string) => void;
}) {
  const entityName = (id: string) => entities.find((e) => e.id === id)?.name || null;
  const byRecency = <T extends { trashedAt: number }>(items: T[]) =>
    [...items].sort((a, b) => b.trashedAt - a.trashedAt);
  const isEmpty =
    trashedEntities.length === 0 && trashedProperties.length === 0 && trashedRelations.length === 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-12 w-full shrink-0 items-center gap-3 border-b border-[rgba(28,28,24,0.08)] px-4 py-3">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-1.5 rounded-[21px] border border-[#1c1c18] bg-white px-3 py-1 text-[13px] leading-[19.5px] tracking-[-0.08px] text-[#1c1c18] transition-opacity hover:opacity-70"
        >
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <span className="text-[16px] font-semibold text-[#1c1c18]">Trash</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-xl flex-col gap-6">
          <p className="text-[13px] text-muted-foreground">
            {isEmpty
              ? "Nothing here yet — deleted Entity Types, Properties, and Relations show up here, and can be restored at any time."
              : "Deleted items stay here until restored — nothing is ever permanently deleted."}
          </p>

          {trashedEntities.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#707070]">
                Entity Types
              </p>
              <ul className="flex flex-col gap-2">
                {byRecency(trashedEntities).map((t) => (
                  <TrashRow
                    key={t.entity.id}
                    label={t.entity.name || "Untitled entity"}
                    onRestore={() => onRestoreEntity(t.entity.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          {trashedProperties.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#707070]">
                Properties
              </p>
              <ul className="flex flex-col gap-2">
                {byRecency(trashedProperties).map((t) => {
                  const owner = entityName(t.entityId);
                  return (
                    <TrashRow
                      key={t.property.id}
                      label={`${owner ?? "Untitled entity"}.${t.property.name || "Untitled property"}`}
                      blockedReason={
                        owner ? undefined : "Its Entity Type was deleted — restore that first."
                      }
                      onRestore={() => onRestoreProperty(t.property.id)}
                    />
                  );
                })}
              </ul>
            </div>
          )}

          {trashedRelations.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#707070]">
                Relations
              </p>
              <ul className="flex flex-col gap-2">
                {byRecency(trashedRelations).map((t) => {
                  const fromName = entityName(t.relation.from);
                  const toName = entityName(t.relation.to);
                  const missing = [
                    !fromName ? "the from-side" : null,
                    !toName ? "the to-side" : null,
                  ].filter((s): s is string => !!s);
                  return (
                    <TrashRow
                      key={t.relation.id}
                      label={`${fromName ?? "?"} → ${toName ?? "?"}`}
                      blockedReason={
                        missing.length > 0
                          ? `Restore ${missing.join(" and ")} connected Entity Type first.`
                          : undefined
                      }
                      onRestore={() => onRestoreRelation(t.relation.id)}
                    />
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
