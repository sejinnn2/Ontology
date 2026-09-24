import { Check, Unlink2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The three-state "how much of this table is mapped" badge — unmapped (no column used by any
 * property yet), partial (some but not all), or full (every column used). Shown next to a table
 * wherever it's listed (Overview's Source Tables, Detail's Data Tables toolbox).
 *
 * Full renders as a solid filled checkmark circle (a completed state, same visual language as a
 * confirmed `StatusBadge`) rather than a chain-link glyph — a link icon reads the same whether a
 * table is 10% or 100% mapped, which undersold "this one is actually done." Partial renders as a
 * ring whose green arc is the table's own real `mapped / total` column ratio (via a conic-gradient,
 * not a fixed half-fill) when the caller supplies `mapped`/`total`, so two "partial" tables at very
 * different completion levels don't look identical — falls back to a fixed small arc otherwise. */
export function MappingStatusBadge({
  status,
  mapped,
  total,
  size = 18,
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
      : 25;
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
          {status === "unmapped" && (
            <span className="flex size-full items-center justify-center rounded-full bg-muted">
              <Unlink2 className="size-[55%] text-muted-foreground" strokeWidth={2.5} />
            </span>
          )}
          {status === "partial" && (
            <span
              className="size-full rounded-full"
              style={{
                background: `conic-gradient(var(--color-ok) ${fillPct}%, var(--color-muted) ${fillPct}% 100%)`,
              }}
            />
          )}
          {status === "full" && (
            <span className="flex size-full items-center justify-center rounded-full bg-ok">
              <Check className="size-[62%] text-white" strokeWidth={3} />
            </span>
          )}
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
