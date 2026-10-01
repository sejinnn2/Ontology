import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { OntologyApp } from "@/lib/app-state";
import { FigmaIcon } from "@/components/detail/list-controls";
import checkCircleIcon from "@/assets/icons/check-circle-2-16.svg";

/**
 * The "Merge complete" / "Split complete" notice (Figma 356:208097 / 356:208109): a flat Alert —
 * white, hairline border, 4px radius, no shadow — 8px above whatever sits at the bottom of the
 * canvas. Kept in a tiny module store rather than component state, since a merge re-anchors the
 * workspace on the merged Entity Type and would otherwise drop it.
 */
type CompletionNotice = { id: number; title: string; description: string; entityId: string };

let notice: CompletionNotice | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function showCompletionNotice(next: Omit<CompletionNotice, "id">) {
  notice = { ...next, id: nextId++ };
  emit();
}
function dismissCompletionNotice(id: number) {
  if (notice?.id !== id) return;
  notice = null;
  emit();
}

const AUTO_DISMISS_MS = 5000;

/** Renders the current notice, if any, centred above its positioned parent. */
export function CompletionNoticeSlot({ app }: { app: OntologyApp }) {
  const current = useSyncExternalStore(subscribe, () => notice);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // Gone once the Entity Type it announces is (e.g. the merge was undone).
  const stale = !!current && !app.entities.some((e) => e.id === current.entityId);
  useEffect(() => {
    if (current && stale) dismissCompletionNotice(current.id);
  }, [current, stale]);
  useEffect(() => {
    if (!current || hovered) return;
    timer.current = window.setTimeout(() => dismissCompletionNotice(current.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer.current);
  }, [current, hovered]);
  if (!current || stale) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="pointer-events-auto absolute bottom-full left-1/2 mb-2 flex w-[391px] -translate-x-1/2 gap-3 rounded-[4px] border border-[#e3e5e4] bg-white p-4"
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <FigmaIcon src={checkCircleIcon} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[16px] font-medium leading-6 text-[#080a09]">{current.title}</p>
        <p className="text-[14px] leading-6 text-[#080a09]">{current.description}</p>
      </div>
    </div>
  );
}
