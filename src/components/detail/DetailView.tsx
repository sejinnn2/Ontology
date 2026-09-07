import { ArrowLeft, BarChart3, Boxes, Columns3, FileText, Gauge, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  entityMappingCompleteness,
  tableByName,
  tableColumnUsage,
  tableMappingCompleteness,
  entitiesUsingTable,
  type Entity,
} from "@/lib/mock-data";
import type { DetailAnchor, OntologyApp } from "@/lib/app-state";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-node-border bg-node shadow-[var(--shadow-node)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-node-border px-4 py-2.5">
        <Icon className="size-3.5" strokeWidth={2} />
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatusDot({ status }: { status: "confirmed" | "suggested" }) {
  return <span className={cn("size-2.5 shrink-0 rounded-full", status === "confirmed" ? "bg-ok" : "bg-review")} />;
}

function CompletenessBar({ mapped, total }: { mapped: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((mapped / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {mapped}/{total} mapped
      </span>
    </div>
  );
}

function SampleTable({ columns, rows }: { columns: string[]; rows: Record<string, string>[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-node-border">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-muted/60">
          <tr>
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-2.5 py-1.5 font-mono font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-node-border">
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-2.5 py-1.5 font-mono text-foreground/80">
                  {row[c] || <span className="text-muted-foreground">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One reusable Detail shell for both entry contexts (Entity Type / Source Table). The layout is
 * identical either way; only the data feeding each section changes. Properties <-> Columns stays
 * the centerpiece — the entity/table itself is context around it, not a deeper hop in the
 * hierarchy (no separate "go look at the table" or "go look at the entity" sub-screen).
 */
export function DetailView({ app, anchor }: { app: OntologyApp; anchor: NonNullable<DetailAnchor> }) {
  const { entities, closeDetail, openDetail } = app;

  if (anchor.kind === "entity") {
    const entity = entities.find((e) => e.id === anchor.id);
    if (!entity) return null;
    return <EntityDetail entity={entity} onBack={closeDetail} onOpenTable={(name) => openDetail("table", name)} />;
  }

  const table = tableByName(anchor.id);
  if (!table) return null;
  return <TableDetail tableName={anchor.id} onBack={closeDetail} onOpenEntity={(id) => openDetail("entity", id)} />;
}

function DetailHeader({
  kind,
  name,
  status,
  confidence,
  onBack,
}: {
  kind: "Entity Type" | "Source Table";
  name: string;
  status?: "confirmed" | "suggested";
  confidence?: number;
  onBack: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-white px-4 py-3">
      <button
        onClick={onBack}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        <ArrowLeft className="size-3.5" /> Back to Overview
      </button>
      <span className="h-4 w-px shrink-0 bg-border" />
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{kind}</span>
      {status && <StatusDot status={status} />}
      <h1 className="min-w-0 truncate text-[15px] font-semibold">{name}</h1>
      {confidence !== undefined && (
        <span className="ml-auto shrink-0 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          {Math.round(confidence * 100)}% confidence
        </span>
      )}
    </div>
  );
}

function EntityDetail({
  entity,
  onBack,
  onOpenTable,
}: {
  entity: Entity;
  onBack: () => void;
  onOpenTable: (tableName: string) => void;
}) {
  const completeness = entityMappingCompleteness(entity);
  const table = tableByName(entity.table);
  const sampleRows = table?.rows.slice(0, 3) ?? [];
  const sampleColumns = table?.columns.map((c) => c.name) ?? [];
  const remaining = entity.properties.filter((p) => p.status === "suggested").length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <DetailHeader kind="Entity Type" name={entity.name} status={entity.status} confidence={entity.confidence} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4">
          <div className="col-span-2">
            <Section icon={FileText} title="Description">
              <p className="text-[13px] text-foreground">{entity.description}</p>
            </Section>
          </div>

          <Section icon={Gauge} title="Statistics">
            <ul className="flex flex-col gap-1.5 text-[12.5px]">
              <li className="flex justify-between">
                <span className="text-muted-foreground">Properties</span>
                <span className="font-mono">{entity.properties.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Awaiting confirmation</span>
                <span className="font-mono">{remaining}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Primary source table</span>
                <button onClick={() => onOpenTable(entity.table)} className="font-mono text-primary hover:underline">
                  {entity.table}
                </button>
              </li>
            </ul>
          </Section>

          <Section icon={BarChart3} title="Mapping completeness">
            <CompletenessBar mapped={completeness.mapped} total={completeness.total} />
          </Section>

          <div className="col-span-2">
            <Section icon={Columns3} title="Properties ↔ Columns">
              <div className="flex flex-col gap-1.5">
                {entity.properties.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2">
                    <StatusDot status={p.status} />
                    <span className="w-32 shrink-0 truncate text-[12.5px] font-medium">{p.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{p.type}</span>
                    <span className="mx-1 text-muted-foreground/50">→</span>
                    {p.mapping ? (
                      <span className="truncate font-mono text-[11.5px] text-ok">
                        {p.mapping.table}.{p.mapping.column}
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-muted-foreground">Unmapped</span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                      {Math.round(p.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <div className="col-span-2">
            <Section icon={Table2} title="Sample data">
              <SampleTable columns={sampleColumns} rows={sampleRows} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function TableDetail({
  tableName,
  onBack,
  onOpenEntity,
}: {
  tableName: string;
  onBack: () => void;
  onOpenEntity: (entityId: string) => void;
}) {
  const table = tableByName(tableName);
  if (!table) return null;
  const completeness = tableMappingCompleteness(tableName);
  const usage = tableColumnUsage(tableName);
  const usingEntities = entitiesUsingTable(tableName);
  const sampleRows = table.rows.slice(0, 3);
  const sampleColumns = table.columns.map((c) => c.name);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <DetailHeader kind="Source Table" name={table.name} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4">
          <div className="col-span-2">
            <Section icon={FileText} title="Description">
              <p className="text-[13px] text-foreground">
                A source table with {table.columns.length} columns and {table.rows.length} sampled rows.
              </p>
            </Section>
          </div>

          <Section icon={Gauge} title="Data360 / Statistics">
            <ul className="flex flex-col gap-1.5 text-[12.5px]">
              <li className="flex justify-between">
                <span className="text-muted-foreground">Columns</span>
                <span className="font-mono">{table.columns.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Sampled rows</span>
                <span className="font-mono">{table.rows.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Entities using this table</span>
                <span className="font-mono">{usingEntities.length}</span>
              </li>
            </ul>
          </Section>

          <Section icon={BarChart3} title="Mapping completeness">
            <CompletenessBar mapped={completeness.mapped} total={completeness.total} />
          </Section>

          <div className="col-span-2">
            <Section icon={Columns3} title="Properties ↔ Columns">
              <div className="flex flex-col gap-1.5">
                {usage.map((col) => (
                  <div key={col.name} className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2">
                    <span className="w-32 shrink-0 truncate font-mono text-[12.5px] font-medium">{col.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{col.type}</span>
                    <span className="mx-1 text-muted-foreground/50">←</span>
                    {col.mappedBy.length > 0 ? (
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {col.mappedBy.map((m) => (
                          <button
                            key={m.propertyId}
                            onClick={() => onOpenEntity(m.entityId)}
                            className="truncate rounded-full bg-ok-soft px-2 py-0.5 text-[11px] text-ok hover:opacity-80"
                          >
                            {m.entityName}.{m.propertyName}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-muted-foreground">Unmapped</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {usingEntities.length > 0 && (
            <div className="col-span-2">
              <Section icon={Boxes} title="Entities using this table">
                <div className="flex flex-wrap gap-2">
                  {usingEntities.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onOpenEntity(e.id)}
                      className="flex items-center gap-1.5 rounded-full border border-node-border bg-node px-3 py-1.5 text-[12px] hover:bg-accent"
                    >
                      <StatusDot status={e.status} />
                      {e.name}
                    </button>
                  ))}
                </div>
              </Section>
            </div>
          )}

          <div className="col-span-2">
            <Section icon={Table2} title="Sample data">
              <SampleTable columns={sampleColumns} rows={sampleRows} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
