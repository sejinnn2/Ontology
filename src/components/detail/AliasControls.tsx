import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aliases in the mapping view — several occurrences of one Entity Type in a data table (a flight
 * row's departure and arrival Airport). The alias lives on each mapping (`ColumnRef.alias`); these
 * are the controls around it: naming the first two, picking one for a new connection, assigning
 * several at once, and a navigator that shows one alias's mappings at a time.
 */

export const normalizeAlias = (value: string) =>
  value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** A starting name from a column: `departure_airport_id` → `departure` (for Airport). */
export function guessAlias(column: string, entityName: string): string {
  const drop = new Set([
    "id",
    "code",
    "key",
    "no",
    "num",
    "number",
    ...entityName.toLowerCase().split(/[^a-z0-9]+/),
  ]);
  const kept = column
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part && !drop.has(part));
  return normalizeAlias(kept.join("_")) || normalizeAlias(column);
}

// Each alias's mark: muted, and apart from the review-status colors.
const TONES = ["#64748b", "#a16207", "#0f766e", "#9d4edd", "#be123c", "#4d7c0f"];
export const aliasTone = (aliases: string[], alias: string | undefined) =>
  alias ? TONES[Math.max(0, aliases.indexOf(alias)) % TONES.length]! : "#c9cccb";

const INPUT =
  "h-7 min-w-0 flex-1 rounded-[6px] border border-[#e3e5e4] px-2 text-[12px] outline-none focus:border-[#161919]";
const PRIMARY =
  "h-7 rounded-[6px] bg-[#1c1c18] px-2.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-30";
const SECONDARY =
  "h-7 rounded-[6px] border border-[#e3e5e4] px-2.5 text-[12px] font-medium text-[#161919] hover:bg-[#f4f4f4]";

/**
 * Naming the two occurrences an Identifier's second column makes: one alias for the column it
 * already had, one for the new column — both prefilled from the column names.
 */
export function AliasCreateForm({
  entityName,
  table,
  existingColumn,
  newColumn,
  othersCount,
  onCreate,
  onCancel,
}: {
  entityName: string;
  table: string;
  existingColumn: string;
  newColumn: string;
  // The other mappings of it in this table — they'll need an alias next.
  othersCount: number;
  onCreate: (existingAlias: string, newAlias: string) => void;
  onCancel: () => void;
}) {
  const [first, setFirst] = useState(() => guessAlias(existingColumn, entityName));
  const [second, setSecond] = useState(() => guessAlias(newColumn, entityName));
  const a = normalizeAlias(first);
  const b = normalizeAlias(second);
  const valid = !!a && !!b && a !== b;
  return (
    <form
      className="flex flex-col gap-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onCreate(a, b);
      }}
    >
      <div>
        <p className="text-[13px] font-medium leading-5 text-[#161919]">
          Two {entityName}s in each {table} row
        </p>
        <p className="text-[12px] leading-4 text-[#6d7472]">
          Name each one. Its other mappings here then go to one of them.
        </p>
      </div>
      {(
        [
          [existingColumn, first, setFirst],
          [newColumn, second, setSecond],
        ] as const
      ).map(([column, value, set], i) => (
        <label key={column} className="flex flex-col gap-1">
          <span className="truncate font-mono text-[11px] text-[#6d7472]">{column}</span>
          <span className="flex items-center gap-1">
            <span className="text-[12px] text-[#9ea3a2]">@</span>
            <input
              autoFocus={i === 1}
              value={value}
              onChange={(event) => set(event.target.value)}
              aria-label={`Alias for ${column}`}
              className={INPUT}
            />
          </span>
        </label>
      ))}
      {a && a === b && <p className="text-[11px] text-[#9c461e]">Give them different names.</p>}
      {othersCount > 0 && (
        <p className="rounded-[6px] bg-[#fafafa] px-2 py-1.5 text-[11px] leading-4 text-[#6d7472]">
          {othersCount} other mapping{othersCount === 1 ? "" : "s"} of {entityName} here will need
          an alias — you can assign {othersCount === 1 ? "it" : "them"} right after.
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={SECONDARY}>
          Cancel
        </button>
        <button type="submit" disabled={!valid} className={PRIMARY}>
          Create aliases
        </button>
      </div>
    </form>
  );
}

/** Which occurrence a new connection belongs to: an existing alias, a new one, or later. */
export function AliasPickList({
  entityName,
  propertyName,
  column,
  aliases,
  taken,
  allowNew,
  onPick,
}: {
  entityName: string;
  propertyName: string;
  column: string;
  aliases: string[];
  // Aliases this Property already has a column in.
  taken: string[];
  // A new alias (another occurrence) — only from its Identifier.
  allowNew: boolean;
  // `undefined`: connect now, assign later (it needs an alias).
  onPick: (alias: string | undefined) => void;
}) {
  const [draft, setDraft] = useState("");
  const next = normalizeAlias(draft);
  const row =
    "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] leading-5 transition-colors hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex flex-col p-1">
      <p className="px-2.5 pb-1 pt-2 text-[12px] leading-4 text-[#6d7472]">
        <span className="font-medium text-[#161919]">
          {propertyName} ← {column}
        </span>
        <br />
        Which {entityName} is it?
      </p>
      {aliases.map((alias) => (
        <button
          key={alias}
          type="button"
          disabled={taken.includes(alias)}
          onClick={() => onPick(alias)}
          className={row}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: aliasTone(aliases, alias) }}
          />
          <span className="flex-1 font-medium text-[#161919]">@{alias}</span>
          {taken.includes(alias) && (
            <span className="text-[11px] text-[#9ea3a2]">already mapped</span>
          )}
        </button>
      ))}
      {allowNew ? (
        <form
          className="flex items-center gap-1.5 px-1.5 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (next && !aliases.includes(next)) onPick(next);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Another ${entityName} — name it`}
            aria-label="New alias"
            className={INPUT}
          />
          <button
            type="submit"
            disabled={!next || aliases.includes(next)}
            aria-label="Add alias"
            className="flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-[#e3e5e4] hover:bg-[#f4f4f4] disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => onPick(undefined)} className={row}>
          <span className="flex-1 text-[#6d7472]">Assign later</span>
          <span className="text-[11px] text-[#9c461e]">needs an alias</span>
        </button>
      )}
    </div>
  );
}

/**
 * Shows the mappings one alias at a time (or the ones still needing one) — a way to look through
 * them, not the alias itself. Each alias says whether its identifier is mapped.
 */
export function AliasNavigator({
  aliases,
  view,
  onView,
  keyed,
  needing,
  onHover,
}: {
  aliases: string[];
  // "all", an alias, or "needs".
  view: string;
  onView: (view: string) => void;
  keyed: (alias: string) => boolean;
  needing: number;
  onHover: (alias: string | null) => void;
}) {
  const chip = (active: boolean) =>
    cn(
      "flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[12px] leading-4 transition-colors",
      active
        ? "border-[#161919] bg-[#161919] text-white"
        : "border-[#e3e5e4] bg-white text-[#3c3c3c] hover:border-[#9ea3a2]",
    );
  return (
    <div className="relative z-10 flex flex-wrap items-center gap-1 px-2.5 pb-2" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={view === "all"}
        onClick={() => onView("all")}
        className={chip(view === "all")}
      >
        All
      </button>
      {aliases.map((alias) => (
        <button
          key={alias}
          type="button"
          role="tab"
          aria-selected={view === alias}
          onClick={() => onView(view === alias ? "all" : alias)}
          onMouseEnter={() => onHover(alias)}
          onMouseLeave={() => onHover(null)}
          title={keyed(alias) ? "Identifier mapped" : "Identifier not mapped"}
          className={chip(view === alias)}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: aliasTone(aliases, alias) }}
          />
          @{alias}
          {keyed(alias) ? (
            <Check className="size-3 opacity-70" strokeWidth={2.5} />
          ) : (
            <span className={view === alias ? "text-[#ffb59a]" : "text-[#9c461e]"}>no id</span>
          )}
        </button>
      ))}
      {needing > 0 && (
        <button
          type="button"
          role="tab"
          aria-selected={view === "needs"}
          onClick={() => onView(view === "needs" ? "all" : "needs")}
          className={cn(
            chip(view === "needs"),
            view !== "needs" && "border-[#f15b15]/50 bg-[#ffe6db] text-[#9c461e]",
          )}
        >
          Needs alias · {needing}
        </button>
      )}
    </div>
  );
}

/** Several mapped columns selected: assign them to one alias at once. */
export function BulkAliasBar({
  count,
  aliases,
  onAssign,
  onClear,
}: {
  count: number;
  aliases: string[];
  onAssign: (alias: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      onPointerDown={(event) => event.stopPropagation()}
      className="flex items-center gap-1.5 rounded-[10px] border border-[rgba(28,28,24,0.08)] bg-white py-1.5 pl-3 pr-1.5 text-[12px] shadow-[var(--shadow-node-lift)]"
    >
      <span className="font-medium text-[#161919]">{count} selected</span>
      <span className="text-[#9ea3a2]">· Assign to</span>
      {aliases.map((alias) => (
        <button
          key={alias}
          type="button"
          onClick={() => onAssign(alias)}
          className="flex h-6 items-center gap-1.5 rounded-full border border-[#e3e5e4] px-2 hover:border-[#161919]"
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: aliasTone(aliases, alias) }}
          />
          @{alias}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-1 flex size-6 items-center justify-center rounded-[6px] text-[#6d7472] hover:bg-[#f4f4f4]"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
