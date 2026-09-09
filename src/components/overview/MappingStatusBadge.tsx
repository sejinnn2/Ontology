import { Link2, Unlink2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** The three-state "how much of this table is mapped" badge — unmapped (no column used by any
 * property yet), partial (some but not all), or full (every column used). Shown next to a table
 * wherever it's listed (Overview's Source Tables, Detail's Data Tables toolbox). */
export function MappingStatusBadge({
  status,
  size = 18,
  className,
}: {
  status: "unmapped" | "partial" | "full";
  size?: number;
  className?: string;
}) {
  const label =
    status === "unmapped" ? "Unmapped" : status === "full" ? "Fully mapped" : "Partially mapped";
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        status === "unmapped" ? "bg-muted" : "bg-background",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {status === "full" && <span className="absolute inset-0 bg-[#CBF5D4]" />}
      {status === "partial" && <span className="absolute inset-x-0 bottom-0 h-1/2 bg-[#CBF5D4]" />}
      {status === "unmapped" ? (
        <Unlink2 className="relative size-[55%] text-muted-foreground" strokeWidth={2.5} />
      ) : (
        <Link2 className="relative size-[55%] text-ok" strokeWidth={2.5} />
      )}
    </span>
  );
}
