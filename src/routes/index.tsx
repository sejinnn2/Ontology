import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useOntologyAppContext } from "@/lib/ontology-context";
import { OverviewCanvas } from "@/components/overview/OverviewCanvas";
import { DetailView, type AnchorMorphRects } from "@/components/detail/DetailView";
import { Header } from "@/components/nav/Header";
import { GlobalSidebar } from "@/components/nav/GlobalSidebar";
import { EntityMorphOverlay } from "@/components/overview/EntityMorphOverlay";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Main" }],
  }),
  component: Index,
});

function Index() {
  const app = useOntologyAppContext();
  const inEditing = app.detail != null;

  // Drives the Overview → Editing enter transition: the contained workspace boundary fades/scales
  // in from the open canvas rather than just appearing — see the wrapper below. Keyed on `inEditing`
  // itself (not on which entity/table `app.detail` points at), so switching the anchor WHILE already
  // inside Editing (clicking a related entity, a different toolbox row, etc.) never replays it —
  // only the actual Overview→Editing boundary crossing does. Skipped entirely while a morph
  // transition is in flight (`app.entityMorphOrigin` set — see below): the overlay is already the
  // entrance animation in that case, and letting this container ALSO scale in at the same time
  // would (a) visually compete with it and (b) throw off the morph target measurement, which reads
  // the real card's position while this container is still mid-transition otherwise.
  const [editingEntered, setEditingEntered] = useState(false);
  useEffect(() => {
    if (!inEditing) {
      setEditingEntered(false);
      return;
    }
    if (app.entityMorphOrigin) {
      setEditingEntered(true);
      return;
    }
    const raf = requestAnimationFrame(() => setEditingEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [inEditing, app.entityMorphOrigin]);

  // The Overview→Editing morph transition's own target — reported by DetailView once the anchor
  // card's header has settled into its final resting position (see `onAnchorMorphTarget`'s own
  // doc comment). Reset back to `null` at the start of every new morph so a stale target from a
  // previous transition can never leak into the next one.
  const [morphTarget, setMorphTarget] = useState<AnchorMorphRects | null>(null);
  const morphEntityId = app.entityMorphOrigin?.entityId ?? null;
  useEffect(() => {
    setMorphTarget(null);
  }, [morphEntityId]);
  const morphEntity = morphEntityId
    ? (app.entities.find((e) => e.id === morphEntityId) ?? null)
    : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <GlobalSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          entities={app.entities}
          relations={app.relations}
          tables={app.tables}
          onSelectSearchResult={app.selectSearchResult}
          onSelectIssue={app.selectIssue}
          historyLog={app.historyLog}
          historyPanelOpen={app.historyPanelOpen}
          onHistoryPanelOpenChange={app.setHistoryPanelOpen}
          historyInspection={app.historyInspection}
          historyInspectionHoveredNumber={app.historyInspectionHoveredNumber}
          onEnterHistoryInspection={app.enterHistoryInspection}
          onExitHistoryInspection={app.exitHistoryInspection}
          onToggleHistoryChangeSelected={app.toggleHistoryChangeSelected}
          onHistoryHoverChange={app.setHistoryInspectionHoveredNumber}
          onRestoreSelectedHistoryChanges={app.restoreSelectedHistoryChanges}
        />
        <div className="relative min-h-0 flex-1">
          {app.detail ? (
            // The Editing workspace: flush, edge-to-edge — same as Overview, no inset/rounded
            // "contained workspace" card. "← Back to Ontology view" floats over DetailView's own
            // canvas (see DetailShell), never in the Header above, which stays GLOBAL and
            // unchanged across the transition.
            <div
              className={cn(
                "relative h-full w-full overflow-hidden bg-white transition-opacity duration-300 ease-out",
                editingEntered ? "opacity-100" : "opacity-0",
              )}
            >
              <DetailView app={app} anchor={app.detail} onAnchorMorphTarget={setMorphTarget} />
            </div>
          ) : (
            <OverviewCanvas app={app} />
          )}
        </div>
      </div>
      {app.entityMorphOrigin && morphEntity && (
        <EntityMorphOverlay
          circleOrigin={app.entityMorphOrigin.circleRect}
          labelOrigin={app.entityMorphOrigin.labelRect}
          target={morphTarget}
          status={morphEntity.status}
          confidence={morphEntity.confidence}
          name={morphEntity.name}
          warningReason={morphEntity.warningReason}
          errorReason={morphEntity.errorReason}
          onDone={() => {
            setMorphTarget(null);
            app.clearEntityMorphOrigin();
          }}
        />
      )}
    </div>
  );
}
