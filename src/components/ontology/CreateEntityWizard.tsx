import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/lib/mock-data";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

let draftPropertyUidCounter = 0;
const draftPropertyUid = () => `draft_prop_${(draftPropertyUidCounter++).toString(36)}`;

type DraftProperty = { key: string; name: string; type: string };

const PROPERTY_TYPES = ["string", "text", "number", "integer", "boolean", "date", "uuid"];

function IdentifierIcon() {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center text-[14px] leading-none"
      aria-label="Identifier"
    >
      🔑
    </span>
  );
}

export type CreateEntityDraft = {
  name: string;
  properties: { name: string; type: string; isIdentifier?: boolean }[];
  relationName: string;
  direction: "fromSource" | "toSource";
};

/**
 * The canvas-first Entity creation wizard — replaces the old header-level "Create Entity Type"
 * popover as the PRIMARY way to add an Entity Type in Overview (see OverviewCanvas's own doc
 * comment on `SHOW_CREATE_ENTITY_TOOLBAR` for why that popover stays dormant rather than deleted).
 * Nothing here touches Current Ontology until the very last "Create" click — every field is local
 * draft state, discarded on Cancel/close with zero side effects (no partial Entity, no orphaned
 * Property, no half-made Relation). The caller (`OverviewCanvas`) is the one that actually calls
 * `app.createEntityWithProperties` with this draft, in one atomic operation, once `onCreate` fires.
 *
 * Three steps when `sourceEntity` is set (extending the ontology from an existing node — see the
 * canvas's own "+" affordance), two when it's `null` (a fully standalone Entity, entered from an
 * explicit canvas action instead of a node): Entity name → Properties (+ which one is the
 * Identifier — a real per-Property choice, see mock-data's own `isIdentifier` field, not limited
 * to a property literally named "id") → Relation (skipped entirely for standalone creation).
 */
export function CreateEntityWizard({
  sourceEntity,
  onCancel,
  onCreate,
}: {
  /** The Entity Type creation was started from (its own "+" affordance), or `null` for a fully
   * standalone Entity started from an empty-canvas entry point — see this component's own doc
   * comment. Purely display + default-naming context; the actual Relation is only ever created by
   * the caller, after `onCreate` fires. */
  sourceEntity: Entity | null;
  onCancel: () => void;
  onCreate: (draft: CreateEntityDraft) => void;
}) {
  const totalSteps = sourceEntity ? 3 : 2;
  const [step, setStep] = useState(1);

  const [name, setName] = useState("");
  const [properties, setProperties] = useState<DraftProperty[]>([
    { key: draftPropertyUid(), name: "", type: "string" },
  ]);
  const [identifierKey, setIdentifierKey] = useState<string | null>(null);
  const [relationName, setRelationName] = useState("");
  const [direction, setDirection] = useState<"fromSource" | "toSource">("fromSource");

  const trimmedName = name.trim();
  const namedProperties = properties.filter((p) => p.name.trim().length > 0);
  const hasValidIdentifier =
    identifierKey !== null &&
    namedProperties.some((p) => p.key === identifierKey && p.name.trim().length > 0);
  const trimmedRelationName = relationName.trim();

  const addProperty = () => {
    const key = draftPropertyUid();
    setProperties((prev) => [...prev, { key, name: "", type: "string" }]);
  };
  const removeProperty = (key: string) => {
    setProperties((prev) => prev.filter((p) => p.key !== key));
    setIdentifierKey((cur) => (cur === key ? null : cur));
  };
  const updateProperty = (key: string, patch: Partial<DraftProperty>) => {
    setProperties((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const handleCreate = () => {
    onCreate({
      name: trimmedName,
      properties: namedProperties.map((p) => ({
        name: p.name.trim(),
        type: p.type,
        ...(p.key === identifierKey ? { isIdentifier: true } : {}),
      })),
      relationName: trimmedRelationName,
      direction,
    });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="max-w-md"
        onPointerDown={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          // The name input below focuses itself explicitly (autoFocus) — letting Radix ALSO run
          // its own default autofocus can fight it on the very first paint.
          if (step === 1) e.preventDefault();
        }}
      >
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle>Create Entity Type</DialogTitle>
              <p className="text-[12px] text-muted-foreground">
                {step} / {totalSteps}
              </p>
            </DialogHeader>
            <div className="flex flex-col gap-1.5 py-2">
              <label className="text-[12px] font-medium text-muted-foreground">Entity name</label>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && trimmedName) setStep(2);
                }}
                placeholder="e.g. Shipment"
                className="rounded-md border border-input px-3 py-2 text-[14px] outline-none focus:border-primary"
              />
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
                onClick={() => setStep(2)}
                className="rounded-md bg-[#1c1c18] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Next
              </button>
            </DialogFooter>
          </>
        )}

        {step === 2 && (
          <>
            <DialogHeader>
              <DialogTitle>Configure Properties</DialogTitle>
              <p className="text-[12px] text-muted-foreground">
                {step} / {totalSteps}
              </p>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              <div className="grid grid-cols-[1fr_100px_70px_28px] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Property</span>
                <span>Type</span>
                <span className="text-center">Identifier</span>
                <span />
              </div>
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {properties.map((p) => (
                  <div
                    key={p.key}
                    className="grid grid-cols-[1fr_100px_70px_28px] items-center gap-2 rounded-md px-1 py-1"
                  >
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => updateProperty(p.key, { name: e.target.value })}
                      placeholder="propertyName"
                      className="min-w-0 rounded-md border border-input px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                    />
                    <select
                      value={p.type}
                      onChange={(e) => updateProperty(p.key, { type: e.target.value })}
                      className="min-w-0 rounded-md border border-input px-1.5 py-1.5 text-[12px] outline-none focus:border-primary"
                    >
                      {PROPERTY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={identifierKey === p.key}
                        disabled={!p.name.trim()}
                        aria-label={
                          p.name.trim()
                            ? "Set as this Entity's Identifier"
                            : "Name this property first"
                        }
                        onClick={() => setIdentifierKey(p.key)}
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                          identifierKey === p.key
                            ? "border-[#00ded8] bg-[#00ded8]"
                            : "border-input hover:border-primary",
                        )}
                      >
                        {identifierKey === p.key && <IdentifierIcon />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeProperty(p.key)}
                      aria-label="Remove this property"
                      disabled={properties.length === 1}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addProperty}
                className="flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-primary hover:bg-accent"
              >
                <Plus className="size-3.5" /> Add property
              </button>
              {!hasValidIdentifier && (
                <p className="text-[11px] text-muted-foreground">
                  Pick one property above to be this Entity's Identifier before continuing.
                </p>
              )}
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-md border border-input px-3 py-1.5 text-[13px] font-medium hover:bg-accent"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!hasValidIdentifier}
                onClick={() => (sourceEntity ? setStep(3) : handleCreate())}
                className="rounded-md bg-[#1c1c18] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {sourceEntity ? "Next" : "Create"}
              </button>
            </DialogFooter>
          </>
        )}

        {step === 3 && sourceEntity && (
          <>
            <div className="flex items-center justify-center gap-2 pb-1 text-[13px] font-medium text-muted-foreground">
              <span className="truncate text-foreground">
                {direction === "fromSource" ? sourceEntity.name : trimmedName || "Untitled entity"}
              </span>
              <span className="shrink-0">──────→</span>
              <span className="truncate text-foreground">
                {direction === "fromSource" ? trimmedName || "Untitled entity" : sourceEntity.name}
              </span>
            </div>
            <DialogHeader>
              <DialogTitle>Define Relation</DialogTitle>
              <p className="text-[12px] text-muted-foreground">
                {step} / {totalSteps}
              </p>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">
                  Relation name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={relationName}
                  onChange={(e) => setRelationName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && trimmedRelationName) handleCreate();
                  }}
                  placeholder="e.g. ships"
                  className="rounded-md border border-input px-3 py-2 text-[14px] outline-none focus:border-primary"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">Direction</label>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-foreground">
                    {sourceEntity.name} → {trimmedName || "Untitled entity"}
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
                {direction === "toSource" && (
                  <p className="text-[11px] text-muted-foreground">
                    {trimmedName || "Untitled entity"} → {sourceEntity.name}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-md border border-input px-3 py-1.5 text-[13px] font-medium hover:bg-accent"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!trimmedRelationName}
                onClick={handleCreate}
                className="rounded-md bg-[#1c1c18] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Create
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
