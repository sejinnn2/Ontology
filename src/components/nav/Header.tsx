import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Trash2, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildConfirmPlan,
  tableMappingCompleteness,
  tableMappingStatus,
  tableColumnUsage,
  type ConfirmIssue,
  type Entity,
  type Relation,
  type TableSchema,
} from "@/lib/mock-data";
import type { ConfidenceRange } from "@/lib/app-state";
import { EntitiesIcon, PropertiesIcon, RelationsIcon, TablesIcon, ColumnsIcon } from "./nav-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmEligibleIds = {
  entityIds: string[];
  propertyIds: { entityId: string; propertyId: string }[];
  relationIds: string[];
};

/** One row in the Confirm dialog's issue list — same name/reason `buildConfirmPlan` already
 * classified, just rendered. Warning and Error share this row shape but never share a color: the
 * icon/text tint is the only thing that tells them apart, matching the rest of the app's
 * warning/error styling (see StatusBadge). */
function IssueRow({ issue }: { issue: ConfirmIssue }) {
  const isError = issue.kind === "error";
  return (
    <li className="flex items-start gap-2 rounded-md bg-[#f8f8f8] px-2.5 py-2">
      {isError ? (
        <XIcon className="mt-0.5 size-3.5 shrink-0 text-[#9c461e]" />
      ) : (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#967700]" />
      )}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-[#171b22]">{issue.name}</p>
        <p className="text-[12px] leading-[1.35] text-[#707070]">{issue.reason}</p>
      </div>
    </li>
  );
}

/** The global Confirm action's validation dialog — opened by the Confirm button instead of
 * confirming everything immediately. Classifies every not-yet-confirmed Entity/Property/Relation
 * as Ready, Warning, or Error (see `buildConfirmPlan`) and always shows this summary first, even
 * when everything is Ready, so "Confirm" is never a silent bulk action. Warnings never block;
 * only Errors do — resolving the affected items is left to the user, who can either back out
 * ("Review warnings"/"Review errors") or proceed with whatever is currently eligible. */
function ConfirmDialog({
  open,
  onOpenChange,
  errors,
  warnings,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: ConfirmIssue[];
  warnings: ConfirmIssue[];
  onConfirm: () => void;
}) {
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm changes</DialogTitle>
          <DialogDescription>
            {!hasErrors && !hasWarnings && "All reviewed items are ready to confirm."}
            {!hasErrors &&
              hasWarnings &&
              "Some items have warnings. These items can still be confirmed, but may need review."}
            {hasErrors &&
              "Some items cannot be confirmed. Errors must be resolved before those affected items can be confirmed."}
          </DialogDescription>
        </DialogHeader>

        {(hasErrors || hasWarnings) && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 text-[13px] font-medium">
              {hasErrors && (
                <span className="flex items-center gap-1 text-[#9c461e]">
                  <XIcon className="size-3.5" /> {errors.length} error
                  {errors.length === 1 ? "" : "s"}
                </span>
              )}
              {hasWarnings && (
                <span className="flex items-center gap-1 text-[#967700]">
                  <AlertTriangle className="size-3.5" /> {warnings.length} warning
                  {warnings.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <ul className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto">
              {errors.map((issue) => (
                <IssueRow key={`${issue.itemKind}:${issue.id}`} issue={issue} />
              ))}
              {warnings.map((issue) => (
                <IssueRow key={`${issue.itemKind}:${issue.id}`} issue={issue} />
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="shrink-0 rounded-md border border-input px-3 py-1.5 text-[13px] font-medium text-foreground transition-opacity hover:opacity-80"
          >
            {hasErrors ? "Review errors" : hasWarnings ? "Review warnings" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="shrink-0 rounded-md bg-[#00b8db] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {hasErrors ? "Confirm eligible items only" : hasWarnings ? "Confirm anyway" : "Confirm"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One "X remaining / Y total" pill in the review-progress row. Icon + label are muted by
 * default; the count switches to the app's existing `--ok` success color once nothing is left to
 * review for that category — reusing the same "done" signal as the mapping-completeness badges
 * elsewhere, rather than inventing a new one. */
function CountPill({
  icon,
  label,
  remaining,
  total,
}: {
  icon: React.ReactNode;
  label: string;
  remaining: number;
  total: number;
}) {
  const done = remaining === 0;
  return (
    <div className="flex shrink-0 items-center gap-[2px] rounded-[10px] border border-transparent">
      <div className="flex items-center gap-1.5">
        <span className={cn("size-3.5 shrink-0", done ? "text-ok" : "text-[#707070]")}>{icon}</span>
        <span className="whitespace-nowrap text-[13px] text-[#707070]">{label}</span>
      </div>
      <span className={cn("whitespace-nowrap text-[13px]", done ? "text-ok" : "text-[#1e1e1e]")}>
        {remaining}/{total} remaining
      </span>
    </div>
  );
}

type Counts = Record<
  "entities" | "properties" | "relations" | "tables" | "columns",
  { remaining: number; total: number }
>;

/** The 5 live review-progress pills, in the exact order/spacing Figma shows. */
function CountPills({ counts }: { counts: Counts }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <CountPill
        icon={<EntitiesIcon />}
        label="Entities"
        remaining={counts.entities.remaining}
        total={counts.entities.total}
      />
      <CountPill
        icon={<PropertiesIcon />}
        label="Properties"
        remaining={counts.properties.remaining}
        total={counts.properties.total}
      />
      <CountPill
        icon={<RelationsIcon />}
        label="Relations"
        remaining={counts.relations.remaining}
        total={counts.relations.total}
      />
      <CountPill
        icon={<TablesIcon />}
        label="Tables"
        remaining={counts.tables.remaining}
        total={counts.tables.total}
      />
      <CountPill
        icon={<ColumnsIcon />}
        label="Columns"
        remaining={counts.columns.remaining}
        total={counts.columns.total}
      />
    </div>
  );
}

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/** A real draggable dual-thumb range — filters which Entities/Properties/Relations/Tables count
 * as "in range" everywhere confidence is shown (Overview's canvas + its own toolbox lists,
 * Detail's toolbox lists): out-of-range items are dimmed on the canvas and hidden from the lists,
 * the same "pure display filter" treatment as search and sort elsewhere in this app. Each thumb
 * tracks its own pointer drag against the track's own bounding rect — the same hand-rolled
 * pointerdown/pointermove/pointerup pattern used for every other draggable control in this app
 * (zoom, node repositioning, toolbox drag) — rather than a native `<input type="range">`, so it
 * matches everything else here pixel-for-pixel instead of introducing a second, browser-styled
 * slider look. */
function ConfidenceScore({
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

  return (
    <div className="flex shrink-0 items-center gap-4">
      <span className="whitespace-nowrap text-[13px] text-[#00b8db]">Confidence score</span>
      <span className="w-8 whitespace-nowrap text-right text-[13px] tabular-nums text-[#707070]">
        {range.min}%
      </span>
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative flex h-4 w-[112px] shrink-0 cursor-pointer items-center"
      >
        <div className="pointer-events-none h-1.5 w-full overflow-hidden rounded-full bg-[#d4d4d8]">
          <div
            className="h-1.5 bg-[#00b8db]"
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
            className="absolute size-4 -translate-x-1/2 cursor-grab rounded-full border border-[rgba(0,184,219,0.6)] bg-[#f9fafb] shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_0_rgba(0,0,0,0.1)] outline-none focus-visible:ring-2 focus-visible:ring-[#61B2FF] active:cursor-grabbing"
          />
        ))}
      </div>
      <span className="w-8 whitespace-nowrap text-[13px] tabular-nums text-[#707070]">
        {range.max}%
      </span>
    </div>
  );
}

/**
 * The persistent app chrome above both the Overview canvas and Detail view — matches the Figma
 * reference (Overview: node 98:11645; Detail: node 95:9122) exactly: a title/actions row, and a
 * confidence-score slider + 5 review-progress pills below it. The two frames share row 1
 * (title + actions) but lay row 2 out differently — see the comment above that row. The
 * "Generate Suggestions" button and the confidence slider are visual-only for now (no backing
 * feature yet); the 5 count pills show real live counts derived from the same status/mapping data
 * the rest of the app already uses. "Confirm" opens a validation dialog rather than confirming
 * immediately — see `ConfirmDialog` above — since there is no per-item Confirm button anywhere in
 * the app (Entity/Property/Relation/Table/Column alike); this is the only place confirmation ever
 * happens.
 *
 * In Detail, Figma merges "← Back" into this row (row 2) instead of a separate breadcrumb bar —
 * pass `onBack` to render it; the entity/table's own name still shows as that card's title inside
 * the canvas itself, so nothing about "what you're looking at" is actually lost.
 */
export function Header({
  entities,
  relations,
  tables,
  confirmItems,
  trashCount,
  confidenceRange,
  onConfidenceRangeChange,
  onBack,
}: {
  entities: Entity[];
  relations: Relation[];
  tables: TableSchema[];
  /** Applies the global Confirm dialog's outcome — flips exactly the given (already-eligible)
   * Entities/Properties/Relations to "confirmed" in one atomic pass. Owned by the caller since
   * it's the one with the underlying `updateEntity`/`updateProperty`/`updateRelation` mutations. */
  confirmItems: (ids: ConfirmEligibleIds) => void;
  /** Total items currently in Trash, shown as a badge on the button that links to the `/trash`
   * page — that page (not this component) owns the actual Trash content and Restore actions. */
  trashCount: number;
  /** The Confidence score slider's own value — lifted to app-state (not local to this component)
   * since Overview and Detail both read it to dim/hide out-of-range items on their own canvases
   * and toolbox lists. */
  confidenceRange: ConfidenceRange;
  onConfidenceRangeChange: (range: ConfidenceRange) => void;
  onBack?: () => void;
}) {
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const confirmPlan = useMemo(() => buildConfirmPlan(entities, relations), [entities, relations]);

  // Same "no confidence value renders as in range" rule Overview/Detail's own canvases already
  // use to dim/hide out-of-range items — applied here only to each pill's own "remaining" count
  // (never its total), so narrowing the Confidence score slider narrows "how many of these still
  // need attention, among what I'm currently looking at" without changing "how many exist" at all.
  const inConfidenceRange = useCallback(
    (confidence: number | undefined) => {
      if (confidence == null) return true;
      const pct = Math.round(confidence * 100);
      return pct >= confidenceRange.min && pct <= confidenceRange.max;
    },
    [confidenceRange],
  );

  const counts = useMemo(() => {
    const entitiesTotal = entities.length;
    const entitiesRemaining = entities.filter(
      (e) => e.status !== "confirmed" && inConfidenceRange(e.confidence),
    ).length;

    let propertiesTotal = 0;
    let propertiesRemaining = 0;
    entities.forEach((e) => {
      propertiesTotal += e.properties.length;
      propertiesRemaining += e.properties.filter(
        (p) => p.status !== "confirmed" && inConfidenceRange(p.confidence),
      ).length;
    });

    const relationsTotal = relations.length;
    const relationsRemaining = relations.filter(
      (r) => r.status !== "confirmed" && inConfidenceRange(r.confidence),
    ).length;

    const tablesTotal = tables.length;
    const tablesRemaining = tables.filter(
      (t) => tableMappingStatus(t.name, entities) !== "full" && inConfidenceRange(t.confidence),
    ).length;

    let columnsTotal = 0;
    let columnsRemaining = 0;
    tables.forEach((t) => {
      columnsTotal += tableMappingCompleteness(t.name, entities).total;
      const usage = tableColumnUsage(t.name, entities);
      t.columns.forEach((c) => {
        const isMapped = (usage.find((u) => u.name === c.name)?.mappedBy.length ?? 0) > 0;
        if (!isMapped && inConfidenceRange(c.confidence)) columnsRemaining += 1;
      });
    });

    return {
      entities: { remaining: entitiesRemaining, total: entitiesTotal },
      properties: { remaining: propertiesRemaining, total: propertiesTotal },
      relations: { remaining: relationsRemaining, total: relationsTotal },
      tables: { remaining: tablesRemaining, total: tablesTotal },
      columns: { remaining: columnsRemaining, total: columnsTotal },
    };
  }, [entities, relations, tables, inConfidenceRange]);

  return (
    <div className="flex shrink-0 flex-col bg-white">
      {/* Row 1 — title + primary actions. Visual only: no suggestion-generation or confirm-all
          workflow exists yet. */}
      <div className="flex w-full shrink-0 items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[20px] font-medium leading-[30px] tracking-[-0.45px] text-[#1c1c18]">
          Ontology
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/trash"
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-input px-2 py-1.5 text-[13px] leading-[19.5px] tracking-[-0.08px] text-foreground transition-colors hover:bg-accent"
          >
            <Trash2 className="size-3.5" /> Trash{trashCount > 0 ? ` (${trashCount})` : ""}
          </Link>
          <button
            type="button"
            className="shrink-0 rounded-[10px] border border-[#1c1c18] bg-[#1c1c18] px-2 py-1.5 text-[13px] leading-[19.5px] tracking-[-0.08px] text-white transition-opacity hover:opacity-90"
          >
            Generate Suggestions
          </button>
          <button
            type="button"
            onClick={() => setConfirmDialogOpen(true)}
            className="shrink-0 rounded-[10px] border border-[#00b8db] bg-[#00b8db] px-[18px] py-1.5 text-[13px] leading-[19.5px] tracking-[-0.08px] text-white transition-opacity hover:opacity-90"
          >
            Confirm
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        errors={confirmPlan.errors}
        warnings={confirmPlan.warnings}
        onConfirm={() => {
          confirmItems(confirmPlan.eligible);
          setConfirmDialogOpen(false);
        }}
      />

      {/* Row 2 — Overview has just the pills (left) and confidence score (right); Detail merges
          "← Back" in as the leftmost item instead, with the pills and confidence score both
          moving to the right, separated by a divider — matches the two Figma frames exactly
          rather than sharing one layout between them. */}
      <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-[rgba(28,28,24,0.08)] px-4 py-3">
        {onBack ? (
          <>
            <button
              type="button"
              onClick={onBack}
              className="flex shrink-0 items-center gap-1.5 rounded-[21px] border border-[#1c1c18] bg-white px-3 py-1 text-[13px] leading-[19.5px] tracking-[-0.08px] text-[#1c1c18] transition-opacity hover:opacity-70"
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <CountPills counts={counts} />
              <div className="flex shrink-0 items-start px-1">
                <div className="h-4 w-px shrink-0 bg-[#e1e3e6]" />
              </div>
              <ConfidenceScore range={confidenceRange} onChange={onConfidenceRangeChange} />
            </div>
          </>
        ) : (
          <>
            <CountPills counts={counts} />
            <ConfidenceScore range={confidenceRange} onChange={onConfidenceRangeChange} />
          </>
        )}
      </div>
    </div>
  );
}
