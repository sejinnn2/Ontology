import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import type { NewPropertyDraft } from "@/lib/app-state";
import { isIdentifierProperty, type Property } from "@/lib/mock-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FigmaIcon, PropertyTypeGlyph } from "@/components/detail/list-controls";
import { cn } from "@/lib/utils";
import identifierKeyIcon from "@/assets/icons/key-2-identifier-16.svg";
import identifierKeyOnIcon from "@/assets/icons/key-identifier-on-16.svg";

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

// Everything that belongs to the row (it and its type menu) — a press anywhere else ends it.
const DRAFT_ATTR = "data-property-draft";

// The row's controls read as buttons: a hairline box that darkens on hover, like the app's small
// outline buttons.
const ROW_BUTTON =
  "flex h-6 shrink-0 items-center justify-center gap-0.5 rounded-[4px] border bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ded8]/40";

/** The Identifier key as a toggle: grey and outlined while off, yellow while on. Several
 * Identifiers make a composite identifier — keyed by their combination — so turning one on next
 * to `currentIdentifier` adds a key part (numbered: `part`) rather than replacing it. */
function IdentifierToggle({
  on,
  part,
  currentIdentifier,
  onToggle,
}: {
  on: boolean;
  part?: number | undefined;
  currentIdentifier?: string | undefined;
  onToggle: () => void;
}) {
  const label = on
    ? part
      ? `Identifier part ${part} — click to remove it from the identifier`
      : "Identifier — click to unset"
    : currentIdentifier
      ? `Add as an identifier part (composite with ${currentIdentifier})`
      : "Make it the identifier";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        ROW_BUTTON,
        part ? "px-1" : "w-6",
        on
          ? "border-[#e6c200] bg-[#faebb0]/60 hover:bg-[#faebb0]"
          : "border-[#e3e5e4] hover:border-[#c9cccb] hover:bg-[#f4f4f4] [&_img]:opacity-40 [&_img]:grayscale hover:[&_img]:opacity-70",
      )}
    >
      <FigmaIcon src={identifierKeyIcon} />
      {part && <span className="text-[11px] font-medium leading-3 text-[#967700]">{part}</span>}
    </button>
  );
}

/** The type as a small dropdown button: its glyph and a chevron, opening the type menu. */
function TypeMenuButton({
  type,
  onChange,
  onClosed,
  menuProps,
  compact = false,
}: {
  // Figma's inline-edit row: a 20px bordered icon button, no chevron.
  compact?: boolean;
  type: string;
  onChange: (type: string) => void;
  // After the menu closes (e.g. to put the focus back on the name).
  onClosed?: () => void;
  menuProps?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Type: ${type}`}
          title={`Type: ${type} — click to change`}
          className={cn(
            compact
              ? "flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-[#e3e5e4] bg-white hover:bg-[#f4f4f4]"
              : cn(
                  ROW_BUTTON,
                  "border-[#e3e5e4] pl-1 pr-0.5 hover:border-[#c9cccb] hover:bg-[#f4f4f4]",
                ),
            open && "border-[#161919]",
          )}
        >
          <PropertyTypeGlyph type={type} color="#6d7472" />
          {!compact && <ChevronDown className="size-3 text-[#6d7472]" strokeWidth={2} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        {...menuProps}
        align="end"
        onCloseAutoFocus={(event) => {
          if (!onClosed) return;
          event.preventDefault();
          window.setTimeout(onClosed, 0);
        }}
        className="w-40 rounded-[6px] border-[#e3e5e4] bg-white p-1 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]"
      >
        <div role="listbox" aria-label="Property type" className="flex flex-col">
          {PROPERTY_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === type}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className="flex h-8 items-center gap-2 rounded-[4px] px-2 text-left text-[14px] leading-5 text-[#161919] hover:bg-[#f4f4f4]"
            >
              <PropertyTypeGlyph type={option} color="#6d7472" />
              <span className="min-w-0 flex-1 truncate">{option}</span>
              {option === type && <Check className="size-4 text-[#161919]" strokeWidth={1.75} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ROW =
  "relative flex h-[34px] shrink-0 items-center gap-1.5 rounded-[4px] border bg-white py-1 pl-3 pr-1.5";
// Not reviewed yet — it's still being written — so its status is a plain grey dot.
const DRAFT_DOT = <span className="mr-0.5 size-1.5 shrink-0 rounded-full bg-[#c9cccb]" />;
const NAME_INPUT =
  "min-w-0 flex-1 bg-transparent text-[14px] leading-6 text-[#080a09] outline-none placeholder:text-[#9ea3a2]";

/**
 * A new, blank Property row (a list's + / Add property): type its name in place. The key makes it
 * an Identifier (beside `currentIdentifier`, a key part of a composite identifier), the type
 * button opens the type menu. Enter adds it and starts another; a press outside adds it too,
 * or — still unnamed — just closes the row, as does Esc.
 */
export function PropertyDraftRow({
  onSubmit,
  onClose,
  currentIdentifier,
}: {
  onSubmit: (draft: NewPropertyDraft) => void;
  onClose: () => void;
  currentIdentifier?: string | undefined;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("string");
  const [identifier, setIdentifier] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (next: boolean) => {
    if (!name.trim()) {
      onClose();
      return;
    }
    onSubmit({ name, type, isIdentifier: identifier });
    if (!next) {
      onClose();
      return;
    }
    setName("");
    setType("string");
    setIdentifier(false);
    inputRef.current?.focus();
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest(`[${DRAFT_ATTR}]`)) return;
      submitRef.current(false);
    };
    // Capture: the canvas stops presses from bubbling (its own pan / selection handling).
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <div
      {...{ [DRAFT_ATTR]: "" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={cn(ROW, "border-[#161919]")}
    >
      {DRAFT_DOT}
      <input
        ref={inputRef}
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Property name"
        aria-label="New property name"
        className={NAME_INPUT}
      />
      <IdentifierToggle
        on={identifier}
        currentIdentifier={currentIdentifier}
        onToggle={() => {
          setIdentifier((on) => !on);
          inputRef.current?.focus();
        }}
      />
      <TypeMenuButton
        type={type}
        onChange={setType}
        // Back to the name, so Enter adds it.
        onClosed={() => inputRef.current?.focus()}
        menuProps={{ [DRAFT_ATTR]: "" }}
      />
    </div>
  );
}

/**
 * A Property of an Entity Type that's still being created: everything stays editable in place —
 * its name (applied on Enter / blur), Identifier key, and type — and it can be removed.
 */
export function PropertyEditRow({
  property,
  part,
  currentIdentifier,
  onChange,
  onRemove,
}: {
  property: Property;
  // Its key part number, in a composite identifier.
  part?: number | undefined;
  currentIdentifier?: string | undefined;
  onChange: (patch: { name?: string; type?: string; isIdentifier?: boolean }) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(property.name);
  useEffect(() => setName(property.name), [property.name]);
  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) setName(property.name);
    else if (trimmed !== property.name) onChange({ name: trimmed });
  };
  const identifier = isIdentifierProperty(property);
  return (
    <div
      data-property-id={property.id}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        ROW,
        "group/editprop border-[#e3e5e4] transition-colors hover:border-[#c9cccb] focus-within:border-[#161919]",
      )}
    >
      {DRAFT_DOT}
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setName(property.name);
            window.setTimeout(() => (event.target as HTMLInputElement).blur(), 0);
          }
        }}
        aria-label={`Property name: ${property.name}`}
        className={NAME_INPUT}
      />
      <IdentifierToggle
        on={identifier}
        part={part}
        currentIdentifier={identifier ? undefined : currentIdentifier}
        onToggle={() => onChange({ isIdentifier: !identifier })}
      />
      <TypeMenuButton type={property.type} onChange={(type) => onChange({ type })} />
      <button
        type="button"
        aria-label={`Remove ${property.name}`}
        title="Remove"
        onClick={onRemove}
        className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-[#6d7472] opacity-0 transition-opacity hover:bg-[#f4f4f4] hover:text-[#161919] focus-visible:opacity-100 group-hover/editprop:opacity-100"
      >
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

/**
 * A Property row being edited in place (Figma 466:88737, "Editing mode"): its name in an input, the
 * Identifier key (filled while on), its type, and Enter to apply. Enter or a press outside applies;
 * Esc cancels.
 */
export function PropertyInlineEditor({
  property,
  onApply,
  onClose,
}: {
  property: Property;
  onApply: (patch: { name?: string; type?: string; isIdentifier?: boolean }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(property.name);
  const [type, setType] = useState(property.type);
  const [identifier, setIdentifier] = useState(isIdentifierProperty(property));
  const inputRef = useRef<HTMLInputElement>(null);
  const apply = () => {
    const patch: { name?: string; type?: string; isIdentifier?: boolean } = {};
    const trimmed = name.trim();
    if (trimmed && trimmed !== property.name) patch.name = trimmed;
    if (type !== property.type) patch.type = type;
    if (identifier !== isIdentifierProperty(property)) patch.isIdentifier = identifier;
    if (Object.keys(patch).length > 0) onApply(patch);
    onClose();
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest(`[${DRAFT_ATTR}]`)) return;
      applyRef.current();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <div
      {...{ [DRAFT_ATTR]: "" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="flex shrink-0 items-center gap-1 rounded-[6px] border border-[#e3e5e4] bg-white py-1.5 pl-1.5 pr-2"
    >
      <input
        ref={inputRef}
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        aria-label="Property name"
        className="min-w-0 flex-1 bg-transparent pr-1 text-[14px] leading-5 text-[#080a09] outline-none"
      />
      <button
        type="button"
        aria-pressed={identifier}
        aria-label={identifier ? "Identifier — click to unset" : "Make it the identifier"}
        title={identifier ? "Identifier" : "Make it the identifier"}
        onClick={() => {
          setIdentifier((on) => !on);
          inputRef.current?.focus();
        }}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
          identifier
            ? "border-[#161919] bg-[#161919]"
            : "border-[#e3e5e4] bg-white hover:bg-[#f4f4f4] [&_img]:opacity-50 [&_img]:grayscale",
        )}
      >
        <FigmaIcon src={identifier ? identifierKeyOnIcon : identifierKeyIcon} />
      </button>
      <TypeMenuButton
        compact
        type={type}
        onChange={setType}
        onClosed={() => inputRef.current?.focus()}
        menuProps={{ [DRAFT_ATTR]: "" }}
      />
      <button
        type="button"
        aria-label="Apply"
        title="Apply (Enter)"
        onClick={apply}
        className="flex size-5 shrink-0 items-center justify-center rounded-[6px] hover:bg-[#f4f4f4]"
      >
        <Check className="size-4 text-[#6d7472]" strokeWidth={1.75} />
      </button>
    </div>
  );
}
