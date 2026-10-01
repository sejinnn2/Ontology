import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, ArrowRight, Check } from "lucide-react";
import type { OntologyApp, SuggestionRef } from "@/lib/app-state";
import { isIdentifierProperty, type ColumnRef, type Entity } from "@/lib/mock-data";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CreateEntityDialog,
  CreatePropertiesDialog,
  CreateRelationDialog,
  PROPERTY_TYPES,
} from "@/components/detail/CreateDialogs";
import { cn } from "@/lib/utils";
import chevronDownIcon from "@/assets/icons/chevron-down-16.svg";
import searchIcon from "@/assets/icons/magnifying-glass-2-16.svg";

/**
 * Creating and editing an Entity Type, Property, or Relation always goes through this one modal:
 * the Entity types panel's + (new Entity Type), a Property list's + (new Properties), a Relation
 * drawn on the canvas, and every item's Edit. Creating uses the Figma create dialogs
 * (`CreateDialogs.tsx`); editing uses the form below. Changes are drafted and applied together on
 * Create / Save, so closing it always leaves the ontology untouched.
 */

export type EditorRequest =
  | { mode: "create"; kind: "entity" }
  | { mode: "create"; kind: "property"; entityId: string }
  // A Relation between two Entity Types (e.g. drawn on the canvas), named here before it exists.
  | { mode: "create"; kind: "relation"; from: string; to: string }
  | { mode: "edit"; ref: SuggestionRef };

const INPUT =
  "w-full rounded-[6px] border border-[#e3e5e4] bg-white px-2.5 text-[14px] leading-5 text-[#161919] outline-none transition-colors placeholder:text-[#9ea3a2] hover:border-[#c9cccb] focus:border-[#00ded8] focus:ring-2 focus:ring-[#00ded8]/25";
const SECONDARY_BUTTON =
  "flex h-8 items-center justify-center rounded-[4px] border border-[#e3e5e4] bg-white px-3 text-[14px] font-medium leading-[21px] text-[#161919] transition-colors hover:bg-[#f4f4f4]";
const PRIMARY_BUTTON =
  "flex h-8 items-center justify-center rounded-[4px] border border-[#e3e5e4] bg-black px-3 text-[14px] font-medium leading-[21px] text-[#fafafa] transition-colors hover:bg-[#252828]";

export function ItemEditorModal({
  app,
  request,
  onClose,
  onCreated,
}: {
  app: OntologyApp;
  request: EditorRequest | null;
  onClose: () => void;
  /** Called with what was just created (e.g. to select it). */
  onCreated?: (refs: SuggestionRef[]) => void;
}) {
  if (request?.mode === "create") {
    const key = JSON.stringify(request);
    if (request.kind === "entity") {
      return (
        <CreateEntityDialog
          key={key}
          app={app}
          onClose={onClose}
          onCreated={(id) => {
            onCreated?.([{ kind: "entity", id }]);
            onClose();
          }}
        />
      );
    }
    if (request.kind === "property") {
      const entity = app.entities.find((e) => e.id === request.entityId);
      if (!entity) return null;
      return (
        <CreatePropertiesDialog
          key={key}
          app={app}
          entity={entity}
          onClose={onClose}
          onCreated={(ids) => {
            onCreated?.(
              ids.map((propertyId) => ({ kind: "property", entityId: entity.id, propertyId })),
            );
            onClose();
          }}
        />
      );
    }
    return (
      <CreateRelationDialog
        key={key}
        app={app}
        from={request.from}
        to={request.to}
        onClose={onClose}
        onCreated={(id) => {
          onCreated?.([{ kind: "relation", id }]);
          onClose();
        }}
      />
    );
  }
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onPointerDown={(event) => event.stopPropagation()}
        className="max-w-[478px] gap-0 rounded-[10px] border-[#e3e5e4] bg-[#fafafa] p-0 shadow-[0_12px_16px_rgba(0,0,0,0.2)] sm:rounded-[10px]"
      >
        {request && (
          <EditorForm key={JSON.stringify(request)} app={app} request={request} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type EditRequest = Extract<EditorRequest, { mode: "edit" }>;

function resolveTarget(app: OntologyApp, request: EditRequest) {
  const ref = request.ref;
  if (ref.kind === "entity") {
    const entity = app.entities.find((e) => e.id === ref.id);
    return entity ? { kind: "entity" as const, entity } : null;
  }
  if (ref.kind === "property" || ref.kind === "mapping") {
    const entity = app.entities.find((e) => e.id === ref.entityId);
    const property = entity?.properties.find((p) => p.id === ref.propertyId);
    return entity && property ? { kind: "property" as const, entity, property } : null;
  }
  const relation = app.relations.find((r) => r.id === ref.id);
  return relation ? { kind: "relation" as const, relation } : null;
}

// A `<select>` value for a column mapping ("" = not mapped).
const MAPPING_SEPARATOR = "\t";
const mappingValue = (mapping: ColumnRef | null | undefined) =>
  mapping ? `${mapping.table}${MAPPING_SEPARATOR}${mapping.column}` : "";
export function parseMappingValue(value: string): ColumnRef | null {
  const [table, column] = value.split(MAPPING_SEPARATOR);
  return table && column ? { table, column, status: "mapped" } : null;
}

function EditorForm({
  app,
  request,
  onClose,
}: {
  app: OntologyApp;
  request: EditRequest;
  onClose: () => void;
}) {
  const target = resolveTarget(app, request);
  const kind = target?.kind;

  const entity = target?.kind === "entity" ? target.entity : undefined;
  const property = target?.kind === "property" ? target.property : undefined;
  const relation = target?.kind === "relation" ? target.relation : undefined;
  const owner = target?.kind === "property" ? target.entity : undefined;

  // Entity Type / Relation draft.
  const [name, setName] = useState(entity?.name ?? relation?.name ?? "");
  const [description, setDescription] = useState(
    entity?.description ?? relation?.description ?? "",
  );
  const [template, setTemplate] = useState(entity?.displayNameTemplate ?? "");
  const [primaryId, setPrimaryId] = useState(entity?.primaryPropertyId ?? "");
  const [from, setFrom] = useState(relation?.from ?? "");
  const [to, setTo] = useState(relation?.to ?? "");

  // Property draft.
  const [propName, setPropName] = useState(property?.name ?? "");
  const [propDescription, setPropDescription] = useState(property?.description ?? "");
  const [type, setType] = useState(property?.type ?? "string");
  const [identifier, setIdentifier] = useState(property ? isIdentifierProperty(property) : false);

  const [error, setError] = useState<string | null>(null);

  if (!target) {
    return (
      <div className="p-6 text-[14px] text-[#6d7472]">
        This item no longer exists.
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const showsPropertyForm = kind === "property";
  const title = `Edit ${kind === "entity" ? "entity type" : kind}`;

  const propertyFields = () => ({
    description: propDescription,
    type,
  });

  const submit = () => {
    if (showsPropertyForm ? !propName.trim() : !name.trim()) return setError("Enter a name.");

    if (entity) {
      app.updateEntity(entity.id, {
        name,
        description,
        displayNameTemplate: template || undefined,
        primaryPropertyId: primaryId || undefined,
      });
    } else if (property && owner) {
      const identifierByName = isIdentifierProperty(property) && property.isIdentifier !== true;
      app.updateProperty(owner.id, property.id, {
        name: propName,
        ...propertyFields(),
        ...(identifierByName ? {} : { isIdentifier: identifier }),
      });
    } else if (relation) {
      if (name !== relation.name) app.renameRelation(relation.id, name);
      app.updateRelation(relation.id, {
        description,
        from,
        to,
      });
    }
    onClose();
  };

  // Identifier membership is per Property, not exclusive per Entity Type. This allows one Data
  // Table to provide identifiers for several Entity Types and also supports composite identifiers
  // made from several Properties on the same Entity Type. A Property literally named "id" remains
  // an identifier by convention and therefore cannot be toggled off.
  const identifierByName =
    !!property && isIdentifierProperty(property) && property.isIdentifier !== true;
  const identifierLocked = identifierByName;
  const identifierLockReason = identifierByName
    ? "A property named “id” is always an identifier."
    : null;
  const nameError = error && (
    <span role="alert" className="text-[12px] leading-4 text-[#dc2626]">
      {error}
    </span>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="border-b border-[#e3e5e4] px-5 pb-4 pt-5 pr-12">
        <DialogTitle className="truncate text-[16px] font-medium leading-6 tracking-[-0.4px] text-[#080a09]">
          {title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {showsPropertyForm
            ? "A Property's name, column mapping, description, and type."
            : kind === "relation"
              ? "How two entity types are connected."
              : "A kind of thing in your ontology, like Policy or Driver."}
        </DialogDescription>
      </div>

      {showsPropertyForm ? (
        <div key="property" className="flex flex-col gap-4 px-5 py-4">
          <Field label="Property Name">
            <input
              autoFocus
              value={propName}
              onChange={(event) => {
                setPropName(event.target.value);
                setError(null);
              }}
              placeholder="policyNumber"
              aria-invalid={!!error}
              className={cn(INPUT, "h-9", error && "border-[#dc2626]")}
            />
            {nameError}
          </Field>
          {/* A Property can map to several datasets — they're connected on the canvas and listed
              (and disconnected) in the detail panel, not edited here. */}
          <Field label="Description">
            <textarea
              value={propDescription}
              onChange={(event) => setPropDescription(event.target.value)}
              placeholder="Describe"
              className={cn(INPUT, "h-[78px] resize-none py-2")}
            />
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Type">
              <SelectBox value={type} onChange={setType} ariaLabel="Type" icon={chevronDownIcon}>
                {(PROPERTY_TYPES.includes(type) ? PROPERTY_TYPES : [type, ...PROPERTY_TYPES]).map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ),
                )}
              </SelectBox>
            </Field>
            <Tooltip>
              <TooltipTrigger asChild>
                <label
                  aria-describedby={identifierLockReason ? "identifier-lock-reason" : undefined}
                  className={cn(
                    "flex h-9 items-center justify-between gap-3 rounded-[6px] border border-[#e3e5e4] px-2.5",
                    identifierLocked ? "cursor-not-allowed bg-[#f4f4f4]" : "cursor-pointer",
                  )}
                >
                  <span
                    className={cn(
                      "text-[14px] leading-[21px]",
                      identifierLocked ? "text-[#9ea3a2]" : "text-[#161919]",
                    )}
                  >
                    Identifier
                  </span>
                  <input
                    type="checkbox"
                    checked={identifier}
                    disabled={identifierLocked}
                    onChange={(event) => setIdentifier(event.target.checked)}
                    className="size-4 accent-[#161919] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              </TooltipTrigger>
              {identifierLockReason && (
                <TooltipContent id="identifier-lock-reason" className="max-w-[240px]">
                  {identifierLockReason}
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>
      ) : (
        <div key="item" className="flex flex-col gap-4 px-5 py-4">
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder={kind === "entity" ? "Policy" : "isGovernedBy"}
              aria-invalid={!!error}
              className={cn(INPUT, "h-9", error && "border-[#dc2626]")}
            />
            {nameError}
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe"
              className={cn(INPUT, "h-[78px] resize-none py-2")}
            />
          </Field>

          {kind === "entity" && entity && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Display name template">
                <input
                  value={template}
                  onChange={(event) => setTemplate(event.target.value)}
                  placeholder="{firstName} {lastName}"
                  className={cn(INPUT, "h-9 font-mono text-[13px]")}
                />
              </Field>
              <Field label="Primary property">
                <SelectBox
                  value={primaryId}
                  onChange={setPrimaryId}
                  ariaLabel="Primary property"
                  icon={chevronDownIcon}
                >
                  <option value="">Identifier (default)</option>
                  {entity.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || "Untitled property"}
                    </option>
                  ))}
                </SelectBox>
              </Field>
            </div>
          )}

          {kind === "relation" && (
            <Field label="From, to">
              <div className="flex items-center gap-2">
                <EntitySelect
                  entities={app.entities}
                  value={from}
                  onChange={setFrom}
                  label="From"
                />
                <ArrowRight className="size-4 shrink-0 text-[#6d7472]" strokeWidth={1.5} />
                <EntitySelect entities={app.entities} value={to} onChange={setTo} label="To" />
                <button
                  type="button"
                  onClick={() => {
                    setFrom(to);
                    setTo(from);
                  }}
                  aria-label="Swap direction"
                  title="Swap direction"
                  className="flex size-9 shrink-0 items-center justify-center rounded-[6px] text-[#6d7472] hover:bg-black/[0.06] hover:text-[#161919]"
                >
                  <ArrowLeftRight className="size-4" strokeWidth={1.5} />
                </button>
              </div>
            </Field>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-[#e3e5e4] px-5 py-3">
        <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" className={PRIMARY_BUTTON}>
          Save
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  labelFor,
  children,
}: {
  label: string;
  // `null` renders a plain group instead of a wrapping <label>, for a control (like the Mapping
  // picker's popover trigger) that a label's click-forwarding would re-trigger.
  labelFor?: null;
  children: ReactNode;
}) {
  const Wrapper = labelFor === null ? "div" : "label";
  return (
    <Wrapper className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] leading-4 text-[#6d7472]">{label}</span>
      {children}
    </Wrapper>
  );
}

type ColumnOption = { value: string; table: string; column: string; type: string };

/**
 * Every column of every data table, searchable by column or table name (words combine: "policies
 * number"). Rows read "column  table  type" so same-named columns in different tables stay
 * distinguishable. Keyboard: type to filter, ↑/↓ to move, Enter to pick. `preferTable`'s columns
 * are listed first (e.g. the table open on the canvas). Picks a `mappingValue` ("" = No mapping).
 */
export function ColumnSearchList({
  app,
  value = "",
  onPick,
  preferTable,
}: {
  app: OntologyApp;
  value?: string;
  onPick: (value: string) => void;
  preferTable?: string | undefined;
}) {
  const options = useMemo<ColumnOption[]>(() => {
    const tables = preferTable
      ? [...app.tables].sort(
          (a, b) => Number(b.name === preferTable) - Number(a.name === preferTable),
        )
      : app.tables;
    return tables.flatMap((table) =>
      table.columns.map((column) => ({
        value: mappingValue({ table: table.name, column: column.name }),
        table: table.name,
        column: column.name,
        type: column.type,
      })),
    );
  }, [app.tables, preferTable]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return options;
    return options.filter((option) => {
      const haystack = `${option.table}.${option.column}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [options, query]);

  const moveActive = (index: number) => {
    const clamped = Math.max(0, Math.min(matches.length - 1, index));
    setActive(clamped);
    listRef.current
      ?.querySelector(`[data-index="${clamped}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  return (
    <>
      <div className="flex h-9 items-center gap-2 border-b border-[#e3e5e4] px-2.5">
        <span className="size-4 shrink-0">
          <img src={searchIcon} alt="" className="block size-full" />
        </span>
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            listRef.current?.scrollTo({ top: 0 });
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveActive(active + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActive(active - 1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const option = matches[active];
              if (option) onPick(option.value);
            }
          }}
          placeholder="Search columns or data tables"
          aria-label="Search columns or data tables"
          aria-controls={listId}
          className="min-w-0 flex-1 bg-transparent text-[14px] leading-5 text-[#161919] outline-none placeholder:text-[#9ea3a2]"
        />
        <span className="shrink-0 text-[12px] tabular-nums text-[#9ea3a2]">
          {matches.length.toLocaleString()}
        </span>
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Columns"
        onWheel={(event) => event.stopPropagation()}
        className="max-h-[280px] overflow-y-auto overscroll-contain p-1"
      >
        {value && !query && (
          <button
            type="button"
            onClick={() => onPick("")}
            className="flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[13px] text-[#6d7472] hover:bg-[#f4f4f4]"
          >
            No mapping
          </button>
        )}
        {matches.length === 0 ? (
          <div className="px-2 py-6 text-center text-[13px] text-[#6d7472]">
            No columns match “{query.trim()}”.
          </div>
        ) : (
          matches.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              data-index={index}
              aria-selected={option.value === value}
              onClick={() => onPick(option.value)}
              onMouseMove={() => active !== index && setActive(index)}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left [content-visibility:auto] [contain-intrinsic-size:auto_32px]",
                index === active && "bg-[#f4f4f4]",
              )}
            >
              <span className="min-w-0 truncate text-[13px] text-[#161919]">{option.column}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-[#6d7472]">
                {option.table}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[#9ea3a2]">{option.type}</span>
              {option.value === value && (
                <Check className="size-4 shrink-0 text-[#161919]" strokeWidth={1.5} />
              )}
            </button>
          ))
        )}
      </div>
    </>
  );
}

function SelectBox({
  value,
  onChange,
  ariaLabel,
  icon,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <span className="relative flex">
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INPUT, "h-9 appearance-none pr-8")}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2">
        <img src={icon} alt="" className="block size-full" />
      </span>
    </span>
  );
}

function EntitySelect({
  entities,
  value,
  onChange,
  label,
}: {
  entities: Entity[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <SelectBox value={value} onChange={onChange} ariaLabel={label} icon={chevronDownIcon}>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name || "Untitled entity"}
          </option>
        ))}
      </SelectBox>
    </span>
  );
}
