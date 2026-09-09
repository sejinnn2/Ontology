import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
 */
export function ConfidenceChip({ confidence }: { confidence: number | undefined }) {
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex shrink-0 cursor-default items-center justify-center gap-2.5 rounded-[10px] bg-black/[0.08] px-[6px] text-center text-[10px] font-normal leading-[16px] tracking-[-0.076px] text-[#3C3C3C] outline-none focus-visible:ring-2 focus-visible:ring-[#61B2FF]"
        >
          {pct != null ? `${pct}%` : "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-1">
        <p className="font-medium text-white">
          {pct != null ? `${pct}% confidence` : "No confidence score"}
        </p>
        <p className="text-[#B7BCC4]">
          {confidence != null
            ? aiReasoning(confidence)
            : "Schema discovery didn't produce a confidence signal for this."}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
