import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { FigmaIcon } from "@/components/detail/list-controls";
import chevronDownSmallIcon from "@/assets/icons/chevron-down-small-16.svg";
import { cn } from "@/lib/utils";
import {
  buildConfirmPlan,
  entityReview,
  propertyReview,
  relationReview,
  tableMappingCompleteness,
  tableColumnUsage,
  mappingStatus,
  RELATION_NOT_MAPPED_REASON,
  IDENTIFIER_UNMAPPED_ERROR_REASON,
  MISSING_IDENTIFIER_ERROR_REASON,
  ENTITY_UNMAPPED_IDENTIFIER_REASON,
  type ConfirmIssue,
  type Entity,
  type Relation,
  type SearchResultRef,
  type TableSchema,
} from "@/lib/mock-data";
import { type HistoryInspection, type HistoryLogEntry, type RestoreOutcome } from "@/lib/app-state";
import {
  EntitiesIcon,
  PropertiesIcon,
  RelationsIcon,
  TablesIcon,
  ColumnsIcon,
  IssueWarningIcon,
  IssueErrorIcon,
} from "./nav-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GlobalSearchPalette } from "./GlobalSearchPalette";
import { HistoryPanel } from "./HistoryPanel";
import { PublishReview } from "./PublishReview";
import type { SaveStatus } from "@/lib/app-state";
import type { DatasetReview, PublishJob } from "@/lib/publish";
import { Loader2 } from "lucide-react";

/** One "X/Y" MAPPING STATUS pill — "how mapped is my ontology?", a persistent, ontology-wide
 * completeness fact. `mapped` = how many of this category are wired to a source column (directly,
 * for Properties, or transitively for Entities/Relations — see the `counts` useMemo below for
 * exactly what "mapped" means per category). Deliberately has NOTHING to do with review status or
 * Confidence: renaming/confirming/declining a suggestion never moves these numbers, and neither
 * does dragging the Confidence slider in the AI Review bar — only an actual mapping change
 * (connect/disconnect a Property, which cascades to its owning Entity and that Entity's
 * Relations) does. Icon + label stay muted regardless of completeness — a full 100% doesn't get
 * an `--ok` success-color callout here. */
function CountPill({
  icon,
  label,
  mapped,
  total,
}: {
  icon: React.ReactNode;
  label: string;
  mapped: number;
  total: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]"
        >
          <span className="whitespace-nowrap text-sm text-muted-foreground">{label}</span>
          <span className="whitespace-nowrap text-sm text-[#161919]">
            {mapped}/{total}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>
          {mapped} of {total} {label.toLowerCase()} mapped
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

type CountKey = "entities" | "properties" | "relations" | "tables" | "columns";
type Counts = Record<CountKey, { mapped: number; total: number }>;

const COUNT_PILL_META: Record<CountKey, { icon: React.ReactNode; label: string }> = {
  entities: { icon: <EntitiesIcon />, label: "Entity types" },
  properties: { icon: <PropertiesIcon />, label: "Properties" },
  relations: { icon: <RelationsIcon />, label: "Relations" },
  tables: { icon: <TablesIcon />, label: "Tables" },
  columns: { icon: <ColumnsIcon />, label: "Columns" },
};

/** All 5 pills together, scoped to the whole ontology — the same GLOBAL review context in both
 * Overview and Detail. Stats and Confidence are properties of the whole review session, not of
 * whichever Entity/Table Detail happens to be anchored on right now. */
const ALL_COUNT_KEYS: CountKey[] = ["entities", "properties", "relations", "tables", "columns"];

/** The live review-progress pills for whichever `keys` are relevant right now, in the exact
 * order/spacing Figma shows. */
function CountPills({ counts, keys }: { counts: Counts; keys: CountKey[] }) {
  return (
    <div className="flex shrink-0 items-center gap-4 px-2">
      {keys.map((key) => {
        const meta = COUNT_PILL_META[key];
        return (
          <CountPill
            key={key}
            icon={meta.icon}
            label={meta.label}
            mapped={counts[key].mapped}
            total={counts[key].total}
          />
        );
      })}
    </div>
  );
}

/** Resolves one `ConfirmIssue` to the object name / object type this popover shows for it —
 * deliberately NOT `issue.name` for a Relation (that's the Relation's own custom name, e.g.
 * "places" — meaningless out of context here) or the raw `"Entity — Property"` string
 * `buildConfirmPlan` uses for a Property issue (a different separator/format than this popover's
 * own "Entity · Property" convention) — both are re-derived from live `entities`/`relations`
 * instead, so this popover's own display format stays independent of whatever `buildConfirmPlan`
 * happens to format its `name` field as for its own (different) caller, the old Confirm dialog. */
function issueDisplayInfo(
  issue: ConfirmIssue,
  entities: Entity[],
  relations: Relation[],
): { name: string; type: string } {
  if (issue.itemKind === "entity") {
    return { name: issue.name, type: "Entity Type" };
  }
  if (issue.itemKind === "relation") {
    const relation = relations.find((r) => r.id === issue.id);
    const fromName = entities.find((e) => e.id === relation?.from)?.name || "Untitled entity";
    const toName = entities.find((e) => e.id === relation?.to)?.name || "Untitled entity";
    return { name: `${fromName} → ${toName}`, type: "Relation" };
  }
  // property
  for (const e of entities) {
    const p = e.properties.find((x) => x.id === issue.id);
    if (p)
      return {
        name: `${e.name || "Untitled entity"} · ${p.name || "Untitled property"}`,
        type: "Property",
      };
  }
  return { name: issue.name, type: "Property" };
}

/** The one navigation action every issue row performs — reuses `SearchResultRef`/
 * `onSelectSearchResult` wholesale (the exact same dispatch Search/History results already use)
 * rather than inventing a second pan/zoom/highlight mechanism: Overview's own `searchFocus`
 * reaction already pans+zooms to an Entity/Relation and highlights it while de-emphasizing
 * unrelated content, and `selectSearchResult` already re-navigates Editing to the right anchor
 * when a Detail workspace is open. Returns `null` only if a Property issue's own owning Entity
 * can no longer be found (the item was deleted after this issue list was computed). */
function issueSearchRef(issue: ConfirmIssue, entities: Entity[]): SearchResultRef | null {
  if (issue.itemKind === "entity") return { kind: "entity", id: issue.id };
  if (issue.itemKind === "relation") return { kind: "relation", id: issue.id };
  for (const e of entities) {
    if (e.properties.some((p) => p.id === issue.id)) {
      return { kind: "property", entityId: e.id, propertyId: issue.id };
    }
  }
  return null;
}

/** The fixed sentence `buildConfirmPlan` prefixes every Relation issue with when it's blocked
 * purely by a connected Entity Type's own Error (never a Relation's own independent error) — see
 * that function's own `blockingEntity` comment. Matched only so `issueTypeLabel` below can label
 * it distinctly ("Blocked by Error"); never re-derives or changes which Relations get it. */
const CASCADE_RELATION_PREFIX =
  "Resolve errors in connected Entity Types before confirming this Relation.";

/** The user-facing "kind of problem" label for an issue — a pure presentation classification of
 * the SAME `reason` text `buildConfirmPlan` already computed (via `propertyStatus`/`entityStatus`/
 * a hand-authored `warningReason`/`errorReason`), never a new validation rule of its own. The two
 * automatic Identifier rules match on their own exported constants exactly; everything else is a
 * hand-authored sentence from the seed data, matched loosely by its own recognizable phrasing so
 * this keeps working if that wording is tweaked slightly. Falls back to a generic label rather
 * than throwing or rendering blank for any reason this doesn't yet recognize. */
function issueTypeLabel(reason: string): string {
  if (reason === IDENTIFIER_UNMAPPED_ERROR_REASON || reason === ENTITY_UNMAPPED_IDENTIFIER_REASON) {
    return "Unmapped Identifier";
  }
  if (reason === MISSING_IDENTIFIER_ERROR_REASON) return "Missing Identifier";
  if (reason === RELATION_NOT_MAPPED_REASON) return "Not mapped yet";
  if (reason.startsWith(CASCADE_RELATION_PREFIX)) return "Blocked by Error";
  if (/rename it to something like|doesn't say what this represents/i.test(reason)) {
    return "Naming Issue";
  }
  if (/overlaps with the existing|duplicates/i.test(reason)) return "Possible Duplicate";
  if (/stored type/i.test(reason) && /changed/i.test(reason)) return "Type Mismatch";
  if (/dedicated table/i.test(reason)) return "No Dedicated Table";
  return "Needs Review";
}

type IssueSeverity = "warning" | "error";

/** The Warning/Error navbar control + its Issues popover — ontology-wide validation attention
 * states (a required Relation name, an unmapped Identifier, a low-confidence mapping, ...),
 * deliberately independent of mapping completeness/Confidence/Suggestions (see the counts pills
 * and Confidence score above, which answer a different question: "how much review is left,"
 * not "what needs attention"). A lightweight issue navigator, not a dashboard: two severity tabs,
 * a flat scannable list, click a row to jump straight to the offending object on the canvas. */
function IssuesControl({
  errors,
  warnings,
  entities,
  relations,
  onSelectIssue,
  openSignal = 0,
}: {
  openSignal?: number;
  errors: ConfirmIssue[];
  warnings: ConfirmIssue[];
  entities: Entity[];
  relations: Relation[];
  /** Distinct from plain Search/History navigation — see app-state's own `selectIssue` doc
   * comment: this ALSO pins the clicked issue as a persistent cross-mode inspection target, so
   * entering Editing Mode afterward (by whatever path) still opens with it selected and its
   * Inspector open, not just a one-off Overview highlight. */
  onSelectIssue: (ref: SearchResultRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<IssueSeverity>("warning");
  const containerRef = useRef<HTMLDivElement>(null);
  // Opened from elsewhere (the Publish confirmation): on the Errors tab when there are any.
  useEffect(() => {
    if (openSignal === 0) return;
    setTab(errors.length > 0 ? "error" : "warning");
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new request
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleSelectIssue = (issue: ConfirmIssue) => {
    const ref = issueSearchRef(issue, entities);
    if (!ref) return;
    onSelectIssue(ref);
    setOpen(false);
  };

  const list = tab === "warning" ? warnings : errors;
  const emptyLabel = tab === "warning" ? "No warnings" : "No errors";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Show warnings and errors"
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 rounded-[4px] px-2 transition-colors",
          open ? "bg-black/[0.08]" : "hover:bg-accent",
        )}
      >
        <span className="flex shrink-0 items-center gap-[5px]">
          <IssueWarningIcon color={warnings.length > 0 ? "#EAB308" : "#909090"} size={18} />
          <span className="w-fit max-w-[26px] whitespace-nowrap text-left text-sm leading-none text-foreground tabular-nums">
            {warnings.length}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <IssueErrorIcon color={errors.length > 0 ? "#EF4444" : "#909090"} size={18} />
          <span className="w-fit max-w-[26px] whitespace-nowrap text-left text-sm leading-none text-foreground tabular-nums">
            {errors.length}
          </span>
        </span>
      </button>
      {/* Figma: node 201:59576 (Warnings tab active) / 203:59750 (Errors tab active). */}
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 flex w-80 flex-col overflow-hidden rounded-[18px] border border-[rgba(28,28,24,0.08)] bg-white shadow-[0px_2px_4px_0px_rgba(17,22,31,0.08),0px_18px_40px_-14px_rgba(17,22,31,0.3)]">
          <div className="flex shrink-0 items-center gap-1 border-b border-[rgba(28,28,24,0.08)] p-2">
            {(["warning", "error"] as const).map((s) => {
              const active = tab === s;
              const count = s === "warning" ? warnings.length : errors.length;
              const activeColor = s === "warning" ? "#CA8A04" : "#DC2626";
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTab(s)}
                  className={cn(
                    "flex flex-1 items-center justify-between rounded-[8px] px-2 py-1 text-sm transition-colors",
                    active
                      ? "bg-black/[0.08] text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span className="flex items-center gap-1">
                    {s === "warning" ? (
                      <IssueWarningIcon color={active ? activeColor : "#6D7472"} size={18} />
                    ) : (
                      <IssueErrorIcon color={active ? activeColor : "#6D7472"} size={18} />
                    )}
                    {s === "warning" ? "Warnings" : "Errors"}
                  </span>
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex max-h-[70vh] min-h-0 flex-col overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                {emptyLabel}
              </p>
            ) : (
              list.map((issue) => {
                const display = issueDisplayInfo(issue, entities, relations);
                return (
                  <button
                    key={`${issue.itemKind}:${issue.id}`}
                    type="button"
                    onClick={() => handleSelectIssue(issue)}
                    className="group flex w-full shrink-0 items-start gap-3 border-b border-[rgba(28,28,24,0.06)] px-2 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "w-[3px] shrink-0 self-stretch rounded-[10px]",
                        tab === "warning" ? "bg-[#CA8A04]" : "bg-destructive",
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-start gap-1 text-xs leading-5">
                        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                          {display.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                          {display.type}
                        </span>
                      </span>
                      <span className="truncate text-xs leading-5 text-foreground">
                        {issueTypeLabel(issue.reason)}
                      </span>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {issue.reason}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-start pt-0.5">
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The persistent GLOBAL app chrome above both the Overview canvas and the Editing workspace —
 * matches the Figma reference (Overview: node 98:11645; Detail: node 95:9122) as a starting
 * point. A single row: title + ontology-level actions, the 5-pill MAPPING STATUS row ("how mapped
 * is my ontology?" — see `counts` below), then Issues/History/Search. Identical in both Overview
 * and Editing, except the breadcrumb: in Editing it reads "Ontology › Edit ontology", and
 * "Ontology" is the way back to the Overview (Figma 328:30072).
 *
 * The AI Suggestion review workflow (Confidence score, "N suggestions"/Suggestions-in-range,
 * Select all in range, Generate Suggestions) is DELIBERATELY NOT here any more — it now lives in
 * `AiReviewBar`, floating over the canvas itself (rendered by `OverviewCanvas`/`DetailView`, next
 * to the existing `SuggestionSelectionBar`), because it answers a different question ("what AI
 * suggestions do I want to review?") than this Header's Mapping Status pills ("how mapped is my
 * ontology?"). Confidence must never move a single number in this Header — seeing that
 * independence hold is the whole point of keeping the two controls physically apart. Search
 * (`GlobalSearchPalette`) is real — one search across the whole Ontology + Data model, staying in
 * this exact spot across the Overview/Editing switch. There is no global Confirm/Save action —
 * Suggestions are Accepted/Declined individually via the contextual selection bar instead. This
 * whole component sits in its own explicit stacking level (`relative z-40` below) so its own
 * floating pieces — the Issues popover, History panel, and Search palette — always paint above
 * the canvas underneath, regardless of the z-index any canvas overlay happens to use.
 */
export function Header({
  entities,
  relations,
  tables,
  onSelectSearchResult,
  onSelectIssue,
  historyLog,
  historyPanelOpen,
  onHistoryPanelOpenChange,
  historyInspection,
  historyInspectionHoveredNumber,
  onEnterHistoryInspection,
  onExitHistoryInspection,
  onToggleHistoryChangeSelected,
  onHistoryHoverChange,
  onRestoreSelectedHistoryChanges,
  onToggleHistoryGroupSelected,
  editing = false,
  onExitEditing,
  saveStatus,
  onSave,
  canOpenPublish,
  publishReviewOpen,
  onPublishReviewOpenChange,
  datasetReviews,
  publishJobs,
  onPublishDatasets,
  publishQueue,
}: {
  entities: Entity[];
  relations: Relation[];
  tables: TableSchema[];
  /** What happens when a Global Search result (or a History change's own "locate on the canvas"
   * button — see `HistoryPanel`, which reuses this exact same dispatch) is chosen — see
   * app-state's own `selectSearchResult` doc comment for the full Overview-vs-Editing navigation
   * this drives. */
  onSelectSearchResult: (ref: SearchResultRef) => void;
  /** What happens when a Warning/Error row in the Issues popover is chosen — see app-state's own
   * `selectIssue` doc comment. Distinct from `onSelectSearchResult` above: this ALSO pins the
   * issue as a persistent cross-mode inspection target (`app.issueInspection`), so entering
   * Editing Mode afterward by any path still opens with it selected and its Inspector open. */
  onSelectIssue: (ref: SearchResultRef) => void;
  /** The GLOBAL "what changed" activity feed — see `HistoryPanel`/app-state's own `HistoryLogEntry`
   * doc comment for why this lives at the Header level (a floating utility, not a workspace
   * sidebar) rather than inside the Editing workspace or either of its side panels. */
  historyLog: HistoryLogEntry[];
  /** Whether History Mode's panel is open at all — see app-state's own `historyPanelOpen` doc
   * comment. */
  historyPanelOpen: boolean;
  onHistoryPanelOpenChange: (open: boolean) => void;
  /** The event currently open in the panel's own inspection detail view (or `null`) — see
   * app-state's own `HistoryInspection` doc comment. Overview's canvas reads this same value to
   * draw each change's numbered marker and historical-value overlay, so panel and canvas always
   * agree on exactly what's being inspected. */
  historyInspection: HistoryInspection | null;
  historyInspectionHoveredNumber: number | null;
  onEnterHistoryInspection: (entryId: string) => void;
  onExitHistoryInspection: () => void;
  onToggleHistoryChangeSelected: (number: number) => void;
  onHistoryHoverChange: (number: number | null) => void;
  onRestoreSelectedHistoryChanges: () => RestoreOutcome;
  onToggleHistoryGroupSelected: (group: number) => void;
  /** In the Editing workspace the breadcrumb reads "Ontology › Edit ontology", and "Ontology"
   * goes back to the Overview (Figma 347:71909). */
  editing?: boolean;
  onExitEditing?: (() => void) | undefined;
  saveStatus: SaveStatus;
  onSave: () => void;
  canOpenPublish: boolean;
  publishReviewOpen: boolean;
  onPublishReviewOpenChange: (open: boolean) => void;
  datasetReviews: DatasetReview[];
  publishJobs: Record<string, PublishJob>;
  onPublishDatasets: (tables: string[]) => void;
  publishQueue: string[];
}) {
  // Still needed for the Issues popover below (Warning/Error attention states) — the old global
  // Confirm dialog this used to also gate is gone; AI Suggestions are now Accepted/Declined
  // individually via the selection bar, and their own eligibility/in-range math now lives in
  // `AiReviewBar`, not here.
  const confirmPlan = useMemo(() => buildConfirmPlan(entities, relations), [entities, relations]);
  // Bumped by the Publish confirmation's "View warnings and errors" to open the issues list.
  const [issuesOpenSignal, setIssuesOpenSignal] = useState(0);

  // MAPPING STATUS — "how mapped is my ontology?" a persistent, ontology-wide completeness fact,
  // 100% independent of review status/Confidence (see this file's own `CountPill` doc comment).
  // Properties are the ground truth (`property.mapping !== null`); Entities/Relations are derived
  // from their Properties so the whole row tells one consistent structural story:
  //   - Entity "mapped" = ALL of its own properties are mapped (`entityMappingCompleteness`,
  //     already defined in mock-data.ts for exactly this) — a partially-mapped Entity still counts
  //     as not-yet-mapped, the same "full vs. partial vs. unmapped" rule tables already use.
  //   - Relation "mapped" = BOTH endpoint Entities are fully mapped. Relations have no mapping
  //     field of their own in this data model (they're a graph edge between Entities, not a
  //     property→column pointer) — mapping-completeness for a Relation can only be a transitive
  //     fact about the two Entities it connects.
  const counts = useMemo(() => {
    // Totals count what exists in the ontology — accepted items, not suggestions: accepting a
    // suggestion adds to the total, mapping it adds to the mapped count.
    const isMapped = (p: Entity["properties"][number]) =>
      p.mappings.some((m) => mappingStatus(m) === "mapped");
    const acceptedEntities = entities.filter((e) => entityReview(e) === "confirmed");
    const acceptedProperties = entities.flatMap((e) =>
      e.properties.filter((p) => propertyReview(p) === "confirmed"),
    );
    // An Entity Type is mapped once every one of its Properties has a mapping.
    const entitiesMapped = acceptedEntities.filter(
      (e) => e.properties.length > 0 && e.properties.every(isMapped),
    ).length;
    const entitiesTotal = acceptedEntities.length;
    const propertiesTotal = acceptedProperties.length;
    const propertiesMapped = acceptedProperties.filter(isMapped).length;
    const acceptedRelations = relations.filter((r) => relationReview(r) === "confirmed");
    const relationsTotal = acceptedRelations.length;
    const relationsMapped = acceptedRelations.filter((r) =>
      (r.mappings ?? []).some((m) => m.status === "mapped"),
    ).length;

    // Tables n/m counts ANY table with at least one confirmed mapping — unlike Entities above,
    // which requires ALL of its own properties mapped. A Table is a source object with no
    // lifecycle of its own (see mock-data's own `MappingStatus` doc); Tables n/m answers "how many
    // source tables has confirmation work actually touched", not "how many are fully done" — that
    // per-table completeness fact is what `tableMappingStatus`'s own "partial"/"full" states (used
    // for the Table's own badge, not this count) already cover.
    const tablesTotal = tables.length;
    const tablesMapped = tables.filter(
      (t) => tableMappingCompleteness(t.name, entities).mapped > 0,
    ).length;

    let columnsTotal = 0;
    let columnsMapped = 0;
    tables.forEach((t) => {
      const usage = tableColumnUsage(t.name, entities);
      columnsTotal += usage.length;
      usage.forEach((column) => {
        // A column with only Suggested-mapping mappers doesn't count — same "confirmed only"
        // rule as `tableMappingCompleteness` above, so Tables/Columns/Entities/Properties all
        // describe one consistent fact (see this block's own doc comment).
        const isMapped = column.mappedBy.some((mapping) => mapping.status === "mapped");
        if (isMapped) columnsMapped += 1;
      });
    });

    return {
      entities: { mapped: entitiesMapped, total: entitiesTotal },
      properties: { mapped: propertiesMapped, total: propertiesTotal },
      relations: { mapped: relationsMapped, total: relationsTotal },
      tables: { mapped: tablesMapped, total: tablesTotal },
      columns: { mapped: columnsMapped, total: columnsTotal },
    };
  }, [entities, relations, tables]);

  return (
    // z-40, not z-30: the canvas's own floating "Search focus" pill (OverviewCanvas.tsx) also
    // uses z-30, and since this root and that pill's nearest positioned ancestors are otherwise
    // unindexed (z-index: auto — they don't open their own stacking context), an equal z-index
    // falls back to DOM order, where the canvas (rendered after this Header) would win and could
    // sit on top of — and swallow clicks meant for — any of this Header's own popovers (the new
    // Issues popover included). z-40 gives this whole component's floating pieces an unambiguous
    // win instead of a DOM-order coin flip.
    <div className="relative z-40 flex shrink-0 flex-col bg-white">
      {/* Row 1 (Figma 347:71907) — workspace selector + breadcrumb, then the 5 live Stats pills,
          Issues, and History/Search on the right. */}
      <div className="flex h-14 w-full shrink-0 items-center justify-between border-b border-[#e3e5e4] px-4">
        <div className="flex shrink-0 items-center gap-4">
          {/* Figma 347:71908: a split "Product ▾ | V5 ▾" workspace selector — decorative, there is
              only ever this one workspace and version. */}
          <div
            aria-hidden="true"
            className="flex h-8 shrink-0 items-center overflow-hidden rounded-[4px] border border-[#e3e5e4] bg-white p-px"
          >
            <span className="flex h-full items-center gap-0.5 rounded-l-[2px] bg-[#fafafa] pl-2.5 pr-1.5 text-[14px] font-medium leading-6 text-[#161919]">
              Product
              <FigmaIcon src={chevronDownSmallIcon} />
            </span>
            <span className="flex h-full items-center gap-0.5 border-l border-[#e3e5e4] pl-[9px] pr-1 text-[14px] font-medium leading-6 text-[#161919]">
              V5
              <FigmaIcon src={chevronDownSmallIcon} />
            </span>
          </div>
          <nav aria-label="Breadcrumb" className="flex shrink-0 items-center">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={onExitEditing}
                  className="whitespace-nowrap text-[14px] leading-5 text-[#6d7472] hover:text-[#161919] hover:underline"
                >
                  Ontology
                </button>
                <span className="flex size-6 items-center justify-center text-[#6d7472]">
                  <ChevronRight className="size-4" strokeWidth={1.5} />
                </span>
                <span
                  aria-current="page"
                  className="whitespace-nowrap text-[14px] leading-5 text-[#6d7472]"
                >
                  Edit ontology
                </span>
              </>
            ) : (
              <span
                aria-current="page"
                className="whitespace-nowrap text-[14px] leading-5 text-[#6d7472]"
              >
                Ontology
              </span>
            )}
          </nav>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          <CountPills counts={counts} keys={ALL_COUNT_KEYS} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex shrink-0 items-center gap-1">
            <GlobalSearchPalette
              entities={entities}
              relations={relations}
              tables={tables}
              onSelectResult={onSelectSearchResult}
            />
            <HistoryPanel
              entries={historyLog}
              panelOpen={historyPanelOpen}
              onPanelOpenChange={onHistoryPanelOpenChange}
              inspection={historyInspection}
              hoveredNumber={historyInspectionHoveredNumber}
              onInspectEvent={onEnterHistoryInspection}
              onExitInspection={onExitHistoryInspection}
              onToggleChange={onToggleHistoryChangeSelected}
              onToggleGroup={onToggleHistoryGroupSelected}
              entities={entities}
              relations={relations}
              onHoverChange={onHistoryHoverChange}
              onLocate={onSelectSearchResult}
              onRestore={onRestoreSelectedHistoryChanges}
            />
          </div>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          <IssuesControl
            errors={confirmPlan.errors}
            warnings={confirmPlan.warnings}
            entities={entities}
            relations={relations}
            onSelectIssue={onSelectIssue}
            openSignal={issuesOpenSignal}
          />
          <div className="mx-1 h-4 w-px shrink-0 bg-border" />
          <SaveButton status={saveStatus} onSave={onSave} />
          <PublishButton
            enabled={canOpenPublish}
            jobs={publishJobs}
            onOpen={() => onPublishReviewOpenChange(true)}
          />
          <PublishReview
            open={publishReviewOpen}
            onOpenChange={onPublishReviewOpenChange}
            reviews={datasetReviews}
            jobs={publishJobs}
            queue={publishQueue}
            onPublish={onPublishDatasets}
            onViewIssues={() => {
              onPublishReviewOpenChange(false);
              setIssuesOpenSignal((n) => n + 1);
            }}
          />
        </div>
      </div>
    </div>
  );
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: "Save",
  saving: "Saving…",
  autosaved: "Autosaved!",
  saved: "Saved!",
  failed: "Save failed · Retry",
};
/** Saves pending Draft changes now; between saves, it shows how the last one went. Changes are
 * also saved automatically — both save the same Draft, neither publishes. */
function SaveButton({ status, onSave }: { status: SaveStatus; onSave: () => void }) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={status === "saving"}
      aria-live="polite"
      className={cn(
        "flex h-8 min-w-[64px] shrink-0 items-center justify-center gap-1 rounded-[6px] border px-3 text-[13px] font-medium transition-colors",
        status === "failed"
          ? "border-[#f15b15] bg-[#ffe6db] text-[#9c461e] hover:bg-[#ffd9c8]"
          : "border-[#e3e5e4] bg-white text-[#1c1c18] hover:bg-[#f4f4f4]",
        (status === "saved" || status === "autosaved") && "text-[#318F5A]",
        status === "saving" && "cursor-default text-[#707070]",
      )}
    >
      {status === "saving" && <Loader2 className="size-3.5 animate-spin" />}
      {SAVE_LABEL[status]}
    </button>
  );
}

/** Opens the Publish review; it doesn't publish by itself. Shows a dataset being published. */
function PublishButton({
  enabled,
  jobs,
  onOpen,
}: {
  enabled: boolean;
  jobs: Record<string, PublishJob>;
  onOpen: () => void;
}) {
  const active = Object.values(jobs).find(
    (job) => job.phase === "publishing" || job.phase === "ingesting",
  );
  const button = (
    <button
      type="button"
      onClick={onOpen}
      disabled={!enabled}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-[#1c1c18] px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {active && <Loader2 className="size-3.5 animate-spin" />}
      {active
        ? `${active.table} · ${active.phase === "publishing" ? "Publishing…" : "Ingestion in progress…"}`
        : "Publish"}
    </button>
  );
  if (enabled) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>Nothing ready to publish — fix the errors first.</p>
      </TooltipContent>
    </Tooltip>
  );
}
