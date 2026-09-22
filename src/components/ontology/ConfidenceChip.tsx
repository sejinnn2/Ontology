import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReasoningContent } from "@/lib/mock-data";

/** A short, confidence-bucketed sentence rather than one hand-written string per item — with 40+
 * properties/relations in the seed data, bucketing by confidence reads as genuinely explanatory
 * without requiring bespoke copy for every row. Exported so the Detail contextual panel's own "AI
 * Suggestion Reasoning" section, and the review-status icon's own tooltip (see StatusBadge), call
 * this exact same function — every surface that explains a suggestion must never disagree. */
export function aiReasoning(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.85)
    return `Strong match (${pct}%) — naming and type both align closely with the source.`;
  if (confidence >= 0.6)
    return `Likely match (${pct}%) — naming is similar, but the pattern isn't exact.`;
  return `Low-confidence guess (${pct}%) — only a weak naming or type signal was found.`;
}

/**
 * The Confidence indicator (Figma: "Confidence Level") — a small percentage chip, with a hover/
 * focus tooltip explaining the AI's suggestion. This is data-wise and visually separate from the
 * Status badge (icon + color, from `ReviewStatus`) — a "suggested" item can be high-confidence,
 * and a "warning"/"error" finding is never caused by low confidence, so this chip only ever shows
 * confidence + its reasoning. The status-specific "why is this a warning/error" text lives on the
 * Status badge's own tooltip instead (see StatusBadge) — kept there rather than duplicated here so
 * there's exactly one place per kind of information.
 *
 * Used for every kind of confidence in the app — Entity/Property/Relation (always a number) as
 * well as Table/Column (optional — schema discovery sometimes has no signal at all) — so this is
 * the one place "no confidence" renders as "—" with an honest "no data" tooltip instead of a
 * fabricated reasoning sentence.
 *
 * `reasoning`, when supplied, replaces the generic bucketed sentence with the actual per-kind
 * evidence (see `ReasoningContent`/`entityReasoningContent`/etc. in mock-data.ts) computed by
 * whichever caller has the real Entity/Property/Relation/Mapping context to derive it from — the
 * short single-line summary here (`reasoning`/`matchSummary`) is the same sentence a full "Why
 * this confidence score?" panel would open with, just without its own evidence table, which
 * doesn't fit this chip's small hover tooltip. Omitted entirely wherever only a bare
 * `confidence` number is in scope (e.g. the Overview<->Detail morph transition), which keeps the
 * original generic-but-honest `aiReasoning` text as a graceful fallback.
 */
export function ConfidenceChip({
  confidence,
  reasoning,
}: {
  confidence: number | undefined;
  reasoning?: ReasoningContent;
}) {
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  const summary = reasoning
    ? reasoning.kind === "mapping"
      ? reasoning.matchSummary
      : reasoning.reasoning
    : confidence != null
      ? aiReasoning(confidence)
      : "Schema discovery didn't produce a confidence signal for this.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex shrink-0 cursor-default items-center justify-center gap-2.5 rounded-[10px] bg-black/[0.08] px-[6px] text-center text-[10px] font-normal leading-[16px] tracking-[-0.076px] text-[#3C3C3C] outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]"
        >
          {pct != null ? `${pct}%` : "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-1">
        <p className="font-medium text-white">
          {pct != null ? `${pct}% confidence` : "No confidence score"}
        </p>
        <p className="text-[#B7BCC4]">{summary}</p>
      </TooltipContent>
    </Tooltip>
  );
}
