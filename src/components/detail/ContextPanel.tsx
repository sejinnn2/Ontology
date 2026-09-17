import { useCallback, useState } from "react";
import { ExternalLink, LogOut, Repeat2, Unlink2 } from "lucide-react";
import {
  entityStatus,
  entityErrorReason,
  propertyStatus,
  propertyErrorReason,
  relationStatus,
  relationErrorReason,
  entityReasoningContent,
  propertyReasoningContent,
  relationReasoningContent,
  mappingReasoningContent,
  mappingStatus,
  type Entity,
  type Property,
  type Relation,
  type ReviewStatus,
  type TableColumn,
  type TableSchema,
  type ReasoningContent,
} from "@/lib/mock-data";
import { StatusBadge } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SelectionBarDeleteIcon,
  SelectionBarDeclineIcon,
  SelectionBarAcceptIcon,
} from "@/components/nav/nav-icons";

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
  | {
      kind: "column";
      tableName: string;
      column: TableColumn;
      mappingEntityId?: string;
      mappingPropertyId?: string;
    };

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
      return `column:${item.tableName}.${item.column.name}:${item.mappingEntityId ?? ""}:${item.mappingPropertyId ?? ""}`;
  }
}

/**
 * The evidence half of "Why this confidence score?" — the one thing that actually differs between
 * the four reasoning contexts (Entity/Property/Relation share this same "Reasoning prose + Top
 * datasets table" shape; a Mapping gets its own deeper "match summary + reasoning + column
 * analysis" shape instead, since it's explaining one specific Column<->Property pairing rather than
 * "how much do I believe this suggestion"). See `ReasoningContent`'s own doc comment in
 * mock-data.ts for how each shape gets computed.
 */
function ReasoningSections({ content }: { content: ReasoningContent }) {
  if (content.kind === "mapping") {
    return (
      <div className="flex w-full flex-col gap-3">
        <p className="text-[14px] font-normal leading-[1.3] text-[#909090]">
          {content.matchSummary}
        </p>
        <hr className="w-full border-[rgba(28,28,24,0.08)]" />
        <div>
          <p className="text-[13px] font-medium leading-[1.2] text-[#171b22]">Reasoning</p>
          <p className="mt-1 text-[14px] font-normal leading-[1.3] text-[#909090]">
            {content.reasoning}
          </p>
        </div>
        <hr className="w-full border-[rgba(28,28,24,0.08)]" />
        <div>
          <p className="text-[13px] font-medium leading-[1.2] text-[#171b22]">
            Column analysis for {content.column.name}
          </p>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <span className="text-[#909090]">Entity match</span>
            <span className="text-right font-medium text-[#171b22]">
              {content.column.entityMatchPct}%
            </span>
            <span className="text-[#909090]">Entity type</span>
            <span className="text-right font-medium text-[#171b22]">
              {content.column.entityType}
            </span>
            <span className="text-[#909090]">Property</span>
            <span className="text-right font-medium text-[#171b22]">{content.column.property}</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-3">
      <div>
        <p className="text-[13px] font-medium leading-[1.2] text-[#171b22]">Reasoning</p>
        <p className="mt-1 text-[14px] font-normal leading-[1.3] text-[#909090]">
          {content.reasoning}
        </p>
      </div>
      {content.topDatasets.length > 0 && (
        <div>
          <p className="text-[13px] font-medium leading-[1.2] text-[#171b22]">Top datasets</p>
          <div className="mt-1 flex flex-col gap-1">
            {content.topDatasets.map((row) => (
              <div
                key={`${row.table}-${row.detail}`}
                className="flex items-center justify-between gap-2 text-[13px]"
              >
                <span className="min-w-0 shrink-0 truncate font-medium text-[#171b22]">
                  {row.table}
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-[#909090]">
                  {row.detail}
                </span>
                <span className="shrink-0 tabular-nums text-[#171b22]">{row.score}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The expanded body for Entity/Property/Relation — the three kinds that carry a `ReviewStatus`.
 * Status icon + name, then Description, then (warning/error only) a colored callout with the
 * item's own `warningReason`/`errorReason`, then "Why this confidence score?" — the Confidence
 * chip here is the exact same `ConfidenceChip` used elsewhere on the canvas — reusing the component
 * (rather than a lookalike) is what guarantees this panel and that chip's own hover tooltip never
 * disagree, since both read the same `reasoning` computed by the same per-kind function (see
 * `ReasoningContent` in mock-data.ts).
 */
function ReviewedItemBody({
  status,
  name,
  description,
  confidence,
  reasoning,
  warningReason,
  errorReason,
  relationActions,
  onRename,
  namePlaceholder,
  onEditDescription,
  onRemoveFromWorkspace,
  onDelete,
  onAccept,
  onReject,
}: {
  status: ReviewStatus;
  name: string;
  description: string;
  confidence: number;
  reasoning: ReasoningContent;
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
  /** "Remove from workspace" — Entity Type only (see `ContextPanelBody`'s own "table" branch for
   * the Data Table equivalent, which has no `ReviewedItemBody` to share this with) — only ever
   * changes whether the Entity's card is currently shown in THIS Editing workspace, never Current
   * Ontology. Kept visually and semantically distinct from `onDelete` below — a workspace/view
   * action, never an ontology mutation. Undefined (never rendered) when the item can't be removed
   * from the workspace at all (the anchor, or a compact satellite shown only because a real
   * Relation connects it, neither of which has anything to "remove"). */
  onRemoveFromWorkspace?: (() => void) | undefined;
  /** Single-selection = Inspect + Act: this item's own Delete/Accept/Reject now live here, right
   * alongside its inspection content, rather than requiring the user to build a 1-item selection
   * just to reach the contextual selection control (`SelectionControlBar`) — that control remains
   * the only place these actions live for a 2+ item selection. Each is only ever passed when
   * actually eligible for this item's current status (Delete: Applied/"confirmed"; Accept/Reject:
   * not yet Applied) — never rendered as a disabled button otherwise. */
  onDelete?: (() => void) | undefined;
  onAccept?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
}) {
  const [acceptWarningOpen, setAcceptWarningOpen] = useState(false);
  const handleAcceptClick = useCallback(() => {
    if (status === "warning") setAcceptWarningOpen(true);
    else onAccept?.();
  }, [status, onAccept]);
  const handleAcceptAnyway = useCallback(() => {
    setAcceptWarningOpen(false);
    onAccept?.();
  }, [onAccept]);
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
            autoFocus={!name}
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
      {/* Confidence is a fact about a pending AI suggestion, not persistent metadata — gone once
          Applied ("confirmed"), same rule the canvas's own cards/rows follow. A Warning/Error is
          still its own not-yet-Applied state and keeps showing it, same as a plain Suggested item
          would. */}
      {status !== "confirmed" && (
        <div className="flex w-full flex-col gap-3 rounded-[8px] bg-[#f8f8f8] p-4">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-medium leading-[1.2] text-[#171b22]">
              Why this confidence score?
            </p>
            <ConfidenceChip confidence={confidence} reasoning={reasoning} />
          </div>
          <ReasoningSections content={reasoning} />
        </div>
      )}
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
      {/* Single-selection action area — Delete (Applied only) or Accept/Reject (still Suggested,
          never both at once for one item) exactly mirror the contextual selection control's own
          eligibility, just scoped to this one object. "Remove from workspace" stays its own,
          visually distinct row below — a workspace/view action, never an ontology mutation. */}
      {(onDelete || onAccept || onReject) && (
        <div className="flex w-full items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input px-3 text-[12px] font-medium text-destructive transition-colors hover:bg-accent"
            >
              <SelectionBarDeleteIcon size={14} /> Delete
            </button>
          )}
          {onReject && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
              className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input px-3 text-[12px] font-medium text-[#161919] transition-colors hover:bg-accent"
            >
              <SelectionBarDeclineIcon size={14} /> Reject
            </button>
          )}
          {onAccept && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleAcceptClick();
              }}
              className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input px-3 text-[12px] font-medium text-[#161919] transition-colors hover:bg-accent"
            >
              <SelectionBarAcceptIcon size={14} /> Accept
            </button>
          )}
        </div>
      )}
      {onRemoveFromWorkspace && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveFromWorkspace();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="size-3.5" /> Remove from workspace
        </button>
      )}
      <Dialog open={acceptWarningOpen} onOpenChange={setAcceptWarningOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Accept this suggestion</DialogTitle>
            <DialogDescription>This suggestion has warnings.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAcceptWarningOpen(false)}
              className="shrink-0 rounded-md border border-input px-3 py-1.5 text-[13px] font-medium text-foreground transition-opacity hover:opacity-80"
            >
              Review warnings
            </button>
            <button
              type="button"
              onClick={handleAcceptAnyway}
              className="shrink-0 rounded-md bg-[#00ded8] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Accept anyway
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Content only — no panel chrome (border/shadow/close button), so `DetailShell` can wrap it in
 * one consistent floating surface regardless of which canvas supplied it. */
export function ContextPanelBody({
  item,
  entities,
  onSwapRelation,
  onRenameRelation,
  onEditRelationDescription,
  onRenameEntity,
  onEditEntityDescription,
  onRenameProperty,
  onEditPropertyDescription,
  onRemoveEntityFromWorkspace,
  onRemoveTableFromWorkspace,
  onDeleteContextItem,
  onAcceptContextItem,
  onRejectContextItem,
  onAcceptMapping,
  onRejectMapping,
  onDisconnectMapping,
}: {
  item: ContextItem;
  /** The live ontology — needed to compute each kind's own "Why this confidence score?" evidence
   * (see `ReasoningContent` in mock-data.ts): Property/Relation reasoning both search across every
   * Entity's own Properties for corroborating tables/columns, and a mapped Column (the "column"
   * case below) needs it to find which Property/Entity actually maps into it. */
  entities: Entity[];
  onSwapRelation: (relationId: string) => void;
  onRenameRelation: (relationId: string, name: string) => void;
  onEditRelationDescription: (relationId: string, description: string) => void;
  onRenameEntity: (entityId: string, name: string) => void;
  onEditEntityDescription: (entityId: string, description: string) => void;
  onRenameProperty: (entityId: string, propertyId: string, name: string) => void;
  onEditPropertyDescription: (entityId: string, propertyId: string, description: string) => void;
  /** "Remove from workspace" for the currently-shown Entity — a workspace/view action, completely
   * separate from Delete, which no longer lives in this panel at all (see `ReviewedItemBody`'s own
   * "Remove from workspace" doc comment) — it only lives in the contextual selection control now.
   * Undefined whenever this particular Entity can't be removed (the
   * anchor, or a compact satellite only shown because of a real Relation) — the calling canvas
   * (`EntityDetailCanvas`) is the one that knows which case applies. */
  onRemoveEntityFromWorkspace?: (() => void) | undefined;
  /** Same idea, for a Data Table — always defined when the current item is a table, since every
   * table shown in this workspace can be removed from it (Data Tables have no Delete action at
   * all, only this). */
  onRemoveTableFromWorkspace?: (() => void) | undefined;
  /** Single selected Entity/Property/Relation's own Delete/Accept/Reject — see `ReviewedItemBody`'s
   * own doc comment. Already scoped to exactly this item and its current status by the caller
   * (`DetailView`'s own `deletableKeys`/`rejectableKeys`/`acceptableKeys`, the same eligibility the
   * contextual selection control uses) — undefined here means genuinely not eligible, never a
   * disabled button. */
  onDeleteContextItem?: (() => void) | undefined;
  onAcceptContextItem?: (() => void) | undefined;
  onRejectContextItem?: (() => void) | undefined;
  /** A mapped Column's own Mapping actions — Disconnect (Applied) or Accept/Reject (still
   * Suggested), per the module doc's lifecycle table. Unlike the three props above, these act on
   * the owning Property found below (`owner`/`property`), not on `item` itself, since selecting a
   * Column never joins the unified selection the way an Entity/Property/Relation does. */
  onAcceptMapping?: ((entityId: string, propertyId: string) => void) | undefined;
  onRejectMapping?: ((entityId: string, propertyId: string) => void) | undefined;
  onDisconnectMapping?: ((entityId: string, propertyId: string) => void) | undefined;
}) {
  switch (item.kind) {
    case "entity":
      return (
        <ReviewedItemBody
          status={entityStatus(item.entity)}
          name={item.entity.name}
          description={item.entity.description}
          confidence={item.entity.confidence}
          reasoning={entityReasoningContent(item.entity)}
          warningReason={item.entity.warningReason}
          errorReason={entityErrorReason(item.entity)}
          onRename={(name) => onRenameEntity(item.entity.id, name)}
          namePlaceholder="Name this Entity Type..."
          onEditDescription={(description) => onEditEntityDescription(item.entity.id, description)}
          onRemoveFromWorkspace={onRemoveEntityFromWorkspace}
          onDelete={onDeleteContextItem}
          onAccept={onAcceptContextItem}
          onReject={onRejectContextItem}
        />
      );
    case "property":
      return (
        <ReviewedItemBody
          status={propertyStatus(item.property)}
          name={item.property.name}
          description={item.property.description}
          confidence={item.property.confidence}
          reasoning={propertyReasoningContent(item.property, entities)}
          warningReason={item.property.warningReason}
          errorReason={propertyErrorReason(item.property)}
          onRename={(name) => onRenameProperty(item.entity.id, item.property.id, name)}
          namePlaceholder="Name this Property..."
          onEditDescription={(description) =>
            onEditPropertyDescription(item.entity.id, item.property.id, description)
          }
          onDelete={onDeleteContextItem}
          onAccept={onAcceptContextItem}
          onReject={onRejectContextItem}
        />
      );
    case "relation":
      return (
        <ReviewedItemBody
          status={relationStatus(item.relation, entities)}
          name={item.relation.name}
          description={item.relation.description}
          confidence={item.relation.confidence}
          reasoning={relationReasoningContent(item.relation, entities)}
          warningReason={item.relation.warningReason}
          errorReason={relationErrorReason(item.relation, entities)}
          relationActions={{ onSwap: () => onSwapRelation(item.relation.id) }}
          onRename={(name) => onRenameRelation(item.relation.id, name)}
          namePlaceholder="Name this relation..."
          onEditDescription={(description) =>
            onEditRelationDescription(item.relation.id, description)
          }
          onDelete={onDeleteContextItem}
          onAccept={onAcceptContextItem}
          onReject={onRejectContextItem}
        />
      );
    case "column": {
      // A mapped Column has a Property↔Column Mapping to explain; an unmapped one doesn't (see
      // `mappingReasoningContent`'s own doc comment) — this is the only place that owner/property
      // pair gets looked up, since `ContextItem`'s own "column" case only carries the raw
      // table+column, not which Property (if any) maps into it.
      const matchingMappings = entities.flatMap((entity) =>
        entity.properties
          .filter(
            (property) =>
              property.mapping?.table === item.tableName &&
              property.mapping.column === item.column.name,
          )
          .map((property) => ({ entity, property })),
      );
      const selectedMapping = item.mappingEntityId
        ? matchingMappings.find(
            ({ entity, property }) =>
              entity.id === item.mappingEntityId && property.id === item.mappingPropertyId,
          )
        : (matchingMappings.find(
            ({ property }) => property.mapping && mappingStatus(property.mapping) === "suggested",
          ) ?? matchingMappings[0]);
      const owner = selectedMapping?.entity;
      const property = selectedMapping?.property;
      const mapping = owner && property ? mappingReasoningContent(owner, property) : null;
      return (
        <>
          <p className="text-[16px] font-medium leading-[1.2] text-[#171b22]">{item.column.name}</p>
          <p className="text-[14px] font-normal leading-[1.2] text-[#909090]">
            {item.column.description}
          </p>
          {/* Confidence reasoning is a pending-suggestion fact, same rule as the Entity/Property/
              Relation action area below — gone once the mapping is Applied ("confirmed"). */}
          {mapping && property?.mapping && mappingStatus(property.mapping) === "suggested" && (
            <div className="flex w-full flex-col gap-3 rounded-[8px] bg-[#f8f8f8] p-4">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-medium leading-[1.2] text-[#171b22]">
                  Why this confidence score?
                </p>
                <ConfidenceChip confidence={property?.confidence} reasoning={mapping} />
              </div>
              <ReasoningSections content={mapping} />
            </div>
          )}
          {/* Mapping lifecycle — Disconnect once Mapped, Accept/Reject while still a Suggested
              mapping. This keys off the connector's own `MappingStatus` (independent of the
              Property's ontology review status — see `mappingStatus`'s own doc comment), since a
              Confirmed Property can still have a merely-Suggested mapping and vice versa. Mirrors
              the Entity/Property/Relation action area above but acts on the owning Property (found
              above), since a Column never joins the unified selection itself. */}
          {owner && property && property.mapping && (
            <div className="flex w-full items-center gap-2">
              {mappingStatus(property.mapping) === "mapped" ? (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDisconnectMapping?.(owner.id, property.id);
                  }}
                  className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Unlink2 className="size-3.5" /> Disconnect
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRejectMapping?.(owner.id, property.id);
                    }}
                    className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input px-3 text-[12px] font-medium text-[#161919] transition-colors hover:bg-accent"
                  >
                    <SelectionBarDeclineIcon size={14} /> Reject
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAcceptMapping?.(owner.id, property.id);
                    }}
                    className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-input px-3 text-[12px] font-medium text-[#161919] transition-colors hover:bg-accent"
                  >
                    <SelectionBarAcceptIcon size={14} /> Accept
                  </button>
                </>
              )}
            </div>
          )}
        </>
      );
    }
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
          {/* Data Tables have no Delete action at all in this app (see this function's own prop
              doc comment) — Remove from workspace is the only lifecycle action a table card
              offers, and it never touches the source Data Table itself, only this workspace's own
              view of it. */}
          {onRemoveTableFromWorkspace && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTableFromWorkspace();
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <LogOut className="size-3.5" /> Remove from workspace
            </button>
          )}
        </>
      );
  }
}
