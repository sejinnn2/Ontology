import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Main" }],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <p className="text-sm text-muted-foreground">New project. Nothing here yet.</p>
    </div>
  );
}
