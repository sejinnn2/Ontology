import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

/** The "+" entry point for creating a brand-new Entity Type from the Entity types panel (Overview
 * and Detail both have one) — a lightweight inline popover asking only for a name, never a modal.
 * Submitting just creates the Entity Type and adds it to this panel; it's deliberately never
 * placed on any canvas automatically — the user drags it there themselves the same way they would
 * any other panel entity, via the existing panel-to-canvas drag/drop this doesn't touch. */
export function CreateEntityButton({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setName("");
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed);
    setName("");
    setOpen(false);
  };

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Create Entity Type"
        title="Create Entity Type"
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
      >
        <Plus className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col gap-2 rounded-lg border border-node-border bg-node p-3 shadow-[var(--shadow-node-lift)]">
          <p className="text-[12px] font-medium text-foreground">New Entity Type</p>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setName("");
                setOpen(false);
              }
            }}
            placeholder="Entity Type name..."
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-[11.5px] outline-none focus:border-primary"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setName("");
                setOpen(false);
              }}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!name.trim()}
              className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
