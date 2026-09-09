import { ExternalLink, Repeat2, Trash2 } from "lucide-react";
import {
  entityStatus,
  entityErrorReason,
  propertyStatus,
  propertyErrorReason,
  type Entity,
  type Property,
  type Relation,
  type ReviewStatus,
  type TableColumn,
  type TableSchema,
} from "@/lib/mock-data";
import { StatusBadge } from "@/components/ontology/StatusBadge";
import { ConfidenceChip, aiReasoning } from "@/components/ontology/ConfidenceChip";

/**
 * What the bottom contextual panel is currently showing. Deliberately narrow: only what doesn't
 * already fit naturally into the canvas (Name + Description, plus "Open in Data360" for a Data
 * Table). Type/mapping/entity-context/identifier/confidence are all already visible on the canvas
 * itself and must not be repeated here.
 */
export type ContextItem =
  | { kind: "entity"; entity: Entity }
  | { kind: "property"; entity: Entity; property: Property }
  | { kind: "relation"; relation: Relation }
  | { kind: "table"; table: TableSchema }
  | { kind: "column"; tableName: string; column: TableColumn };

export function contextItemKey(item: ContextItem): string {
  switch (item.kind) {
    case "entity":
      return `entity:${item.entity.id}`;
    case "property":
      return `property:${item.property.id}`;
    case "relation":
      return `relation:${item.relation.id}`;
    case "table":
      return `table:${item.table.name}`;
    case "column":
      return `column:${item.tableName}.${item.column.name}`;
  }
}

/**
 * The expanded body for Entity/Property/Relation — the three kinds that carry a `ReviewStatus`.
 * Status icon + name, then Description, then (warning/error only) a colored callout with the
 * item's own `warningReason`/`errorReason`, then an "AI Suggestion Reasoning" section. The
 * Confidence chip here is the exact same `ConfidenceChip` used elsewhere on the canvas — reusing
 * the component (rather than a lookalike) is what guarantees this panel and that chip's own hover
 * tooltip never disagree, since both read the same props from the same underlying item.
 */
function ReviewedItemBody({
  status,
  name,
  description,
  confidence,
  warningReason,
  errorReason,
  relationActions,
  onRename,
  namePlaceholder,
  onEditDescription,
  onDelete,
  deleteLabel,
}: {
  status: ReviewStatus;
  name: string;
  description: string;
  confidence: number;
  warningReason?: string | undefined;
  errorReason?: string | undefined;
  /** Only set for a Relation — Swap direction lives here rather than in a separate menu, since
   * this panel already carries every other per-item action. Confirming a Relation is no longer a
   * per-item action; it happens only through the global Confirm dialog (see Header), which is
   * also where the Error-dependency-on-connected-Entity-Types rule is now enforced. */
  relationActions?: {
    onSwap: () => void;
  };
  /** Makes the name editable in place (click into it, type, blur or Enter to save) instead of a
   * static label — available for all three reviewed kinds. For a Relation this is also the one
   * and only way to resolve an auto-created placeholder relation's own Error (see app-state's
   * `createPlaceholderRelation`/`renameRelation`): giving it any non-blank name clears that Error. */
  onRename?: (name: string) => void;
  namePlaceholder?: string;
  /** Same click-to-edit treatment as the name, for the Description — available for all three
   * reviewed kinds. */
  onEditDescription?: (description: string) => void;
  /** Delete — available for all three reviewed kinds. This moves the item into Trash rather than
   * destroying it (see app-state's `Trashed*` types and its own Trash entry point); it is never a
   * permanent delete. */
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full items-center gap-2">
        <StatusBadge
          status={status}
          size={24}
          confidence={confidence}
          warningReason={warningReason}
          errorReason={errorReason}
        />
        {onRename ? (
          <input
            key={name}
            type="text"
            defaultValue={name}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== name) onRename(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = name;
                e.currentTarget.blur();
              }
            }}
            placeholder={namePlaceholder ?? "Name this..."}
            className="-mx-1 min-w-0 flex-1 truncate rounded-md border border-transparent px-1 text-[16px] font-medium leading-[1.2] text-[#171b22] outline-none hover:bg-[#f8f8f8] focus:border-input focus:bg-[#f8f8f8]"
          />
        ) : (
          <p className="min-w-0 flex-1 truncate text-[16px] font-medium leading-[1.2] text-[#171b22]">
            {name}
          </p>
        )}
      </div>
      {onEditDescription ? (
        <textarea
          key={description}
          defaultValue={description}
          rows={2}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== description) onEditDescription(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.value = description;
              e.currentTarget.blur();
            }
          }}
          placeholder="Add a description..."
          className="-mx-1 w-full resize-none rounded-md border border-transparent px-1 text-[14px] font-normal leading-[1.2] text-[#909090] outline-none hover:bg-[#f8f8f8] focus:border-input focus:bg-[#f8f8f8]"
        />
      ) : (
        <p className="w-full text-[14px] font-normal leading-[1.2] text-[#909090]">{description}</p>
      )}
      {status === "warning" && (
        <div className="w-full rounded-[8px] bg-[#f7efd1] p-4">
          <p className="text-[14px] font-medium leading-[1.2] text-[#171b22]">Warning</p>
          <p className="mt-1 text-[14px] font-normal leading-[1.2] text-[#909090]">
            {warningReason ?? "No warning details available."}
          </p>
        </div>
      )}
      {status === "error" && (
        <div className="w-full rounded-[8px] bg-[#ffe6db] p-4">
          <p className="text-[14px] font-medium leading-[1.2] text-[#171b22]">Error</p>
          <p className="mt-1 text-[14px] font-normal leading-[1.2] text-[#909090]">
            {errorReason ?? "No error details available."}
          </p>
        </div>
      )}
      <div className="flex w-full flex-col gap-2 rounded-[8px] bg-[#f8f8f8] p-4">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-medium leading-[1.2] text-[#171b22]">
            AI Suggestion Reasoning
          </p>
          <ConfidenceChip confidence={confidence} />
        </div>
        <p className="text-[14px] font-normal leading-[1.2] text-[#909090]">
          {aiReasoning(confidence)}
        </p>
      </div>
      {relationActions && (
        <div className="flex w-full items-center justify-between gap-2 rounded-[8px] border border-[rgba(28,28,24,0.08)] p-4">
          <p className="text-[14px] font-medium leading-[1.2] text-[#171b22]">Relation actions</p>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={relationActions.onSwap}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-primary hover:bg-accent"
          >
            <Repeat2 className="size-3.5" /> Swap direction
          </button>
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#f15b15]/25 px-3 py-1.5 text-[12px] font-medium text-[#9c461e] transition-colors hover:bg-[#ffe6db]"
        >
          <Trash2 className="size-3.5" /> {deleteLabel ?? "Delete"}
        </button>
      )}
    </div>
  );
}

/** Content only — no panel chrome (border/shadow/close button), so `DetailShell` can wrap it in
 * one consistent floating surface regardless of which canvas supplied it. */
export function ContextPanelBody({
  item,
  onSwapRelation,
  onRenameRelation,
  onEditRelationDescription,
  onRenameEntity,
  onEditEntityDescription,
  onRenameProperty,
  onEditPropertyDescription,
  onDeleteEntity,
  onDeleteProperty,
  onDeleteRelation,
}: {
  item: ContextItem;
  onSwapRelation: (relationId: string) => void;
  onRenameRelation: (relationId: string, name: string) => void;
  onEditRelationDescription: (relationId: string, description: string) => void;
  onRenameEntity: (entityId: string, name: string) => void;
  onEditEntityDescription: (entityId: string, description: string) => void;
  onRenameProperty: (entityId: string, propertyId: string, name: string) => void;
  onEditPropertyDescription: (entityId: string, propertyId: string, description: string) => void;
  onDeleteEntity: (entityId: string) => void;
  onDeleteProperty: (entityId: string, propertyId: string) => void;
  onDeleteRelation: (relationId: string) => void;
}) {
  switch (item.kind) {
    case "entity":
      return (
        <ReviewedItemBody
          status={entityStatus(item.entity)}
          name={item.entity.name}
          description={item.entity.description}
          confidence={item.entity.confidence}
          warningReason={item.entity.warningReason}
          errorReason={entityErrorReason(item.entity)}
          onRename={(name) => onRenameEntity(item.entity.id, name)}
          namePlaceholder="Name this Entity Type..."
          onEditDescription={(description) => onEditEntityDescription(item.entity.id, description)}
          onDelete={() => onDeleteEntity(item.entity.id)}
          deleteLabel="Delete Entity Type"
        />
      );
    case "property":
      return (
        <ReviewedItemBody
          status={propertyStatus(item.property)}
          name={item.property.name}
          description={item.property.description}
          confidence={item.property.confidence}
          warningReason={item.property.warningReason}
          errorReason={propertyErrorReason(item.property)}
          onRename={(name) => onRenameProperty(item.entity.id, item.property.id, name)}
          namePlaceholder="Name this Property..."
          onEditDescription={(description) =>
            onEditPropertyDescription(item.entity.id, item.property.id, description)
          }
          onDelete={() => onDeleteProperty(item.entity.id, item.property.id)}
          deleteLabel="Delete Property"
        />
      );
    case "relation":
      return (
        <ReviewedItemBody
          status={item.relation.status}
          name={item.relation.name}
          description={item.relation.description}
          confidence={item.relation.confidence}
          warningReason={item.relation.warningReason}
          errorReason={item.relation.errorReason}
          relationActions={{ onSwap: () => onSwapRelation(item.relation.id) }}
          onRename={(name) => onRenameRelation(item.relation.id, name)}
          namePlaceholder="Name this relation..."
          onEditDescription={(description) =>
            onEditRelationDescription(item.relation.id, description)
          }
          onDelete={() => onDeleteRelation(item.relation.id)}
          deleteLabel="Delete Relation"
        />
      );
    case "column":
      return (
        <>
          <p className="text-[16px] font-medium leading-[1.2] text-[#171b22]">{item.column.name}</p>
          <p className="text-[14px] font-normal leading-[1.2] text-[#909090]">
            {item.column.description}
          </p>
        </>
      );
    case "table":
      return (
        <>
          <p className="text-[16px] font-medium leading-[1.2] text-[#171b22]">{item.table.name}</p>
          <p className="text-[14px] font-normal leading-[1.2] text-[#909090]">
            {item.table.description}
          </p>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-1 flex items-center gap-1.5 text-[12px] font-medium text-primary hover:opacity-80"
          >
            <ExternalLink className="size-3.5" /> Open in Data360
          </button>
        </>
      );
  }
}
