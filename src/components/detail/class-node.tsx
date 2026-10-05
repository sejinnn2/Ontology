import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { entityMappingCompleteness, type Entity } from "@/lib/mock-data";
import suggestedIcon from "@/assets/icons/class-node-suggested-24.svg";
import activeIcon from "@/assets/icons/class-node-active-24.svg";
import dotFull from "@/assets/icons/class-dot-full-6.svg";
import dotPartial from "@/assets/icons/class-dot-partial-6.svg";
import dotNone from "@/assets/icons/class-dot-none-6.svg";

/**
 * Entity Type nodes in the editing graph, from Figma "Node-Editing mode" (472:110792). The status
 * dot shows how much of the type is mapped (full / partial / none).
 */
export type ClassNodeMapping = "full" | "partial" | "none";

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

/**
 * Figma "Node-Editing mode" (472:110792): a white card, 1px light border and the standard card
 * shadow. Focused is a 2px cyan border, selected a 1px near-black one, dim fades it to 20%.
 */
const CARD_SHADOW = "shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)]";

export function classNodeClass({
  selected = false,
  focus = false,
  dimmed = false,
  attached = false,
}: {
  selected?: boolean | undefined;
  focus?: boolean | undefined;
  dimmed?: boolean | undefined;
  attached?: boolean | undefined;
}) {
  return cn(
    "relative flex items-center gap-1 rounded-[6px] border bg-white px-3 text-left transition-[box-shadow,opacity,border-color]",
    CARD_SHADOW,
    selected
      ? "border-[#080a09]"
      : focus
        ? "border-2 border-[#0891b2]"
        : "border-[#e3e5e4] hover:border-[#0891b2]",
    dimmed && "opacity-20",
    attached && "rounded-b-none border-b-0",
  );
}

/** The open node's list, as the rest of its card: the head's border continues down both sides and
 * the bottom, with a hairline between head and list. */
export function classNodeBodyClass({
  selected = false,
  focus = false,
}: {
  selected?: boolean;
  focus?: boolean;
}) {
  return cn(
    "rounded-b-[6px] rounded-t-none border border-t-0 bg-white shadow-[inset_0_1px_0_#e3e5e4]",
    CARD_SHADOW,
    selected
      ? "border-[#080a09]"
      : focus
        ? "border-2 border-t-0 border-[#0891b2]"
        : "border-[#e3e5e4]",
  );
}

/** The card's title: a 28px sparkle beside the 16px name, over the status dot and counts. The
 * sparkle is gray, and cyan while the node is focused or selected. */
export function ClassNodeBody({
  icon,
  name,
  nameClassName,
  lodName = "lod-name",
  counts,
  mapping,
  active = false,
}: {
  /** The zoom-LOD class that scales the name: `lod-title` on the middle node, `lod-name` else. */
  lodName?: "lod-name" | "lod-title";
  /** Replaces the Suggested sparkle for entity types with another review status. */
  icon?: ReactNode | undefined;
  name: string;
  nameClassName?: string | undefined;
  counts: string;
  mapping: ClassNodeMapping;
  active?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-2">
        <span className="lod-type flex shrink-0">
          {icon ?? (
            <img alt="" src={active ? activeIcon : suggestedIcon} className="block size-7" />
          )}
        </span>
        <span
          className={cn(
            lodName,
            "min-w-0 flex-1 truncate text-[16px] font-medium leading-6 text-[#080a09]",
            nameClassName,
          )}
        >
          {name}
        </span>
      </span>
      <span className="lod-detail flex items-center gap-1.5">
        <img
          alt=""
          src={mapping === "full" ? dotFull : mapping === "partial" ? dotPartial : dotNone}
          className="block size-1.5 shrink-0"
        />
        <span className="truncate text-[12px] leading-4 text-[#6d7472]">{counts}</span>
      </span>
    </span>
  );
}
