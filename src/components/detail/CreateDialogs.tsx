import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { NewPropertyDraft, OntologyApp } from "@/lib/app-state";
import {
  isIdentifierProperty,
  relationDatasetOptions,
  relationJoins,
  type ColumnRef,
  type Entity,
} from "@/lib/mock-data";
import { dataTypeFamily } from "@/lib/mapping-rules";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FigmaIcon, propertyTypeIcon } from "@/components/detail/list-controls";
import { statusDotColor } from "@/components/ontology/StatusBadge";
import { cn } from "@/lib/utils";
import crossIcon from "@/assets/icons/cross-medium-16.svg";
import chevronIcon from "@/assets/icons/chevron-down-carbon-16.svg";
import chevronDarkIcon from "@/assets/icons/chevron-down-carbon-dark-16.svg";
import plusIcon from "@/assets/icons/plus-16.svg";
import searchIcon from "@/assets/icons/magnifying-glass-2-16.svg";

/**
 * The editing workspace's create dialogs (Figma "Editing mode"): Create entity type (328:7243 →
 * 328:8598), Create properties (328:13143) and Create a relation (353:154492). All share one
 * shadcn-Dialog chrome: white, 8px radius, no dividers, an 18px title, a 20px close in the corner
 * and 40px footer buttons. Nothing is created until the footer's Create.
 */

export const PROPERTY_TYPES = [
  "string",
  "integer",
  "decimal",
  "boolean",
  "date",
  "timestamp",
  "uuid",
  "enum",
];

const PRIMARY_BUTTON =
  "flex h-10 min-w-20 items-center justify-center rounded-[4px] bg-[#161919] px-4 text-[14px] font-medium leading-6 text-[#fafafa] transition-colors hover:bg-[#252828] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#161919]";
const SECONDARY_BUTTON =
  "flex h-10 min-w-20 items-center justify-center rounded-[4px] border border-[#e3e5e4] bg-white px-4 text-[14px] font-medium leading-6 text-[#161919] transition-colors hover:bg-[#f4f4f4]";
const INPUT =
  "h-10 w-full rounded-[4px] border border-[#e3e5e4] bg-white px-3 text-[14px] leading-5 text-[#080a09] outline-none transition-colors placeholder:text-[#6d7472] focus:border-[#3b82f6]";
// Figma "Combobox Base / Menu": flush under its trigger, the trigger's width.
const MENU =
  "w-[var(--radix-popover-trigger-width)] min-w-[128px] overflow-hidden rounded-[4px] border-[#e3e5e4] bg-white p-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]";
const MENU_ITEM =
  "flex h-8 w-full shrink-0 items-center gap-2 rounded-[4px] px-3 text-left text-[14px] leading-5 text-[#080a09] hover:bg-[#f4f4f4]";

/** The dialog frame every create step uses. */
function CreateDialogFrame({
  open,
  onClose,
  width,
  title,
  description,
  onSubmit,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  width: number;
  title: string;
  description: string;
  onSubmit: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        hideClose
        onPointerDown={(event) => event.stopPropagation()}
        style={{ width }}
        className="flex max-h-[600px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden rounded-[8px] border-[#e3e5e4] bg-white p-0 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] sm:rounded-[8px]"
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="shrink-0 pb-2 pl-4 pr-8 pt-4">
            <DialogTitle className="truncate text-[18px] font-semibold leading-[18px] tracking-[-0.45px] text-[#080a09]">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{description}</DialogDescription>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-2">{children}</div>
          <div className="flex shrink-0 items-center justify-end gap-3 px-4 pb-4">{footer}</div>
        </form>
        <DialogClose
          aria-label="Close"
          className="absolute right-[9px] top-[9px] flex size-5 items-center justify-center rounded-[4px] hover:bg-[#f4f4f4]"
        >
          <FigmaIcon src={crossIcon} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-[14px] font-medium leading-5 text-[#080a09]">{label}</span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={INPUT}
      />
    </label>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Property rows (Create properties / Create entity type step 2)                              */
/* ------------------------------------------------------------------------------------------ */

type DraftRow = {
  key: number;
  name: string;
  type: string;
  identifier: boolean;
  description: string;
  mapping: ColumnRef | null;
};
let draftKey = 0;
const newRow = (identifier = false): DraftRow => ({
  key: draftKey++,
  name: "",
  type: "string",
  identifier,
  description: "",
  mapping: null,
});
const namedRows = (rows: DraftRow[]) => rows.filter((row) => row.name.trim());
const toDrafts = (rows: DraftRow[]): NewPropertyDraft[] =>
  namedRows(rows).map((row) => ({
    name: row.name,
    type: row.type,
    description: row.description,
    mappings: row.mapping ? [row.mapping] : [],
    ...(row.identifier ? { isIdentifier: true } : {}),
  }));
// At least one named row that's an identifier (checked, or named "id" by convention).
const hasIdentifier = (rows: DraftRow[]) =>
  namedRows(rows).some((row) => row.identifier || isIdentifierProperty({ name: row.name.trim() }));

const TABLE_HEADERS = [
  ["Property name", 2],
  ["Type", 2],
  ["Identifier", 1],
  ["Description", 2],
  ["Mapping", 2],
  ["Actions", 1],
] as const;

/** Figma "Table" (353:169491): a 10-column grid of 40px rows, then "Add property" under it. */
function PropertyDraftTable({
  app,
  rows,
  onChange,
}: {
  app: OntologyApp;
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
}) {
  const update = (key: number, patch: Partial<DraftRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const lastNameRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-end gap-3">
      <div
        role="table"
        className="grid w-full grid-cols-10 overflow-hidden rounded-[4px] border border-[#e3e5e4] bg-white"
      >
        <div role="row" className="contents">
          {TABLE_HEADERS.map(([label, span], i) => (
            <div
              key={label}
              role="columnheader"
              className={cn(
                "relative flex h-10 items-center border-b border-[#e3e5e4] bg-[#fafafa] px-4",
                span === 2 ? "col-span-2" : "col-span-1",
              )}
            >
              <span className="truncate text-[14px] font-medium leading-6 text-[#6d7472]">
                {label}
              </span>
              {i < TABLE_HEADERS.length - 1 && (
                <span className="absolute right-0 top-[9px] h-5 w-px bg-[#e3e5e4]" />
              )}
            </div>
          ))}
        </div>
        {rows.map((row, index) => (
          <div key={row.key} role="row" className="contents">
            <CellInput
              ref={index === rows.length - 1 ? lastNameRef : undefined}
              value={row.name}
              onChange={(name) => update(row.key, { name })}
              placeholder="Property name"
              ariaLabel="Property name"
              autoFocus={index === 0}
            />
            <TypeCell
              value={row.type}
              onChange={(type) =>
                update(row.key, {
                  type,
                  // A mapping of another type family doesn't survive the type change.
                  ...(row.mapping && !columnFits(app, row.mapping, type) ? { mapping: null } : {}),
                })
              }
            />
            <div
              role="cell"
              className="col-span-1 flex h-10 items-center border-b border-[#e3e5e4] px-4"
            >
              <DraftCheckbox
                checked={row.identifier}
                // One Identifier per Entity Type: checking a row unchecks the others.
                onChange={(identifier) =>
                  onChange(
                    rows.map((r) =>
                      r.key === row.key
                        ? { ...r, identifier }
                        : identifier
                          ? { ...r, identifier: false }
                          : r,
                    ),
                  )
                }
                label={`${row.name || "Property"} is an identifier`}
              />
            </div>
            <CellInput
              value={row.description}
              onChange={(description) => update(row.key, { description })}
              placeholder="Description"
              ariaLabel="Description"
            />
            <MappingCell
              app={app}
              type={row.type}
              value={row.mapping}
              onChange={(mapping) => update(row.key, { mapping })}
            />
            <div
              role="cell"
              className="col-span-1 flex h-10 items-center border-b border-[#e3e5e4] px-4"
            >
              <button
                type="button"
                disabled={rows.length === 1}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                className="flex h-8 min-w-16 items-center justify-center rounded-[4px] border border-[#fecaca] bg-white px-2 text-[14px] font-medium leading-6 text-[#dc2626] transition-colors hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onChange([...rows, newRow()]);
          requestAnimationFrame(() => lastNameRef.current?.focus());
        }}
        className="flex h-8 min-w-16 items-center justify-center rounded-[4px] border border-[#e3e5e4] bg-[#f4f4f4] px-2 text-[14px] font-medium leading-6 text-[#161919] transition-colors hover:bg-[#e3e5e4]"
      >
        <FigmaIcon src={plusIcon} />
        <span className="px-1">Add property</span>
      </button>
    </div>
  );
}

const CELL = "col-span-2 h-10 border-b border-[#e3e5e4]";
// A cell being typed in, or whose menu is open, gets a 1px blue frame (Figma 353:171593).
const CELL_ACTIVE = "border border-transparent focus-within:border-[#3b82f6]";

function CellInput({
  ref,
  value,
  onChange,
  placeholder,
  ariaLabel,
  autoFocus,
}: {
  ref?: React.Ref<HTMLInputElement> | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  return (
    <div role="cell" className={cn(CELL, "bg-white")}>
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "size-full truncate bg-transparent px-4 text-[14px] leading-5 text-[#080a09] outline-none placeholder:text-[#6d7472]",
          CELL_ACTIVE,
        )}
      />
    </div>
  );
}

function DraftCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[#161919] outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]/40",
        checked && "bg-[#161919]",
      )}
    >
      {checked && <Check className="size-3.5 text-[#fafafa]" strokeWidth={1.5} />}
    </button>
  );
}

/** A table cell that opens a menu under itself: value, then the chevron (up while open). */
function MenuCell({
  open,
  onOpenChange,
  label,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="cell" className={cn(CELL, "bg-white")}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "flex size-full items-center gap-4 px-4 text-left outline-none",
              CELL_ACTIVE,
              "focus-visible:border-[#3b82f6] data-[state=open]:border-[#3b82f6]",
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">{trigger}</span>
            <FigmaIcon src={chevronIcon} className={cn(open && "rotate-180")} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={0}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className={MENU}
        >
          {children}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TypeCell({ value, onChange }: { value: string; onChange: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const types = PROPERTY_TYPES.includes(value) ? PROPERTY_TYPES : [value, ...PROPERTY_TYPES];
  return (
    <MenuCell
      open={open}
      onOpenChange={setOpen}
      label="Type"
      trigger={<span className="truncate text-[14px] leading-5 text-[#080a09]">{value}</span>}
    >
      <div role="listbox" className="flex max-h-[300px] flex-col overflow-y-auto px-1 py-1.5">
        {types.map((type) => {
          const TypeGlyph = propertyTypeIcon(type);
          return (
            <button
              key={type}
              type="button"
              role="option"
              aria-selected={type === value}
              onClick={() => {
                onChange(type);
                setOpen(false);
              }}
              className={cn(MENU_ITEM, type === value && "bg-[#f4f4f4]")}
            >
              <span className="min-w-0 flex-1 truncate">{type}</span>
              <TypeGlyph className="size-4 shrink-0 text-[#6d7472]" strokeWidth={1.5} aria-hidden />
            </button>
          );
        })}
      </div>
    </MenuCell>
  );
}

const columnFits = (app: OntologyApp, mapping: ColumnRef, type: string) => {
  const column = app.tables
    .find((t) => t.name === mapping.table)
    ?.columns.find((c) => c.name === mapping.column);
  return !!column && dataTypeFamily(column.type) === dataTypeFamily(type);
};

/** The Mapping cell: a searchable list of the columns this row's type can map to. */
function MappingCell({
  app,
  type,
  value,
  onChange,
}: {
  app: OntologyApp;
  type: string;
  value: ColumnRef | null;
  onChange: (mapping: ColumnRef | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const family = dataTypeFamily(type);
    return app.tables.flatMap((table) =>
      table.columns
        .filter((column) => dataTypeFamily(column.type) === family)
        .map((column) => ({ table: table.name, column: column.name })),
    );
  }, [app.tables, type]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length
    ? options.filter((o) =>
        terms.every((term) => `${o.table}.${o.column}`.toLowerCase().includes(term)),
      )
    : options;
  const shown = matches.slice(0, 200);
  return (
    <MenuCell
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      label="Mapping"
      trigger={
        value ? (
          <>
            {/* A mapping picked here is a confirmed one. */}
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: statusDotColor("confirmed") }}
            />
            <span className="truncate text-[14px] leading-5 text-[#080a09]">{value.column}</span>
          </>
        ) : (
          <span className="truncate text-[14px] leading-5 text-[#6d7472]">Select</span>
        )
      }
    >
      <div className="flex h-10 items-center gap-2 border-b border-[#e3e5e4] px-3">
        <FigmaIcon src={searchIcon} className="opacity-50" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label="Search columns"
          className="min-w-0 flex-1 bg-transparent pr-2 text-[14px] leading-5 text-[#080a09] outline-none placeholder:text-[#080a09]/50"
        />
      </div>
      <div
        role="listbox"
        onWheel={(event) => event.stopPropagation()}
        className="flex max-h-[300px] flex-col overflow-y-auto overscroll-contain px-1 py-1.5"
      >
        {value && !query && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={cn(MENU_ITEM, "text-[#6d7472]")}
          >
            No mapping
          </button>
        )}
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] text-[#6d7472]">
            No {type} columns match.
          </p>
        ) : (
          shown.map((option) => {
            const selected = value?.table === option.table && value.column === option.column;
            return (
              <button
                key={`${option.table}.${option.column}`}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange({ table: option.table, column: option.column, status: "mapped" });
                  setOpen(false);
                }}
                className={cn(MENU_ITEM, selected && "bg-[#f4f4f4]")}
              >
                <span className="min-w-0 truncate">{option.column}</span>
                <span className="min-w-0 flex-1 truncate text-[#6d7472]">{option.table}</span>
              </button>
            );
          })
        )}
      </div>
    </MenuCell>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* The three dialogs                                                                           */
/* ------------------------------------------------------------------------------------------ */

const IDENTIFIER_HINT = "Mark at least one property as the identifier.";

/** Create entity type: its name and description (384px), then its properties (896px). */
export function CreateEntityDialog({
  app,
  onClose,
  onCreated,
}: {
  app: OntologyApp;
  onClose: () => void;
  onCreated: (entityId: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // The first row starts as the identifier, the one the new Entity Type needs.
  const [rows, setRows] = useState<DraftRow[]>(() => [newRow(true)]);
  const canCreate = hasIdentifier(rows);
  if (step === 1) {
    return (
      <CreateDialogFrame
        open
        onClose={onClose}
        width={384}
        title="Create entity type"
        description="A kind of thing in your ontology, like Policy or Driver."
        onSubmit={() => name.trim() && setStep(2)}
        footer={
          <button type="submit" disabled={!name.trim()} className={PRIMARY_BUTTON}>
            Next
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Entity name"
            autoFocus
          />
          <TextField
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Description"
          />
        </div>
      </CreateDialogFrame>
    );
  }
  return (
    <CreateDialogFrame
      open
      onClose={onClose}
      width={896}
      title={`Create properties of ${name.trim()}`}
      description="The new entity type's properties: name, type, identifier, description, and column mapping."
      onSubmit={() => {
        if (!canCreate) return;
        const id = app.createEntityWithProperties({
          name,
          description,
          position: { x: 0, y: 0 },
          properties: toDrafts(rows),
        });
        onCreated(id);
      }}
      footer={
        <>
          {!canCreate && (
            <span className="mr-auto text-[12px] text-[#6d7472]">{IDENTIFIER_HINT}</span>
          )}
          <button type="button" onClick={() => setStep(1)} className={SECONDARY_BUTTON}>
            Previous
          </button>
          <button
            type="submit"
            disabled={!canCreate}
            title={canCreate ? undefined : IDENTIFIER_HINT}
            className={PRIMARY_BUTTON}
          >
            Create
          </button>
        </>
      }
    >
      <PropertyDraftTable app={app} rows={rows} onChange={setRows} />
    </CreateDialogFrame>
  );
}

/** Create properties: several of an Entity Type's properties at once (896px). */
export function CreatePropertiesDialog({
  app,
  entity,
  onClose,
  onCreated,
}: {
  app: OntologyApp;
  entity: Entity;
  onClose: () => void;
  onCreated: (propertyIds: string[]) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>(() => [newRow()]);
  const canCreate = namedRows(rows).length > 0;
  return (
    <CreateDialogFrame
      open
      onClose={onClose}
      width={896}
      title={`Create properties of ${entity.name || "Untitled entity"}`}
      description="New properties: name, type, identifier, description, and column mapping."
      onSubmit={() => {
        if (!canCreate) return;
        onCreated(app.createProperties(entity.id, toDrafts(rows)));
      }}
      footer={
        <button type="submit" disabled={!canCreate} className={PRIMARY_BUTTON}>
          Create
        </button>
      }
    >
      <PropertyDraftTable app={app} rows={rows} onChange={setRows} />
    </CreateDialogFrame>
  );
}

/** Create a relation (384px): name, description, mapping, then Subject / Object. */
export function CreateRelationDialog({
  app,
  from,
  to,
  onClose,
  onCreated,
}: {
  app: OntologyApp;
  from: string;
  to: string;
  onClose: () => void;
  onCreated: (relationId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState(from);
  const [object, setObject] = useState(to);
  const [table, setTable] = useState("");
  const subjectEntity = app.entities.find((e) => e.id === subject);
  const objectEntity = app.entities.find((e) => e.id === object);
  // A join's columns can differ but its table can't, so the tables both sides map into lead.
  // A Relation maps through a dataset where both Identifiers are mapped; its keys are those
  // Identifier columns (shown as the hint), so only such datasets can be picked.
  const tableOptions = useMemo(
    () =>
      relationDatasetOptions(subjectEntity, objectEntity).map((t) => {
        const [join] = relationJoins(
          {
            id: "",
            name: "",
            description: "",
            from: subject,
            to: object,
            confidence: 1,
            status: "suggested",
            datasets: [t],
          },
          app.entities,
        );
        return {
          value: t,
          label: t,
          hint: join ? `${join.fromColumns.join(", ")} → ${join.toColumns.join(", ")}` : "",
        };
      }),
    [app.entities, subject, object, subjectEntity, objectEntity],
  );
  // A dataset picked for another pair no longer applies.
  const pickedTable = tableOptions.some((o) => o.value === table) ? table : "";
  const entityOptions = app.entities.map((e) => ({
    value: e.id,
    label: e.name || "Untitled entity",
    hint: "",
  }));
  const canCreate = !!name.trim() && !!subjectEntity && !!objectEntity;
  return (
    <CreateDialogFrame
      open
      onClose={onClose}
      width={384}
      title="Create a relation"
      description="How two entity types are connected, and the table that joins them."
      onSubmit={() => {
        if (!canCreate) return;
        onCreated(
          app.createRelation(subject, object, name, {
            description,
            datasets: pickedTable ? [pickedTable] : [],
          }),
        );
      }}
      footer={
        <button type="submit" disabled={!canCreate} className={PRIMARY_BUTTON}>
          Create
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Relation name"
          autoFocus
        />
        <TextField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description"
        />
        <SelectField
          label="Mapping"
          value={pickedTable}
          options={tableOptions}
          onChange={setTable}
          emptyLabel="No dataset has both identifiers mapped yet"
        />
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Subject"
            value={subject}
            options={entityOptions}
            onChange={setSubject}
          />
          <SelectField label="Object" value={object} options={entityOptions} onChange={setObject} />
        </div>
      </div>
    </CreateDialogFrame>
  );
}

type SelectOption = { value: string; label: string; hint: string };

/** A labelled select (Figma "Select", 40px): the value or "Select", then the dark chevron. */
function SelectField({
  label,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  // Shown (and the select disabled) when there's nothing to pick.
  emptyLabel?: string;
}) {
  const empty = options.length === 0 && !!emptyLabel;
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-[14px] font-medium leading-5 text-[#080a09]">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            disabled={empty}
            className={cn(
              INPUT,
              "flex items-center gap-4 text-left data-[state=open]:border-[#3b82f6] disabled:cursor-not-allowed disabled:bg-[#fafafa] disabled:text-[#6d7472]",
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {empty ? emptyLabel : (selected?.label ?? "Select")}
            </span>
            <FigmaIcon src={chevronDarkIcon} className={cn(open && "rotate-180")} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className={MENU}
        >
          <div
            role="listbox"
            onWheel={(event) => event.stopPropagation()}
            className="flex max-h-[300px] flex-col overflow-y-auto overscroll-contain px-1 py-1.5"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(MENU_ITEM, option.value === value && "bg-[#f4f4f4]")}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && (
                  <span className="shrink-0 text-[12px] text-[#6d7472]">{option.hint}</span>
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
