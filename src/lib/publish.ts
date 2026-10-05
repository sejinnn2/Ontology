import {
  identifiersOf,
  mappingStatus,
  instanceLabel,
  sameAlias,
  isRelationOnlyUnmapped,
  relationLabel,
  relationReview,
  relationWarningReason,
  type ColumnRef,
  type Entity,
  type Relation,
} from "@/lib/mock-data";

// --- Publishing is per dataset ------------------------------------------------------------------
// Publishing a dataset ingests its rows into the graph through its accepted Property mappings.
// What was published is remembered per dataset, so the review can show what changed since, and the
// published parts can be protected (see `publishedLocks`).

/** One accepted mapping, as published: which Property of which Entity Type reads which column. */
export type PublishedMapping = {
  entityId: string;
  propertyId: string;
  column: string;
  alias?: string | undefined;
};
export type DatasetPublish = {
  table: string;
  version: number;
  at: number;
  mappings: PublishedMapping[];
};
export type PublishedState = Record<string, DatasetPublish>;

export type PublishPhase = "publishing" | "ingesting" | "published" | "failed";
export type PublishJob = {
  table: string;
  phase: PublishPhase;
  // Adding columns to a published dataset ingests the whole dataset again.
  reingest: boolean;
  reason?: string;
};

export const publishedMappingKey = (m: PublishedMapping) =>
  `${m.entityId}|${m.propertyId}|${m.column}|${m.alias ?? ""}`;

/** Everything published, as lookups the editing locks read. */
export type PublishedLocks = {
  entityIds: Set<string>;
  propertyIds: Set<string>;
  tables: Set<string>;
  /** Keyed `table|entityId|propertyId|column`. */
  mappingKeys: Set<string>;
};
export function publishedLocks(published: PublishedState): PublishedLocks {
  const locks: PublishedLocks = {
    entityIds: new Set(),
    propertyIds: new Set(),
    tables: new Set(),
    mappingKeys: new Set(),
  };
  Object.values(published).forEach((dataset) => {
    locks.tables.add(dataset.table);
    dataset.mappings.forEach((m) => {
      locks.entityIds.add(m.entityId);
      locks.propertyIds.add(m.propertyId);
      locks.mappingKeys.add(`${dataset.table}|${publishedMappingKey(m)}`);
    });
  });
  return locks;
}
export const isPublishedMapping = (
  locks: PublishedLocks,
  entityId: string,
  propertyId: string,
  m: ColumnRef,
) =>
  locks.mappingKeys.has(
    `${m.table}|${publishedMappingKey({ entityId, propertyId, column: m.column, alias: m.alias })}`,
  );

// --- The Publish review -------------------------------------------------------------------------

export type DatasetIssue = { text: string; entityId?: string | undefined };
export type MappingChange = { label: string; entityId: string; propertyId: string };
export type DatasetReview = {
  table: string;
  /** Accepted mappings — what publishing ingests. */
  accepted: (PublishedMapping & { label: string })[];
  /** Mappings still Suggested: kept in the draft, not published. */
  suggestedCount: number;
  /** Entity Types this dataset publishes (through its accepted mappings). */
  entityIds: string[];
  added: MappingChange[];
  removed: MappingChange[];
  errors: DatasetIssue[];
  warnings: DatasetIssue[];
  lastPublish?: DatasetPublish | undefined;
  /** Nothing new to publish since its last version. */
  upToDate: boolean;
  /** Accepted columns added to an already published dataset — ingested again as a whole. */
  reingest: boolean;
  /** Accepted Relations between its Entity Types that aren't mapped yet (optional). */
  unmappedRelations: string[];
};

/** Every dataset with at least one mapping, checked for publishing. */
export function reviewDatasets(
  entities: Entity[],
  relations: Relation[],
  published: PublishedState,
): DatasetReview[] {
  const byTable = new Map<
    string,
    { entity: Entity; propertyId: string; propertyName: string; mapping: ColumnRef }[]
  >();
  entities.forEach((entity) =>
    entity.properties.forEach((property) =>
      property.mappings.forEach((mapping) => {
        const list = byTable.get(mapping.table) ?? [];
        list.push({ entity, propertyId: property.id, propertyName: property.name, mapping });
        byTable.set(mapping.table, list);
      }),
    ),
  );
  Object.keys(published).forEach((table) => {
    if (!byTable.has(table)) byTable.set(table, []);
  });

  const entityName = (id: string) => entities.find((e) => e.id === id)?.name || "Untitled entity";
  const propertyName = (entityId: string, propertyId: string) =>
    entities.find((e) => e.id === entityId)?.properties.find((p) => p.id === propertyId)?.name ||
    "Untitled property";
  const changeLabel = (m: PublishedMapping) =>
    `${entityName(m.entityId)}.${propertyName(m.entityId, m.propertyId)} ← ${m.column}${m.alias ? ` @${m.alias}` : ""}`;

  return Array.from(byTable.entries())
    .map(([table, rows]): DatasetReview => {
      const acceptedRows = rows.filter((row) => mappingStatus(row.mapping) === "mapped");
      const accepted = acceptedRows.map((row) => {
        const m: PublishedMapping = {
          entityId: row.entity.id,
          propertyId: row.propertyId,
          column: row.mapping.column,
          alias: row.mapping.alias,
        };
        return { ...m, label: changeLabel(m) };
      });
      const entityIds = Array.from(new Set(acceptedRows.map((row) => row.entity.id)));
      const errors: DatasetIssue[] = [];
      const warnings: DatasetIssue[] = [];

      if (accepted.length === 0) {
        errors.push({ text: "No accepted property mapping yet — accept at least one to publish." });
      }
      // Each published Entity Type needs its whole identifier: its records are keyed by it.
      entityIds.forEach((entityId) => {
        const entity = entities.find((e) => e.id === entityId)!;
        const name = entity.name || "Untitled entity";
        const identifiers = identifiersOf(entity);
        if (identifiers.length === 0) {
          errors.push({ text: `${name} has no identifier.`, entityId });
          return;
        }
        // Each occurrence (the dataset's one, or each alias) needs its whole identifier.
        const aliases = Array.from(
          new Set(
            acceptedRows
              .filter((row) => row.entity.id === entityId)
              .map((row) => row.mapping.alias),
          ),
        );
        aliases.forEach((alias) => {
          const missing = identifiers.filter(
            (identifier) =>
              !identifier.mappings.some(
                (m) =>
                  m.table === table && sameAlias(m.alias, alias) && mappingStatus(m) === "mapped",
              ),
          );
          if (missing.length > 0) {
            errors.push({
              text: `${name}${alias ? ` @${alias}` : ""}: its identifier (${missing.map((p) => p.name).join(", ")}) has no accepted mapping in ${instanceLabel(table, alias)}.`,
              entityId,
            });
          }
        });
        const here = rows.filter((row) => row.entity.id === entityId);
        const needing = here.some((row) => row.mapping.alias)
          ? here.filter((row) => !row.mapping.alias).length
          : 0;
        if (needing > 0) {
          errors.push({
            text: `${name}: ${needing} mapping${needing === 1 ? "" : "s"} in ${table} still need${needing === 1 ? "s" : ""} an alias.`,
            entityId,
          });
        }
        if (entity.errorReason) errors.push({ text: `${name}: ${entity.errorReason}`, entityId });
        entity.properties.forEach((property) => {
          if (
            property.errorReason &&
            property.mappings.some((m) => m.table === table && mappingStatus(m) === "mapped")
          ) {
            errors.push({ text: `${name}.${property.name}: ${property.errorReason}`, entityId });
          }
          if (
            property.warningReason &&
            property.mappings.some((m) => m.table === table && mappingStatus(m) === "mapped")
          ) {
            warnings.push({
              text: `${name}.${property.name}: ${property.warningReason}`,
              entityId,
            });
          }
        });
        if (entity.warningReason) {
          warnings.push({ text: `${name}: ${entity.warningReason}`, entityId });
        }
      });

      const suggestedCount = rows.length - acceptedRows.length;
      if (suggestedCount > 0) {
        warnings.push({
          text: `${suggestedCount} suggested mapping${suggestedCount === 1 ? "" : "s"} aren't accepted and won't be published.`,
        });
      }
      // Relations are optional: one that isn't mapped yet links no records, but doesn't block
      // or warn — it's summarized on its own. Any other Relation warning is a Warning.
      const unmappedRelations: string[] = [];
      relations.forEach((relation) => {
        if (!entityIds.includes(relation.from) || !entityIds.includes(relation.to)) return;
        if (relationReview(relation) !== "confirmed") return;
        if (isRelationOnlyUnmapped(relation)) {
          unmappedRelations.push(relation.id);
          return;
        }
        const reason = relationWarningReason(relation);
        if (reason) warnings.push({ text: `${relationLabel(relation)}: ${reason}` });
      });

      const lastPublish = published[table];
      const before = new Set((lastPublish?.mappings ?? []).map(publishedMappingKey));
      const now = new Set(accepted.map(publishedMappingKey));
      const added = accepted
        .filter((m) => !before.has(publishedMappingKey(m)))
        .map((m) => ({ label: m.label, entityId: m.entityId, propertyId: m.propertyId }));
      const removed = (lastPublish?.mappings ?? [])
        .filter((m) => !now.has(publishedMappingKey(m)))
        .map((m) => ({ label: changeLabel(m), entityId: m.entityId, propertyId: m.propertyId }));
      const reingest = !!lastPublish && added.length > 0;
      if (reingest) {
        warnings.push({
          text: `Adds ${added.length} column${added.length === 1 ? "" : "s"} to the published dataset — all of ${table} will be ingested again.`,
        });
      }
      return {
        table,
        accepted,
        suggestedCount,
        entityIds,
        added,
        removed,
        errors,
        warnings,
        lastPublish,
        upToDate: !!lastPublish && added.length === 0 && removed.length === 0,
        reingest,
        unmappedRelations,
      };
    })
    .sort((a, b) => a.table.localeCompare(b.table));
}

export const datasetPublishable = (review: DatasetReview) =>
  review.errors.length === 0 && !review.upToDate;
