import { AlertTriangle, CircleAlert, CircleCheck, Unlink, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { datasetPublishable, type DatasetReview, type PublishJob } from "@/lib/publish";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Publish confirmation — what Publish will do, in a few lines: which datasets go out, and how many
 * Warnings and Errors there are. Datasets with Warnings are published; datasets with Errors are
 * skipped. The issues themselves live in the Warning/Error list ("View warnings and errors").
 * Publishing still happens one dataset at a time: confirming queues each ready dataset as its own
 * publish.
 */
export function PublishReview({
  open,
  onOpenChange,
  reviews,
  jobs,
  queue,
  onPublish,
  onViewIssues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviews: DatasetReview[];
  jobs: Record<string, PublishJob>;
  queue: string[];
  onPublish: (tables: string[]) => void;
  onViewIssues: () => void;
}) {
  const busy = (table: string) =>
    queue.includes(table) ||
    jobs[table]?.phase === "publishing" ||
    jobs[table]?.phase === "ingesting";
  const ready = reviews.filter((r) => datasetPublishable(r) && !busy(r.table));
  const withWarnings = ready.filter((r) => r.warnings.length > 0);
  const skipped = reviews.filter((r) => r.errors.length > 0);
  const upToDate = reviews.filter((r) => r.upToDate && r.errors.length === 0);
  const inProgress = reviews.filter((r) => busy(r.table));
  const warningCount = reviews.reduce((n, r) => n + r.warnings.length, 0);
  const errorCount = reviews.reduce((n, r) => n + r.errors.length, 0);
  const nothingReady = ready.length === 0;
  const unmappedRelations = new Set(ready.flatMap((r) => r.unmappedRelations)).size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="flex max-w-[440px] flex-col gap-0 overflow-hidden rounded-2xl border-[rgba(28,28,24,0.08)] bg-white p-0 shadow-[var(--shadow-node-lift)]"
      >
        <div className="flex items-start justify-between px-5 pb-2 pt-5">
          <DialogTitle className="text-[16px] font-semibold text-[#1c1c18]">
            {nothingReady
              ? "Nothing ready to publish"
              : `Publish ${plural(ready.length, "dataset")}?`}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="-mr-1 -mt-1 flex size-7 items-center justify-center rounded-md text-[#707070] hover:bg-accent hover:text-[#1c1c18]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2.5 px-5 pb-4 text-[13px] leading-5 text-[#3C3C3C]">
          <SummaryLine icon={<CircleCheck className="size-4 text-[#0298b2]" />}>
            <b className="font-medium text-[#1c1c18]">{plural(ready.length, "dataset")}</b> ready to
            publish
            {withWarnings.length > 0 && ` — ${withWarnings.length} with warnings`}
          </SummaryLine>
          <SummaryLine icon={<AlertTriangle className="size-4 text-[#e6c200]" />}>
            {warningCount === 0 ? (
              "No warnings."
            ) : (
              <>
                <b className="font-medium text-[#1c1c18]">{plural(warningCount, "warning")}</b> —
                datasets with warnings are published.
              </>
            )}
          </SummaryLine>
          <SummaryLine icon={<CircleAlert className="size-4 text-[#f15b15]" />}>
            {errorCount === 0 ? (
              "No errors — no dataset will be skipped."
            ) : (
              <>
                <b className="font-medium text-[#1c1c18]">{plural(errorCount, "error")}</b> —{" "}
                {plural(skipped.length, "dataset")} with errors will be{" "}
                <b className="font-medium text-[#1c1c18]">skipped</b>, not published.
              </>
            )}
          </SummaryLine>
          {unmappedRelations > 0 && (
            <SummaryLine icon={<Unlink className="size-4 text-[#707070]" />}>
              <b className="font-medium text-[#1c1c18]">{plural(unmappedRelations, "relation")}</b>{" "}
              not mapped yet — published without linking records. Relation mappings are optional.
            </SummaryLine>
          )}
          {(upToDate.length > 0 || inProgress.length > 0) && (
            <p className="pl-6 text-[12px] text-[#707070]">
              {[
                upToDate.length > 0 && `${plural(upToDate.length, "dataset")} already up to date`,
                inProgress.length > 0 && `${inProgress.length} publishing now`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p
            className={cn(
              "mt-1 rounded-[8px] px-3 py-2 text-[12px]",
              nothingReady ? "bg-[#f4f4f4] text-[#3C3C3C]" : "bg-[#fafafa] text-[#707070]",
            )}
          >
            {nothingReady
              ? "No dataset can be published yet. Fix the errors in the editor, then publish again."
              : "Each dataset is published and ingested on its own, one after another — if one fails, the others still publish."}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#e3e5e4] px-5 py-3">
          <button
            type="button"
            onClick={onViewIssues}
            className="h-8 rounded-[6px] px-2 text-[13px] font-medium text-[#1c1c18] hover:bg-[#f4f4f4]"
          >
            View warnings and errors
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 rounded-[6px] border border-[#e3e5e4] px-3 text-[13px] font-medium text-[#1c1c18] hover:bg-[#f4f4f4]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={nothingReady}
              onClick={() => {
                onPublish(ready.map((r) => r.table));
                onOpenChange(false);
              }}
              className="h-8 rounded-[6px] bg-[#1c1c18] px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {nothingReady ? "Publish" : `Publish ${plural(ready.length, "dataset")}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
