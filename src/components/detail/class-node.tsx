import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { entityMappingCompleteness, type Entity } from "@/lib/mock-data";
import suggestedIcon from "@/assets/icons/class-node-suggested-24.svg";
import dotFull from "@/assets/icons/class-dot-full-6.svg";
import dotPartial from "@/assets/icons/class-dot-partial-6.svg";
import dotNone from "@/assets/icons/class-dot-none-6.svg";

/**
 * The "ClassNode" entity-type card (Figma 530:295736), used for Entity Type nodes in the editing
 * graph. Mapping completeness sets the border style (full solid, partial dashed, none dotted) and
 * the status dot; selected tints the card and uses the accent border; focus adds a halo; dim fades
 * it. The Figma set also scales width with how connected the type is — not ported: the graph's
 * layout assumes one node width.
 */
export type ClassNodeMapping = "full" | "partial" | "none";

const ACCENT = "#0092b8";

export function classNodeMapping(entity: Entity): ClassNodeMapping {
  const { mapped, total } = entityMappingCompleteness(entity);
  return total > 0 && mapped === total ? "full" : mapped === 0 ? "none" : "partial";
}

/** "17 props · 5 tables": the tables its properties are mapped into. */
export function classNodeCounts(entity: Entity): string {
  const tables = new Set(entity.properties.flatMap((p) => p.mappings.map((m) => m.table))).size;
  const props = entity.properties.length;
  return `${props} ${props === 1 ? "prop" : "props"} · ${tables} ${tables === 1 ? "table" : "tables"}`;
}

export function classNodeClass({
  mapping,
  selected = false,
  focus = false,
  dimmed = false,
  attached = false,
}: {
  mapping: ClassNodeMapping;
  selected?: boolean | undefined;
  focus?: boolean | undefined;
  dimmed?: boolean | undefined;
  attached?: boolean | undefined;
}) {
  return cn(
    "relative flex items-center gap-1 rounded-[10px] border-[2.5px] px-3 text-left transition-[box-shadow,opacity,border-color,background-color]",
    mapping === "full" ? "border-solid" : mapping === "partial" ? "border-dashed" : "border-dotted",
    selected || focus ? "border-[#0092b8]" : "border-[rgba(98,116,142,0.4)] hover:border-[#0092b8]",
    selected ? "bg-[#f2f8fa]" : "bg-white",
    focus && "shadow-[0_0_0_2px_rgba(0,146,184,0.35)]",
    dimmed && "opacity-40",
    attached && "rounded-b-none border-b-0",
  );
}

export const classNodeAccent = ACCENT;

/** The card's title row (icon + name) over its status dot and counts. */
export function ClassNodeBody({
  icon,
  name,
  nameClassName,
  lodName = "lod-name",
  counts,
  mapping,
}: {
  /** The zoom-LOD class that scales the name: `lod-title` on the middle node, `lod-name` else. */
  lodName?: "lod-name" | "lod-title";
  /** Replaces the Suggested sparkle for entity types with another review status. */
  icon?: ReactNode | undefined;
  name: string;
  nameClassName?: string | undefined;
  counts: string;
  mapping: ClassNodeMapping;
}) {
  return (
    <>
      <span className="lod-type flex shrink-0">
        {icon ?? <img alt="" src={suggestedIcon} className="block size-6" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 pl-1.5">
        <span
          className={cn(
            lodName,
            "truncate text-[14px] font-medium leading-5 text-[#020618]",
            nameClassName,
          )}
        >
          {name}
        </span>
        <span className="lod-detail flex items-center gap-1.5">
          <img
            alt=""
            src={mapping === "full" ? dotFull : mapping === "partial" ? dotPartial : dotNone}
            className="block size-1.5 shrink-0"
          />
          <span className="truncate text-[12px] leading-4 text-[#62748e]">{counts}</span>
        </span>
      </span>
    </>
  );
}
