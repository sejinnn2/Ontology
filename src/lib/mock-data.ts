export type ReviewStatus = "suggested" | "confirmed";

export type ColumnRef = { table: string; column: string };

export type Property = {
  id: string;
  name: string;
  type: string;
  confidence: number;
  status: ReviewStatus;
  /** null = unmapped */
  mapping: ColumnRef | null;
};

export type Entity = {
  id: string;
  name: string;
  description: string;
  confidence: number;
  status: ReviewStatus;
  /** primary source table this entity's properties mostly draw from */
  table: string;
  x: number;
  y: number;
  properties: Property[];
};

export type Relation = {
  id: string;
  name: string;
  from: string;
  to: string;
  confidence: number;
  status: ReviewStatus;
};

export type TableColumn = { name: string; type: string };
export type TableSchema = {
  name: string;
  columns: TableColumn[];
  rows: Record<string, string>[];
};

export const tables: TableSchema[] = [
  {
    name: "customers",
    columns: [
      { name: "customer_id", type: "uuid" },
      { name: "first_name", type: "text" },
      { name: "last_name", type: "text" },
      { name: "email", type: "text" },
      { name: "customer_tier", type: "text" },
      { name: "created_at", type: "timestamptz" },
    ],
    rows: [
      { customer_id: "cus_1001", first_name: "John", last_name: "Smith", email: "john.smith@example.com", customer_tier: "gold", created_at: "2024-01-15" },
      { customer_id: "cus_1002", first_name: "Ava", last_name: "Chen", email: "ava.chen@example.com", customer_tier: "silver", created_at: "2024-05-02" },
      { customer_id: "cus_1003", first_name: "Marcus", last_name: "Webb", email: "marcus.webb@example.com", customer_tier: "bronze", created_at: "2025-02-20" },
    ],
  },
  {
    name: "orders",
    columns: [
      { name: "order_id", type: "uuid" },
      { name: "customer_id", type: "uuid" },
      { name: "order_date", type: "date" },
      { name: "status", type: "text" },
      { name: "total_amount", type: "numeric" },
      { name: "ship_carrier", type: "text" },
    ],
    rows: [
      { order_id: "ord_5001", customer_id: "cus_1001", order_date: "2025-06-01", status: "fulfilled", total_amount: "214.00", ship_carrier: "FedEx" },
      { order_id: "ord_5002", customer_id: "cus_1002", order_date: "2025-06-10", status: "pending", total_amount: "58.40", ship_carrier: "" },
      { order_id: "ord_5003", customer_id: "cus_1001", order_date: "2025-07-02", status: "cancelled", total_amount: "340.00", ship_carrier: "UPS" },
    ],
  },
  {
    name: "order_items",
    columns: [
      { name: "order_item_id", type: "uuid" },
      { name: "order_id", type: "uuid" },
      { name: "product_id", type: "uuid" },
      { name: "qty", type: "int" },
      { name: "unit_price", type: "numeric" },
    ],
    rows: [
      { order_item_id: "oi_1", order_id: "ord_5001", product_id: "prod_301", qty: "1", unit_price: "129.00" },
      { order_item_id: "oi_2", order_id: "ord_5001", product_id: "prod_302", qty: "2", unit_price: "42.50" },
      { order_item_id: "oi_3", order_id: "ord_5002", product_id: "prod_303", qty: "1", unit_price: "58.40" },
    ],
  },
  {
    name: "products",
    columns: [
      { name: "product_id", type: "uuid" },
      { name: "product_name", type: "text" },
      { name: "category_id", type: "uuid" },
      { name: "base_price", type: "numeric" },
    ],
    rows: [
      { product_id: "prod_301", product_name: "Traverse Backpack", category_id: "cat_10", base_price: "129.00" },
      { product_id: "prod_302", product_name: "Kiln Ceramic Mug", category_id: "cat_20", base_price: "24.00" },
      { product_id: "prod_303", product_name: "Arc Desk Lamp", category_id: "cat_30", base_price: "92.00" },
    ],
  },
  {
    name: "categories",
    columns: [
      { name: "category_id", type: "uuid" },
      { name: "category_name", type: "text" },
    ],
    rows: [
      { category_id: "cat_10", category_name: "Bags & Backpacks" },
      { category_id: "cat_20", category_name: "Home & Kitchen" },
      { category_id: "cat_30", category_name: "Lighting" },
    ],
  },
  {
    name: "payments",
    columns: [
      { name: "payment_id", type: "uuid" },
      { name: "order_id", type: "uuid" },
      { name: "method", type: "text" },
      { name: "amount", type: "numeric" },
      { name: "status", type: "text" },
    ],
    rows: [
      { payment_id: "pay_1", order_id: "ord_5001", method: "card", amount: "214.00", status: "captured" },
      { payment_id: "pay_2", order_id: "ord_5002", method: "paypal", amount: "58.40", status: "pending" },
      { payment_id: "pay_3", order_id: "ord_5003", method: "card", amount: "340.00", status: "refunded" },
    ],
  },
];

/** Initial seed data only — the live, mutable ontology lives in useOntologyApp()'s React state,
 * seeded from these arrays once on mount. Nothing should import `initialEntities` /
 * `initialRelations` directly at runtime except that one seeding call. */
export const initialEntities: Entity[] = [
  {
    id: "e_customer",
    name: "Customer",
    description: "A person who places orders.",
    confidence: 0.92,
    status: "confirmed",
    table: "customers",
    x: 40,
    y: 260,
    properties: [
      { id: "p_cust_id", name: "id", type: "string", confidence: 0.99, status: "confirmed", mapping: { table: "customers", column: "customer_id" } },
      { id: "p_cust_email", name: "email", type: "string", confidence: 0.97, status: "confirmed", mapping: { table: "customers", column: "email" } },
      { id: "p_cust_first", name: "firstName", type: "string", confidence: 0.95, status: "confirmed", mapping: { table: "customers", column: "first_name" } },
      { id: "p_cust_last", name: "lastName", type: "string", confidence: 0.95, status: "confirmed", mapping: { table: "customers", column: "last_name" } },
      { id: "p_cust_tier", name: "tier", type: "enum", confidence: 0.72, status: "suggested", mapping: { table: "customers", column: "customer_tier" } },
      { id: "p_cust_loyalty", name: "loyaltyPoints", type: "int", confidence: 0.3, status: "suggested", mapping: null },
    ],
  },
  {
    id: "e_order",
    name: "Order",
    description: "A purchase placed by a customer.",
    confidence: 0.9,
    status: "confirmed",
    table: "orders",
    x: 380,
    y: 60,
    properties: [
      { id: "p_ord_id", name: "id", type: "string", confidence: 0.99, status: "confirmed", mapping: { table: "orders", column: "order_id" } },
      { id: "p_ord_date", name: "orderDate", type: "date", confidence: 0.95, status: "confirmed", mapping: { table: "orders", column: "order_date" } },
      { id: "p_ord_status", name: "status", type: "enum", confidence: 0.9, status: "confirmed", mapping: { table: "orders", column: "status" } },
      { id: "p_ord_total", name: "total", type: "decimal", confidence: 0.6, status: "suggested", mapping: { table: "orders", column: "total_amount" } },
    ],
  },
  {
    id: "e_order_item",
    name: "Order Item",
    description: "A single product line within an order.",
    confidence: 0.95,
    status: "confirmed",
    table: "order_items",
    x: 380,
    y: 420,
    properties: [
      { id: "p_oi_id", name: "id", type: "string", confidence: 0.99, status: "confirmed", mapping: { table: "order_items", column: "order_item_id" } },
      { id: "p_oi_qty", name: "qty", type: "int", confidence: 0.97, status: "confirmed", mapping: { table: "order_items", column: "qty" } },
      { id: "p_oi_price", name: "unitPrice", type: "decimal", confidence: 0.93, status: "confirmed", mapping: { table: "order_items", column: "unit_price" } },
    ],
  },
  {
    id: "e_product",
    name: "Product",
    description: "A sellable item, independent of size or color.",
    confidence: 0.87,
    status: "confirmed",
    table: "products",
    x: 680,
    y: 420,
    properties: [
      { id: "p_prod_id", name: "id", type: "string", confidence: 0.99, status: "confirmed", mapping: { table: "products", column: "product_id" } },
      { id: "p_prod_name", name: "name", type: "string", confidence: 0.95, status: "confirmed", mapping: { table: "products", column: "product_name" } },
      { id: "p_prod_price", name: "listPrice", type: "decimal", confidence: 0.55, status: "suggested", mapping: { table: "products", column: "base_price" } },
    ],
  },
  {
    id: "e_category",
    name: "Category",
    description: "A grouping products can be classified under.",
    confidence: 0.93,
    status: "confirmed",
    table: "categories",
    x: 980,
    y: 420,
    properties: [
      { id: "p_cat_id", name: "id", type: "string", confidence: 0.99, status: "confirmed", mapping: { table: "categories", column: "category_id" } },
      { id: "p_cat_name", name: "name", type: "string", confidence: 0.97, status: "confirmed", mapping: { table: "categories", column: "category_name" } },
    ],
  },
  {
    id: "e_payment",
    name: "Payment",
    description: "A payment captured against an order.",
    confidence: 0.94,
    status: "confirmed",
    table: "payments",
    x: 680,
    y: 60,
    properties: [
      { id: "p_pay_id", name: "id", type: "string", confidence: 0.99, status: "confirmed", mapping: { table: "payments", column: "payment_id" } },
      { id: "p_pay_method", name: "method", type: "enum", confidence: 0.92, status: "confirmed", mapping: { table: "payments", column: "method" } },
      { id: "p_pay_amount", name: "amount", type: "decimal", confidence: 0.95, status: "confirmed", mapping: { table: "payments", column: "amount" } },
      { id: "p_pay_status", name: "status", type: "enum", confidence: 0.85, status: "suggested", mapping: { table: "payments", column: "status" } },
    ],
  },
  {
    id: "e_shipment",
    name: "Shipment",
    description: "How an order was shipped to the customer.",
    confidence: 0.68,
    status: "suggested",
    table: "orders",
    x: 40,
    y: 60,
    properties: [
      { id: "p_ship_carrier", name: "carrier", type: "string", confidence: 0.7, status: "suggested", mapping: { table: "orders", column: "ship_carrier" } },
      { id: "p_ship_tracking", name: "trackingStatus", type: "string", confidence: 0.25, status: "suggested", mapping: null },
    ],
  },
];

/** Initial seed data only — see the note on initialEntities above. */
export const initialRelations: Relation[] = [
  { id: "r_places", name: "places", from: "e_customer", to: "e_order", confidence: 0.95, status: "confirmed" },
  { id: "r_contains", name: "contains", from: "e_order", to: "e_order_item", confidence: 0.97, status: "confirmed" },
  { id: "r_references", name: "references", from: "e_order_item", to: "e_product", confidence: 0.96, status: "confirmed" },
  { id: "r_belongs_to", name: "belongsTo", from: "e_product", to: "e_category", confidence: 0.93, status: "confirmed" },
  { id: "r_paid_by", name: "paidBy", from: "e_order", to: "e_payment", confidence: 0.9, status: "confirmed" },
  { id: "r_shipped_via", name: "shippedVia", from: "e_order", to: "e_shipment", confidence: 0.68, status: "suggested" },
  { id: "r_may_include", name: "mayInclude", from: "e_order", to: "e_category", confidence: 0.3, status: "suggested" },
];

export const tableByName = (name: string) => tables.find((t) => t.name === name);

/** How many of an entity's own properties are mapped to a source column. */
export function entityMappingCompleteness(entity: Entity): { mapped: number; total: number } {
  return { mapped: entity.properties.filter((p) => p.mapping !== null).length, total: entity.properties.length };
}

export type ColumnUsage = {
  name: string;
  type: string;
  mappedBy: { entityId: string; entityName: string; propertyId: string; propertyName: string }[];
};

/** Every column of a table, and which entity properties (if any) map to it — the reverse of an
 * entity's own property list, used by the table-anchored Detail view. Takes the live `entities`
 * as a parameter (rather than closing over seed data) so it always reflects current state. */
export function tableColumnUsage(tableName: string, entities: Entity[]): ColumnUsage[] {
  const table = tableByName(tableName);
  if (!table) return [];
  return table.columns.map((col) => ({
    name: col.name,
    type: col.type,
    mappedBy: entities.flatMap((e) =>
      e.properties
        .filter((p) => p.mapping?.table === tableName && p.mapping.column === col.name)
        .map((p) => ({ entityId: e.id, entityName: e.name, propertyId: p.id, propertyName: p.name })),
    ),
  }));
}

/** How many of a table's own columns are used by at least one entity property. */
export function tableMappingCompleteness(tableName: string, entities: Entity[]): { mapped: number; total: number } {
  const usage = tableColumnUsage(tableName, entities);
  return { mapped: usage.filter((c) => c.mappedBy.length > 0).length, total: usage.length };
}

/** Whether a table's columns are entirely unmapped, entirely mapped, or somewhere in between —
 * drives the three-state mapping badge shown next to a table wherever it's listed. */
export function tableMappingStatus(tableName: string, entities: Entity[]): "unmapped" | "partial" | "full" {
  const { mapped, total } = tableMappingCompleteness(tableName, entities);
  if (total === 0 || mapped === 0) return "unmapped";
  return mapped === total ? "full" : "partial";
}

/** Every entity that draws at least one property from this table. */
export function entitiesUsingTable(tableName: string, entities: Entity[]): Entity[] {
  return entities.filter((e) => e.properties.some((p) => p.mapping?.table === tableName));
}
