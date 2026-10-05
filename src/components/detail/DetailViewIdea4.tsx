import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DetailAnchor, OntologyApp } from "@/lib/app-state";
import { parseSuggestionKey } from "@/lib/app-state";
import {
  entitiesUsingTable,
  entityDisplayStatus,
  entityErrorReason,
  entityReview,
  entityWarningReason,
  tableByName,
  tableHighestMappingConfidence,
  tableMappingCompleteness,
  tableMappingStatus,
  tablesUsedByEntity,
  type Entity,
  type TableSchema,
} from "@/lib/mock-data";
import { StatusBadge } from "@/components/ontology/StatusBadge";
import { MappingStatusBadge } from "@/components/overview/MappingStatusBadge";
import { EntityConfidenceChip } from "@/components/ontology/ConfidenceChip";
import {
  DEFAULT_SORT,
  nextSortState,
  sortByState,
  SortDropdown,
  type SortKey,
  type SortState,
} from "@/components/ontology/SortDropdown";
import { EditingGraphView, TableGraphView } from "@/components/detail/EditingGraph";
import {
  acceptsPropertyDrop,
  dropPropertiesOn,
  leftDropTarget,
} from "@/components/detail/property-move";
import { ENTITY_PANEL_DND_TYPE, TABLE_PANEL_DND_TYPE } from "@/components/detail/panel-dnd";
import { ItemEditorModal, type EditorRequest } from "@/components/detail/ItemEditorModal";
import { CreateButton, FigmaIcon } from "@/components/detail/list-controls";
import { isTypingTarget } from "@/components/ontology/CanvasControls";
import {
  SidePanelContext,
  useSidePanelOpen,
  FLOATING_CARD,
  useSidePanels,
} from "@/components/detail/editing-canvas";
import { cn } from "@/lib/utils";
import dotGridIcon from "@/assets/icons/dot-grid-2x3-16.svg";
import searchIcon from "@/assets/icons/magnifying-glass-2-16.svg";
import panelOpenIcon from "@/assets/icons/side-panel-open-16.svg";

/**
 * The editing workspace: the Entity types panel, the Graph, and the Data tables panel. Opened on an
 * Entity Type it's that Entity Type's Graph (`EditingGraphView`); opened on a Data Table, the
 * table's (`TableGraphView`). Creating / editing items happens in `ItemEditorModal`.
 */
export function DetailViewIdea4({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
  if (anchor?.kind === "table") {
    const table = tableByName(anchor.id);
    return table ? <TableWorkspace app={app} table={table} /> : <EmptyWorkspace />;
  }
  return <EntityWorkspace app={app} anchor={anchor} />;
}

function EmptyWorkspace() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Select an Entity Type or a Data Table to start editing.
    </div>
  );
}

// Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z for the app-wide undo/redo stack (see `useOntologyApp`'s own
// `undo`/`redo`), except while typing.
function useUndoRedoShortcuts(onUndo: () => void, onRedo: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo, onRedo]);
}

/**
 * An Entity Type just made by a Split: outlined (and scrolled to) in the Entity types panel so it
 * can be found (Figma 542:87832), until the next click anywhere.
 */
function useNewEntityHighlight() {
  const [newEntityId, setNewEntityId] = useState<string | null>(null);
  useEffect(() => {
    if (!newEntityId) return;
    const clear = () => setNewEntityId(null);
    // Armed after this click has finished, so the Split press itself doesn't clear it.
    const timer = window.setTimeout(() => window.addEventListener("pointerdown", clear), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", clear);
    };
  }, [newEntityId]);
  return { newEntityId, setNewEntityId };
}

/** The Edit modal every part of the workspace opens (creating happens in place — see
 * `PropertyDraftRow`, `startRelationDraft` and `startEntityDraft`). */
function useItemEditor(app: OntologyApp) {
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const editKey = useCallback((key: string) => {
    const ref = parseSuggestionKey(key);
    if (ref) setEditor({ mode: "edit", ref });
  }, []);
  const modal = <ItemEditorModal app={app} request={editor} onClose={() => setEditor(null)} />;
  return { editKey, modal };
}

/** An Entity Type just created in place is pointed out once the workspace is back (see
 * `useNewEntityHighlight`). */
function useCreatedEntityHighlight(app: OntologyApp, setNewEntityId: (id: string) => void) {
  const { createdEntityId, clearCreatedEntity } = app;
  useEffect(() => {
    if (!createdEntityId) return;
    setNewEntityId(createdEntityId);
    clearCreatedEntity();
  }, [createdEntityId, clearCreatedEntity, setNewEntityId]);
}

function EntityWorkspace({ app, anchor }: { app: OntologyApp; anchor: DetailAnchor }) {
  useUndoRedoShortcuts(app.undo, app.redo);
  const sidePanels = useSidePanels();
  const { newEntityId, setNewEntityId } = useNewEntityHighlight();
  useCreatedEntityHighlight(app, setNewEntityId);
  const { editKey, modal } = useItemEditor(app);
  const focusEntity = useMemo(
    () =>
      anchor?.kind === "entity" ? (app.entities.find((e) => e.id === anchor.id) ?? null) : null,
    [anchor, app.entities],
  );
  // The Entity Types it's related to, marked in the Entity types panel.
  const relatedIds = useMemo(() => {
    if (!focusEntity) return new Set<string>();
    return new Set(
      app.relations
        .filter((r) => r.from === focusEntity.id || r.to === focusEntity.id)
        .map((r) => (r.from === focusEntity.id ? r.to : r.from))
        .filter((id) => id !== focusEntity.id),
    );
  }, [app.relations, focusEntity]);
  if (!focusEntity) return <EmptyWorkspace />;
  return (
    <SidePanelContext.Provider value={sidePanels}>
      <div className="relative flex h-full w-full overflow-hidden bg-white">
        <Idea4EntityPanel
          app={app}
          onCreate={app.creation ? undefined : () => void app.startEntityDraft()}
          focusEntityId={focusEntity.id}
          workingIds={relatedIds}
          highlightId={newEntityId}
        />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f9fafb]">
          <EditingGraphView
            app={app}
            focusEntity={focusEntity}
            onEdit={editKey}
            onSplit={setNewEntityId}
          />
        </main>
        <Idea4TablePanel app={app} activeNames={new Set(tablesUsedByEntity(focusEntity))} />
        {modal}
      </div>
    </SidePanelContext.Provider>
  );
}

function TableWorkspace({ app, table }: { app: OntologyApp; table: TableSchema }) {
  useUndoRedoShortcuts(app.undo, app.redo);
  const sidePanels = useSidePanels();
  const { newEntityId, setNewEntityId } = useNewEntityHighlight();
  useCreatedEntityHighlight(app, setNewEntityId);
  const { editKey, modal } = useItemEditor(app);
  // The Entity Types mapped into it, marked in the Entity types panel.
  const usingIds = useMemo(
    () => new Set(entitiesUsingTable(table.name, app.entities).map((e) => e.id)),
    [table.name, app.entities],
  );
  return (
    <SidePanelContext.Provider value={sidePanels}>
      <div className="relative flex h-full w-full overflow-hidden bg-white">
        <Idea4EntityPanel
          app={app}
          onCreate={app.creation ? undefined : () => void app.startEntityDraft()}
          workingIds={usingIds}
          highlightId={newEntityId}
        />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f9fafb]">
          <TableGraphView app={app} table={table} onEdit={editKey} onSplit={setNewEntityId} />
        </main>
        <Idea4TablePanel app={app} activeNames={new Set()} focusName={table.name} />
        {modal}
      </div>
    </SidePanelContext.Provider>
  );
}

// Figma Icon Button (sm, Ghost): 24px, 6px radius, #e3e5e4 on hover.
const PANEL_ICON_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-[6px] hover:bg-[#e3e5e4]";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "8 props · 2 tables" — the tables are the distinct source tables its Properties map into. */
function entityRowDetail(entity: Entity): string {
  const tables = new Set(entity.properties.flatMap((p) => p.mappings.map((m) => m.table)));
  return `${plural(entity.properties.length, "prop", "props")} · ${plural(tables.size, "table", "tables")}`;
}

/** "8 columns · 2 entities" — the entities are the ones with a Property mapped into this table. */
function tableRowDetail(table: TableSchema, entities: Entity[]): string {
  const mapped = entities.filter((entity) =>
    entity.properties.some((p) => p.mappings.some((m) => m.table === table.name)),
  ).length;
  return `${plural(table.columns.length, "column", "columns")} · ${plural(mapped, "entity", "entities")}`;
}

/** Sort + Search row shared by the Entity types / Data tables side panels — same search-toggle
 * behavior as `ListControls` (Escape or X clears and closes), restyled to the panels' own 32px
 * Figma row. */
function SidePanelListControls({
  sort,
  onSortChange,
  search,
  onSearchChange,
  searchPlaceholder,
  onCreate,
  createLabel,
}: {
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  onCreate?: (() => void) | undefined;
  createLabel?: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = () => {
    onSearchChange("");
    setSearchOpen(false);
  };
  return (
    // Figma "filter section" (node 449:28557): 40px, pl-10/pr-12, bottom hairline.
    <div className="relative z-50 flex h-10 shrink-0 items-center gap-2 border-b border-[#e3e5e4] pl-2.5 pr-3 text-[14px] text-[#6d7472]">
      {searchOpen ? (
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeSearch();
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-[14px] text-[#161919] outline-none placeholder:text-[#9ea3a2]"
        />
      ) : (
        <SortDropdown sort={sort} onChange={onSortChange} showPrefix={false} variant="figma" />
      )}
      <div className="ml-auto flex items-center gap-0.5">
        {onCreate && <CreateButton label={createLabel ?? "Create"} onClick={onCreate} />}
        <button
          type="button"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          aria-label={searchOpen ? "Close search" : "Search"}
          className="flex size-5 shrink-0 items-center justify-center rounded-[6px] hover:bg-[#e3e5e4]"
        >
          {searchOpen ? <X className="size-4" strokeWidth={1.5} /> : <FigmaIcon src={searchIcon} />}
        </button>
      </div>
    </div>
  );
}

function SidePanelEmpty({ query }: { query: string }) {
  return (
    <p className="px-4 py-3 text-[12px] text-[#6d7472]">
      {query ? `No matches for “${query}”` : "Nothing here yet"}
    </p>
  );
}

/**
 * The pointer's drag image for a panel row (Figma 328:15086): a compact 32px card of the row's grip,
 * status and name, instead of a snapshot of the whole row.
 */
function setCompactDragImage(event: React.DragEvent<HTMLElement>, name: string) {
  const row = event.currentTarget;
  const ghost = document.createElement("div");
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-1000px",
    left: "-1000px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "32px",
    padding: "0 12px",
    background: "#fff",
    border: "1px solid #e3e5e4",
    borderRadius: "8px",
    boxShadow: "0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)",
    font: "500 14px/20px var(--font-sans)",
    color: "#161919",
    whiteSpace: "nowrap",
  });
  const [grip, badge] = Array.from(row.children);
  if (grip) ghost.append(grip.cloneNode(true));
  if (badge) ghost.append(badge.cloneNode(true));
  const label = document.createElement("span");
  label.textContent = name || "Untitled entity";
  ghost.append(label);
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, 20, 16);
  window.setTimeout(() => ghost.remove(), 0);
}

/** The Entity types panel collapsed (Figma 328:30397): a floating card in the canvas's top-left
 * corner — its name and an expand button — so the canvas gets the panel's full width. */
function CollapsedEntityPanel({ onExpand }: { onExpand: () => void }) {
  return (
    // Figma 328:30397: 120px, pl-12 pr-8, 14px Medium label + the side-panel-open glyph.
    <div className={cn(FLOATING_CARD, "absolute left-3 top-3 z-40 w-[120px] pl-3 pr-2")}>
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-[#161919]">
        Entity types
      </span>
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand Entity types panel"
        className="flex size-6 shrink-0 items-center justify-center rounded-[6px] hover:bg-black/[0.04]"
      >
        <FigmaIcon src={panelOpenIcon} />
      </button>
    </div>
  );
}

// Figma side-panel rows (nodes 460:40912 / 460:41163): 48px (py-6 + two lines), pl-12/pr-10,
// gap-8. The focus row is blue (`#eff6ff` + a 2px `#3b82f6` left border, matching the selected
// canvas card); rows already on the canvas get a 2px `#6d7472` left border. Bordered rows trade
// 2px of left padding for the border so the content stays at x=12.
function sidePanelRowClass(state: "focus" | "related" | "idle") {
  return cn(
    "flex w-full items-center gap-2 py-1.5 pr-2.5 text-left",
    state === "focus"
      ? "border-l-2 border-[#3b82f6] bg-[#eff6ff] pl-2.5"
      : state === "related"
        ? "border-l-2 border-[#6d7472] bg-white pl-2.5 hover:bg-[#e3e5e4]"
        : "bg-white pl-3 hover:bg-[#e3e5e4]",
  );
}

/** A side-panel row's two lines: Medium 14/20 name over a Regular 12/16 detail. */
function SidePanelRowText({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[14px] font-medium leading-5 text-[#161919]">{name}</span>
      <span className="truncate text-[12px] leading-4 text-[#6d7472]">{detail}</span>
    </span>
  );
}

function Idea4EntityPanel({
  app,
  focusEntityId,
  workingIds,
  onCreate,
  highlightId,
}: {
  app: OntologyApp;
  focusEntityId?: string;
  workingIds: Set<string>;
  // An Entity Type to point out (just created by a Split): outlined and scrolled into view.
  highlightId?: string | null | undefined;
  // The + in the filter row: create a new Entity Type (in place — see `startEntityDraft`).
  onCreate?: (() => void) | undefined;
}) {
  const [open, setOpen] = useSidePanelOpen("entity");
  const highlightRef = useRef<HTMLButtonElement>(null);
  // A row a dragged Property is over (it moves the Property to that Entity Type on drop).
  const [dropId, setDropId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  useEffect(() => {
    if (highlightId) highlightRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlightId]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const rows = useMemo(
    () =>
      sortByState(
        app.entities.filter((entity) => entity.name.toLowerCase().includes(query.toLowerCase())),
        sort,
        (entity) => entity.name,
        (entity) => entity.confidence,
      ),
    [app.entities, query, sort],
  );
  if (!open) {
    return <CollapsedEntityPanel onExpand={() => setOpen(true)} />;
  }
  return (
    // Rebuilt directly off the Figma "Panel-Entity types" node (406:5388, fetched in full — not
    // just its screenshot) — see the per-element comments below for what each value is sampled
    // from.
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-[#e3e5e4] bg-white">
      {/* Title, 48px (Figma 328:30992) — the collapse glyph is Side-panel--open turned 180°. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#e3e5e4] pl-4 pr-3">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-[#161919]">
          Entity types
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse Entity types panel"
          className={PANEL_ICON_BUTTON}
        >
          <FigmaIcon src={panelOpenIcon} className="rotate-180" />
        </button>
      </div>
      <SidePanelListControls
        sort={sort}
        onSortChange={(key) => setSort((prev) => nextSortState(prev, key))}
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search entity types…"
        onCreate={onCreate}
        createLabel="New entity type"
      />
      {rows.length === 0 && <SidePanelEmpty query={query} />}
      {/* Rows (Figma node 460:40911): focus / on-canvas / idle states — see
          `sidePanelRowClass`. 2px gap between rows, no dividers. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {rows.map((entity) => {
          const isFocus = entity.id === focusEntityId;
          const isRelated = !isFocus && workingIds.has(entity.id);
          return (
            <button
              key={entity.id}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ENTITY_PANEL_DND_TYPE, entity.id);
                setCompactDragImage(e, entity.name);
                setDraggingId(entity.id);
              }}
              onDragEnd={() => setDraggingId(null)}
              onClick={() => app.openDetail("entity", entity.id)}
              onDragEnter={(e) => {
                if (!acceptsPropertyDrop(e, entity.id)) return;
                e.preventDefault();
                setDropId(entity.id);
              }}
              onDragOver={(e) => {
                if (!acceptsPropertyDrop(e, entity.id)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropId !== entity.id) setDropId(entity.id);
              }}
              onDragLeave={(e) => {
                if (!leftDropTarget(e)) return;
                setDropId((current) => (current === entity.id ? null : current));
              }}
              onDrop={(e) => {
                setDropId(null);
                dropPropertiesOn(app, e, entity.id);
              }}
              ref={entity.id === highlightId ? highlightRef : undefined}
              className={cn(
                sidePanelRowClass(isFocus ? "focus" : isRelated ? "related" : "idle"),
                // The row being dragged stays grey for the whole drag (Figma 350:98084).
                entity.id === draggingId && "bg-[#e3e5e4]",
                entity.id === highlightId &&
                  "outline outline-2 -outline-offset-2 outline-[#161919]",
                entity.id === dropId &&
                  "bg-[#00ded8]/10 outline outline-[1.5px] -outline-offset-[1.5px] outline-[#00ded8]",
              )}
            >
              <span className="shrink-0 active:cursor-grabbing" style={{ cursor: "grab" }}>
                <FigmaIcon src={dotGridIcon} />
              </span>
              <StatusBadge
                status={entityDisplayStatus(entity)}
                size={16}
                confidence={entity.confidence}
                warningReason={entityWarningReason(entity)}
                errorReason={entityErrorReason(entity)}
              />
              <SidePanelRowText
                name={entity.name || "New entity type"}
                detail={entityRowDetail(entity)}
              />
              {/* Figma 328:30991: every row but a confirmed one shows its score. */}
              {entityReview(entity) === "suggested" && (
                <EntityConfidenceChip entity={entity} tone="muted" />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function Idea4TablePanel({
  app,
  activeNames,
  focusName,
}: {
  app: OntologyApp;
  activeNames: Set<string>;
  // The table this workspace is open on — same focus treatment as `Idea4EntityPanel`'s own focus
  // row (blue left bar + tint), distinct from the gray bar for tables merely on canvas.
  focusName?: string;
}) {
  // Rebuilt directly off the Figma "Panel-Data tables" node (417:13975) — the same reskin pass
  // `Idea4EntityPanel` above already got off its own "Panel-Entity types" node, just mirrored:
  // this panel sits on the workspace's right edge (`border-l`, not `border-r`), so its collapse
  // glyph is the same IconSidebarWideLeftArrow mirrored, as Figma draws it.
  const [open, setOpen] = useSidePanelOpen("table");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  // Tables have no confidence of their own — "Confidence" sorts by the strongest mapping into
  // each table, the same proxy Overview's own Data tables panel sorts by.
  const rows = useMemo(
    () =>
      sortByState(
        app.tables.filter((table) => table.name.toLowerCase().includes(query.toLowerCase())),
        sort,
        (table) => table.name,
        (table) => tableHighestMappingConfidence(table.name, app.entities),
      ),
    [app.tables, app.entities, query, sort],
  );
  // Collapsed, it lives in the canvas's zoom card (`CanvasZoomCard`) — Figma 353:132125.
  if (!open) return null;
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-l border-[#e3e5e4] bg-white">
      {/* Figma 328:31741: mirrored — the collapse button first, then the title. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#e3e5e4] pl-3 pr-4">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse Data tables panel"
          className={PANEL_ICON_BUTTON}
        >
          <FigmaIcon src={panelOpenIcon} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-[#161919]">
          Data tables
        </span>
      </div>
      <SidePanelListControls
        sort={sort}
        onSortChange={(key) => setSort((prev) => nextSortState(prev, key))}
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search data tables…"
      />
      {rows.length === 0 && <SidePanelEmpty query={query} />}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {rows.map((table) => {
          // Same focus / on-canvas / idle row states as the Entity types panel (Figma 460:41162).
          const isFocus = table.name === focusName;
          const isRelated = !isFocus && activeNames.has(table.name);
          return (
            <button
              key={table.name}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TABLE_PANEL_DND_TYPE, table.name);
              }}
              onClick={() => app.openDetail("table", table.name)}
              className={sidePanelRowClass(isFocus ? "focus" : isRelated ? "related" : "idle")}
            >
              <span className="shrink-0 active:cursor-grabbing" style={{ cursor: "grab" }}>
                <FigmaIcon src={dotGridIcon} />
              </span>
              <MappingStatusBadge
                status={tableMappingStatus(table.name, app.entities)}
                {...tableMappingCompleteness(table.name, app.entities)}
                size={16}
              />
              <SidePanelRowText name={table.name} detail={tableRowDetail(table, app.entities)} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
