import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Agentation } from "agentation";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OntologyAppProvider, useOntologyAppContext } from "@/lib/ontology-context";

function DevScenarioSwitcher() {
  const app = useOntologyAppContext();
  return (
    <div className="flex h-10 shrink-0 items-center justify-center gap-1 border-b border-white/10 bg-[#1c1c18] px-3">
      <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-white/55">
        Demo fixture
      </span>
      {(["fresh", "in-progress"] as const).map((scenario, index) => (
        <button
          key={scenario}
          type="button"
          onClick={() => app.resetDemoScenario(scenario)}
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
            app.demoScenario === scenario
              ? "bg-white text-[#1c1c18]"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          {index === 0 ? "01 · Fresh" : "02 · In Progress"}
        </button>
      ))}
    </div>
  );
}

function OntologyRoutes() {
  const { demoScenario } = useOntologyAppContext();
  return <Outlet key={demoScenario} />;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      { name: "description", content: "Lovable Generated Project" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Inter:opsz,wght@14..32,400..900&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {import.meta.env.DEV && <Agentation endpoint="http://localhost:8080" />}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* One shared delay for every Confidence/status-icon tooltip in the app — see
          components/ui/tooltip.tsx for the shared black/white look those tooltips use. */}
      <TooltipProvider delayDuration={150}>
        {/* One shared ontology app instance for every route (the canvas at `/`, the Trash page
            at `/trash`) — mounted here, above the Outlet, so navigating between them never
            resets or forks the entities/relations/trash state. */}
        <OntologyAppProvider>
          <div className="flex h-screen flex-col overflow-hidden">
            {import.meta.env.DEV && <DevScenarioSwitcher />}
            <div className="min-h-0 flex-1">
              {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
              <OntologyRoutes />
            </div>
          </div>
        </OntologyAppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
