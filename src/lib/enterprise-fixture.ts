import type {
  Entity,
  Property,
  Relation,
  ReviewStatus,
  TableColumn,
  TableSchema,
} from "./mock-data";

type Domain = "commerce" | "customer" | "finance" | "supply" | "workforce" | "governance";

type EnterpriseEntitySpec = {
  name: string;
  table: string;
  domain: Domain;
  description: string;
  propertyCount?: number;
  compositeIdentifier?: boolean;
};

const specs: EnterpriseEntitySpec[] = [
  {
    name: "Customer Account",
    table: "customer_account_master",
    domain: "customer",
    description: "Canonical commercial account spanning billing, service, and sales systems.",
    propertyCount: 148,
    compositeIdentifier: true,
  },
  {
    name: "Customer Account Legacy",
    table: "cust_acct_mstr_legacy_v2",
    domain: "customer",
    description: "Legacy account representation retained for unresolved migration dependencies.",
    propertyCount: 96,
    compositeIdentifier: true,
  },
  {
    name: "Customer Contact Preference",
    table: "customer_contact_preference",
    domain: "customer",
    description: "Channel and consent preferences for a customer contact.",
  },
  {
    name: "Customer Communication Consent",
    table: "cust_comm_consent_hist",
    domain: "customer",
    description: "Effective-dated communication consent records from regional systems.",
    compositeIdentifier: true,
  },
  {
    name: "Customer Household",
    table: "customer_household_rollup",
    domain: "customer",
    description: "Household group used for service and loyalty analysis.",
  },
  {
    name: "Customer Loyalty Membership",
    table: "loyalty_member_account",
    domain: "customer",
    description: "Enrollment and balance state for a loyalty program member.",
    compositeIdentifier: true,
  },
  {
    name: "Party",
    table: "party_golden_record",
    domain: "customer",
    description: "Master-data party representing a person or organization.",
    propertyCount: 166,
  },
  {
    name: "Party Role Assignment",
    table: "party_role_assignment",
    domain: "customer",
    description: "Effective-dated business role held by a party.",
    compositeIdentifier: true,
  },
  {
    name: "Address",
    table: "address_normalized",
    domain: "customer",
    description: "Normalized postal address shared across operational systems.",
  },
  {
    name: "Address Verification Result",
    table: "address_verification_result",
    domain: "customer",
    description: "Provider response and correction details for an address verification.",
  },
  {
    name: "Sales Order Header",
    table: "erp_sales_order_hdr",
    domain: "commerce",
    description: "ERP order header retained alongside the digital Order model.",
    propertyCount: 132,
  },
  {
    name: "Sales Order Line",
    table: "erp_sales_order_line",
    domain: "commerce",
    description: "ERP sales-order line with pricing and fulfillment references.",
    propertyCount: 118,
    compositeIdentifier: true,
  },
  {
    name: "Purchase Order",
    table: "proc_purchase_order_header",
    domain: "commerce",
    description: "Approved purchase order issued to a supplier.",
  },
  {
    name: "Purchase Order Line",
    table: "proc_purchase_order_line",
    domain: "commerce",
    description: "Individual material or service line on a purchase order.",
    compositeIdentifier: true,
  },
  {
    name: "Contract",
    table: "contract_master_current",
    domain: "commerce",
    description: "Commercial agreement and effective terms.",
    propertyCount: 154,
  },
  {
    name: "Contract Line Item",
    table: "contract_line_item",
    domain: "commerce",
    description: "Product, service, or entitlement governed by a contract.",
    compositeIdentifier: true,
  },
  {
    name: "Price List",
    table: "pricing_price_list",
    domain: "commerce",
    description: "Named collection of effective prices by market and currency.",
  },
  {
    name: "Price List Entry",
    table: "pricing_price_list_entry",
    domain: "commerce",
    description: "Effective price for a product within a price list.",
    compositeIdentifier: true,
  },
  {
    name: "Promotion Campaign",
    table: "mktg_promotion_campaign",
    domain: "commerce",
    description: "Marketing promotion with eligibility and redemption rules.",
  },
  {
    name: "Promotion Redemption",
    table: "mktg_promo_redemption_event",
    domain: "commerce",
    description: "Recorded application of a promotion to an order or account.",
  },
  {
    name: "Invoice",
    table: "ar_invoice_header",
    domain: "finance",
    description: "Accounts-receivable invoice issued to a customer.",
    propertyCount: 142,
  },
  {
    name: "Invoice Line",
    table: "ar_invoice_line",
    domain: "finance",
    description: "Charge, tax, or adjustment line on an invoice.",
    compositeIdentifier: true,
  },
  {
    name: "Payment Transaction",
    table: "payment_transaction_fact",
    domain: "finance",
    description: "Gateway-level authorization, capture, refund, or reversal transaction.",
    propertyCount: 176,
  },
  {
    name: "Payment Instrument",
    table: "payment_instrument_token",
    domain: "finance",
    description: "Tokenized customer payment instrument and lifecycle state.",
  },
  {
    name: "Refund",
    table: "payment_refund_transaction",
    domain: "finance",
    description: "Refund issued against a captured payment.",
  },
  {
    name: "Credit Memo",
    table: "ar_credit_memo",
    domain: "finance",
    description: "Accounts-receivable credit adjustment.",
  },
  {
    name: "General Ledger Account",
    table: "gl_account_chart",
    domain: "finance",
    description: "Chart-of-accounts entry used for financial postings.",
    compositeIdentifier: true,
  },
  {
    name: "Journal Entry",
    table: "gl_journal_entry_header",
    domain: "finance",
    description: "Balanced financial journal entry header.",
  },
  {
    name: "Journal Entry Line",
    table: "gl_journal_entry_line",
    domain: "finance",
    description: "Debit or credit posting within a journal entry.",
    compositeIdentifier: true,
  },
  {
    name: "Tax Determination Result",
    table: "tax_determination_result",
    domain: "finance",
    description: "Jurisdiction and rate decision returned by the tax engine.",
  },
  {
    name: "Supplier",
    table: "supplier_master",
    domain: "supply",
    description: "Approved supplier organization and procurement profile.",
    propertyCount: 128,
  },
  {
    name: "Supplier Site",
    table: "supplier_site_location",
    domain: "supply",
    description: "Ordering, remittance, or fulfillment site for a supplier.",
    compositeIdentifier: true,
  },
  {
    name: "Inventory Item",
    table: "inventory_item_master",
    domain: "supply",
    description: "Stocked material identity used by warehouse and planning systems.",
    propertyCount: 181,
  },
  {
    name: "Inventory Balance",
    table: "inventory_balance_snapshot",
    domain: "supply",
    description: "Point-in-time on-hand and available quantity.",
    compositeIdentifier: true,
  },
  {
    name: "Inventory Reservation",
    table: "inventory_reservation",
    domain: "supply",
    description: "Quantity reserved for demand at a warehouse location.",
  },
  {
    name: "Warehouse",
    table: "warehouse_facility_master",
    domain: "supply",
    description: "Physical fulfillment facility and operating attributes.",
  },
  {
    name: "Warehouse Location",
    table: "warehouse_storage_location",
    domain: "supply",
    description: "Bin, zone, or staging location within a warehouse.",
    compositeIdentifier: true,
  },
  {
    name: "Shipment Package",
    table: "shipment_package_detail",
    domain: "supply",
    description: "Physical package and tracking identifiers within a shipment.",
  },
  {
    name: "Carrier Service Level",
    table: "carrier_service_level_ref",
    domain: "supply",
    description: "Carrier product and delivery commitment configuration.",
    compositeIdentifier: true,
  },
  {
    name: "Return Merchandise Authorization",
    table: "rma_header",
    domain: "supply",
    description: "Authorized customer return and disposition workflow.",
  },
  {
    name: "Return Line",
    table: "rma_line",
    domain: "supply",
    description: "Individual returned item and requested resolution.",
    compositeIdentifier: true,
  },
  {
    name: "Employee",
    table: "hr_employee_master",
    domain: "workforce",
    description: "Worker master record across employment lifecycle.",
    propertyCount: 158,
  },
  {
    name: "Employee Assignment",
    table: "hr_employee_assignment",
    domain: "workforce",
    description: "Effective-dated role, manager, and organization assignment.",
    compositeIdentifier: true,
  },
  {
    name: "Organization Unit",
    table: "hr_organization_unit",
    domain: "workforce",
    description: "Hierarchical operating or reporting unit.",
  },
  {
    name: "Legal Entity",
    table: "legal_entity_master",
    domain: "governance",
    description: "Registered organization used for contracts, tax, and reporting.",
    propertyCount: 152,
  },
  {
    name: "Business Unit",
    table: "business_unit_master",
    domain: "governance",
    description: "Operational business unit within a legal entity.",
  },
  {
    name: "Cost Center",
    table: "finance_cost_center",
    domain: "governance",
    description: "Organizational unit responsible for costs.",
    compositeIdentifier: true,
  },
  {
    name: "Data Processing Agreement",
    table: "privacy_data_processing_agreement",
    domain: "governance",
    description: "Privacy agreement governing processing purpose and retention.",
  },
  {
    name: "Data Retention Policy Assignment",
    table: "data_retention_policy_assignment",
    domain: "governance",
    description: "Policy assignment linking governed data to retention rules.",
    compositeIdentifier: true,
  },
  {
    name: "System Application Registry Entry",
    table: "cmdb_application_registry",
    domain: "governance",
    description: "Enterprise application inventory record with ownership and criticality.",
    propertyCount: 137,
  },
  {
    name: "Integration Endpoint Configuration",
    table: "integration_endpoint_config",
    domain: "governance",
    description: "Runtime endpoint, protocol, and credential reference configuration.",
  },
  {
    name: "Reference Data Code Value",
    table: "ref_data_code_value",
    domain: "governance",
    description: "Effective-dated code value from a governed reference domain.",
    compositeIdentifier: true,
  },
  {
    name: "Legacy Cross Reference Record",
    table: "x_ref_legacy_key_map_v03",
    domain: "governance",
    description: "Cross-system key mapping retained during phased migrations.",
    propertyCount: 124,
    compositeIdentifier: true,
  },
];

const businessFields = [
  "status_code",
  "status_reason_code",
  "effective_start_timestamp",
  "effective_end_timestamp",
  "created_timestamp_utc",
  "created_by_user_identifier",
  "last_updated_timestamp_utc",
  "last_updated_by_user_identifier",
  "source_system_code",
  "source_system_record_identifier",
  "record_version_number",
  "is_current_record_flag",
  "is_deleted_flag",
  "is_test_record_flag",
  "business_unit_code",
  "legal_entity_code",
  "country_iso_alpha_2_code",
  "region_code",
  "currency_iso_code",
  "language_locale_code",
  "external_reference_number",
  "legacy_reference_number",
  "legacy_reference_number_2",
  "migration_batch_identifier",
  "data_quality_score_percent",
  "data_steward_review_status",
  "record_effective_date",
  "record_expiration_date",
  "notes_internal_long_text",
  "custom_attribute_01",
  "custom_attribute_02",
  "custom_attribute_03",
  "custom_attribute_04",
  "custom_attribute_05",
  "integration_correlation_identifier",
  "upstream_event_identifier",
  "etl_job_run_identifier",
  "row_hash_value",
  "nullable_reason_code",
  "classification_code",
  "category_code",
  "sub_category_code",
  "display_name",
  "short_name",
  "long_description_text",
  "priority_sequence_number",
  "processing_state_code",
  "approval_state_code",
  "approved_by_user_identifier",
  "approved_timestamp_utc",
  "owner_organization_identifier",
  "owner_employee_identifier",
  "parent_record_identifier",
  "related_record_identifier",
  "amount_local_currency",
  "amount_reporting_currency",
  "quantity_value",
  "unit_of_measure_code",
  "timezone_name",
  "valid_from_date",
  "valid_to_date",
  "legacy_flag_1",
  "legacy_flag_2",
  "legacy_text_01",
  "legacy_text_02",
  "legacy_numeric_01",
  "legacy_date_01",
];

const typeFor = (name: string): string => {
  if (name.includes("timestamp")) return "timestamptz";
  if (name.endsWith("_date")) return "date";
  if (name.includes("amount") || name.includes("score") || name.includes("quantity"))
    return "numeric";
  if (name.includes("number") || name.includes("sequence")) return "bigint";
  if (name.startsWith("is_") || name.endsWith("_flag")) return "boolean";
  if (name.includes("identifier") || name.endsWith("_id")) return "uuid";
  return name.includes("text") || name.includes("description") ? "text" : "varchar";
};

const titleCase = (value: string) => value.replace(/_/g, " ");
const camel = (value: string) => value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function generatedColumn(name: string, index: number): TableColumn {
  return {
    name,
    type: typeFor(name),
    description: `${titleCase(name)} captured from the owning enterprise source record.`,
    nullable: index % 4 !== 0,
  };
}

function uniqueColumns(columns: TableColumn[]): TableColumn[] {
  const seen = new Set<string>();
  return columns.filter((column) => !seen.has(column.name) && !!seen.add(column.name));
}

function padColumns(seed: TableColumn[], target: number, prefix: string): TableColumn[] {
  const result = [...seed];
  let index = 0;
  while (result.length < target) {
    const base = businessFields[index % businessFields.length]!;
    const cycle = Math.floor(index / businessFields.length);
    const name = cycle === 0 ? base : `${prefix}_${base}_${String(cycle + 1).padStart(2, "0")}`;
    result.push(generatedColumn(name, result.length));
    index += 1;
  }
  return uniqueColumns(result).slice(0, target);
}

export function buildEnterpriseTables(baseTables: TableSchema[]): TableSchema[] {
  const expandedBase = baseTables.map((table) => ({
    ...table,
    columns: padColumns(
      table.columns,
      Math.max(36, table.columns.length),
      slug(table.name).slice(0, 12),
    ),
  }));

  const generated = specs.map((spec, index): TableSchema => {
    const idPrefix = slug(spec.name).slice(0, 24);
    const identity = spec.compositeIdentifier
      ? [`${idPrefix}_id`, "legal_entity_code", "source_system_code"]
      : [`${idPrefix}_id`];
    const target = spec.propertyCount ?? 42 + ((index * 19) % 76);
    const columns = padColumns(
      identity.map((name, columnIndex) => ({
        ...generatedColumn(name, columnIndex),
        nullable: false,
        description:
          columnIndex === 0
            ? `Primary source identifier for ${spec.name}.`
            : `Composite identifier component for ${spec.name}.`,
      })),
      target,
      idPrefix.slice(0, 12),
    );
    return {
      name: spec.table,
      description: `${spec.description} Synthetic enterprise-scale source table for design stress testing.`,
      columns,
      rows: [
        Object.fromEntries(
          columns
            .slice(0, 18)
            .map((column, columnIndex) => [
              column.name,
              columnIndex === 0 ? `${idPrefix}_000001` : `sample_${columnIndex}`,
            ]),
        ),
      ],
    };
  });
  return [...expandedBase, ...generated];
}

function statusFor(index: number): ReviewStatus {
  if (index % 31 === 0) return "warning";
  if (index % 43 === 0) return "error";
  if (index % 3 === 0) return "suggested";
  return "confirmed";
}

function propertiesFor(
  spec: EnterpriseEntitySpec,
  table: TableSchema,
  entityIndex: number,
): Property[] {
  return table.columns.map((column, index) => {
    const isIdentifier = index === 0 || (!!spec.compositeIdentifier && index < 3);
    const status = isIdentifier
      ? entityIndex % 4 === 0
        ? "suggested"
        : "confirmed"
      : statusFor(index + entityIndex);
    const hasSuggestion = isIdentifier || index % 7 !== 0;
    const intentionallyUnmappedIdentifier = isIdentifier && entityIndex % 17 === 0 && index === 0;
    const confidence = Math.max(
      0.18,
      Math.min(0.99, 0.99 - ((index * 13 + entityIndex * 7) % 79) / 100),
    );
    return {
      id: `p_ent_${String(entityIndex).padStart(2, "0")}_${String(index).padStart(3, "0")}`,
      name: index === 0 ? "id" : camel(column.name),
      description: column.description,
      type: column.type,
      confidence,
      status,
      isIdentifier,
      mapping:
        intentionallyUnmappedIdentifier || !hasSuggestion
          ? null
          : {
              table: table.name,
              column: column.name,
              status: index % 5 === 0 ? "suggested" : "mapped",
            },
      ...(status === "warning"
        ? {
            warningReason:
              "The source field has conflicting definitions across regional data dictionaries.",
          }
        : {}),
      ...(status === "error"
        ? {
            errorReason:
              "The proposed semantic type is incompatible with values sampled from the source column.",
          }
        : {}),
    };
  });
}

export function buildEnterpriseEntities(
  baseEntities: Entity[],
  allTables: TableSchema[],
): Entity[] {
  const tableMap = new Map(allTables.map((table) => [table.name, table]));
  const expandedBase = baseEntities.map((entity, entityIndex) => {
    const table = tableMap.get(entity.table);
    if (!table || entity.properties.length >= 30) return entity;
    const mappedColumns = new Set(
      entity.properties.flatMap((property) => (property.mapping ? [property.mapping.column] : [])),
    );
    const extras = table.columns
      .filter((column) => !mappedColumns.has(column.name))
      .slice(0, 30 - entity.properties.length)
      .map((column, index): Property => ({
        id: `p_base_${entity.id}_${String(index).padStart(2, "0")}`,
        name: camel(column.name),
        description: column.description,
        type: column.type,
        confidence: 0.42 + ((index * 11 + entityIndex) % 52) / 100,
        status: index % 4 === 0 ? "suggested" : "confirmed",
        mapping:
          index % 6 === 0
            ? null
            : {
                table: table.name,
                column: column.name,
                status: index % 3 === 0 ? "suggested" : "mapped",
              },
      }));
    return { ...entity, properties: [...entity.properties, ...extras] };
  });

  const generated = specs.map((spec, index): Entity => {
    const table = tableMap.get(spec.table)!;
    const columns = 8;
    const x = 180 + (index % columns) * 300 + (index % 3) * 34;
    const y = 920 + Math.floor(index / columns) * 270 + (index % 2) * 52;
    const status: ReviewStatus =
      index % 19 === 0 ? "warning" : index % 5 === 0 ? "suggested" : "confirmed";
    return {
      id: `e_ent_${String(index).padStart(2, "0")}_${slug(spec.name)}`,
      name: spec.name,
      description: spec.description,
      confidence: 0.55 + ((index * 17) % 44) / 100,
      status,
      table: spec.table,
      x,
      y,
      properties: propertiesFor(spec, table, index),
      ...(status === "warning"
        ? {
            warningReason:
              "This Entity Type overlaps with a similarly named legacy model and needs ownership review.",
          }
        : {}),
    };
  });
  return [...expandedBase, ...generated];
}

const relationNames = [
  "is operationally owned by",
  "is legally governed by",
  "is billed through",
  "is fulfilled through",
  "has effective assignment to",
  "references canonical master record",
  "was migrated from legacy record",
  "is reconciled against",
  "provides settlement context for",
  "has current configuration in",
  "is conditionally eligible for",
  "is associated with",
  "contains",
  "belongs to",
  "depends on",
];

export function buildEnterpriseRelations(
  baseRelations: Relation[],
  entities: Entity[],
): Relation[] {
  const generatedEntities = entities.filter((entity) => entity.id.startsWith("e_ent_"));
  const byName = new Map(entities.map((entity) => [entity.name, entity]));
  const hubNames = [
    "Customer Account",
    "Party",
    "Legal Entity",
    "Inventory Item",
    "Employee",
    "Order",
    "Product",
  ];
  const hubs = hubNames
    .map((name) => byName.get(name))
    .filter((entity): entity is Entity => !!entity);
  const relations: Relation[] = [];
  // Detail View treats one connected Entity pair as one visual relationship context. Keep the
  // pair unique regardless of direction so enterprise density does not manufacture duplicate
  // React rows that the product model itself cannot distinguish.
  const pairKey = (left: string, right: string) => [left, right].sort().join("|");
  const seen = new Set(baseRelations.map((relation) => pairKey(relation.from, relation.to)));

  const add = (from: Entity, to: Entity, sequence: number, preferredName?: string) => {
    const key = pairKey(from.id, to.id);
    if (from.id === to.id || seen.has(key)) return;
    seen.add(key);
    const confidence = Math.max(0.22, Math.min(0.98, 0.96 - ((sequence * 17) % 68) / 100));
    const status: ReviewStatus =
      sequence % 29 === 0
        ? "warning"
        : sequence % 47 === 0
          ? "error"
          : sequence % 3 === 0
            ? "suggested"
            : "confirmed";
    const cardinalities = ["1:1", "1:N", "N:1", "N:N"] as const;
    const fromIds = from.properties
      .filter((property) => property.isIdentifier || property.name === "id")
      .slice(0, 3);
    const toIds = to.properties
      .filter((property) => property.isIdentifier || property.name === "id")
      .slice(0, 3);
    const relationName = preferredName ?? relationNames[sequence % relationNames.length]!;
    relations.push({
      id: `r_ent_${String(relations.length).padStart(3, "0")}`,
      name: relationName,
      description: `${from.name} ${relationName} ${to.name}. The relationship is supported by ${fromIds.length > 1 || toIds.length > 1 ? "composite" : "single-column"} identifiers.`,
      from: from.id,
      to: to.id,
      confidence,
      status,
      cardinality: cardinalities[sequence % cardinalities.length]!,
      sourceMapping: {
        fromTable: from.table,
        fromColumns: fromIds.map((property) => property.mapping?.column ?? property.name),
        toTable: to.table,
        toColumns: toIds.map((property) => property.mapping?.column ?? property.name),
      },
      ...(status === "warning"
        ? {
            warningReason:
              "Two plausible foreign-key paths support this relation; the authoritative path is unresolved.",
          }
        : {}),
      ...(status === "error"
        ? {
            errorReason:
              "The suggested relation reverses the documented ownership direction in the source contract.",
          }
        : {}),
    });
  };

  // Every generated entity participates in a coherent domain chain and connects to its domain hub.
  const domainGroups = new Map<Domain, typeof generatedEntities>();
  specs.forEach((spec, index) => {
    const entity = generatedEntities[index];
    if (!entity) return;
    const list = domainGroups.get(spec.domain) ?? [];
    list.push(entity);
    domainGroups.set(spec.domain, list);
  });
  let sequence = 0;
  domainGroups.forEach((group) => {
    group.forEach((entity, index) => {
      const next = group[index + 1];
      const nextButOne = group[index + 2];
      if (next) add(entity, next, sequence++);
      if (nextButOne && index % 2 === 0) add(entity, nextButOne, sequence++);
    });
  });

  // Hubs intentionally carry many edges, creating dense but domain-plausible regions.
  generatedEntities.forEach((entity, index) => {
    const spec = specs[index];
    if (!spec) return;
    const domainHubName: Record<Domain, string> = {
      customer: "Party",
      commerce: "Order",
      finance: "Legal Entity",
      supply: "Inventory Item",
      workforce: "Employee",
      governance: "Legal Entity",
    };
    const hub = byName.get(domainHubName[spec.domain]);
    if (hub && hub.id !== entity.id)
      add(
        entity,
        hub,
        sequence++,
        index % 4 === 0 ? "references canonical master record" : undefined,
      );
  });

  const crossDomainPairs: [string, string, string][] = [
    ["Customer Account", "Contract", "is governed by active commercial agreement"],
    ["Customer Account", "Invoice", "is billed through"],
    ["Customer Account", "Payment Instrument", "authorizes payment with"],
    ["Sales Order Header", "Invoice", "is invoiced by"],
    ["Sales Order Line", "Inventory Item", "reserves inventory item"],
    ["Purchase Order", "Supplier", "is issued to"],
    ["Purchase Order Line", "Inventory Item", "procures inventory item"],
    ["Invoice", "Legal Entity", "is issued by legal entity"],
    ["Journal Entry Line", "General Ledger Account", "posts to"],
    ["Employee Assignment", "Organization Unit", "assigns employee into"],
    ["Business Unit", "Legal Entity", "operates within"],
    ["Supplier Site", "Address", "is located at"],
    ["Warehouse", "Address", "is located at"],
    ["Shipment Package", "Carrier Service Level", "ships using"],
    ["Return Line", "Inventory Item", "returns inventory item"],
    [
      "System Application Registry Entry",
      "Integration Endpoint Configuration",
      "publishes integration endpoint",
    ],
    [
      "Data Retention Policy Assignment",
      "System Application Registry Entry",
      "governs records managed by",
    ],
    ["Legacy Cross Reference Record", "Party", "resolves legacy identity to"],
  ];
  crossDomainPairs.forEach(([fromName, toName, name]) => {
    const from = byName.get(fromName);
    const to = byName.get(toName);
    if (from && to) add(from, to, sequence++, name);
  });

  // Add additional coherent hub spokes until the fixture passes 130 total relationships.
  let cursor = 0;
  while (baseRelations.length + relations.length < 136) {
    const from = generatedEntities[cursor % generatedEntities.length];
    const to = hubs[(cursor * 3 + 1) % hubs.length];
    if (from && to) {
      add(from, to, sequence++, relationNames[(cursor + 5) % relationNames.length]);
    }
    cursor += 1;
    if (cursor > 1000) break;
  }

  // Deliberate enterprise edge cases. These bypass the ordinary pair guard because recursive
  // hierarchy edges and two independently meaningful directions between the same Entity Types
  // are both common in real models. Keeping them explicit makes the current UI's multi-edge
  // limitations visible during the stress test instead of hiding them in generated noise.
  const addEdgeCase = (
    fromName: string,
    toName: string,
    name: string,
    cardinality: NonNullable<Relation["cardinality"]>,
    confidence: number,
    status: ReviewStatus,
  ) => {
    const from = byName.get(fromName);
    const to = byName.get(toName);
    if (!from || !to) return;
    const fromIds = from.properties
      .filter((property) => property.isIdentifier || property.name === "id")
      .slice(0, 3);
    const toIds = to.properties
      .filter((property) => property.isIdentifier || property.name === "id")
      .slice(0, 3);
    relations.push({
      id: `r_edge_case_${String(relations.length).padStart(3, "0")}`,
      name,
      description:
        from.id === to.id
          ? `${from.name} recursively ${name} another ${to.name} record in the same hierarchy.`
          : `${from.name} ${name} ${to.name}; the reverse direction is modeled separately because it has different business semantics.`,
      from: from.id,
      to: to.id,
      confidence,
      status,
      cardinality,
      sourceMapping: {
        fromTable: from.table,
        fromColumns: fromIds.map((property) => property.mapping?.column ?? property.name),
        toTable: to.table,
        toColumns: toIds.map((property) => property.mapping?.column ?? property.name),
      },
      ...(status === "warning"
        ? {
            warningReason:
              "The hierarchy direction is inferred from similarly named parent and owner columns and needs review.",
          }
        : {}),
    });
  };

  addEdgeCase("Employee", "Employee", "reports to", "N:1", 0.93, "confirmed");
  addEdgeCase(
    "Organization Unit",
    "Organization Unit",
    "is parent organization of",
    "1:N",
    0.78,
    "suggested",
  );
  addEdgeCase("Category", "Category", "has parent category", "N:1", 0.84, "confirmed");
  addEdgeCase(
    "Legal Entity",
    "Legal Entity",
    "consolidates reporting results from",
    "1:N",
    0.61,
    "warning",
  );
  addEdgeCase("Supplier", "Inventory Item", "supplies inventory item", "N:N", 0.91, "confirmed");
  addEdgeCase(
    "Inventory Item",
    "Supplier",
    "is sourced from approved supplier",
    "N:N",
    0.76,
    "suggested",
  );
  addEdgeCase("Customer Account", "Party", "is mastered as party", "1:1", 0.94, "confirmed");
  addEdgeCase(
    "Party",
    "Customer Account",
    "has commercial customer account",
    "1:N",
    0.72,
    "suggested",
  );
  return [...baseRelations, ...relations];
}
