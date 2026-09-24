import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The single hover-revealed "delete this ontology object" affordance — shared by Entity Type
 * cards, Property rows, and Relation badges so all three read as the same interaction (see the
 * delete-unification spec: Entity/Property/Relation deletion always looks and behaves the same).
 * Deliberately a trash can, never the X used for a Property↔Column mapping disconnect — those are
 * two different actions (delete an ontology object vs. disconnect a mapping) and must never share
 * an icon. Every caller supplies its own hover-reveal wiring (an ancestor `group/*` class plus
 * `opacity-0 group-hover/*:opacity-100` in `className`) since each surface's hover target differs.
 */
export function DeleteButton({
  onClick,
  "aria-label": ariaLabel,
  title = "Delete",
  className,
  size = 12,
}: {
  onClick: () => void;
  "aria-label": string;
  title?: string;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[#ffe6db] hover:text-[#9c461e]",
        className,
      )}
    >
      <Trash2 style={{ width: size, height: size }} />
    </button>
  );
}
