import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { tableMappingCompleteness, tableMappingStatus, type Entity, type Relation, type TableSchema } from "@/lib/mock-data";
import { EntitiesIcon, PropertiesIcon, RelationsIcon, TablesIcon, ColumnsIcon } from "./nav-icons";

/** One "X remaining / Y total" pill in the review-progress row. Icon + label are muted by
 * default; the count switches to the app's existing `--ok` success color once nothing is left to
 * review for that category — reusing the same "done" signal as the mapping-completeness badges
 * elsewhere, rather than inventing a new one. */
function CountPill({ icon, label, remaining, total }: { icon: React.ReactNode; label: string; remaining: number; total: number }) {
  const done = remaining === 0;
  return (
    <div className="flex items-center gap-1.5 rounded-[10px] border border-transparent px-2.5 py-1.5">
      <span className={cn("size-3.5 shrink-0", done ? "text-ok" : "text-muted-foreground")}>{icon}</span>
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={cn("text-[12px]", done ? "text-ok" : "text-foreground")}>{remaining}/{total} remaining</span>
    </div>
  );
}

/**
 * The persistent app chrome above both the Overview canvas and Detail view — matches the Figma
 * reference (nodes 15:17601 + 16:20299) exactly: a title/actions row, and a confidence-score
 * slider + 5 review-progress pills below it. The "Generate Suggestions"/"Confirm" buttons and the
 * confidence slider are visual-only for now (no backing feature yet); the 5 count pills show real
 * live counts derived from the same status/mapping data the rest of the app already uses.
 */
export function Header({ entities, relations, tables }: { entities: Entity[]; relations: Relation[]; tables: TableSchema[] }) {
  const counts = useMemo(() => {
    const entitiesTotal = entities.length;
    const entitiesRemaining = entities.filter((e) => e.status !== "confirmed").length;

    let propertiesTotal = 0;
    let propertiesRemaining = 0;
    entities.forEach((e) => {
      propertiesTotal += e.properties.length;
      propertiesRemaining += e.properties.filter((p) => p.status !== "confirmed").length;
    });

    const relationsTotal = relations.length;
    const relationsRemaining = relations.filter((r) => r.status !== "confirmed").length;

    const tablesTotal = tables.length;
    const tablesRemaining = tables.filter((t) => tableMappingStatus(t.name, entities) !== "full").length;

    let columnsTotal = 0;
    let columnsMapped = 0;
    tables.forEach((t) => {
      const c = tableMappingCompleteness(t.name, entities);
      columnsTotal += c.total;
      columnsMapped += c.mapped;
    });
    const columnsRemaining = columnsTotal - columnsMapped;

    return {
      entities: { remaining: entitiesRemaining, total: entitiesTotal },
      properties: { remaining: propertiesRemaining, total: propertiesTotal },
      relations: { remaining: relationsRemaining, total: relationsTotal },
      tables: { remaining: tablesRemaining, total: tablesTotal },
      columns: { remaining: columnsRemaining, total: columnsTotal },
    };
  }, [entities, relations, tables]);

  return (
    <div className="flex shrink-0 flex-col bg-white">
      {/* Row 1 — title + primary actions. Visual only: no suggestion-generation or confirm-all
          workflow exists yet. */}
      <div className="flex h-[59px] shrink-0 items-center justify-between border-b border-[rgba(28,28,24,0.08)] px-4">
        <span className="text-[20px] font-medium tracking-[-0.45px] text-[#1c1c18]">Ontology</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#1c1c18] bg-[#1c1c18] px-2 py-1.5 text-[13px] tracking-[-0.08px] text-white transition-opacity hover:opacity-90"
          >
            Generate Suggestions
          </button>
          <button
            type="button"
            className="rounded-lg border border-[#a5efee] bg-[#00b8db] px-[18px] py-1.5 text-[13px] tracking-[-0.08px] text-white transition-opacity hover:opacity-90"
          >
            Confirm
          </button>
        </div>
      </div>

      {/* Row 2 — confidence threshold (visual only) + live review-progress pills. */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[rgba(28,28,24,0.08)] px-4">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[#007595]">Confidence score</span>
          <span className="text-[12px] text-muted-foreground">0%</span>
          <div className="relative flex h-4 w-[112px] items-center">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#d4d4d8]">
              <div className="h-1.5 w-1/2 bg-[#00b8db]" />
            </div>
            <span className="absolute left-0 size-4 -translate-x-1/2 rounded-full border border-[#00b8db]/60 bg-[#f9fafb] shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_0_rgba(0,0,0,0.1)]" />
            <span className="absolute left-1/2 size-4 -translate-x-1/2 rounded-full border border-[#00b8db]/60 bg-[#f9fafb] shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_0_rgba(0,0,0,0.1)]" />
          </div>
          <span className="text-[12px] text-muted-foreground">50%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CountPill icon={<EntitiesIcon />} label="Entities" remaining={counts.entities.remaining} total={counts.entities.total} />
          <CountPill icon={<PropertiesIcon />} label="Properties" remaining={counts.properties.remaining} total={counts.properties.total} />
          <CountPill icon={<RelationsIcon />} label="Relations" remaining={counts.relations.remaining} total={counts.relations.total} />
          <CountPill icon={<TablesIcon />} label="Tables" remaining={counts.tables.remaining} total={counts.tables.total} />
          <CountPill icon={<ColumnsIcon />} label="Columns" remaining={counts.columns.remaining} total={counts.columns.total} />
        </div>
      </div>
    </div>
  );
}
