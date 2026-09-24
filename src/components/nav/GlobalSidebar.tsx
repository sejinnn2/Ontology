import {
  Search,
  Sparkles,
  Share2,
  Library,
  FileSearch,
  Download,
  Database,
  TrendingUp,
  Presentation,
  BookOpen,
  Settings,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** One icon slot in the global sidebar below — every one of these (besides the active Ontology
 * item) is pure chrome: it visually represents another section of the wider Zaimler product this
 * Ontology mapping workspace lives inside, but none of them navigate anywhere from here. The
 * active item is marked by a solid teal bar flush against the sidebar's own left edge (Figma:
 * node 114:19289) rather than a filled background pill — the `-left-[10px]` offset reaches back
 * through this icon's own centered position (the sidebar is 56px wide, the icon 36px, so it sits
 * 10px in from the true edge) to land the bar flush against it. */
function NavIcon({
  icon,
  active,
  label,
}: {
  icon: React.ReactNode;
  active?: boolean;
  label: string;
}) {
  return (
    <div className="relative">
      {active && (
        <span
          aria-hidden="true"
          className="absolute -left-[10px] top-1/2 h-9 w-1 -translate-y-1/2 bg-[#00ded8]"
        />
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="size-5 [&>svg]:size-full">{icon}</span>
      </button>
    </div>
  );
}

/** The global, product-level icon rail down the left edge — sits OUTSIDE this Ontology workspace
 * entirely (every icon besides the active one stands for some other Zaimler product section that
 * doesn't exist in this prototype) purely so the workspace reads as embedded in the real product
 * shell, per the Figma "Overview"/"Editing mode" frames this was built from. None of these icons
 * are wired to navigate anywhere — see `NavIcon`'s own comment. */
export function GlobalSidebar() {
  return (
    <div className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-background">
      <div className="flex h-14 w-full shrink-0 items-center justify-center">
        <div className="flex size-10 items-center justify-center rounded-[10px] bg-[#00ded8]">
          <svg viewBox="0 0 20 20" className="size-5" fill="none">
            <path
              d="M4 5.5h8L4 14.5h8"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
      <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2 pb-3">
        <div className="h-px w-5 shrink-0 bg-border" />
        <div className="flex flex-col items-center gap-0.5">
          <NavIcon icon={<Search />} label="Search" />
          <NavIcon icon={<Sparkles />} label="AI search" />
          <NavIcon icon={<Share2 />} active label="Ontology" />
          <NavIcon icon={<Library />} label="Library" />
          <NavIcon icon={<FileSearch />} label="Documents" />
          <NavIcon icon={<Download />} label="Import" />
          <NavIcon icon={<Database />} label="Data sources" />
          <NavIcon icon={<TrendingUp />} label="Insights" />
        </div>
        <div className="flex-1" />
        <div className="h-px w-5 shrink-0 bg-border" />
        <div className="flex flex-col items-center gap-0.5">
          <NavIcon icon={<Presentation />} label="Reports" />
          <NavIcon icon={<BookOpen />} label="Documentation" />
          <NavIcon icon={<Settings />} label="Settings" />
          <NavIcon icon={<Globe />} label="Workspace" />
        </div>
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-medium text-muted-foreground">
          SM
        </div>
      </div>
    </div>
  );
}
