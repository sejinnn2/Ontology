import { useState } from "react";
import type { Entity } from "@/lib/mock-data";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirms an Entity-to-Entity Relation before it's created — opens whenever a connector is
 * dragged from one Entity Type onto another EXISTING Entity Type (Overview and Detail alike),
 * replacing the old behavior where that same drag/drop gesture created an unnamed Relation
 * immediately. Nothing here touches Current Ontology until "Create" is clicked; Cancel (or
 * closing the dialog any other way) leaves it untouched, exactly like `CreateEntityWizard`, whose
 * own "Define Relation" step this mirrors — this is the same UI, just for two entities that both
 * already exist rather than one existing + one still-being-drafted.
 *
 * `sourceEntity`/`targetEntity` are fixed by the drag gesture itself (wherever the handle was
 * grabbed vs. dropped) and never swap identity here — only `direction` (which one actually becomes
 * the created Relation's `from`/`to`) is editable, via "Swap direction". Deliberately allows
 * `sourceEntity.id === targetEntity.id` (a self-relation) and never checks for an existing Relation
 * between the two — see `createRelation`'s own doc comment in app-state.ts for why neither is
 * blocked: each Relation this creates is an independent object, so two entities may end up
 * connected by any number of separately-named Relations.
 */
export function DefineRelationDialog({
  sourceEntity,
  targetEntity,
  onCancel,
  onCreate,
}: {
  sourceEntity: Entity;
  targetEntity: Entity;
  onCancel: () => void;
  onCreate: (params: { name: string; direction: "fromSource" | "toSource" }) => void;
}) {
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"fromSource" | "toSource">("fromSource");
  const trimmedName = name.trim();

  const fromName = direction === "fromSource" ? sourceEntity.name : targetEntity.name;
  const toName = direction === "fromSource" ? targetEntity.name : sourceEntity.name;

  const handleCreate = () => {
    if (!trimmedName) return;
    onCreate({ name: trimmedName, direction });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-2 pb-1 text-[13px] font-medium text-muted-foreground">
          <span className="truncate text-foreground">{fromName || "Untitled entity"}</span>
          <span className="shrink-0">──────→</span>
          <span className="truncate text-foreground">{toName || "Untitled entity"}</span>
        </div>
        <DialogHeader>
          <DialogTitle>Define Relation</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">Source Entity</label>
              <div className="truncate rounded-md border border-input bg-muted px-3 py-2 text-[13px] text-foreground">
                {sourceEntity.name || "Untitled entity"}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">Target Entity</label>
              <div className="truncate rounded-md border border-input bg-muted px-3 py-2 text-[13px] text-foreground">
                {targetEntity.name || "Untitled entity"}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Relation name</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmedName) handleCreate();
              }}
              placeholder="e.g. placedBy"
              className="rounded-md border border-input px-3 py-2 text-[14px] outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Direction</label>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-foreground">
                {fromName || "Untitled entity"} → {toName || "Untitled entity"}
              </span>
              <button
                type="button"
                onClick={() =>
                  setDirection((d) => (d === "fromSource" ? "toSource" : "fromSource"))
                }
                className="rounded-md border border-input px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Swap
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input px-3 py-1.5 text-[13px] font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmedName}
            onClick={handleCreate}
            className="rounded-md bg-[#1c1c18] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
