import type { ReviewStatus } from "@/lib/mock-data";
import sparkle8 from "@/assets/icons/sparkle-status-8.svg";
import sparkle12 from "@/assets/icons/sparkle-status-12.svg";
import check8 from "@/assets/icons/status-check-8.svg";
import check12 from "@/assets/icons/status-check-12.svg";
import warning8 from "@/assets/icons/status-warning-8.svg";
import warning12 from "@/assets/icons/status-warning-12.svg";
import error8 from "@/assets/icons/status-error-8.svg";
import error12 from "@/assets/icons/status-error-12.svg";

export type ItemStatusSize = 6 | 16 | 20 | 24;

// Figma "ItemStatus-Temporal" (356:217160): the dot's color, and the box's fill and glyph.
const STATUS = {
  suggested: { dot: "#0891b2", bg: "#d2fffa", glyph: [sparkle8, sparkle12] },
  confirmed: { dot: "#16a34a", bg: "#bbf7d0", glyph: [check8, check12] },
  warning: { dot: "#ca8a04", bg: "#fef08a", glyph: [warning8, warning12] },
  error: { dot: "#dc2626", bg: "#fecaca", glyph: [error8, error12] },
} as const satisfies Record<ReviewStatus, unknown>;

export const itemStatusDotColor = (status: ReviewStatus) => STATUS[status].dot;

/** A review status as a 6px dot, or a 16/20/24px rounded box with its glyph. */
export function ItemStatusIcon({
  status,
  size,
  round = false,
  ...rest
}: {
  status: ReviewStatus;
  /** 6 (dot), 16, 20, 24 — or any size with `round`. */
  size: ItemStatusSize | number;
  /** A circle instead of the rounded box (e.g. a node's centered status). */
  round?: boolean;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const s = STATUS[status];
  if (size === 6) {
    return (
      <span
        {...rest}
        className="block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: s.dot }}
      />
    );
  }
  const glyphSize = size <= 16 ? 8 : 12;
  const inset = (size - glyphSize) / 2;
  const glyph = glyphSize === 8 ? s.glyph[0] : s.glyph[1];
  return (
    <span
      {...rest}
      className="relative block shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: round ? 9999 : size === 16 ? 4 : 6,
        backgroundColor: s.bg,
      }}
    >
      <img
        alt=""
        src={glyph}
        className="absolute block"
        style={{ left: inset, top: inset, width: size - inset * 2, height: size - inset * 2 }}
      />
    </span>
  );
}
