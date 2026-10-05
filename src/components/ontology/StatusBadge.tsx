import type { ReactNode } from "react";
import type { ReviewStatus } from "@/lib/mock-data";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import suggestedSmall from "@/assets/status/suggested-8.svg";
import suggestedLarge from "@/assets/status/suggested-12.svg";
import confirmedSmall from "@/assets/status/confirmed-8.svg";
import confirmedLarge from "@/assets/status/confirmed-12.svg";
import warningSmall from "@/assets/status/warning-8.svg";
import warningLarge from "@/assets/status/warning-12.svg";
import errorSmall from "@/assets/status/error-8.svg";
import errorLarge from "@/assets/status/error-12.svg";

/**
 * The review-status badge — a colored circle with a status glyph — shown on Entity Types,
 * Properties, and Relations wherever they appear (canvas nodes, toolbox rows, card headers).
 *
 * This is deliberately a different component from `MappingStatusBadge`: that one shows whether a
 * Table/Column is *mapped* (a completeness fact about data), while this one shows an item's own
 * *review status* (a fact about whether a person has looked at it) — Figma names both "New
 * suggestion" internally, but they answer different questions and must not be conflated.
 *
 * `status` is data (`ReviewStatus`, from mock-data) — never confuse it with the separate,
 * unrelated notion of *interaction* state (hover/active/dragging), which callers handle with
 * their own props (e.g. `emphasis`, `connectSourceSide`) entirely independently of this badge.
 * Figma's variant names ("Default", "Confirmed", "Warning", "Error") map 1:1 to review statuses
 * here ("Default" == `suggested`) — that naming is Figma's, not a cue to merge the two concepts.
 *
 * Only `suggested` and `confirmed` are ever produced by the app today. `warning` and `error` are
 * fully styled so the visual system is complete, but nothing currently assigns those statuses —
 * no trigger logic for them exists yet, by design.
 */

// Suggested/Confirmed badge colors match the Zaimler Figma spec (frame "Entity Triggered
// Editing", node 406:4814 — the `--purple/300`/`--purple/600` and `--cyan/200`/`--cyan/700`
// circle fill + icon color sampled directly off that frame's exported assets). Warning/Error
// are untouched: that frame doesn't produce either status, so there's no design evidence to
// update them from — see CLAUDE.md's Figma accent palette table.
// Status colors from the Zaimler Figma "Status" set (node 440:26406): the 6px dot, the icon's
// circle fill, and its glyph (the glyph's color is baked into its SVG asset). `border` is a
// separate, older accent used for Overview relation edges and isn't part of that set.
const STATUS_STYLE: Record<ReviewStatus, { border: string; badgeBg: string; dot: string }> = {
  suggested: { border: "#7c5eff", badgeBg: "#d8b4fe", dot: "#7e22ce" },
  confirmed: { border: "#0298b2", badgeBg: "#a5f3fc", dot: "#0891b2" },
  warning: { border: "#e6c200", badgeBg: "#fef08a", dot: "#ca8a04" },
  error: { border: "#f15b15", badgeBg: "#fecaca", dot: "#dc2626" },
};

// Glyphs exported from that Figma set: an 8px drawing for the 16px icon, and a 12px drawing for
// the 20px and 24px icons (each tuned to its size rather than one glyph scaled).
const STATUS_GLYPH: Record<ReviewStatus, { small: string; large: string }> = {
  suggested: { small: suggestedSmall, large: suggestedLarge },
  confirmed: { small: confirmedSmall, large: confirmedLarge },
  warning: { small: warningSmall, large: warningLarge },
  error: { small: errorSmall, large: errorLarge },
};

export function statusBorderColor(status: ReviewStatus): string {
  return STATUS_STYLE[status].border;
}

/** The bare 6px status dot's color (Figma "Status" set, node 440:26406) — for rows with no room
 * for the full badge. */
export function statusDotColor(status: ReviewStatus): string {
  return STATUS_STYLE[status].dot;
}

/** The plain-English name for a review status — shared by this badge's own tooltip and any other
 * spot (e.g. a bare status dot with no room for a full badge) that needs the same label. */
export function reviewStatusLabel(status: ReviewStatus): string {
  return status === "suggested"
    ? "Suggested"
    : status === "confirmed"
      ? "Confirmed"
      : status === "warning"
        ? "Warning"
        : "Error";
}

/**
 * Confirmed/Suggested tooltips are just their own label — those states need no further
 * explanation. Only Warning/Error show a reason, from the item's own `warningReason`/
 * `errorReason` data (see mock-data.ts's `ReviewFlags`) — never derived from confidence — falling
 * back to a plain "no details" notice when a warning/error item doesn't carry one, rather than
 * inventing a reason. `confidence` is kept in the props for callers (every Entity/Property/
 * Relation site already passes it) though this badge no longer renders it itself.
 */
export function StatusBadge({
  status,
  size = 20,
  confidence,
  warningReason,
  errorReason,
  tooltipContent,
  noTooltip = false,
}: {
  status: ReviewStatus;
  size?: number;
  confidence: number;
  warningReason?: string | undefined;
  errorReason?: string | undefined;
  /** Optional richer tooltip body for a specific badge context. */
  tooltipContent?: ReactNode;
  /** Just the badge, no hover tooltip. */
  noTooltip?: boolean;
}) {
  const style = STATUS_STYLE[status];
  // 16px and smaller use the 8px glyph (half the badge); 20px and up use the 12px glyph, which
  // Figma keeps at 12px for both 20 and 24 — larger badges scale it with the badge.
  const small = size < 20;
  const glyph = small ? STATUS_GLYPH[status].small : STATUS_GLYPH[status].large;
  const glyphSize = small ? size / 2 : Math.max(12, size / 2);
  const label = reviewStatusLabel(status);
  // Only Warning/Error carry an explanation worth surfacing — Confirmed/Suggested are simply the
  // review state itself, so their tooltip is just the label with no extra reasoning line.
  const body =
    status === "warning"
      ? (warningReason ?? "No warning details available.")
      : status === "error"
        ? (errorReason ?? "No error details available.")
        : null;
  if (noTooltip) {
    return (
      <span
        style={{ width: size, height: size, background: style.badgeBg }}
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        aria-label={label}
      >
        <span
          aria-hidden
          className="relative block shrink-0"
          style={{ width: glyphSize, height: glyphSize }}
        >
          <img alt="" src={glyph} className="absolute inset-0 block size-full" />
        </span>
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          style={{ width: size, height: size, background: style.badgeBg }}
          className="inline-flex shrink-0 cursor-default items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]"
          aria-label={label}
        >
          <span
            aria-hidden
            className="relative block shrink-0"
            style={{ width: glyphSize, height: glyphSize }}
          >
            <img alt="" src={glyph} className="absolute inset-0 block size-full" />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className={tooltipContent || body ? "space-y-1" : undefined}>
        {tooltipContent ?? (
          <>
            <p className="font-medium text-white">{label}</p>
            {body && <p className="text-[#B7BCC4]">{body}</p>}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
