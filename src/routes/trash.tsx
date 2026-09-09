import { createFileRoute } from "@tanstack/react-router";
import { useOntologyAppContext } from "@/lib/ontology-context";
import { TrashPage } from "@/components/trash/TrashPage";

export const Route = createFileRoute("/trash")({
  head: () => ({
    meta: [{ title: "Trash · Main" }],
  }),
  component: TrashRoute,
});

function TrashRoute() {
  const app = useOntologyAppContext();

  return (
    <TrashPage
      entities={app.entities}
      trashedEntities={app.trashedEntities}
      trashedProperties={app.trashedProperties}
      trashedRelations={app.trashedRelations}
      onRestoreEntity={app.restoreEntity}
      onRestoreProperty={app.restoreProperty}
      onRestoreRelation={app.restoreRelation}
    />
  );
}
