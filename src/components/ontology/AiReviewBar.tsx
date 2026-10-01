import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildConfirmPlan,
  entityReview,
  mappingStatus,
  propertyReview,
  relationReview,
  type Entity,
  type Property,
  type Relation,
  type TableSchema,
} from "@/lib/mock-data";
import { suggestionKey, type ConfidenceRange } from "@/lib/app-state";
import {
  EntitiesIcon,
  PropertiesIcon,
  RelationsIcon,
  TablesIcon,
  ColumnsIcon,
} from "@/components/nav/nav-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Limits which items the bar counts and selects — Editing mode passes one so the numbers cover
 * only what its lanes show, not the whole ontology. Tables/Columns follow `mapping`, since they're
 * derived from mapping suggestions. Omitted = everything (Overview). */
export type SuggestionScope = {
  entity: (entity: Entity) => boolean;
  property: (owner: Entity, property: Property) => boolean;
  relation: (relation: Relation) => boolean;
  mapping: (owner: Entity, property: Property) => boolean;
};

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/** The "Generate Suggestions" button's own glyph — exact SVG export from the Figma reference
 * (node 176:45301), inlined the same way as the Header's other Figma-exported icons rather than
 * left pointing at Figma's short-lived asset URL. */
function SparkleIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.31205 1.57135C7.34204 1.4108 7.42722 1.2658 7.55285 1.16146C7.6785 1.05712 7.83667 1 7.99999 1C8.16329 1 8.32147 1.05712 8.44711 1.16146C8.57274 1.2658 8.65793 1.4108 8.68792 1.57135L9.42344 5.46102C9.47568 5.73756 9.61007 5.99193 9.80906 6.19092C10.0081 6.38993 10.2624 6.52431 10.539 6.57656L14.4287 7.31208C14.5891 7.34207 14.7341 7.42725 14.8385 7.55288C14.9429 7.67853 15 7.8367 15 8.00002C15 8.16333 14.9429 8.32151 14.8385 8.44714C14.7341 8.57278 14.5891 8.65797 14.4287 8.68795L10.539 9.42348C10.2624 9.47572 10.0081 9.61011 9.80906 9.8091C9.61007 10.0081 9.47568 10.2625 9.42344 10.539L8.68792 14.4287C8.65793 14.5893 8.57274 14.7342 8.44711 14.8385C8.32147 14.9429 8.16329 15 7.99999 15C7.83667 15 7.6785 14.9429 7.55285 14.8385C7.42722 14.7342 7.34204 14.5893 7.31205 14.4287L6.57653 10.539C6.52428 10.2625 6.3899 10.0081 6.1909 9.8091C5.9919 9.61011 5.73754 9.47572 5.461 9.42348L1.57135 8.68795C1.4108 8.65797 1.2658 8.57278 1.16146 8.44714C1.05712 8.32151 1 8.16333 1 8.00002C1 7.8367 1.05712 7.67853 1.16146 7.55288C1.2658 7.42725 1.4108 7.34207 1.57135 7.31208L5.461 6.57656C5.73754 6.52431 5.9919 6.38993 6.1909 6.19092C6.3899 5.99193 6.52428 5.73756 6.57653 5.46102L7.31205 1.57135Z"
        fill={color}
      />
    </svg>
  );
}

/** A real draggable dual-thumb range — identical drag mechanics to every other hand-rolled
 * draggable in this app (zoom, node repositioning, toolbox drag): each thumb tracks its own
 * pointer drag against the track's own bounding rect rather than a native `<input type="range">`,
 * so it matches this app's own look pixel-for-pixel. Filters which Entity/Property/Relation
 * Suggestions currently fall "in range" everywhere Confidence is read — see this file's own doc
 * comment on why that's a DIFFERENT question from Mapping Status, which this slider never touches. */
function ConfidenceSlider({
  range,
  onChange,
}: {
  range: ConfidenceRange;
  onChange: (range: ConfidenceRange) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragThumb = useRef<"min" | "max" | null>(null);

  const pctFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return clampPct(((clientX - rect.left) / rect.width) * 100);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const thumb = dragThumb.current;
      if (!thumb) return;
      const pct = pctFromClientX(e.clientX);
      onChange(
        thumb === "min"
          ? { min: Math.min(pct, range.max), max: range.max }
          : { min: range.min, max: Math.max(pct, range.min) },
      );
    };
    const onUp = () => {
      dragThumb.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [range, onChange, pctFromClientX]);

  // Clicking (not dragging) the bare track jumps whichever thumb is nearer straight to that spot
  // — standard slider behavior, and the only way to move a thumb without grabbing it precisely.
  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (e.target !== trackRef.current) return;
    const pct = pctFromClientX(e.clientX);
    const nearerMin = Math.abs(pct - range.min) <= Math.abs(pct - range.max);
    onChange(
      nearerMin
        ? { min: Math.min(pct, range.max), max: range.max }
        : { min: range.min, max: Math.max(pct, range.min) },
    );
  };

  // Figma 353:132518: "Confidence score", then the track (100×8, #f4f4f4, a #161919 range with
  // 20px white thumbs ringed 2px #161919) with each thumb's score in a muted pill beside it.
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="whitespace-nowrap text-[14px] leading-6 text-[#080a09]">
        Confidence score
      </span>
      <ScoreBadge value={range.min} />
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative flex h-5 w-[100px] shrink-0 cursor-pointer items-center"
      >
        <div className="pointer-events-none h-2 w-full rounded-full bg-[#f4f4f4]">
          <div
            className="h-2 rounded-full bg-[#161919]"
            style={{ marginLeft: `${range.min}%`, width: `${range.max - range.min}%` }}
          />
        </div>
        {(["min", "max"] as const).map((thumb) => (
          <span
            key={thumb}
            role="slider"
            tabIndex={0}
            aria-label={thumb === "min" ? "Minimum confidence" : "Maximum confidence"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={thumb === "min" ? range.min : range.max}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragThumb.current = thumb;
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 1;
              const delta = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
              if (!delta) return;
              e.preventDefault();
              const current = thumb === "min" ? range.min : range.max;
              const next = clampPct(current + delta);
              onChange(
                thumb === "min"
                  ? { min: Math.min(next, range.max), max: range.max }
                  : { min: range.min, max: Math.max(next, range.min) },
              );
            }}
            style={{ left: `${thumb === "min" ? range.min : range.max}%` }}
            className="absolute size-5 -translate-x-1/2 cursor-grab rounded-full border-2 border-[#161919] bg-white outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8] active:cursor-grabbing"
          />
        ))}
      </div>
      <ScoreBadge value={range.max} />
    </div>
  );
}

/** A thumb's score (Figma Badge_Confidence): a muted 12px pill, at least 32px wide. */
function ScoreBadge({ value }: { value: number }) {
  return (
    <span className="flex min-w-8 shrink-0 items-center justify-center rounded-full bg-[#f4f4f4] px-1.5 py-px text-[12px] leading-4 tabular-nums text-[#6d7472]">
      {value}%
    </span>
  );
}

type BreakdownKey = "entities" | "properties" | "relations" | "tables" | "columns";
type BreakdownCounts = Record<BreakdownKey, { inRange: number; total: number }>;

const BREAKDOWN_META: Record<BreakdownKey, { icon: React.ReactNode; label: string }> = {
  entities: { icon: <EntitiesIcon />, label: "Entities" },
  properties: { icon: <PropertiesIcon />, label: "Properties" },
  relations: { icon: <RelationsIcon />, label: "Relations" },
  tables: { icon: <TablesIcon />, label: "Tables" },
  columns: { icon: <ColumnsIcon />, label: "Columns" },
};
// Each stat's own tooltip sentence — deliberately NOT one template with a noun swapped in, since
// Tables/Columns are counting a different THING than Entities/Properties/Relations are (see this
// component's own doc comment on how their counts are derived): an Entity/Property/Relation
// suggestion genuinely IS the item being counted ("N of M Entity suggestions"), but a Table has no
// suggestion of its own to count — what's being counted is how many Tables/Columns HAVE a pending,
// in-range mapping suggestion pointing at them. Phrasing it as "N of M Table mapping suggestions"
// reads as if there were N/M discrete mapping suggestions, when N/M is actually a count of Tables
// (or Columns) themselves — this spells that out instead.
function breakdownTooltipText(key: BreakdownKey, inRange: number, total: number): string {
  switch (key) {
    case "entities":
      return `${inRange} of ${total} Entity suggestions`;
    case "properties":
      return `${inRange} of ${total} Property suggestions`;
    case "relations":
      return `${inRange} of ${total} Relation suggestions`;
    case "tables":
      return `${inRange} of ${total} Tables have a column mapping suggestion`;
    case "columns":
      return `${inRange} of ${total} Columns have a mapping suggestion`;
  }
}
const BREAKDOWN_ORDER: BreakdownKey[] = [
  "entities",
  "properties",
  "relations",
  "tables",
  "columns",
];

/**
 * The AI Suggestion review workflow's own floating control — "what AI suggestions do I want to
 * review?" — deliberately a completely separate question from the Header's Mapping Status pills
 * above ("how mapped is my ontology?"). Both happen to show an n/m count per the same 5 object
 * categories, which is exactly why they live far apart on screen and never share a computation:
 * Mapping Status counts MAPPED items out of all items, entirely independent of Confidence or
 * review status; this bar counts SUGGESTIONS — items whose status is exactly "suggested" —
 * currently inside the Confidence range, out of every suggested item available for that category.
 * A Warning or Error is a real issue to resolve, not a pending AI suggestion, so neither ever
 * contributes to these counts, even though (per `buildConfirmPlan`) a Warning is still eligible to
 * confirm — "can this be confirmed" and "is this a suggestion" are answered separately in this
 * component. Changing Confidence here must never move a single Mapping Status number in the
 * navbar.
 *
 * Tables/Columns have no Confidence or review status of their own (they're raw source schema, not
 * an AI proposal — see `TableSchema`'s own doc comment) — a table/column's own "suggestion" count
 * is derived from whichever Property mappings with status exactly "suggested" currently point at
 * it, the same "borrow the mapping side's state" approach Mapping Status's own Tables/Columns
 * pills already use (see Header.tsx's own `counts`), just swapping "mapped at all" for "mapped by
 * a suggested, in-range mapping."
 */
const ALL_IN_SCOPE: SuggestionScope = {
  entity: () => true,
  property: () => true,
  relation: () => true,
  mapping: () => true,
};

export function AiReviewBar({
  entities,
  relations,
  tables,
  confidenceRange,
  onConfidenceRangeChange,
  onSelectSuggestionsInRange,
  scope,
}: {
  entities: Entity[];
  relations: Relation[];
  tables: TableSchema[];
  confidenceRange: ConfidenceRange;
  onConfidenceRangeChange: (range: ConfidenceRange) => void;
  onSelectSuggestionsInRange: (keys: string[]) => void;
  scope?: SuggestionScope | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  const inConfidenceRange = useCallback(
    (confidence: number | undefined) => {
      if (confidence == null) return true;
      const pct = Math.round(confidence * 100);
      return pct >= confidenceRange.min && pct <= confidenceRange.max;
    },
    [confidenceRange],
  );
  const inScope: SuggestionScope = scope ?? ALL_IN_SCOPE;

  // `buildConfirmPlan` groups every not-yet-confirmed Entity/Property/Relation into `eligible`
  // (Suggested or Warning — Warning never blocks a confirm, only Error does) or `errors`. That
  // split answers "can this be confirmed," which is what `eligibleKeys` below (and the "Select all
  // in range" button) act on — a different question from "is this a suggestion," which the
  // breakdown further down answers by filtering to status exactly "suggested" instead, since a
  // Warning or Error is a real issue to look at, not a pending AI suggestion.
  const confirmPlan = buildConfirmPlan(entities, relations);

  const eligibleKeys: string[] = [];
  confirmPlan.eligible.entityIds.forEach((id) => {
    const e = entities.find((x) => x.id === id);
    if (e && inScope.entity(e) && inConfidenceRange(e.confidence)) {
      eligibleKeys.push(suggestionKey({ kind: "entity", id }));
    }
  });
  confirmPlan.eligible.propertyIds.forEach(({ entityId, propertyId }) => {
    const owner = entities.find((e) => e.id === entityId);
    const property = owner?.properties.find((p) => p.id === propertyId);
    if (
      owner &&
      property &&
      inScope.property(owner, property) &&
      inConfidenceRange(property.confidence)
    ) {
      eligibleKeys.push(suggestionKey({ kind: "property", entityId, propertyId }));
    }
  });
  confirmPlan.eligible.relationIds.forEach((id) => {
    const r = relations.find((x) => x.id === id);
    if (r && inScope.relation(r) && inConfidenceRange(r.confidence)) {
      eligibleKeys.push(suggestionKey({ kind: "relation", id }));
    }
  });
  entities.forEach((entity) => {
    entity.properties.forEach((property) => {
      if (!inScope.mapping(entity, property) || !inConfidenceRange(property.confidence)) return;
      property.mappings.forEach((m) => {
        if (mappingStatus(m) !== "suggested") return;
        eligibleKeys.push(
          suggestionKey({
            kind: "mapping",
            entityId: entity.id,
            propertyId: property.id,
            table: m.table,
            column: m.column,
          }),
        );
      });
    });
  });
  // Feeds only the "N more in range excluded" tooltip below — items blocked by an Error are never
  // in `eligibleKeys`, regardless of Confidence range.
  let errorsExcluded = 0;
  confirmPlan.errors.forEach((issue) => {
    let issueInRange = false;
    if (issue.itemKind === "entity") {
      const e = entities.find((x) => x.id === issue.id);
      issueInRange = !!e && inScope.entity(e) && inConfidenceRange(e.confidence);
    } else if (issue.itemKind === "relation") {
      const r = relations.find((x) => x.id === issue.id);
      issueInRange = !!r && inScope.relation(r) && inConfidenceRange(r.confidence);
    } else {
      const owner = entities.find((e) => e.properties.some((p) => p.id === issue.id));
      const property = owner?.properties.find((p) => p.id === issue.id);
      issueInRange =
        !!owner &&
        !!property &&
        inScope.property(owner, property) &&
        inConfidenceRange(property.confidence);
    }
    if (issueInRange) errorsExcluded += 1;
  });

  // The breakdown itself: strictly status === "suggested" per kind, via `entityStatus`/
  // `propertyStatus` (so the Identifier-unmapped auto-Error rule still excludes an entity/property
  // the same way it excludes it from `eligible` above) — computed independently of `confirmPlan`,
  // since Warnings belong to `eligible` there but must NOT be counted as suggestions here.
  let entitiesTotal = 0;
  let entitiesInRange = 0;
  entities.forEach((e) => {
    if (entityReview(e) !== "suggested" || !inScope.entity(e)) return;
    entitiesTotal += 1;
    if (inConfidenceRange(e.confidence)) entitiesInRange += 1;
  });
  let propertiesTotal = 0;
  let propertiesInRange = 0;
  entities.forEach((e) => {
    e.properties.forEach((p) => {
      if (propertyReview(p) !== "suggested" || !inScope.property(e, p)) return;
      propertiesTotal += 1;
      if (inConfidenceRange(p.confidence)) propertiesInRange += 1;
    });
  });
  let relationsTotal = 0;
  let relationsInRange = 0;
  relations.forEach((r) => {
    if (relationReview(r) !== "suggested" || !inScope.relation(r)) return;
    relationsTotal += 1;
    if (inConfidenceRange(r.confidence)) relationsInRange += 1;
  });

  // Tables/Columns: derived from every Property mapping whose own status is exactly "suggested",
  // grouped by which table/column it points at — see this component's own doc comment above.
  const tableGroups = new Map<string, { any: boolean; inRange: boolean }>();
  const columnGroups = new Map<string, { any: boolean; inRange: boolean }>();
  entities.forEach((e) => {
    e.properties.forEach((p) => {
      if (!inScope.mapping(e, p)) return;
      const inRange = inConfidenceRange(p.confidence);
      p.mappings.forEach((m) => {
        if (mappingStatus(m) !== "suggested") return;
        const tableKey = m.table;
        const columnKey = `${m.table}.${m.column}`;
        const tEntry = tableGroups.get(tableKey) ?? { any: false, inRange: false };
        tEntry.any = true;
        tEntry.inRange = tEntry.inRange || inRange;
        tableGroups.set(tableKey, tEntry);
        const cEntry = columnGroups.get(columnKey) ?? { any: false, inRange: false };
        cEntry.any = true;
        cEntry.inRange = cEntry.inRange || inRange;
        columnGroups.set(columnKey, cEntry);
      });
    });
  });
  let tablesTotal = 0;
  let tablesInRange = 0;
  tableGroups.forEach((g) => {
    tablesTotal += 1;
    if (g.inRange) tablesInRange += 1;
  });
  let columnsTotal = 0;
  let columnsInRange = 0;
  columnGroups.forEach((g) => {
    columnsTotal += 1;
    if (g.inRange) columnsInRange += 1;
  });

  const breakdown: BreakdownCounts = {
    entities: { inRange: entitiesInRange, total: entitiesTotal },
    properties: { inRange: propertiesInRange, total: propertiesTotal },
    relations: { inRange: relationsInRange, total: relationsTotal },
    tables: { inRange: tablesInRange, total: tablesTotal },
    columns: { inRange: columnsInRange, total: columnsTotal },
  };

  // The "N suggestions" pill's own number — deliberately the sum of ALL FIVE breakdown rows above
  // (Entities/Properties/Relations/Tables/Columns), not just `eligibleKeys.length` (which counts
  // items eligible to CONFIRM — Suggested and Warning together — rather than strictly items whose
  // status is "suggested"). This is the same total a user would get by adding up the expanded
  // breakdown themselves, so the collapsed number and its own expansion never disagree.
  const totalSuggestionsInRange =
    breakdown.entities.inRange +
    breakdown.properties.inRange +
    breakdown.relations.inRange +
    breakdown.tables.inRange +
    breakdown.columns.inRange;

  return (
    <div ref={containerRef} className="relative flex flex-col items-center">
      {expanded && (
        // Figma 362:232525: a purple-100 tab on top of the bar — purple labels, black counts.
        <div className="absolute bottom-full flex animate-[aiReviewReveal_180ms_ease-out] items-center gap-4 whitespace-nowrap rounded-t-[4px] border border-b-0 border-[#e3e5e4] bg-[#f3e8ff] px-2 py-[5px]">
          {BREAKDOWN_ORDER.map((key) => {
            const meta = BREAKDOWN_META[key];
            const { inRange, total } = breakdown[key];
            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="flex shrink-0 items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]"
                  >
                    <span className="size-4 shrink-0 text-[#7e22ce]">{meta.icon}</span>
                    <span className="text-sm leading-5 text-[#7e22ce]">{meta.label}</span>
                    <span className="text-sm leading-5 tabular-nums text-[#080a09]">
                      {inRange}/{total}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{breakdownTooltipText(key, inRange, total)}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-12 shrink-0 items-center gap-4 rounded-[4px] bg-white py-1 pl-4 pr-2 shadow-[0_0_1px_rgba(0,0,0,0.1),0_1px_4px_rgba(0,0,0,0.1)]"
      >
        <ConfidenceSlider range={confidenceRange} onChange={onConfidenceRangeChange} />
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              // Ghost button (Figma 353:132525): no border or fill until hovered / open.
              "flex h-8 min-w-[64px] shrink-0 items-center justify-center whitespace-nowrap rounded-[4px] px-3 text-sm font-medium text-[#161919] transition-colors",
              expanded ? "bg-[#e3e5e4]" : "hover:bg-[#f4f4f4]",
            )}
          >
            {totalSuggestionsInRange} suggestion{totalSuggestionsInRange === 1 ? "" : "s"}
          </button>
          <button
            type="button"
            onClick={() => onSelectSuggestionsInRange(eligibleKeys)}
            disabled={eligibleKeys.length === 0}
            // Outline button, no icon (Figma 353:132529's style).
            className="flex h-8 min-w-[64px] shrink-0 items-center justify-center whitespace-nowrap rounded-[4px] border border-[#e3e5e4] bg-white px-3 text-sm font-medium text-[#161919] transition-colors hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            Select all in range
          </button>
          {/* Visual-only, matching current behavior exactly — this prototype has no real
              AI-generation pipeline behind it yet (see the Header's own former copy of this same
              button, which was never wired to anything either); re-running it whenever the
              ontology or mappings change is the intended eventual behavior once one exists. */}
          <button
            type="button"
            className="flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] bg-[#161919] pl-2 pr-3 text-sm font-medium text-[#fafafa] transition-opacity hover:opacity-90"
          >
            <SparkleIcon color="#A78BFA" size={16} />
            Generate Suggestions
          </button>
        </div>
      </div>
    </div>
  );
}
