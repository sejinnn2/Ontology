import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchOntologyAndData,
  searchResultCount,
  type Entity,
  type Relation,
  type SearchResult,
  type SearchResultRef,
  type TableSchema,
} from "@/lib/mock-data";
import {
  EntitiesIcon,
  PropertiesIcon,
  RelationsIcon,
  TablesIcon,
  ColumnsIcon,
} from "@/components/nav/nav-icons";

type ResultGroupKey = "entities" | "properties" | "relations" | "tables" | "columns";

const GROUP_META: Record<ResultGroupKey, { label: string; icon: React.ReactNode }> = {
  entities: { label: "Entity Types", icon: <EntitiesIcon /> },
  properties: { label: "Properties", icon: <PropertiesIcon /> },
  relations: { label: "Relations", icon: <RelationsIcon /> },
  tables: { label: "Data Tables", icon: <TablesIcon /> },
  columns: { label: "Columns", icon: <ColumnsIcon /> },
};
const GROUP_ORDER: ResultGroupKey[] = ["entities", "properties", "relations", "tables", "columns"];

const refKey = (ref: SearchResultRef): string => {
  switch (ref.kind) {
    case "entity":
      return `entity:${ref.id}`;
    case "property":
      return `property:${ref.entityId}:${ref.propertyId}`;
    case "relation":
      return `relation:${ref.id}`;
    case "table":
      return `table:${ref.name}`;
    case "column":
      return `column:${ref.table}:${ref.column}`;
  }
};

/**
 * The GLOBAL search entry point — one search across the whole Ontology + Data model (Entity
 * Types, Properties, Relations, Data Tables, Columns), not a per-panel local filter. Lives in the
 * Header next to Confidence/Filter and stays in that exact spot whether the workspace below is
 * Overview or a contained Editing session — see app-state's own `searchFocus`/`selectSearchResult`
 * doc comments for what actually happens when a result is chosen; this component only owns
 * finding and presenting results, never what picking one does to the workspace. A floating
 * palette anchored under the Search button, not a full-screen command-K overlay — deliberately no
 * tabs, no Recents/Assets/Plugins sections, just an input and grouped results, per the spec this
 * was built against. */
export function GlobalSearchPalette({
  entities,
  relations,
  tables,
  onSelectResult,
}: {
  entities: Entity[];
  relations: Relation[];
  tables: TableSchema[];
  onSelectResult: (ref: SearchResultRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    // Autofocus on open, same beat a real command palette opens on — the whole point is typing
    // immediately, not clicking into a field first.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const results = useMemo(
    () => searchOntologyAndData(entities, relations, tables, query),
    [entities, relations, tables, query],
  );
  const totalCount = searchResultCount(results);

  // One flat, ordered list across every group — what Up/Down/Enter actually step through, so
  // keyboard selection always agrees with the grouped list on screen regardless of which group a
  // highlighted row happens to sit in.
  const flatResults = useMemo(
    () => GROUP_ORDER.flatMap((key) => results[key].map((r) => ({ groupKey: key, result: r }))),
    [results],
  );
  const [highlighted, setHighlighted] = useState(0);
  useEffect(() => setHighlighted(0), [query]);

  const choose = useCallback(
    (ref: SearchResultRef) => {
      onSelectResult(ref);
      close();
    },
    [onSelectResult, close],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatResults.length > 0) setHighlighted((i) => (i + 1) % flatResults.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatResults.length > 0) {
        setHighlighted((i) => (i - 1 + flatResults.length) % flatResults.length);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = flatResults[highlighted];
      if (picked) choose(picked.result.ref);
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Search ontology & data"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-[4px] transition-colors",
          open ? "bg-[#00ded8]/10 text-[#00ded8]" : "text-[#171b22] hover:bg-accent",
        )}
      >
        <SearchIcon className="size-[18px]" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-2xl border border-[rgba(28,28,24,0.08)] bg-white shadow-[var(--shadow-node-lift)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(28,28,24,0.08)] px-3 py-2.5">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search ontology & data..."
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2">
            {query.trim() === "" && (
              <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                Search Entity Types, Properties, Relations, Data Tables, and Columns.
              </p>
            )}
            {query.trim() !== "" && totalCount === 0 && (
              <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                No matches for "{query.trim()}".
              </p>
            )}
            {query.trim() !== "" &&
              GROUP_ORDER.map((groupKey) => {
                const groupResults = results[groupKey];
                if (groupResults.length === 0) return null;
                const meta = GROUP_META[groupKey];
                return (
                  <div key={groupKey} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span className="size-3 shrink-0 [&_svg]:size-3">{meta.icon}</span>
                      {meta.label}
                    </div>
                    {groupResults.map((result) => {
                      const flatIndex = flatResults.findIndex(
                        (f) => refKey(f.result.ref) === refKey(result.ref),
                      );
                      const isHighlighted = flatIndex === highlighted;
                      return (
                        <button
                          key={refKey(result.ref)}
                          type="button"
                          onMouseEnter={() => setHighlighted(flatIndex)}
                          onClick={() => choose(result.ref)}
                          className={cn(
                            "flex w-full min-w-0 shrink-0 items-baseline gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px]",
                            isHighlighted ? "bg-[#00ded8]/10" : "hover:bg-accent",
                          )}
                        >
                          {result.parentLabel && (
                            <span className="shrink-0 truncate text-muted-foreground">
                              {result.parentLabel} →
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {result.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
