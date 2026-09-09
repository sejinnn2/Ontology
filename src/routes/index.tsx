import { createFileRoute } from "@tanstack/react-router";
import { useOntologyAppContext } from "@/lib/ontology-context";
import { OverviewCanvas } from "@/components/overview/OverviewCanvas";
import { DetailView } from "@/components/detail/DetailView";
import { Header } from "@/components/nav/Header";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Main" }],
  }),
  component: Index,
});

function Index() {
  const app = useOntologyAppContext();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Header
        entities={app.entities}
        relations={app.relations}
        tables={app.tables}
        confirmItems={app.confirmItems}
        trashCount={
          app.trashedEntities.length + app.trashedProperties.length + app.trashedRelations.length
        }
        confidenceRange={app.confidenceRange}
        onConfidenceRangeChange={app.setConfidenceRange}
        {...(app.detail ? { onBack: app.closeDetail } : {})}
      />
      <div className="relative min-h-0 flex-1">
        {app.detail ? <DetailView app={app} anchor={app.detail} /> : <OverviewCanvas app={app} />}
      </div>
    </div>
  );
}
