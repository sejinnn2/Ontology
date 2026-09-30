import type { ReactNode } from "react";
import { Portal as HoverCardPortal } from "@radix-ui/react-hover-card";
import { Box, ScanSearch, Sparkles, Table } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOntologyAppContext } from "@/lib/ontology-context";
import { cn } from "@/lib/utils";
import {
  entityReasoningContent,
  mappingReasoningContent,
  propertyReasoningContent,
  relationReasoningContent,
  type Entity,
  type Property,
  type ReasoningContent,
  type Relation,
} from "@/lib/mock-data";

/** A short, confidence-bucketed sentence rather than one hand-written string per item — with 40+
 * properties/relations in the seed data, bucketing by confidence reads as genuinely explanatory
 * without requiring bespoke copy for every row. Exported so the Detail contextual panel's own "AI
 * Suggestion Reasoning" section, and the review-status icon's own tooltip (see StatusBadge), call
 * this exact same function — every surface that explains a suggestion must never disagree. */
export function aiReasoning(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.85)
    return `Strong match (${pct}%) — naming and type both align closely with the source.`;
  if (confidence >= 0.6)
    return `Likely match (${pct}%) — naming is similar, but the pattern isn't exact.`;
  return `Low-confidence guess (${pct}%) — only a weak naming or type signal was found.`;
}

/**
 * The Confidence indicator (Figma: "Confidence Level") — a small percentage chip, with a hover/
 * focus tooltip explaining the AI's suggestion. This is data-wise and visually separate from the
 * Status badge (icon + color, from `ReviewStatus`) — a "suggested" item can be high-confidence,
 * and a "warning"/"error" finding is never caused by low confidence, so this chip only ever shows
 * confidence + its reasoning. The status-specific "why is this a warning/error" text lives on the
 * Status badge's own tooltip instead (see StatusBadge) — kept there rather than duplicated here so
 * there's exactly one place per kind of information.
 *
 * Used for every kind of confidence in the app — Entity/Property/Relation (always a number) as
 * well as Table/Column (optional — schema discovery sometimes has no signal at all) — so this is
 * the one place "no confidence" renders as "—" with an honest "no data" tooltip instead of a
 * fabricated reasoning sentence.
 *
 * `reasoning`, when supplied, replaces the generic bucketed sentence with the actual per-kind
 * evidence (see `ReasoningContent`/`entityReasoningContent`/etc. in mock-data.ts) computed by
 * whichever caller has the real Entity/Property/Relation/Mapping context to derive it from — the
 * short single-line summary here (`reasoning`/`matchSummary`) is the same sentence a full "Why
 * this confidence score?" panel would open with, just without its own evidence table, which
 * doesn't fit this chip's small hover tooltip. Omitted entirely wherever only a bare
 * `confidence` number is in scope (e.g. the Overview<->Detail morph transition), which keeps the
 * original generic-but-honest `aiReasoning` text as a graceful fallback.
 */
export function ConfidenceChip({
  confidence,
  reasoning,
}: {
  confidence: number | undefined;
  reasoning?: ReasoningContent;
}) {
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  const summary = reasoning
    ? reasoning.kind === "mapping"
      ? reasoning.matchSummary
      : reasoning.reasoning.join(" ")
    : confidence != null
      ? aiReasoning(confidence)
      : "Schema discovery didn't produce a confidence signal for this.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          // Solid zinc-200/zinc-800 rounded-full pill, per the "N%" chip sampled directly off the
          // Zaimler Figma spec (frame "Entity Triggered Editing", node 406:4814) — replaces the
          // prototype's original translucent-black/rounded-[10px] pill.
          className="inline-flex shrink-0 cursor-default items-center justify-center gap-2.5 rounded-full bg-[#e3e5e4] px-[6px] py-px text-center text-[10px] font-normal leading-[16px] tracking-[-0.076px] text-[#252828] outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]"
        >
          {pct != null ? `${pct}%` : "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-1">
        <p className="font-medium text-white">
          {pct != null ? `${pct}% confidence` : "No confidence score"}
        </p>
        <p className="text-[#B7BCC4]">{summary}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// --- "Why this confidence score?" card -----------------------------------------------------------

/** Short type label for a property's value type, as shown in the mapping card's "Property" row. */
function typeAbbreviation(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("bool")) return "BOOL";
  if (t.includes("date") || t.includes("time")) return "DATE";
  if (t.includes("enum")) return "ENUM";
  if (t.includes("uuid")) return "UUID";
  if (t.includes("int") || t.includes("decimal") || t.includes("numeric") || t.includes("float")) {
    return "NUM";
  }
  return "TXT";
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12.5px] text-[#3c4140]">{children}</span>;
}

function CardSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-5 pt-4 last:pb-5">
      <h4 className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-[#161919]">
        {icon}
        <span className="min-w-0 truncate">{title}</span>
      </h4>
      <div className="mt-1.5 pl-[26px]">{children}</div>
    </section>
  );
}

const sectionIcon = "size-[18px] shrink-0 text-[#6d7472]";

function AnalysisRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[#6d7472]">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-[#3c4140]">{children}</dd>
    </div>
  );
}

function MappingCardBody({ content }: { content: Extract<ReasoningContent, { kind: "mapping" }> }) {
  const { column, strength } = content;
  return (
    <>
      <div className="space-y-2.5 py-4 pl-12 pr-5 text-[13px] leading-[1.6] text-[#6d7472]">
        <p>
          Based on column name, appears to be {strength} to <Mono>{column.entityType}</Mono> entity.
        </p>
        <p>
          <Mono>{column.entityType}</Mono> → <Mono>{column.property}</Mono> is the closest match to
          column {column.name} with {column.entityMatchPct}% confidence.
        </p>
      </div>
      <div className="mx-5 border-t border-[#e3e5e4]" />
      <CardSection icon={<Sparkles className={sectionIcon} strokeWidth={1.5} />} title="Reasoning">
        <p className="text-[13px] leading-[1.7] text-[#6d7472]">
          We use embeddings of the semantic representation of the column based on the{" "}
          <Mono>table name</Mono>, <Mono>column name</Mono> and <Mono>sample values</Mono>.
        </p>
      </CardSection>
      <CardSection
        icon={<ScanSearch className={sectionIcon} strokeWidth={1.5} />}
        title={`Column analysis for ${column.name}`}
      >
        <dl className="mt-1.5 space-y-2.5 text-[13px]">
          <AnalysisRow label="Entity match">
            <Sparkles className="size-4 shrink-0 text-[#6d7472]" strokeWidth={1.5} />
            {column.entityMatchPct}%
          </AnalysisRow>
          <AnalysisRow label="Entity type">
            <Box className="size-4 shrink-0 text-[#6d7472]" strokeWidth={1.5} />
            <span className="truncate">{column.entityType}</span>
          </AnalysisRow>
          <AnalysisRow label="Property">
            <span className="shrink-0 font-mono text-[10px] tracking-wide text-[#6d7472]">
              {typeAbbreviation(column.propertyType)}
            </span>
            <span className="truncate">{column.property}</span>
          </AnalysisRow>
        </dl>
      </CardSection>
    </>
  );
}

function EvidenceCardBody({
  content,
  onOpenTable,
}: {
  content: Extract<ReasoningContent, { kind: "evidence" }>;
  onOpenTable: (tableName: string) => void;
}) {
  return (
    <>
      <CardSection icon={<Sparkles className={sectionIcon} strokeWidth={1.5} />} title="Reasoning">
        <div className="space-y-1.5 text-[13px] leading-[1.6] text-[#6d7472]">
          {content.reasoning.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </CardSection>
      <CardSection icon={<Table className={sectionIcon} strokeWidth={1.5} />} title="Top datasets">
        {content.topDatasets.length === 0 ? (
          <p className="text-[13px] text-[#6d7472]">No mapped datasets yet.</p>
        ) : (
          <table className="mt-1.5 w-full table-fixed text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e3e5e4] text-[#161919]">
                <th className="w-[46%] pb-2 font-semibold">Name</th>
                <th className="pb-2 font-semibold">Column</th>
                <th className="w-14 pb-2 text-right font-semibold">Score</th>
              </tr>
            </thead>
            <tbody>
              {content.topDatasets.map((row) => (
                <tr key={`${row.table}-${row.detail}`}>
                  <td className="truncate pr-3 pt-2">
                    <button
                      type="button"
                      onClick={() => onOpenTable(row.table)}
                      className="max-w-full truncate font-medium text-[#0298b2] hover:underline"
                    >
                      {row.table}
                    </button>
                  </td>
                  <td className="truncate pr-3 pt-2 text-[#6d7472]">{row.detail}</td>
                  <td className="pt-2 text-right tabular-nums text-[#6d7472]">{row.score}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardSection>
    </>
  );
}

// Computed only while the card is open — property reasoning scans the whole ontology, so this
// must not run for every row in a long list just to render its pill.
function ReasoningCard({ getContent }: { getContent: () => ReasoningContent | null }) {
  const app = useOntologyAppContext();
  const content = getContent();
  if (!content) return null;
  return (
    <>
      <p className="px-5 pb-4 pt-5 text-center text-[16px] font-semibold text-[#161919]">
        Why this confidence score?
      </p>
      <div className="mx-5 border-t border-[#e3e5e4]" />
      {content.kind === "mapping" ? (
        <MappingCardBody content={content} />
      ) : (
        <EvidenceCardBody content={content} onOpenTable={(name) => app.openDetail("table", name)} />
      )}
    </>
  );
}

// The pill's colors: the standard gray, or the lighter muted one the Graph view's Figma frames
// use (nodes, relation pills, property panels — Figma 508:43219).
const PILL_TONE = {
  default: "bg-[#e3e5e4] text-[#252828]",
  muted: "bg-[#f4f4f4] text-[#6d7472] leading-4",
};
export type ConfidenceTone = keyof typeof PILL_TONE;

const PILL_SIZE = {
  // Overview canvas nodes — same pill as `ConfidenceChip`.
  sm: "px-[6px] py-px text-[10px] leading-[16px] tracking-[-0.076px]",
  // Editing-view lanes/panels.
  md: "px-1.5 py-px text-[12px]",
};

/**
 * A confidence pill whose hover opens the "Why this confidence score?" card. The card renders in
 * a portal so lanes' `overflow-hidden` can't clip it, and swallows clicks/pointer-downs so they
 * don't reach the row or canvas the pill sits in (React events bubble through portals).
 */
function ConfidenceCardChip({
  confidence,
  getContent,
  size,
  width,
  tone = "default",
}: {
  confidence: number;
  getContent: () => ReasoningContent | null;
  size: keyof typeof PILL_SIZE;
  width: string;
  tone?: ConfidenceTone | undefined;
}) {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          onClick={stop}
          className={cn(
            "inline-flex shrink-0 cursor-default items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#00DED8]",
            PILL_TONE[tone],
            PILL_SIZE[size],
          )}
        >
          {Math.round(confidence * 100)}%
        </span>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onClick={stop}
          onPointerDown={stop}
          className={cn(
            "rounded-2xl border-[rgba(28,28,24,0.08)] bg-white p-0 text-[#161919] shadow-[var(--shadow-node-lift)]",
            width,
          )}
        >
          <ReasoningCard getContent={getContent} />
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}

/** A Property<->Column mapping's confidence. `entity` must be the Property's own owner. */
export function MappingConfidenceChip({
  entity,
  property,
  tone,
}: {
  entity: Entity;
  property: Property;
  tone?: ConfidenceTone | undefined;
}) {
  if (!property.mapping) return null;
  return (
    <ConfidenceCardChip
      confidence={property.confidence}
      getContent={() => mappingReasoningContent(entity, property)}
      size="md"
      width="w-[380px]"
      tone={tone}
    />
  );
}

/** An Entity Type suggestion's confidence. */
export function EntityConfidenceChip({
  entity,
  size = "md",
  tone,
}: {
  entity: Entity;
  size?: keyof typeof PILL_SIZE;
  tone?: ConfidenceTone | undefined;
}) {
  return (
    <ConfidenceCardChip
      confidence={entity.confidence}
      getContent={() => entityReasoningContent(entity)}
      size={size}
      width="w-[420px]"
      tone={tone}
    />
  );
}

/** A Property suggestion's confidence. */
export function PropertyConfidenceChip({
  property,
  tone,
}: {
  property: Property;
  tone?: ConfidenceTone | undefined;
}) {
  const app = useOntologyAppContext();
  return (
    <ConfidenceCardChip
      confidence={property.confidence}
      getContent={() => propertyReasoningContent(property, app.entities)}
      size="md"
      width="w-[420px]"
      tone={tone}
    />
  );
}

/** A Relation suggestion's confidence. */
export function RelationConfidenceChip({
  relation,
  tone,
}: {
  relation: Relation;
  tone?: ConfidenceTone | undefined;
}) {
  const app = useOntologyAppContext();
  return (
    <ConfidenceCardChip
      confidence={relation.confidence}
      getContent={() => relationReasoningContent(relation, app.entities)}
      size="md"
      width="w-[420px]"
      tone={tone}
    />
  );
}
