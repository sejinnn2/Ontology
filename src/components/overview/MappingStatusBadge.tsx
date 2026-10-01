import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The three-state "how much of this table is mapped" icon (Figma "Mapping Status", 328:2205) —
 * the one table-status indicator used everywhere a table is listed. Unmapped is an empty pale
 * ring; partial is the same ring with a green arc from 12 o'clock clockwise, sized to the table's
 * real `mapped / total` column ratio when the caller supplies it (Figma draws only 50%); full is a
 * solid green disc with a white checkmark. At size 6 the ring becomes a dot / pie wedge. */
export function MappingStatusBadge({
  status,
  mapped,
  total,
  size = 16,
  className,
}: {
  status: "unmapped" | "partial" | "full";
  /** Real column counts behind a "partial" table — see this component's own doc comment. Ignored
   * for "unmapped"/"full", which never need a proportional fill. */
  mapped?: number;
  total?: number;
  size?: number;
  className?: string;
}) {
  // Every current caller passes real `mapped`/`total` counts (see `tableMappingCompleteness`), so
  // the tooltip states the actual ratio rather than just the three-state label — "12/20 columns
  // mapped" says exactly how far along a "partial" table is instead of leaving that to the arc's
  // own fill, which not everyone will read precisely at a glance. Falls back to the plain label for
  // any future caller that doesn't have counts to pass.
  const label =
    mapped != null && total != null
      ? `${mapped}/${total} columns mapped`
      : status === "unmapped"
        ? "Unmapped"
        : status === "full"
          ? "Fully mapped"
          : "Partially mapped";
  const fillPct =
    status === "partial" && total
      ? Math.min(96, Math.max(8, Math.round((mapped! / total) * 100)))
      : 50;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          style={{ width: size, height: size }}
          className={cn(
            "relative flex shrink-0 cursor-default items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]",
            className,
          )}
          aria-label={label}
        >
          <MappingStatusGlyph size={size} status={status} pct={fillPct} />
        </span>
      </TooltipTrigger>
      {/* Same custom tooltip look as `StatusBadge`'s own Confirmed/Suggested case (see that
          component) — a single bold white label, no secondary muted line, reused here rather than
          the plain native `title` attribute so every hover explanation in the app shares one look. */}
      <TooltipContent>
        <p className="font-medium text-white">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// Figma IconCheckmark2Medium in its 8×8 box (the white check on a fully mapped table).
const CHECK_8 =
  "M7.62207 1.87573L7.29004 2.24976L2.85742 7.22437L2.48242 6.85718L0.375977 4.78784L1.07617 4.07397L2.80859 5.77515L6.87598 1.21069L7.62207 1.87573Z";

function MappingStatusGlyph({
  size,
  status,
  pct,
}: {
  size: number;
  status: "unmapped" | "partial" | "full";
  pct: number;
}) {
  const c = size / 2;
  if (status === "full") {
    // 8px check at 16, 12px from 20 up; no check on the 6px dot.
    const check = size < 12 ? 0 : size < 20 ? 8 : 12;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={c} fill="var(--color-success)" />
        {check > 0 && (
          <path
            d={CHECK_8}
            fill="white"
            transform={`translate(${(size - check) / 2} ${(size - check) / 2}) scale(${check / 8})`}
          />
        )}
      </svg>
    );
  }
  if (size < 12) {
    // Too small for a ring: a muted dot with a green pie wedge.
    const a = (Math.min(pct, 99.999) / 100) * 2 * Math.PI;
    const x = c + c * Math.sin(a);
    const y = c - c * Math.cos(a);
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={c} fill="var(--color-muted)" />
        {status === "partial" && (
          <path
            d={`M${c} ${c} L${c} 0 A${c} ${c} 0 ${a > Math.PI ? 1 : 0} 1 ${x} ${y} Z`}
            fill="var(--color-success)"
          />
        )}
      </svg>
    );
  }
  // The ring: inner radius 70% of the outer (Figma arcData), so a 0.15·size band.
  const r = size * 0.425;
  const w = size * 0.15;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={w} />
      {status === "partial" && (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--color-success)"
          strokeWidth={w}
          pathLength={100}
          strokeDasharray={`${pct} 100`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      )}
    </svg>
  );
}
