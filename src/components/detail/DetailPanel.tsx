import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import type { OntologyApp } from "@/lib/app-state";
import { parseSuggestionKey } from "@/lib/app-state";
import {
  entityDisplayStatus,
  entityErrorReason,
  isIdentifierProperty,
  mappingStatus,
  propertyErrorReason,
  propertyStatus,
  relationErrorReason,
  relationJoins,
  relationLabel,
  relationStatus,
  tableMappingCompleteness,
  tableMappingStatus,
  type Entity,
  type Property,
  type Relation,
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
  "flex w-full flex-col overflow-hidden rounded-lg border border-[#e3e5e4] bg-white shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)]";
// The footer's two equal buttons (Figma "Button", outline, 32px, 4px radius, Medium 14).
const FOOTER_BUTTON =
  "flex h-8 min-w-16 flex-1 items-center justify-center rounded-[4px] border border-[#e3e5e4] bg-white px-2 text-[14px] font-medium leading-6 text-[#161919] transition-colors hover:bg-[#f4f4f4]";
const ICON_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.06]";
// Where the fields scroll when they outgrow the Figma frame's 142px.
const BODY_CLASS = "max-h-[142px] min-h-0 overflow-y-auto px-4 py-3";

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
      if (p.mapping?.table !== table.name) return;
      if (mappingStatus(p.mapping) === "mapped") mappedColumns.add(p.mapping.column);
      else suggestedColumns.add(p.mapping.column);
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
  const suggested = status === "suggested";
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
    status === "error" || status === "warning"
      ? item.kind === "entity"
        ? (entityErrorReason(item.entity) ?? item.entity.warningReason)
        : item.kind === "property"
          ? (propertyErrorReason(item.property) ?? item.property.warningReason)
          : (relationErrorReason(item.relation, app.entities) ?? item.relation.warningReason)
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
      {item.kind === "entity" && <EntityFields entity={item.entity} />}
      {item.kind === "property" && <PropertyFields app={app} property={item.property} />}
      {item.kind === "relation" && <RelationFields app={app} item={item} />}
      {/* A suggestion is decided here (Reject removes it); anything else can be deleted in the
          same spot. */}
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
              onClick={() => {
                app.acceptSuggestions([item.key]);
                advance();
              }}
              className={FOOTER_BUTTON}
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

function EntityFields({ entity }: { entity: Entity }) {
  const primary = primaryPropertyOf(entity);
  const template = entity.displayNameTemplate ?? (primary ? `{${primary.name}}` : "");
  const identifiers = entity.properties.filter((p) => isIdentifierProperty(p));
  return (
    <div className={cn(BODY_CLASS, "grid grid-cols-3 gap-4")}>
      <div className="col-span-3">
        <Field label="Description">
          <Value value={entity.description} placeholder="No description" />
        </Field>
      </div>
      <Field label="Identifiers">
        {identifiers.length === 0 ? (
          <p className="text-[14px] leading-6 text-[#9c461e]">No identifier yet</p>
        ) : (
          identifiers.map((p) => (
            <div key={p.id} className="flex min-w-0 items-center gap-2">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: statusDotColor(propertyStatus(p)) }}
              />
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[14px] leading-6 text-[#080a09]">
                  {p.name}
                </span>
                <span role="img" aria-label="Identifier" className="shrink-0">
                  <FigmaIcon src={keyIcon} />
                </span>
                <PropertyTypeGlyph type={p.type} color="#6d7472" />
              </span>
              {propertyStatus(p) === "suggested" && (
                <PropertyConfidenceChip property={p} tone="muted" />
              )}
            </div>
          ))
        )}
      </Field>
      <Field label="Display name template">
        <Value value={template} />
      </Field>
      <Field label="Primary property">
        <Value value={primary?.name} />
      </Field>
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

function PropertyFields({ app, property }: { app: OntologyApp; property: Property }) {
  const mapping = property.mapping;
  const identifier = isIdentifierProperty(property);
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
      <Field label="Mapping">
        <div className="flex min-w-0 items-center rounded-[6px] border border-[#e3e5e4] bg-[#fafafa] px-3 py-2">
          {mapping ? (
            <MappingValue app={app} table={mapping.table} column={mapping.column} />
          ) : (
            <span className="truncate text-[12px] leading-4 text-[#6d7472]">Not mapped yet</span>
          )}
        </div>
      </Field>
    </div>
  );
}

// A Relation: what it means, which Entity Types it runs between (Subject → Object), and — table
// by table — the columns its join keys come from.
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
  const joins = relationJoins(relation);
  return (
    <div className={cn(BODY_CLASS, "flex flex-col gap-4")}>
      <Field label="Description">
        <Value value={relation.description} placeholder="No description" />
      </Field>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <Field label="From (Subject)">
            <Value value={fromName} placeholder="No subject" />
          </Field>
        </div>
        <span aria-hidden className="flex shrink-0">
          <FigmaIcon src={arrowLeftRightIcon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <Field label="To (Object)">
            <Value value={toName} placeholder="No object" />
          </Field>
        </div>
      </div>
      <Field label="Mapping">
        {joins.length === 0 ? (
          <p className="text-[14px] leading-6 text-[#9ea3a2]">No mapping yet</p>
        ) : (
          <div className="flex flex-col">
            {joins.map((join, i) => (
              <div
                key={`${join.fromTable}-${join.toTable}-${i}`}
                className={cn(
                  "grid grid-cols-3 items-center gap-x-4 border-[#e3e5e4] bg-[#fafafa] px-3 py-2",
                  i === 0 ? "border" : "border-x border-b",
                  i === 0 && "rounded-t-[6px]",
                  i === joins.length - 1 && "rounded-b-[6px]",
                )}
              >
                <MappingValue
                  app={app}
                  table={
                    join.fromTable === join.toTable
                      ? join.fromTable
                      : `${join.fromTable} · ${join.toTable}`
                  }
                />
                <div className="col-span-2 flex min-w-0 items-center justify-end gap-2 overflow-hidden text-[14px] leading-6 text-[#080a09]">
                  <JoinEnd entity={fromName} columns={join.fromColumns} />
                  <ArrowRight className="size-3 shrink-0 text-[#6d7472]" strokeWidth={1.5} />
                  <span className="shrink-0 font-medium">
                    {relation.name || "Unnamed relation"}
                  </span>
                  <ArrowRight className="size-3 shrink-0 text-[#6d7472]" strokeWidth={1.5} />
                  <JoinEnd entity={toName} columns={join.toColumns} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Field>
    </div>
  );
}

function JoinEnd({ entity, columns }: { entity: string; columns: string[] }) {
  return (
    <span className="min-w-0 truncate">
      <span className="font-medium">{entity}</span>[{columns.join(", ") || "—"}]
    </span>
  );
}
