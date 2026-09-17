import type { ReviewStatus } from "@/lib/mock-data";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

const STATUS_STYLE: Record<ReviewStatus, { border: string; badgeBg: string; iconColor: string }> = {
  suggested: { border: "#7c5eff", badgeBg: "#e1daff", iconColor: "#553eb7" },
  confirmed: { border: "#0298b2", badgeBg: "#c7eef5", iconColor: "#007287" },
  warning: { border: "#e6c200", badgeBg: "#faebb0", iconColor: "#967700" },
  error: { border: "#f15b15", badgeBg: "#ffd6c3", iconColor: "#9c461e" },
};

export function statusBorderColor(status: ReviewStatus): string {
  return STATUS_STYLE[status].border;
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

function SparkleIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.96745 1.52421C5.99066 1.39995 6.05659 1.28772 6.15383 1.20696C6.25108 1.1262 6.3735 1.08199 6.49991 1.08199C6.62631 1.08199 6.74874 1.1262 6.84598 1.20696C6.94322 1.28772 7.00916 1.39995 7.03237 1.52421L7.60166 4.53479C7.64209 4.74883 7.74611 4.94571 7.90013 5.09973C8.05416 5.25376 8.25104 5.35777 8.46507 5.39821L11.4757 5.9675C11.5999 5.99071 11.7121 6.05664 11.7929 6.15388C11.8737 6.25113 11.9179 6.37355 11.9179 6.49996C11.9179 6.62636 11.8737 6.74879 11.7929 6.84603C11.7121 6.94327 11.5999 7.00921 11.4757 7.03241L8.46507 7.60171C8.25104 7.64214 8.05416 7.74616 7.90013 7.90018C7.74611 8.05421 7.64209 8.25108 7.60166 8.46512L7.03237 11.4757C7.00916 11.6 6.94322 11.7122 6.84598 11.7929C6.74874 11.8737 6.62631 11.9179 6.49991 11.9179C6.3735 11.9179 6.25108 11.8737 6.15383 11.7929C6.05659 11.7122 5.99066 11.6 5.96745 11.4757L5.39816 8.46512C5.35772 8.25108 5.25371 8.05421 5.09968 7.90018C4.94566 7.74616 4.74878 7.64214 4.53474 7.60171L1.52416 7.03241C1.3999 7.00921 1.28767 6.94327 1.20691 6.84603C1.12615 6.74879 1.08194 6.62636 1.08194 6.49996C1.08194 6.37355 1.12615 6.25113 1.20691 6.15388C1.28767 6.05664 1.3999 5.99071 1.52416 5.9675L4.53474 5.39821C4.74878 5.35777 4.94566 5.25376 5.09968 5.09973C5.25371 4.94571 5.35772 4.74883 5.39816 4.53479L5.96745 1.52421Z"
        fill={color}
      />
    </svg>
  );
}

function CheckIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size * (8.5 / 10.5)}
      viewBox="0 0 10.5 8.5"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0.75 5.52273L3 7.75L9.75 0.750001"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Exported so any other chrome that needs to signal "warning"/"error" (e.g. the Header's own
 * Issues control) can reuse the exact same glyph canvas nodes use for these statuses, instead of a
 * generic icon-library lookalike that reads as a different visual language. */
export function WarningIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.67468 1.01939C7.09489 1.00312 8.1568 1.21007 9.19225 3.06529L11.785 7.57212C12.7754 9.05926 13.2622 11.7284 9.61608 11.9286L6.50085 11.9999L3.35143 11.909C-0.294582 11.7089 0.266267 9.06186 1.18249 7.55357L3.77526 3.04575C4.81072 1.19053 5.87263 0.984567 6.29284 1.00083L6.67468 1.01939ZM6.49987 8.50181C6.08566 8.50181 5.74987 8.8376 5.74987 9.25181V9.28892C5.74995 9.70307 6.08571 10.0389 6.49987 10.0389C6.91399 10.0389 7.24979 9.70303 7.24987 9.28892V9.25181C7.24987 8.83763 6.91404 8.50187 6.49987 8.50181ZM6.49987 4.24986C6.08566 4.24986 5.74987 4.58564 5.74987 4.99986V6.84458C5.74995 7.25873 6.08571 7.59458 6.49987 7.59458C6.91399 7.59453 7.24979 7.25869 7.24987 6.84458V4.99986C7.24987 4.58568 6.91404 4.24991 6.49987 4.24986Z"
        fill={color}
      />
    </svg>
  );
}

export function ErrorIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.56177 0.5C7.04271 0.5 7.43017 0.894422 7.4216 1.37528L7.31196 7.52745C7.30467 7.93656 6.97095 8.26439 6.56177 8.26439C6.1526 8.26439 5.81887 7.93656 5.81158 7.52745L5.70195 1.37528C5.69338 0.894422 6.08083 0.5 6.56177 0.5ZM6.56443 12.5C6.26996 12.5 6.01807 12.3971 5.80875 12.1913C5.59943 11.982 5.49654 11.7301 5.50009 11.4357C5.49654 11.1447 5.59943 10.8964 5.80875 10.6906C6.01807 10.4813 6.26996 10.3766 6.56443 10.3766C6.85181 10.3766 7.10015 10.4813 7.30947 10.6906C7.5188 10.8964 7.62523 11.1447 7.62878 11.4357C7.62523 11.6308 7.57379 11.8099 7.47445 11.9731C7.37866 12.1328 7.25094 12.2605 7.09128 12.3563C6.93163 12.4521 6.75602 12.5 6.56443 12.5Z"
        fill={color}
        stroke={color}
        strokeWidth="0.5"
      />
    </svg>
  );
}

const STATUS_ICON: Record<ReviewStatus, typeof SparkleIcon> = {
  suggested: SparkleIcon,
  confirmed: CheckIcon,
  warning: WarningIcon,
  error: ErrorIcon,
};

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
}: {
  status: ReviewStatus;
  size?: number;
  confidence: number;
  warningReason?: string | undefined;
  errorReason?: string | undefined;
}) {
  const style = STATUS_STYLE[status];
  const Icon = STATUS_ICON[status];
  const label = reviewStatusLabel(status);
  // Only Warning/Error carry an explanation worth surfacing — Confirmed/Suggested are simply the
  // review state itself, so their tooltip is just the label with no extra reasoning line.
  const body =
    status === "warning"
      ? (warningReason ?? "No warning details available.")
      : status === "error"
        ? (errorReason ?? "No error details available.")
        : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          style={{ width: size, height: size, background: style.badgeBg }}
          className="inline-flex shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]"
          aria-label={label}
        >
          <Icon color={style.iconColor} size={Math.round(size * 0.5)} />
        </span>
      </TooltipTrigger>
      <TooltipContent className={body ? "space-y-1" : undefined}>
        <p className="font-medium text-white">{label}</p>
        {body && <p className="text-[#B7BCC4]">{body}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
