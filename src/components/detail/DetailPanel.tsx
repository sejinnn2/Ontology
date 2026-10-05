import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock, Trash2 } from "lucide-react";
import type { OntologyApp } from "@/lib/app-state";
import { parseSuggestionKey, suggestionKey } from "@/lib/app-state";
import {
  canConfirmEntity,
  canConfirmProperty,
  canConfirmRelation,
  entityDatasets,
  entityDisplayStatus,
  entityErrorReason,
  entityReview,
  entityWarningReason,
  identifierColumnsIn,
  identifiersOf,
  isIdentifierProperty,
  mappingStatus,
  propertyErrorReason,
  propertyReview,
  propertyStatus,
  relationErrorReason,
  relationAcceptBlockers,
  relationJoins,
  relationMappingAcceptBlockers,
  relationLabel,
  relationMappingCandidates,
  relationMappingKey,
  relationReview,
  relationStatus,
  relationWarningReason,
  tableMappingCompleteness,
  tableMappingStatus,
  type Entity,
  type Property,
  type Relation,
  type RelationJoin,
  type ReviewStatus,
  type TableSchema,
} from "@/lib/mock-data";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import { StatusBadge, statusDotColor } from "@/components/ontology/StatusBadge";
import {
  EntityConfidenceChip,
  PropertyConfidenceChip,
  RelationConfidenceChip,
} from "@/components/ontology/ConfidenceChip";
import { isTypingTarget } from "@/components/ontology/CanvasControls";
import { FigmaIcon, PropertyTypeGlyph } from "@/components/detail/list-controls";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import pencilIcon from "@/assets/icons/pencil-20.svg";
import crossIcon from "@/assets/icons/cross-medium-20.svg";
import rejectIcon from "@/assets/icons/controller-button-x-16.svg";
import acceptIcon from "@/assets/icons/check-circle-2-16.svg";
import arrowLeftRightIcon from "@/assets/icons/arrow-left-right-20.svg";
import keyIcon from "@/assets/icons/key-2-16.svg";
import arrowRightIcon from "@/assets/icons/arrow-right-12.svg";

/**
 * The editing canvas's bottom detail panel: one selected Entity Type, Property, Relation, or Data
 * Table. It takes the AI review bar's place while it's open (the bottom strip always shows what
 * you're acting on: all suggestions in range, one item, or a multi-selection).
 *
 * Layout (Figma 542:27924 / 501:101223 / 542:25288 / 542:39059 / 542:50544): a header (status,
 * name, kind, confidence; Edit and close on the right), an issue strip for errors/warnings, the
 * item's fields — Description across the top, then its type-specific ones — and a footer with
 * Reject / Accept (a suggestion) or Delete. The AI's reasoning lives on the confidence score's
 * hover, not here. ↑/↓ still step through suggestions.
 */

type ReviewDetailItem =
  | { kind: "entity"; key: string; entity: Entity }
  | { kind: "property"; key: string; entity: Entity; property: Property }
  | { kind: "relation"; key: string; relation: Relation; from?: Entity; to?: Entity };
// A Data Table isn't a reviewable suggestion, so it's inspected through its own state (see
// `resolveDetailItem`) rather than the suggestion selection.
type TableDetailItem = { kind: "table"; key: string; table: TableSchema };
export type DetailItem = ReviewDetailItem | TableDetailItem;

/** The one item the panel shows: exactly one selected Entity/Property/Relation, or — with nothing
 * selected — the Data Table being inspected. */
export function resolveDetailItem(
  app: OntologyApp,
  inspectedTableName?: string | null,
): DetailItem | null {
  if (app.suggestionSelection.size === 0 && inspectedTableName) {
    const table = app.tables.find((t) => t.name === inspectedTableName);
    return table ? { kind: "table", key: `table|${table.name}`, table } : null;
  }
  if (app.suggestionSelection.size !== 1) return null;
  const [key] = app.suggestionSelection;
  if (!key) return null;
  const ref = parseSuggestionKey(key);
  if (!ref) return null;
  if (ref.kind === "entity") {
    const entity = app.entities.find((e) => e.id === ref.id);
    return entity ? { kind: "entity", key, entity } : null;
  }
  if (ref.kind === "property") {
    const entity = app.entities.find((e) => e.id === ref.entityId);
    const property = entity?.properties.find((p) => p.id === ref.propertyId);
    return entity && property ? { kind: "property", key, entity, property } : null;
  }
  if (ref.kind === "relation") {
    const relation = app.relations.find((r) => r.id === ref.id);
    if (!relation) return null;
    const from = app.entities.find((e) => e.id === relation.from);
    const to = app.entities.find((e) => e.id === relation.to);
    return { kind: "relation", key, relation, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return null;
}

// Figma "Detail": white, 8px radius, hairline border, shadow-lg.
const PANEL_CLASS =
  "flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-[#e3e5e4] bg-white shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)]";
// The footer's two equal buttons (Figma "Button", outline, 32px, 4px radius, Medium 14).
const FOOTER_BUTTON =
  "flex h-8 min-w-16 flex-1 items-center justify-center rounded-[4px] border border-[#e3e5e4] bg-white px-2 text-[14px] font-medium leading-6 text-[#161919] transition-colors hover:bg-[#f4f4f4]";
const ICON_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.06]";
// The panel hugs its content (Figma 356:197299); the body is what scrolls once the dock's max
// height (see `DetailDock`) is reached.
const BODY_CLASS = "min-h-0 overflow-y-auto overscroll-contain px-4 py-3";

type DetailPanelProps = {
  app: OntologyApp;
  item: DetailItem;
  /** Suggested items on the canvas, in canvas order — what ↑/↓ steps through. */
  queue: string[];
  onSelectKey: (key: string) => void;
  onClose: () => void;
  /** Called when the item deleted is the Entity the workspace is open on. */
  onDeletedFocus: () => void;
  focusEntityId?: string | undefined;
  /** Opens `ItemEditorModal` for the shown item — the panel itself is read-only. */
  onEdit?: ((key: string) => void) | undefined;
};

export function DetailPanel(props: DetailPanelProps) {
  const { item } = props;
  if (item.kind === "table") {
    return <TableDetailPanel app={props.app} table={item.table} onClose={props.onClose} />;
  }
  return <ReviewDetailPanel {...props} item={item} />;
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

/** The panel's header: status icon, name, kind, an optional chip / link; Edit and close. */
function PanelHeader({
  icon,
  name,
  kind,
  after,
  onEdit,
  onClose,
  bordered = true,
}: {
  icon: ReactNode;
  name: string;
  kind: string;
  after?: ReactNode;
  onEdit?: (() => void) | undefined;
  onClose: () => void;
  bordered?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center justify-between gap-2 pl-4 pr-2",
        bordered && "border-b border-[#e3e5e4]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="min-w-0 truncate text-[16px] font-medium leading-6 text-[#080a09]">
          {name}
        </span>
        <span className="shrink-0 text-[12px] leading-4 text-[#6d7472]">{kind}</span>
        {after}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onEdit && (
          <button type="button" onClick={onEdit} className={ICON_BUTTON} aria-label="Edit">
            <FigmaIcon src={pencilIcon} size={20} />
          </button>
        )}
        <button type="button" onClick={onClose} className={ICON_BUTTON} aria-label="Close details">
          <FigmaIcon src={crossIcon} size={20} />
        </button>
      </div>
    </header>
  );
}

/** A 6px review-status dot, centered in the 16px icon slot. */
function StatusDot({ status }: { status: ReviewStatus }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <span className="size-1.5 rounded-full" style={{ background: statusDotColor(status) }} />
    </span>
  );
}

type TableDetailTab = "overview" | "sample";

/**
 * A Data Table's details (Figma 542:39059 / 542:50544): read-only source facts (tables are raw
 * data, not AI suggestions, so there's nothing to accept or reject). Two tabs: Overview (its
 * description and how its columns are mapped) and Sample data (its sample rows, every column,
 * scrolling sideways).
 */
function TableDetailPanel({
  app,
  table,
  onClose,
}: {
  app: OntologyApp;
  table: TableSchema;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const [tab, setTab] = useState<TableDetailTab>("overview");
  const completeness = tableMappingCompleteness(table.name, app.entities);
  const mappedColumns = new Set<string>();
  const suggestedColumns = new Set<string>();
  app.entities.forEach((entity) => {
    entity.properties.forEach((p) => {
      p.mappings.forEach((m) => {
        if (m.table !== table.name) return;
        if (mappingStatus(m) === "mapped") mappedColumns.add(m.column);
        else suggestedColumns.add(m.column);
      });
    });
  });
  mappedColumns.forEach((column) => suggestedColumns.delete(column));
  const unmapped = table.columns.length - mappedColumns.size - suggestedColumns.size;
  return (
    <section
      data-detail-panel
      aria-label="Data table details"
      onPointerDown={(event) => event.stopPropagation()}
      className={PANEL_CLASS}
    >
      <PanelHeader
        bordered={false}
        icon={
          <MappingStatusBadge
            status={tableMappingStatus(table.name, app.entities)}
            {...completeness}
            size={16}
          />
        }
        name={table.name}
        kind="Data table"
        // Figma's "Data 360 →" link; there's no Data 360 page to open yet.
        after={
          <span className="flex h-8 shrink-0 items-center text-[12px] font-medium leading-4 text-[#3b82f6]">
            Data 360 →
          </span>
        }
        onClose={onClose}
      />
      <div className="flex shrink-0 border-b border-[#e3e5e4] px-4">
        <div role="tablist" aria-label="Data table details" className="flex h-8 items-center gap-4">
          {(
            [
              ["overview", "Overview"],
              ["sample", "Sample data"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "relative flex h-full items-center text-[14px] leading-5 transition-colors",
                tab === value ? "text-[#080a09]" : "text-[#6d7472] hover:text-[#161919]",
              )}
            >
              {label}
              {tab === value && (
                <span aria-hidden className="absolute inset-x-0.5 bottom-0 h-0.5 bg-[#080a09]" />
              )}
            </button>
          ))}
        </div>
      </div>
      {tab === "overview" ? (
        <div role="tabpanel" className={cn(BODY_CLASS, "flex flex-col gap-4")}>
          <Field label="Description">
            <Value value={table.description} placeholder="No description" />
          </Field>
          <Field label={`Mapping (${table.columns.length})`}>
            <div className="flex gap-4">
              {(
                [
                  ["Mapped", mappedColumns.size, "#0891b2"],
                  ["Suggested", suggestedColumns.size, "#7e22ce"],
                  ["Unmapped", unmapped, "#f4f4f4"],
                ] as const
              ).map(([label, count, color]) => (
                <div
                  key={label}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-[#e3e5e4] bg-[#fafafa] px-3 py-2"
                >
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[#6d7472]">
                    {label}
                  </span>
                  <span className="shrink-0 text-[12px] leading-4 tabular-nums text-[#080a09]">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </Field>
          <TableRelations app={app} table={table.name} />
        </div>
      ) : (
        <div role="tabpanel" className={cn(BODY_CLASS, "flex flex-col")}>
          {table.rows.length > 0 ? (
            <div className="min-h-0 overflow-auto overscroll-contain rounded-[6px] border border-[#e3e5e4]">
              <table className="min-w-full text-left font-mono text-[11px] leading-4">
                <thead className="sticky top-0 bg-[#fafafa] text-[#6d7472]">
                  <tr>
                    {table.columns.map((column) => (
                      <th
                        key={column.name}
                        className="max-w-[200px] truncate whitespace-nowrap px-2 py-1.5 font-normal"
                      >
                        {column.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-[#161919]">
                  {table.rows.map((row, i) => (
                    <tr key={i} className="border-t border-[#e3e5e4]">
                      {table.columns.map((column) => (
                        <td
                          key={column.name}
                          className="max-w-[200px] truncate whitespace-nowrap px-2 py-1.5"
                        >
                          {row[column.name] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12px] leading-4 text-[#6d7472]">No sample rows.</p>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewDetailPanel({
  app,
  item,
  queue,
  onSelectKey,
  onClose,
  onDeletedFocus,
  focusEntityId,
  onEdit,
}: Omit<DetailPanelProps, "item" | "onOpenTable"> & { item: ReviewDetailItem }) {
  const status: ReviewStatus =
    item.kind === "entity"
      ? entityDisplayStatus(item.entity)
      : item.kind === "property"
        ? propertyStatus(item.property)
        : relationStatus(item.relation, app.entities);
  // Still a suggestion — it shows its confidence and Reject / Accept, whatever issue it has.
  const suggested =
    (item.kind === "entity"
      ? entityReview(item.entity)
      : item.kind === "property"
        ? propertyReview(item.property)
        : relationReview(item.relation)) === "suggested";
  // An Error is never acceptable; a Relation also waits for its Entity Types to be accepted.
  // Shown above the footer, not just on the disabled button's hover.
  const blockedReason =
    item.kind === "entity"
      ? canConfirmEntity(item.entity)
        ? undefined
        : "Fix the errors above to accept it."
      : item.kind === "property"
        ? canConfirmProperty(item.property)
          ? undefined
          : "Fix the error above to accept it."
        : canConfirmRelation(item.relation, app.entities)
          ? undefined
          : relationAcceptBlockers(item.relation, app.entities).join(" ") ||
            "Fix the error above to accept it.";
  const index = queue.indexOf(item.key);

  const step = (direction: 1 | -1) => {
    if (queue.length === 0) return;
    const next =
      index === -1
        ? queue[direction === 1 ? 0 : queue.length - 1]
        : queue[(index + direction + queue.length) % queue.length];
    if (next) onSelectKey(next);
  };
  // After Accept/Reject the item leaves the queue, so move on to whatever came after it.
  const advance = () => {
    const rest = queue.filter((key) => key !== item.key);
    const next = index === -1 ? rest[0] : rest[Math.min(index, rest.length - 1)];
    if (next) onSelectKey(next);
    else onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowDown") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleDelete = () => {
    if (item.kind === "entity") {
      app.deleteEntity(item.entity.id);
      if (item.entity.id === focusEntityId) onDeletedFocus();
    } else if (item.kind === "property") {
      app.deleteProperty(item.entity.id, item.property.id);
    } else {
      app.deleteRelation(item.relation.id);
    }
    onClose();
  };

  const name =
    item.kind === "entity"
      ? item.entity.name || "Untitled entity"
      : item.kind === "property"
        ? item.property.name || "Untitled property"
        : relationLabel(item.relation);
  const kindLabel =
    item.kind === "entity"
      ? "Entity type"
      : item.kind === "property"
        ? `Property of ${item.entity.name || "Untitled entity"}`
        : "Relation";
  const issue =
    status === "error"
      ? item.kind === "entity"
        ? entityErrorReason(item.entity)
        : item.kind === "property"
          ? propertyErrorReason(item.property)
          : relationErrorReason(item.relation, app.entities)
      : status === "warning"
        ? item.kind === "entity"
          ? entityWarningReason(item.entity)
          : item.kind === "property"
            ? item.property.warningReason
            : relationWarningReason(item.relation)
        : undefined;

  return (
    <section
      data-detail-panel
      aria-label={`${kindLabel} details`}
      onPointerDown={(event) => event.stopPropagation()}
      className={PANEL_CLASS}
    >
      <PanelHeader
        icon={
          item.kind === "entity" ? (
            <StatusBadge status={status} size={16} confidence={item.entity.confidence} />
          ) : (
            <StatusDot status={status} />
          )
        }
        name={name}
        kind={kindLabel}
        after={
          suggested &&
          (item.kind === "entity" ? (
            <EntityConfidenceChip entity={item.entity} tone="muted" />
          ) : item.kind === "property" ? (
            <PropertyConfidenceChip property={item.property} tone="muted" />
          ) : (
            <RelationConfidenceChip relation={item.relation} tone="muted" />
          ))
        }
        onEdit={onEdit ? () => onEdit(item.key) : undefined}
        onClose={onClose}
      />
      {/* The AI's reasoning isn't repeated here — it's on the confidence score's hover. */}
      {issue && (
        <p className="flex shrink-0 items-center gap-1.5 truncate border-b border-[#e3e5e4] bg-[#ffe6db] px-4 py-1.5 text-[12px] leading-4 text-[#9c461e]">
          <span className="truncate">{issue}</span>
        </p>
      )}
      {item.kind === "entity" && <EntityFields app={app} entity={item.entity} />}
      {item.kind === "property" && (
        <PropertyFields app={app} entity={item.entity} property={item.property} />
      )}
      {item.kind === "relation" && <RelationFields app={app} item={item} />}
      {/* A suggestion is decided here (Reject removes it); anything else can be deleted in the
          same spot. */}
      {suggested && blockedReason && <BlockedNote>{blockedReason}</BlockedNote>}
      <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-[#e3e5e4] px-4">
        {suggested ? (
          <>
            <button
              type="button"
              onClick={() => {
                app.declineSuggestions([item.key]);
                advance();
              }}
              className={FOOTER_BUTTON}
            >
              <FigmaIcon src={rejectIcon} />
              <span className="px-1">Reject</span>
            </button>
            <button
              type="button"
              disabled={!!blockedReason}
              title={blockedReason}
              onClick={() => {
                app.acceptSuggestions([item.key]);
                advance();
              }}
              className={cn(FOOTER_BUTTON, "disabled:cursor-not-allowed disabled:opacity-40")}
            >
              <FigmaIcon src={acceptIcon} />
              <span className="px-1">Accept</span>
            </button>
          </>
        ) : (
          // Figma 542:77498: a borderless, destructive-red Delete across the footer.
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-[4px] text-[14px] font-medium leading-6 text-destructive transition-colors hover:bg-destructive/5"
          >
            <Trash2 className="size-4" strokeWidth={1.5} />
            <span>Delete</span>
          </button>
        )}
      </footer>
    </section>
  );
}

/** Why Accept is off, in words — on the panel itself rather than only in a hover title. */
function BlockedNote({ children, inset = false }: { children: ReactNode; inset?: boolean }) {
  return (
    <p
      className={cn(
        "flex shrink-0 items-start gap-1.5 text-[12px] leading-4 text-[#6d7472]",
        inset ? "pt-1" : "border-t border-[#e3e5e4] bg-[#fafafa] px-4 py-2",
      )}
    >
      <Lock className="mt-px size-3 shrink-0" strokeWidth={2} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-[12px] leading-4 text-[#6d7472]">{label}</span>
      {children}
    </div>
  );
}

/** A read-only field value (editing happens in `ItemEditorModal`, via the panel's Edit). */
function Value({ value, placeholder = "—" }: { value: string | undefined; placeholder?: string }) {
  return (
    <p
      className={cn("truncate text-[14px] leading-6", value ? "text-[#080a09]" : "text-[#9ea3a2]")}
    >
      {value || placeholder}
    </p>
  );
}

function primaryPropertyOf(entity: Entity): Property | undefined {
  return (
    entity.properties.find((p) => p.id === entity.primaryPropertyId) ??
    entity.properties.find((p) => isIdentifierProperty(p)) ??
    entity.properties[0]
  );
}

function EntityFields({ app, entity }: { app: OntologyApp; entity: Entity }) {
  const primary = primaryPropertyOf(entity);
  const template = entity.displayNameTemplate ?? (primary ? `{${primary.name}}` : "");
  const identifiers = identifiersOf(entity);
  const composite = identifiers.length > 1;
  const datasets = entityDatasets(entity);
  return (
    <div className={cn(BODY_CLASS, "grid grid-cols-3 gap-4")}>
      <div className="col-span-3">
        <Field label="Description">
          <Value value={entity.description} placeholder="No description" />
        </Field>
      </div>
      {/* One Identifier, or — two or more — a composite identifier: records are told apart by
          the combination, each Identifier a numbered key part. */}
      <Field label={composite ? `Identifier · composite of ${identifiers.length}` : "Identifier"}>
        {identifiers.length === 0 ? (
          <p className="text-[14px] leading-6 text-[#9c461e]">No identifier yet</p>
        ) : (
          <div className="flex min-w-0 flex-col">
            {identifiers.map((identifier, index) => (
              <div key={identifier.id} className="flex min-w-0 items-center gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: statusDotColor(propertyStatus(identifier)) }}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-[#080a09]">
                    {identifier.name}
                  </span>
                  <span
                    role="img"
                    aria-label={composite ? `Identifier part ${index + 1}` : "Identifier"}
                    className="flex shrink-0 items-center"
                  >
                    <FigmaIcon src={keyIcon} />
                    {composite && (
                      <span className="text-[10px] font-medium leading-3 text-[#967700]">
                        {index + 1}
                      </span>
                    )}
                  </span>
                  <PropertyTypeGlyph type={identifier.type} color="#6d7472" />
                </span>
                {propertyReview(identifier) === "suggested" && (
                  <PropertyConfidenceChip property={identifier} tone="muted" />
                )}
              </div>
            ))}
          </div>
        )}
      </Field>
      <Field label="Display name template">
        <Value value={template} />
      </Field>
      <Field label="Primary property">
        <Value value={primary?.name} />
      </Field>
      {/* The Entity Type's own mapping: the datasets its instances come from — wherever its
          Identifier is mapped (a composite one: each key part's column, all needed). */}
      <div className="col-span-3">
        <Field label={`Datasets · ${datasets.length}`}>
          {datasets.length === 0 ? (
            <p className="text-[12px] leading-5 text-[#9c461e]">
              Map the identifier to a column to bring in this entity type's records.
            </p>
          ) : (
            <MappingRows>
              {datasets.map((dataset) => (
                <MappingRow
                  key={dataset.table}
                  app={app}
                  table={dataset.table}
                  columns={dataset.columns.map((m) => m.column)}
                  composite={composite}
                  missing={dataset.missing.map((p) => p.name)}
                  status={
                    dataset.columns.every((m) => mappingStatus(m) === "mapped")
                      ? "mapped"
                      : "suggested"
                  }
                />
              ))}
            </MappingRows>
          )}
        </Field>
      </div>
    </div>
  );
}

/** A bordered list of mapping rows (the same frame as a Relation's mapping list). */
function MappingRows({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-[#e3e5e4] rounded-[6px] border border-[#e3e5e4]">
      {children}
    </div>
  );
}

/** One mapping: the dataset (with its mapping-status icon) and column(s), the mapping's own status,
 * and — for a Property's mapping — Accept / Reject while suggested, Disconnect once mapped. */
function MappingRow({
  app,
  table,
  columns,
  status,
  composite = false,
  missing = [],
  onAccept,
  onReject,
  onDisconnect,
}: {
  app: OntologyApp;
  table: string;
  columns: string[];
  status: "suggested" | "mapped";
  composite?: boolean;
  // Key parts with no column in this dataset (a composite identifier that's incomplete here).
  missing?: string[];
  onAccept?: () => void;
  onReject?: () => void;
  onDisconnect?: () => void;
}) {
  return (
    <div className="group/maprow flex h-10 min-w-0 items-center gap-3 px-3">
      <div className="min-w-0 flex-1">
        <MappingValue app={app} table={table} column={columns.join(", ")} />
      </div>
      {missing.length > 0 ? (
        <span
          title={`${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} mapped in ${table}, so its records can't be identified here.`}
          className="shrink-0 rounded-full bg-[#faebb0] px-1.5 py-px text-[12px] leading-4 text-[#967700]"
        >
          Missing {missing.join(", ")}
        </span>
      ) : (
        composite && (
          <span className="shrink-0 rounded-full bg-[#f4f4f4] px-1.5 py-px text-[12px] leading-4 text-[#6d7472]">
            Composite
          </span>
        )
      )}
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] leading-4 text-[#6d7472]">
        <span
          className="size-1.5 rounded-full"
          style={{ background: statusDotColor(status === "mapped" ? "confirmed" : "suggested") }}
        />
        {status === "mapped" ? "Mapped" : "Suggested"}
      </span>
      {(onAccept || onReject || onDisconnect) && (
        <span className="flex shrink-0 items-center gap-0.5">
          {status === "suggested" && onReject && (
            <button
              type="button"
              aria-label="Reject mapping"
              title="Reject"
              onClick={onReject}
              className={ICON_BUTTON}
            >
              <FigmaIcon src={rejectIcon} />
            </button>
          )}
          {status === "suggested" && onAccept && (
            <button
              type="button"
              aria-label="Accept mapping"
              title="Accept"
              onClick={onAccept}
              className={ICON_BUTTON}
            >
              <FigmaIcon src={acceptIcon} />
            </button>
          )}
          {status === "mapped" && onDisconnect && (
            <button
              type="button"
              aria-label="Disconnect mapping"
              title="Disconnect"
              onClick={onDisconnect}
              className={ICON_BUTTON}
            >
              <FigmaIcon src={crossIcon} size={20} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** A Data Table and its column: the table's mapping-status icon, the table in Medium, then
 * `[column]`. */
function MappingValue({
  app,
  table,
  column,
}: {
  app: OntologyApp;
  table: string;
  // The instance, where the dataset holds several of the Entity Type.
  column?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MappingStatusBadge
        status={tableMappingStatus(table, app.entities)}
        {...tableMappingCompleteness(table, app.entities)}
        size={16}
      />
      <span className="min-w-0 truncate text-[12px] leading-4 text-[#080a09]">
        <span className="font-medium">{table}</span>
        {column !== undefined && `[${column}]`}
      </span>
    </span>
  );
}

function PropertyFields({
  app,
  entity,
  property,
}: {
  app: OntologyApp;
  entity: Entity;
  property: Property;
}) {
  const identifier = isIdentifierProperty(property);
  const mappingKey = (m: { table: string; column: string }) =>
    suggestionKey({
      kind: "mapping",
      entityId: entity.id,
      propertyId: property.id,
      table: m.table,
      column: m.column,
    });
  return (
    <div className={cn(BODY_CLASS, "grid grid-cols-3 gap-4")}>
      <div className="col-span-3">
        <Field label="Description">
          <Value value={property.description} placeholder="No description" />
        </Field>
      </div>
      <Field label="Type">
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-[#080a09]">
            {property.type || "—"}
          </span>
          {property.type && <PropertyTypeGlyph type={property.type} color="#6d7472" />}
        </span>
      </Field>
      <Field label="Identifier">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-[#080a09]">
            Identifier
          </span>
          {/* Read-only here: it's set in the Edit modal. */}
          <Checkbox checked={identifier} disabled aria-label="Identifier" />
        </span>
      </Field>
      {/* Every dataset this Property's values come from — one row per mapping. */}
      <div className="col-span-3">
        <Field label={`Mappings · ${property.mappings.length}`}>
          {property.mappings.length === 0 ? (
            <p className="text-[12px] leading-5 text-[#6d7472]">Not mapped yet</p>
          ) : (
            <MappingRows>
              {property.mappings.map((m) => (
                <MappingRow
                  key={`${m.table}.${m.column}`}
                  app={app}
                  table={m.table}
                  columns={[m.column]}
                  status={mappingStatus(m)}
                  onAccept={() => app.acceptSuggestions([mappingKey(m)])}
                  onReject={() => app.declineSuggestions([mappingKey(m)])}
                  onDisconnect={() => app.disconnectMapping(entity.id, property.id, m)}
                />
              ))}
            </MappingRows>
          )}
        </Field>
      </div>
    </div>
  );
}

// A Relation: what it means, which Entity Types it runs between (Subject → Object), and — table
// by table — the columns its join keys come from (both sides' columns in that one table).
function RelationFields({
  app,
  item,
}: {
  app: OntologyApp;
  item: Extract<DetailItem, { kind: "relation" }>;
}) {
  const { relation, from, to } = item;
  const fromName = from?.name ?? relation.from;
  const toName = to?.name ?? relation.to;
  const joins = relationJoins(relation, app.entities);
  // More mappings it could use: datasets where both Identifiers are mapped, not yet saved.
  const more = relationMappingCandidates(from, to).filter(
    (c) => !joins.some((j) => j.table === c.table),
  );
  return (
    // Figma 356:198234: the mapping list isn't clipped — the panel grows with it, up to the dock's
    // max height.
    <div className={cn(BODY_CLASS, "flex flex-col gap-4")}>
      <Field label="Description">
        <Value value={relation.description} placeholder="No description" />
      </Field>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <Field label="Subject">
            <Value value={fromName} placeholder="No subject" />
          </Field>
        </div>
        <span aria-hidden className="flex shrink-0">
          <FigmaIcon src={arrowLeftRightIcon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <Field label="Object">
            <Value value={toName} placeholder="No object" />
          </Field>
        </div>
      </div>
      <Field label={`Mapping · ${joins.length}`}>
        {joins.length === 0 ? (
          <p className="text-[14px] leading-6 text-[#9ea3a2]">No mapping yet</p>
        ) : (
          <MappingRows>
            {joins.map((join) => (
              <RelationMappingRow
                key={relationMappingKey(join)}
                app={app}
                join={join}
                subject={fromName}
                object={toName}
                blockers={relationMappingAcceptBlockers(relation, join, app.entities)}
                onAccept={() => app.acceptRelationMapping(relation.id, join)}
                onDisconnect={() => app.disconnectRelationMapping(relation.id, join)}
              />
            ))}
          </MappingRows>
        )}
        {more.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <span className="text-[12px] leading-4 text-[#6d7472]">Also mappable through</span>
            {more.map((candidate) => (
              <button
                key={relationMappingKey(candidate)}
                type="button"
                title={`${fromName}[${candidate.fromColumns.join(", ")}] → ${toName}[${candidate.toColumns.join(", ")}]`}
                onClick={() =>
                  app.connectRelationMapping(relation.id, { ...candidate, status: "mapped" })
                }
                className="rounded-full border border-[#e3e5e4] bg-white px-2 py-0.5 text-[12px] leading-4 text-[#161919] hover:bg-[#f4f4f4]"
              >
                + {candidate.table}
                {(candidate.fromAlias || candidate.toAlias) &&
                  ` @${candidate.fromAlias ?? candidate.toAlias}`}
              </button>
            ))}
          </div>
        )}
      </Field>
    </div>
  );
}

/**
 * One saved Relation mapping, read the same way the Create a relation picker shows it:
 * dataset · Subject[identifier column(s)] → Object[identifier column(s)], then the mapping's own
 * review state (separate from the Relation's) — or why it's broken.
 */
function RelationMappingRow({
  app,
  join,
  subject,
  object,
  relationName,
  showDataset = true,
  blockers = [],
  onAccept,
  onDisconnect,
}: {
  app: OntologyApp;
  join: RelationJoin;
  subject: string;
  object: string;
  // Shown between the two ends (where the row isn't already about one Relation).
  relationName?: string | undefined;
  // Off where the list is already about one dataset.
  showDataset?: boolean;
  // Why a suggested one can't be accepted yet (shown under it); empty when it can.
  blockers?: string[];
  // Accept / Reject while suggested — Reject disconnects it.
  onAccept?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
}) {
  const status = join.status ?? "suggested";
  const decidable = status === "suggested" && !join.broken && !!onAccept;
  return (
    <div className="flex min-w-0 flex-col px-3 py-1.5">
      <div className="group/relmap flex min-h-9 min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {showDataset && <MappingValue app={app} table={join.table} />}
          {/* Wraps rather than truncates, so a composite key's columns all stay readable. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-4 text-[#080a09]">
            <JoinEnd
              entity={subject}
              alias={join.fromAlias}
              columns={join.fromColumns}
              broken={join.broken}
            />
            <FigmaIcon src={arrowRightIcon} size={12} />
            {relationName && (
              <>
                <span className="font-medium">{relationName}</span>
                <FigmaIcon src={arrowRightIcon} size={12} />
              </>
            )}
            <JoinEnd
              entity={object}
              alias={join.toAlias}
              columns={join.toColumns}
              broken={join.broken}
            />
          </span>
        </div>
        {join.broken ? (
          <span
            className="shrink-0 text-[12px] leading-4 text-[#dc2626]"
            title="The identifier columns mapped in this dataset have changed since this mapping was saved."
          >
            No longer matches
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] leading-4 text-[#6d7472]">
            <span
              className="size-1.5 rounded-full"
              style={{
                background: statusDotColor(status === "mapped" ? "confirmed" : "suggested"),
              }}
            />
            {status === "mapped" ? "Mapped" : "Suggested"}
          </span>
        )}
        {decidable ? (
          <span className="flex shrink-0 items-center gap-0.5">
            {onDisconnect && (
              <button
                type="button"
                aria-label={`Reject the ${join.table} mapping`}
                title="Reject"
                onClick={onDisconnect}
                className={ICON_BUTTON}
              >
                <FigmaIcon src={rejectIcon} />
              </button>
            )}
            <button
              type="button"
              aria-label={`Accept the ${join.table} mapping`}
              title={blockers.length > 0 ? blockers.join(" ") : "Accept"}
              disabled={blockers.length > 0}
              onClick={onAccept}
              className={cn(ICON_BUTTON, "disabled:cursor-not-allowed disabled:opacity-40")}
            >
              <FigmaIcon src={acceptIcon} />
            </button>
          </span>
        ) : (
          onDisconnect && (
            <button
              type="button"
              aria-label={`Disconnect the ${join.table} mapping`}
              title="Disconnect"
              onClick={onDisconnect}
              className={cn(
                ICON_BUTTON,
                "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/relmap:opacity-100",
              )}
            >
              <FigmaIcon src={crossIcon} size={20} />
            </button>
          )
        )}
      </div>
      {decidable &&
        blockers.map((blocker) => (
          <BlockedNote key={blocker} inset>
            {blocker}
          </BlockedNote>
        ))}
    </div>
  );
}

function JoinEnd({
  entity,
  alias,
  columns,
  broken = false,
}: {
  entity: string;
  // The occurrence, where the dataset holds several of that Entity Type.
  alias?: string | undefined;
  columns: string[];
  broken?: boolean;
}) {
  return (
    <span
      className={cn("min-w-0 break-words", (broken || columns.length === 0) && "text-[#dc2626]")}
    >
      <span className="font-medium">{entity}</span>
      {alias && <span className="text-[#6d7472]">@{alias}</span>}[{columns.join(", ") || "—"}]
    </span>
  );
}

/**
 * A dataset's Relations — the dataset-first way to map them (like the "Map relations" step):
 * every Relation between two Entity Types whose Identifiers are both mapped here can link records
 * through it, keyed by those Identifier columns. Mapped ones can be disconnected; the rest mapped.
 */
function TableRelations({ app, table }: { app: OntologyApp; table: string }) {
  const name = (id: string) => app.entities.find((e) => e.id === id)?.name || "Untitled entity";
  // A Relation's mappings through this dataset (one per pair of instances where it holds several
  // of an Entity Type), else the ones it could have here.
  const rows = app.relations.flatMap((r) => {
    const saved = relationJoins(r, app.entities).filter((j) => j.table === table);
    if (saved.length) return saved.map((join) => ({ relation: r, join, mapped: true }));
    return relationMappingCandidates(
      app.entities.find((e) => e.id === r.from),
      app.entities.find((e) => e.id === r.to),
    )
      .filter((c) => c.table === table)
      .map((candidate) => ({
        relation: r,
        join: { ...candidate, broken: false } as RelationJoin,
        mapped: false,
      }));
  });
  const here = app.entities.filter((e) => identifierColumnsIn(e, table).length > 0);
  return (
    <Field label={`Relations in this dataset · ${rows.length}`}>
      {rows.length === 0 ? (
        <p className="text-[12px] leading-5 text-[#6d7472]">
          {here.length < 2
            ? "Map the identifiers of two entity types here to relate their records through it."
            : "No relation between the entity types here yet."}
        </p>
      ) : (
        <MappingRows>
          {rows.map(({ relation: r, join, mapped }) =>
            mapped ? (
              <RelationMappingRow
                key={`${r.id}|${relationMappingKey(join)}`}
                app={app}
                join={join}
                subject={name(r.from)}
                object={name(r.to)}
                relationName={relationLabel(r)}
                showDataset={false}
                onDisconnect={() => app.disconnectRelationMapping(r.id, join)}
              />
            ) : (
              <div
                key={`${r.id}|${relationMappingKey(join)}`}
                className="flex h-12 min-w-0 items-center gap-3 px-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] leading-4 text-[#080a09]">
                  <JoinEnd
                    entity={name(r.from)}
                    alias={join.fromAlias}
                    columns={join.fromColumns}
                  />
                  <FigmaIcon src={arrowRightIcon} size={12} />
                  <span className="shrink-0 font-medium">{relationLabel(r)}</span>
                  <FigmaIcon src={arrowRightIcon} size={12} />
                  <JoinEnd entity={name(r.to)} alias={join.toAlias} columns={join.toColumns} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const { broken: _broken, ...mapping } = join;
                    app.connectRelationMapping(r.id, { ...mapping, status: "mapped" });
                  }}
                  className="flex h-7 shrink-0 items-center rounded-[4px] border border-[#e3e5e4] bg-white px-2.5 text-[12px] font-medium leading-4 text-[#161919] hover:bg-[#f4f4f4]"
                >
                  Map
                </button>
              </div>
            ),
          )}
        </MappingRows>
      )}
    </Field>
  );
}

// The dock's resize limits: the panel can't be dragged shorter than its header + footer + a row,
// and never taller than the canvas minus the zoom card's corner (12 + 32 + 12) and the 12px gap.
const DOCK_MIN = 144;
const DOCK_TOP_CLEARANCE = 68;
const DOCK_KEY_STEP = 16;
// The user's max height, kept across items (and across closing / reopening the panel).
let rememberedDockCap: number | null = null;

/**
 * Where the detail panel sits on the canvas: bottom-centred, 12px in (Figma 356:197299's
 * center/bottom constraints, 880–1444 wide). Its height hugs the panel's content; dragging the top
 * edge sets a max height instead (so a shorter item still hugs), double-click resets it. A Data
 * table starts capped at Figma's 240px, since its Sample data would otherwise fill the canvas.
 */
export function DetailDock({
  children,
  defaultCap = null,
}: {
  children: ReactNode;
  defaultCap?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cap, setCapState] = useState<number | null>(rememberedDockCap);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startH: number } | null>(null);
  const setCap = (next: number | null) => {
    rememberedDockCap = next;
    setCapState(next);
  };
  const effectiveCap = cap ?? defaultCap;
  // The tallest the panel can be: its content's own height (a hug can't be stretched), within
  // the canvas.
  const limits = () => {
    const dock = ref.current;
    const canvas = dock?.parentElement?.clientHeight ?? window.innerHeight;
    const max = canvas - DOCK_TOP_CLEARANCE;
    const panel = dock?.querySelector<HTMLElement>("[data-detail-panel]");
    let natural = panel?.offsetHeight ?? max;
    panel?.querySelectorAll<HTMLElement>(".overflow-y-auto").forEach((el) => {
      natural += el.scrollHeight - el.clientHeight;
    });
    return { min: DOCK_MIN, max: Math.max(DOCK_MIN, Math.min(max, natural)) };
  };
  const clampToLimits = (height: number) => {
    const { min, max } = limits();
    return Math.round(Math.min(max, Math.max(min, height)));
  };
  return (
    <div
      ref={ref}
      className="group/detaildock absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-[1444px] flex-col"
      style={{
        maxHeight:
          effectiveCap != null
            ? `min(${effectiveCap}px, calc(100% - ${DOCK_TOP_CLEARANCE}px))`
            : `calc(100% - ${DOCK_TOP_CLEARANCE}px)`,
      }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize details panel"
        aria-valuemin={DOCK_MIN}
        aria-valuenow={Math.round(ref.current?.offsetHeight ?? 0)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button !== 0 || !ref.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { startY: event.clientY, startH: ref.current.offsetHeight };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setCap(clampToLimits(start.startH + start.startY - event.clientY));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => setCap(null)}
        onKeyDown={(event) => {
          const height = ref.current?.offsetHeight ?? 0;
          const next =
            event.key === "ArrowUp"
              ? height + DOCK_KEY_STEP
              : event.key === "ArrowDown"
                ? height - DOCK_KEY_STEP
                : event.key === "Home"
                  ? DOCK_MIN
                  : event.key === "End"
                    ? Infinity
                    : null;
          if (event.key === "Enter") setCap(null);
          else if (next == null) return;
          else setCap(clampToLimits(next));
          // Keep ↑/↓ from also stepping through suggestions (DetailPanel's window listener).
          event.preventDefault();
          event.stopPropagation();
        }}
        className="group/grip absolute inset-x-0 top-0 z-10 flex h-2 cursor-ns-resize justify-center outline-none"
      >
        <span
          className={cn(
            "mt-1 h-1 w-8 rounded-full transition-opacity group-focus-visible/grip:ring-2 group-focus-visible/grip:ring-[#00DED8]",
            dragging
              ? "bg-[#9ea3a2] opacity-100"
              : "bg-[#e3e5e4] opacity-0 group-hover/detaildock:opacity-100 group-hover/grip:bg-[#9ea3a2] group-focus-visible/grip:opacity-100",
          )}
        />
      </div>
      {children}
    </div>
  );
}
