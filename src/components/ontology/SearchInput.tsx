import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Search-by-name for a toolbox list (Entity types / Data Tables, in both Overview and Detail) —
 * pure display filtering: it narrows which rows render, never touches the ontology data or the
 * canvas itself. Stops its own pointerdown from propagating since some callers render this inside
 * a pannable canvas, whose own onPointerDown would otherwise grab pointer capture for panning on
 * any bubbled pointerdown from a plain click into the field. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background py-1 pl-7 pr-2 text-[11.5px] outline-none focus:border-primary"
      />
    </div>
  );
}
