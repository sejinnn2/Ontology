import { createFileRoute } from "@tanstack/react-router";
import { useOntologyApp } from "@/lib/app-state";
import { OverviewCanvas } from "@/components/overview/OverviewCanvas";
import { DetailView } from "@/components/detail/DetailView";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Main" }],
  }),
  component: Index,
});

function Index() {
  const app = useOntologyApp();

  if (app.detail) {
    return <DetailView app={app} anchor={app.detail} />;
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <OverviewCanvas app={app} />
    </div>
  );
}
