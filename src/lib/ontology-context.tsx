import { createContext, useContext, type ReactNode } from "react";
import { useOntologyApp, type OntologyApp } from "./app-state";

const OntologyAppContext = createContext<OntologyApp | null>(null);

/** Mounted once at the app root (see `__root.tsx`) so every route — the Ontology canvas at `/`
 * and the Trash page at `/trash` — reads and mutates the exact same `useOntologyApp()` instance,
 * rather than each route call site creating its own independent (and instantly out of sync)
 * entities/relations state. Routing between them is a normal client-side navigation, not a full
 * reload, so this provider — and the state inside it — never remounts when the URL changes. */
export function OntologyAppProvider({ children }: { children: ReactNode }) {
  const app = useOntologyApp();
  return <OntologyAppContext.Provider value={app}>{children}</OntologyAppContext.Provider>;
}

export function useOntologyAppContext(): OntologyApp {
  const app = useContext(OntologyAppContext);
  if (!app) throw new Error("useOntologyAppContext must be used within OntologyAppProvider");
  return app;
}
