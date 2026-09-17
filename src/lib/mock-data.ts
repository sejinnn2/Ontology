/** This single field carries two conceptually separate questions for an Entity/Property/Relation,
 * which is why the app is careful never to conflate it with the OTHER two ways an object's state
 * gets described elsewhere:
 *   - Ontology lifecycle — "suggested" (an AI proposal, not yet applied) vs. "confirmed" (Applied
 *     to the ontology). This is the axis `acceptSuggestions`/`confirmItems` (app-state.ts) mutate.
 *   - Validation — "warning"/"error" flag a real issue with the item itself, independent of how
 *     far along its lifecycle is; "warning" is fully styled throughout the UI (see StatusBadge)
 *     but never blocks Accept, only "error" does (see `buildConfirmPlan`). The one Error the app
 *     ever computes automatically is a Property's own: an Identifier property (see
 *     `isIdentifierProperty`) with no active column mapping is always Error, via `propertyStatus`
 *     below, and an Entity Type inherits that as its own Error via `entityStatus` — never derived
 *     from confidence, and never any other Property-level Error case. Every other warning/error
 *     below is hand-flipped on the seed item itself (with a `warningReason`/`errorReason`
 *     alongside) purely to give the Detail contextual panel's warning/error layout something real
 *     to render.
 * Source-data completeness (Table/Column "mapped" vs "unmapped") and AI review workload
 * ("Suggestions") are both DERIVED elsewhere from this field (and from `Property.mapping`) rather
 * than stored as their own status — see `tableMappingStatus`/`tableMappingCompleteness` below and
 * `AiReviewBar`'s own doc comment, respectively. Tables and Columns never get a `ReviewStatus` of
 * their own at all — see `TableSchema`'s doc comment below.
 *
 * Parent/child invariant: a Property can never be "confirmed" while its own Entity is still
 * "suggested" — "Child Applied → Parent must be Applied." `acceptSuggestions` (app-state.ts) is the
 * only place that resolves an Accept action into the ids `confirmItems` writes, so it's the one
 * place this is enforced: accepting a suggested Entity always applies its own current Properties
 * right along with it, and a lone Property key is honored only once its Entity already is (or is
 * becoming) Applied. The reverse combination (an Applied Entity with a still-Suggested Property)
 * is perfectly valid — see that function's own doc comment — since a Property added after its
 * Entity was already applied is an independent suggestion of its own. */
export type ReviewStatus = "suggested" | "confirmed" | "warning" | "error";

/** A Property↔Column connector's OWN lifecycle — completely independent of the owning Property's
 * own `ReviewStatus` (see that type's own doc comment: Property "Confirmed" and mapping "Mapped"
 * are two different facts, never inferred from each other). A connector existing at all (`mapping
 * !== null`) does NOT mean it's "Mapped" — it may still be an AI-proposed `"suggested"` connection
 * nobody has reviewed yet. `status` is optional so every pre-existing seed mapping (none of which
 * predate this lifecycle) defaults to `"suggested"` via `mappingStatus()` below, rather than
 * silently becoming "already confirmed" the moment this field was introduced — the prototype's own
 * honest starting state is "AI proposed many mappings, none reviewed yet." */
export type MappingStatus = "suggested" | "mapped";
export type ColumnRef = { table: string; column: string; status?: MappingStatus };

/** `mapping.status`, defaulted — see `ColumnRef`'s own doc comment for why a missing value reads
 * as `"suggested"` rather than `"mapped"`. The one place this default is decided; every other
 * function in this file that cares about a mapping's confirmation state calls this instead of
 * reading `.status` directly. */
export function mappingStatus(mapping: ColumnRef): MappingStatus {
  return mapping.status ?? "suggested";
}

/** Independent of `confidence` — a low-confidence suggestion is never automatically a warning or
 * error, and a warning/error can carry any confidence at all. Only set when `status` is
 * "warning"/"error" respectively; both the Confidence tooltip and the contextual panel read the
 * same field, so neither can ever show different text for the same item. */
type ReviewFlags = { warningReason?: string; errorReason?: string };

export type Property = {
  id: string;
  name: string;
  description: string;
  type: string;
  confidence: number;
  status: ReviewStatus;
  /** null = unmapped */
  mapping: ColumnRef | null;
  /** Explicit "this is the Identifier" flag — set only by the canvas-first Entity creation wizard
   * (see app-state's own `createEntityWithProperties`), which lets a user name their Identifier
   * property anything ("trackingNumber", not just "id"). Never set on seed data, which instead
   * relies purely on the `isIdentifierProperty` naming convention below — see that function's own
   * doc comment for why both checks coexist. */
  isIdentifier?: boolean;
} & ReviewFlags;

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
} & ReviewFlags;

export type Relation = {
  id: string;
  name: string;
  description: string;
  from: string;
  to: string;
  confidence: number;
  status: ReviewStatus;
} & ReviewFlags;

export type TableColumn = {
  name: string;
  type: string;
  description: string;
};
/** Deliberately no `confidence` field, on either this or `TableColumn` above — a Table/Column is
 * raw source data, already known to exist; Confidence belongs to an AI-generated semantic
 * suggestion (an Entity/Property/Relation, or a Property<->Column Mapping — see `Property.mapping`
 * and `Property.confidence`, which together already express "the AI is N% confident this Property
 * should map to this Column"), never to the source object being mapped into. If you need to know
 * how "confident" or "complete" a table/column looks in the UI, that's `tableMappingStatus` /
 * `tableMappingCompleteness` below — a fact about how much of it is currently mapped, derived from
 * the Properties mapped into it, not a stored number on the table/column itself. */
export type TableSchema = {
  name: string;
  description: string;
  columns: TableColumn[];
  rows: Record<string, string>[];
};

export const tables: TableSchema[] = [
  {
    name: "customers",
    description: "One row per registered shopper, including their loyalty tier.",
    columns: [
      {
        name: "customer_id",
        type: "uuid",
        description: "Primary key for the customer record.",
      },
      { name: "first_name", type: "text", description: "Customer's given name." },
      { name: "last_name", type: "text", description: "Customer's family name." },
      {
        name: "email",
        type: "text",
        description: "Customer's contact email address.",
      },
      {
        name: "customer_tier",
        type: "text",
        description: "Loyalty tier: gold, silver, or bronze.",
      },
      {
        name: "created_at",
        type: "timestamptz",
        description: "When the customer account was created.",
      },
    ],
    rows: [
      {
        customer_id: "cus_1001",
        first_name: "John",
        last_name: "Smith",
        email: "john.smith@example.com",
        customer_tier: "gold",
        created_at: "2024-01-15",
      },
      {
        customer_id: "cus_1002",
        first_name: "Ava",
        last_name: "Chen",
        email: "ava.chen@example.com",
        customer_tier: "silver",
        created_at: "2024-05-02",
      },
      {
        customer_id: "cus_1003",
        first_name: "Marcus",
        last_name: "Webb",
        email: "marcus.webb@example.com",
        customer_tier: "bronze",
        created_at: "2025-02-20",
      },
    ],
  },
  {
    name: "orders",
    description: "One row per checkout, from placement through fulfillment.",
    columns: [
      {
        name: "order_id",
        type: "uuid",
        description: "Primary key for the order.",
      },
      {
        name: "customer_id",
        type: "uuid",
        description: "Customer who placed the order.",
      },
      {
        name: "order_date",
        type: "date",
        description: "Date the order was placed.",
      },
      {
        name: "status",
        type: "text",
        description: "Fulfillment status: pending, fulfilled, or cancelled.",
      },
      {
        name: "total_amount",
        type: "numeric",
        description: "Total charged for the order.",
      },
      {
        name: "ship_carrier",
        type: "text",
        description: "Carrier used to ship the order, if any.",
      },
    ],
    rows: [
      {
        order_id: "ord_5001",
        customer_id: "cus_1001",
        order_date: "2025-06-01",
        status: "fulfilled",
        total_amount: "214.00",
        ship_carrier: "FedEx",
      },
      {
        order_id: "ord_5002",
        customer_id: "cus_1002",
        order_date: "2025-06-10",
        status: "pending",
        total_amount: "58.40",
        ship_carrier: "",
      },
      {
        order_id: "ord_5003",
        customer_id: "cus_1001",
        order_date: "2025-07-02",
        status: "cancelled",
        total_amount: "340.00",
        ship_carrier: "UPS",
      },
    ],
  },
  {
    name: "order_items",
    description: "One row per product line within an order.",
    columns: [
      {
        name: "order_item_id",
        type: "uuid",
        description: "Primary key for the order line item.",
      },
      {
        name: "order_id",
        type: "uuid",
        description: "Order this line item belongs to.",
      },
      {
        name: "product_id",
        type: "uuid",
        description: "Product being purchased on this line.",
      },
      {
        name: "qty",
        type: "int",
        description: "Quantity of the product ordered.",
      },
      {
        name: "unit_price",
        type: "numeric",
        description: "Price charged per unit at time of purchase.",
      },
    ],
    rows: [
      {
        order_item_id: "oi_1",
        order_id: "ord_5001",
        product_id: "prod_301",
        qty: "1",
        unit_price: "129.00",
      },
      {
        order_item_id: "oi_2",
        order_id: "ord_5001",
        product_id: "prod_302",
        qty: "2",
        unit_price: "42.50",
      },
      {
        order_item_id: "oi_3",
        order_id: "ord_5002",
        product_id: "prod_303",
        qty: "1",
        unit_price: "58.40",
      },
    ],
  },
  {
    name: "products",
    description: "Catalog of sellable items, independent of size or color.",
    columns: [
      {
        name: "product_id",
        type: "uuid",
        description: "Primary key for the product.",
      },
      {
        name: "product_name",
        type: "text",
        description: "Display name of the product.",
      },
      {
        name: "category_id",
        type: "uuid",
        description: "Category the product is classified under.",
      },
      {
        name: "base_price",
        type: "numeric",
        description: "List price before any discounts.",
      },
    ],
    rows: [
      {
        product_id: "prod_301",
        product_name: "Traverse Backpack",
        category_id: "cat_10",
        base_price: "129.00",
      },
      {
        product_id: "prod_302",
        product_name: "Kiln Ceramic Mug",
        category_id: "cat_20",
        base_price: "24.00",
      },
      {
        product_id: "prod_303",
        product_name: "Arc Desk Lamp",
        category_id: "cat_30",
        base_price: "92.00",
      },
    ],
  },
  {
    name: "categories",
    description: "Groupings that products can be classified under.",
    columns: [
      { name: "category_id", type: "uuid", description: "Primary key for the category." },
      { name: "category_name", type: "text", description: "Display name of the category." },
    ],
    rows: [
      { category_id: "cat_10", category_name: "Bags & Backpacks" },
      { category_id: "cat_20", category_name: "Home & Kitchen" },
      { category_id: "cat_30", category_name: "Lighting" },
    ],
  },
  {
    name: "payments",
    description: "One row per payment captured against an order.",
    columns: [
      {
        name: "payment_id",
        type: "uuid",
        description: "Primary key for the payment.",
      },
      {
        name: "order_id",
        type: "uuid",
        description: "Order this payment was captured against.",
      },
      {
        name: "method",
        type: "text",
        description: "Payment method used: card, paypal, etc.",
      },
      { name: "amount", type: "numeric", description: "Amount captured." },
      {
        name: "status",
        type: "text",
        description: "Payment status: captured, pending, or refunded.",
      },
    ],
    rows: [
      {
        payment_id: "pay_1",
        order_id: "ord_5001",
        method: "card",
        amount: "214.00",
        status: "captured",
      },
      {
        payment_id: "pay_2",
        order_id: "ord_5002",
        method: "paypal",
        amount: "58.40",
        status: "pending",
      },
      {
        payment_id: "pay_3",
        order_id: "ord_5003",
        method: "card",
        amount: "340.00",
        status: "refunded",
      },
    ],
  },
  // A single wide, sparsely-documented legacy table — the real-world source for the "Product
  // Details" Entity Type below, whose ~50 candidate properties intentionally outnumber this
  // table's own 20 columns (schema discovery over-proposes properties from field names alone,
  // long before every one of them has a real source column to map to).
  {
    name: "product_details",
    description:
      "Extended per-variant attributes for a product, imported from a legacy PIM export.",
    columns: [
      { name: "sku", type: "text", description: "Stock keeping unit." },
      {
        name: "upc",
        type: "text",
        description: "Universal product code (barcode).",
      },
      {
        name: "weight_kg",
        type: "numeric",
        description: "Shipping weight in kilograms.",
      },
      {
        name: "length_cm",
        type: "numeric",
        description: "Packaged length in centimeters.",
      },
      {
        name: "width_cm",
        type: "numeric",
        description: "Packaged width in centimeters.",
      },
      {
        name: "height_cm",
        type: "numeric",
        description: "Packaged height in centimeters.",
      },
      {
        name: "material",
        type: "text",
        description: "Primary material this variant is made from.",
      },
      {
        name: "color",
        type: "text",
        description: "Display color name for this variant.",
      },
      {
        name: "brand",
        type: "text",
        description: "Brand this product is sold under.",
      },
      {
        name: "manufacturer",
        type: "text",
        description: "Company that manufactures this product.",
      },
      {
        name: "country_of_origin",
        type: "text",
        description: "Country where this product was manufactured.",
      },
      {
        name: "hs_code",
        type: "text",
        description: "Harmonized System code used for customs.",
      },
      {
        name: "warranty_months",
        type: "integer",
        description: "Manufacturer warranty length in months.",
      },
      {
        name: "seo_title",
        type: "text",
        description: "Title tag used on the product page.",
      },
      {
        name: "seo_slug",
        type: "text",
        description: "URL slug used on the product page.",
      },
      {
        name: "primary_image_url",
        type: "text",
        description: "URL of the main product photo.",
      },
      {
        name: "model_number",
        type: "text",
        description: "Manufacturer's model number.",
      },
      {
        name: "style_code",
        type: "text",
        description: "Internal style code used by merchandising.",
      },
      {
        name: "is_discontinued",
        type: "boolean",
        description: "Whether this variant has been discontinued.",
      },
      {
        name: "cost_price",
        type: "numeric",
        description: "What this product costs to acquire or produce.",
      },
    ],
    rows: [
      {
        sku: "TRV-BP-BLK",
        upc: "049000028911",
        weight_kg: "1.2",
        material: "Recycled nylon",
        color: "Black",
        brand: "Traverse",
        is_discontinued: "false",
        cost_price: "34.50",
      },
      {
        sku: "KLN-MUG-CLY",
        upc: "049000028928",
        weight_kg: "0.4",
        material: "Stoneware",
        color: "Clay",
        brand: "Kiln",
        is_discontinued: "false",
        cost_price: "6.20",
      },
    ],
  },
];

// The "Product Details" Entity Type below exists to cover a few review scenarios none of the
// other seed entities do: dozens of properties at once (a long, scrollable list — most of the
// other entities have 2-6), a named identifier property with no mapping at all (`id` below), and
// a Warning whose reason is a rename suggestion rather than a structural concern like Shipment's.
// Written as a compact field list + a map over it, purely because of the volume (~50 properties)
// — every entry is still a real, specific field a product-details table would plausibly have, not
// filler.
const productDetailFields: {
  name: string;
  type: string;
  description: string;
  confidence: number;
  column?: string;
  status?: ReviewStatus;
  warningReason?: string;
}[] = [
  {
    name: "sku",
    type: "string",
    description: "Stock keeping unit for this variant.",
    confidence: 0.97,
    column: "sku",
  },
  {
    name: "upc",
    type: "string",
    description: "Universal product code (barcode) for this variant.",
    confidence: 0.9,
    column: "upc",
  },
  {
    name: "weightKg",
    type: "decimal",
    description: "Shipping weight in kilograms.",
    confidence: 0.88,
    column: "weight_kg",
  },
  {
    name: "lengthCm",
    type: "decimal",
    description: "Packaged length in centimeters.",
    confidence: 0.82,
    column: "length_cm",
  },
  {
    name: "widthCm",
    type: "decimal",
    description: "Packaged width in centimeters.",
    confidence: 0.82,
    column: "width_cm",
  },
  {
    name: "heightCm",
    type: "decimal",
    description: "Packaged height in centimeters.",
    confidence: 0.82,
    column: "height_cm",
  },
  {
    name: "material",
    type: "string",
    description: "Primary material this variant is made from.",
    confidence: 0.75,
    column: "material",
  },
  {
    name: "color",
    type: "string",
    description: "Display color name for this variant.",
    confidence: 0.79,
    column: "color",
  },
  {
    name: "brand",
    type: "string",
    description: "Brand this product is sold under.",
    confidence: 0.91,
    column: "brand",
  },
  {
    name: "manufacturer",
    type: "string",
    description: "Company that manufactures this product.",
    confidence: 0.7,
    column: "manufacturer",
  },
  {
    name: "countryOfOrigin",
    type: "string",
    description: "Country where this product was manufactured.",
    confidence: 0.68,
    column: "country_of_origin",
  },
  {
    name: "hsCode",
    type: "string",
    description: "Harmonized System code used for customs.",
    confidence: 0.6,
    column: "hs_code",
  },
  {
    name: "warrantyMonths",
    type: "integer",
    description: "Manufacturer warranty length in months.",
    confidence: 0.72,
    column: "warranty_months",
  },
  {
    name: "seoTitle",
    type: "string",
    description: "Title tag used on the product page.",
    confidence: 0.55,
    column: "seo_title",
  },
  {
    name: "seoSlug",
    type: "string",
    description: "URL slug used on the product page.",
    confidence: 0.58,
    column: "seo_slug",
  },
  {
    name: "primaryImageUrl",
    type: "string",
    description: "URL of the main product photo.",
    confidence: 0.8,
    column: "primary_image_url",
  },
  {
    name: "modelNumber",
    type: "string",
    description: "Manufacturer's model number.",
    confidence: 0.66,
    column: "model_number",
  },
  {
    name: "styleCode",
    type: "string",
    description: "Internal style code used by merchandising.",
    confidence: 0.5,
    column: "style_code",
  },
  {
    name: "isDiscontinued",
    type: "boolean",
    description: "Whether this variant has been discontinued.",
    confidence: 0.85,
    column: "is_discontinued",
  },
  {
    name: "costPrice",
    type: "decimal",
    description: "What this product costs to acquire or produce.",
    confidence: 0.77,
    column: "cost_price",
  },
  {
    name: "ean",
    type: "string",
    description: "European Article Number, where different from the UPC.",
    confidence: 0.4,
  },
  {
    name: "sizeLabel",
    type: "string",
    description: "Human-readable size label (S/M/L, shoe size, etc).",
    confidence: 0.45,
  },
  {
    name: "colorHex",
    type: "string",
    description: "Hex color swatch shown next to the color name.",
    confidence: 0.42,
  },
  {
    name: "isFragile",
    type: "boolean",
    description: "Whether this item needs fragile handling in transit.",
    confidence: 0.38,
  },
  {
    name: "isHazmat",
    type: "boolean",
    description: "Whether this item is classified as hazardous material.",
    confidence: 0.35,
  },
  {
    name: "isPerishable",
    type: "boolean",
    description: "Whether this item has a shelf life that affects shipping.",
    confidence: 0.33,
  },
  {
    name: "minOrderQty",
    type: "integer",
    description: "Smallest quantity a customer can order at once.",
    confidence: 0.5,
  },
  {
    name: "maxOrderQty",
    type: "integer",
    description: "Largest quantity a customer can order at once.",
    confidence: 0.5,
  },
  {
    name: "reorderPoint",
    type: "integer",
    description: "Inventory level that triggers a reorder.",
    confidence: 0.44,
  },
  {
    name: "safetyStock",
    type: "integer",
    description: "Buffer inventory kept on hand for this item.",
    confidence: 0.44,
  },
  {
    name: "leadTimeDays",
    type: "integer",
    description: "Typical days between reorder and restock.",
    confidence: 0.41,
  },
  {
    name: "careInstructions",
    type: "string",
    description: "Washing/handling instructions shown to customers.",
    confidence: 0.36,
  },
  {
    name: "seoDescription",
    type: "string",
    description: "Meta description used on the product page.",
    confidence: 0.39,
  },
  {
    name: "metaKeywords",
    type: "string",
    description: "Legacy meta-keywords field from the old storefront.",
    confidence: 0.2,
  },
  {
    name: "thumbnailUrl",
    type: "string",
    description: "URL of the small thumbnail image.",
    confidence: 0.55,
  },
  {
    name: "altText",
    type: "string",
    description: "Accessibility alt text for the primary image.",
    confidence: 0.48,
  },
  {
    name: "videoUrl",
    type: "string",
    description: "URL of a product demo video, if one exists.",
    confidence: 0.3,
  },
  {
    name: "seasonCode",
    type: "string",
    description: "Merchandising season this product belongs to.",
    confidence: 0.37,
  },
  {
    name: "collectionName",
    type: "string",
    description: "Named collection this product is part of.",
    confidence: 0.37,
  },
  {
    name: "launchDate",
    type: "date",
    description: "Date this product first went on sale.",
    confidence: 0.46,
  },
  {
    name: "discontinuedDate",
    type: "date",
    description: "Date this product was discontinued, if it has been.",
    confidence: 0.4,
  },
  {
    name: "isFeatured",
    type: "boolean",
    description: "Whether this product is featured on the homepage.",
    confidence: 0.43,
  },
  {
    name: "isOnSale",
    type: "boolean",
    description: "Whether this product currently has an active discount.",
    confidence: 0.5,
  },
  {
    name: "discountPercent",
    type: "decimal",
    description: "Current discount percentage, if on sale.",
    confidence: 0.41,
  },
  {
    name: "marginPercent",
    type: "decimal",
    description: "Gross margin percentage at the current price.",
    confidence: 0.34,
  },
  {
    name: "msrp",
    type: "decimal",
    description: "Manufacturer's suggested retail price.",
    confidence: 0.6,
  },
  {
    name: "currencyCode",
    type: "string",
    description: "Currency the prices on this record are stated in.",
    confidence: 0.52,
  },
  {
    name: "unitOfMeasure",
    type: "string",
    description: "Unit this product is sold by (each, kg, box of 6).",
    confidence: 0.47,
  },
  {
    name: "packagingType",
    type: "string",
    description: "How this product is packaged for shipping.",
    confidence: 0.35,
  },
  {
    name: "flag1",
    type: "boolean",
    description: "Miscellaneous status flag carried over from the legacy import.",
    confidence: 0.65,
    status: "warning",
    warningReason:
      "The name 'flag1' doesn't say what this represents — rename it to something like 'isLegacyImport' once its purpose is confirmed with the source team.",
  },
];

const productDetailProperties: Property[] = [
  {
    id: "p_pd_id",
    name: "id",
    description: "Unique identifier for this product detail record.",
    type: "string",
    confidence: 0.6,
    status: "suggested",
    // Deliberately unmapped — schema discovery proposed the identifier itself before finding a
    // source column for it, which does happen. This is the one case that IS blocking: an
    // Identifier with no mapping computes as Error (see mock-data's own `propertyStatus`), which
    // in turn is what makes this whole entity show as Error too (see `entityStatus`) — a real,
    // reachable example of the Identifier-mapping rule, not a hand-set example status.
    mapping: null,
  },
  ...productDetailFields.map((f, i): Property => ({
    id: `p_pd_${i}`,
    name: f.name,
    description: f.description,
    type: f.type,
    confidence: f.confidence,
    status: f.status ?? "suggested",
    mapping: f.column ? { table: "product_details", column: f.column } : null,
    ...(f.warningReason ? { warningReason: f.warningReason } : {}),
  })),
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
    y: 300,
    properties: [
      {
        id: "p_cust_id",
        name: "id",
        description: "Unique identifier for this customer.",
        type: "string",
        confidence: 0.99,
        status: "confirmed",
        mapping: { table: "customers", column: "customer_id" },
      },
      {
        id: "p_cust_email",
        name: "email",
        description: "Customer's contact email address.",
        type: "string",
        confidence: 0.97,
        status: "confirmed",
        mapping: { table: "customers", column: "email" },
      },
      {
        id: "p_cust_first",
        name: "firstName",
        description: "Customer's given name.",
        type: "string",
        confidence: 0.95,
        status: "confirmed",
        mapping: { table: "customers", column: "first_name" },
      },
      {
        id: "p_cust_last",
        name: "lastName",
        description: "Customer's family name.",
        type: "string",
        confidence: 0.95,
        status: "confirmed",
        mapping: { table: "customers", column: "last_name" },
      },
      {
        id: "p_cust_tier",
        name: "tier",
        description: "Customer's loyalty tier.",
        type: "enum",
        confidence: 0.72,
        status: "suggested",
        mapping: { table: "customers", column: "customer_tier" },
      },
      {
        id: "p_cust_loyalty",
        name: "loyaltyPoints",
        description: "Accumulated loyalty points balance.",
        type: "int",
        confidence: 0.3,
        status: "suggested",
        mapping: null,
      },
    ],
  },
  {
    id: "e_order",
    name: "Order",
    description: "A purchase placed by a customer.",
    confidence: 0.9,
    status: "confirmed",
    table: "orders",
    x: 360,
    y: 300,
    properties: [
      {
        id: "p_ord_id",
        name: "id",
        description: "Unique identifier for this order.",
        type: "string",
        confidence: 0.99,
        status: "confirmed",
        mapping: { table: "orders", column: "order_id" },
      },
      {
        id: "p_ord_date",
        name: "orderDate",
        description: "Date the order was placed.",
        type: "date",
        confidence: 0.95,
        status: "confirmed",
        mapping: { table: "orders", column: "order_date" },
      },
      {
        id: "p_ord_status",
        name: "status",
        description: "Current fulfillment status of the order.",
        type: "enum",
        confidence: 0.9,
        status: "confirmed",
        mapping: { table: "orders", column: "status" },
      },
      {
        id: "p_ord_total",
        name: "total",
        description: "Total amount charged for the order.",
        type: "decimal",
        confidence: 0.6,
        // Hand-set to "warning" (see ReviewFlags) — a non-Identifier Property is never Error in
        // this app (see mock-data's own `propertyStatus`), so a schema concern short of that gets
        // Warning instead; not derived from the 60% confidence above, which is a separate concern.
        status: "warning",
        warningReason:
          "The mapped column's stored type in the source table was recently changed from numeric to varchar — this mapping likely needs to be redone once the schema settles.",
        mapping: { table: "orders", column: "total_amount" },
      },
    ],
  },
  {
    id: "e_order_item",
    name: "Order Item",
    description: "A single product line within an order.",
    confidence: 0.95,
    status: "confirmed",
    table: "order_items",
    x: 680,
    y: 60,
    properties: [
      {
        id: "p_oi_id",
        name: "id",
        description: "Unique identifier for this order line item.",
        type: "string",
        confidence: 0.99,
        status: "confirmed",
        mapping: { table: "order_items", column: "order_item_id" },
      },
      {
        id: "p_oi_qty",
        name: "qty",
        description: "Quantity of the product ordered on this line.",
        type: "int",
        confidence: 0.97,
        status: "confirmed",
        mapping: { table: "order_items", column: "qty" },
      },
      {
        id: "p_oi_price",
        name: "unitPrice",
        description: "Price charged per unit on this line.",
        type: "decimal",
        confidence: 0.93,
        status: "confirmed",
        mapping: { table: "order_items", column: "unit_price" },
      },
    ],
  },
  {
    id: "e_product",
    name: "Product",
    description: "A sellable item, independent of size or color.",
    confidence: 0.87,
    status: "confirmed",
    table: "products",
    x: 1000,
    y: 60,
    properties: [
      {
        id: "p_prod_id",
        name: "id",
        description: "Unique identifier for this product.",
        type: "string",
        confidence: 0.99,
        status: "confirmed",
        mapping: { table: "products", column: "product_id" },
      },
      {
        id: "p_prod_name",
        name: "name",
        description: "Display name of the product.",
        type: "string",
        confidence: 0.95,
        status: "confirmed",
        mapping: { table: "products", column: "product_name" },
      },
      {
        id: "p_prod_price",
        name: "listPrice",
        description: "List price before any discounts.",
        type: "decimal",
        confidence: 0.55,
        status: "suggested",
        mapping: { table: "products", column: "base_price" },
      },
    ],
  },
  {
    id: "e_category",
    name: "Category",
    description: "A grouping products can be classified under.",
    confidence: 0.93,
    status: "confirmed",
    table: "categories",
    x: 1320,
    y: 220,
    properties: [
      {
        id: "p_cat_id",
        name: "id",
        description: "Unique identifier for this category.",
        type: "string",
        confidence: 0.99,
        status: "confirmed",
        mapping: { table: "categories", column: "category_id" },
      },
      {
        id: "p_cat_name",
        name: "name",
        description: "Display name of the category.",
        type: "string",
        confidence: 0.97,
        status: "confirmed",
        mapping: { table: "categories", column: "category_name" },
      },
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
    y: 540,
    properties: [
      {
        id: "p_pay_id",
        name: "id",
        description: "Unique identifier for this payment.",
        type: "string",
        confidence: 0.99,
        status: "confirmed",
        mapping: { table: "payments", column: "payment_id" },
      },
      {
        id: "p_pay_method",
        name: "method",
        description: "Payment method used to capture this payment.",
        type: "enum",
        confidence: 0.92,
        status: "confirmed",
        mapping: { table: "payments", column: "method" },
      },
      {
        id: "p_pay_amount",
        name: "amount",
        description: "Amount captured for this payment.",
        type: "decimal",
        confidence: 0.95,
        status: "confirmed",
        mapping: { table: "payments", column: "amount" },
      },
      {
        id: "p_pay_status",
        name: "status",
        description: "Current status of the payment.",
        type: "enum",
        confidence: 0.85,
        status: "suggested",
        mapping: { table: "payments", column: "status" },
      },
    ],
  },
  {
    id: "e_shipment",
    name: "Shipment",
    description: "How an order was shipped to the customer.",
    confidence: 0.68,
    // Hand-set to "warning" (see ReviewFlags) purely to exercise the contextual panel's Warning
    // layout — not derived from the 68% confidence above, which is a separate concern.
    status: "warning",
    warningReason:
      "This entity was built entirely from columns on the orders table rather than its own dedicated table — worth confirming that's intentional before relying on it.",
    table: "orders",
    x: 360,
    y: 600,
    properties: [
      {
        id: "p_ship_carrier",
        name: "carrier",
        description: "Carrier used to ship the order.",
        type: "string",
        confidence: 0.7,
        status: "suggested",
        mapping: { table: "orders", column: "ship_carrier" },
      },
      {
        id: "p_ship_tracking",
        name: "trackingStatus",
        description: "Latest known tracking status for the shipment.",
        type: "string",
        confidence: 0.25,
        status: "suggested",
        mapping: null,
      },
    ],
  },
  {
    id: "e_product_details",
    name: "Product Details",
    description:
      "Extended per-variant attributes for a product — dimensions, merchandising, and logistics fields imported from a legacy PIM export.",
    confidence: 0.62,
    // Not hand-set to "error" — its own identifier property (`p_pd_id` below) is unmapped, which
    // makes `entityStatus()` compute this entity as Error automatically (see mock-data's own
    // `entityStatus`/`propertyStatus`). That aggregated Error is also what gives this entity's own
    // relation below (`detailsFor`) a real, reachable example of the "a Relation can't be
    // confirmed while a connected Entity Type has an Error" rule (see buildConfirmPlan) — the
    // relation itself is never rewritten to "error", this is purely a confirmation dependency.
    status: "suggested",
    table: "product_details",
    x: 1320,
    y: 300,
    properties: productDetailProperties,
  },
  {
    id: "e_order_fulfillment",
    name: "Order Fulfillment",
    // Deliberately spans two source tables — most properties map into `orders`, the rest into
    // `payments` — to exercise the Columns area's "one card per mapped table" layout with more
    // than one card actually showing at once, rather than every seed entity mapping into a single
    // dedicated table the way Order/Payment/Product etc. all do.
    description:
      "A combined snapshot of an order's shipping and payment status, drawn from both the orders and payments tables.",
    confidence: 0.71,
    status: "suggested",
    table: "orders",
    x: 40,
    y: 620,
    properties: [
      {
        id: "p_fulfill_id",
        name: "id",
        description: "Unique identifier for this fulfillment record.",
        type: "string",
        confidence: 0.99,
        // Must stay "suggested" while the owning Entity (`e_order_fulfillment` above) is itself
        // still "suggested" — a Property can never be independently Applied under a Suggested
        // parent (see `acceptSuggestions`' own doc comment in app-state.ts). Accepting this Entity
        // applies this Property right along with it.
        status: "suggested",
        mapping: { table: "orders", column: "order_id" },
      },
      {
        id: "p_fulfill_order_status",
        name: "orderStatus",
        description: "Fulfillment status of the underlying order.",
        type: "enum",
        confidence: 0.9,
        status: "suggested",
        mapping: { table: "orders", column: "status" },
      },
      {
        id: "p_fulfill_carrier",
        name: "shipCarrier",
        description: "Carrier used to ship the order.",
        type: "string",
        confidence: 0.7,
        status: "suggested",
        mapping: { table: "orders", column: "ship_carrier" },
      },
      {
        id: "p_fulfill_payment_method",
        name: "paymentMethod",
        description: "Method used to pay for the order.",
        type: "enum",
        confidence: 0.92,
        status: "suggested",
        mapping: { table: "payments", column: "method" },
      },
      {
        id: "p_fulfill_payment_status",
        name: "paymentStatus",
        description: "Current status of the order's payment.",
        type: "enum",
        confidence: 0.85,
        status: "suggested",
        mapping: { table: "payments", column: "status" },
      },
      {
        id: "p_fulfill_amount_paid",
        name: "amountPaid",
        description: "Amount captured for the order's payment.",
        type: "decimal",
        confidence: 0.95,
        status: "suggested",
        mapping: { table: "payments", column: "amount" },
      },
    ],
  },
];

/** Initial seed data only — see the note on initialEntities above. */
export const initialRelations: Relation[] = [
  {
    id: "r_places",
    name: "places",
    description: "A Customer places one or more Orders.",
    from: "e_customer",
    to: "e_order",
    confidence: 0.95,
    status: "confirmed",
  },
  {
    id: "r_contains",
    name: "contains",
    description: "An Order contains one or more Order Items.",
    from: "e_order",
    to: "e_order_item",
    confidence: 0.97,
    status: "confirmed",
  },
  {
    id: "r_references",
    name: "references",
    description: "An Order Item references the Product being purchased.",
    from: "e_order_item",
    to: "e_product",
    confidence: 0.96,
    status: "confirmed",
  },
  {
    id: "r_belongs_to",
    name: "belongsTo",
    description: "A Product belongs to a Category.",
    from: "e_product",
    to: "e_category",
    confidence: 0.93,
    status: "confirmed",
  },
  {
    id: "r_paid_by",
    name: "paidBy",
    description: "An Order is paid by a Payment.",
    from: "e_order",
    to: "e_payment",
    confidence: 0.9,
    status: "confirmed",
  },
  {
    id: "r_shipped_via",
    name: "shippedVia",
    description: "An Order is shipped via a Shipment.",
    from: "e_order",
    to: "e_shipment",
    confidence: 0.68,
    status: "suggested",
  },
  {
    id: "r_may_include",
    name: "mayInclude",
    description: "An Order may include items from a Category directly.",
    from: "e_order",
    to: "e_category",
    confidence: 0.3,
    // Hand-set to "warning" (see ReviewFlags) purely to exercise the contextual panel's Warning
    // layout — not derived from the 30% confidence above, which is a separate concern.
    status: "warning",
    warningReason:
      "This overlaps with the existing Order → Order Item → Product path — confirm whether Order should really link to Category directly, or if this duplicates that chain.",
  },
  {
    id: "r_details_for",
    name: "detailsFor",
    description: "Product Details describes extended attributes for a Product.",
    from: "e_product_details",
    to: "e_product",
    confidence: 0.55,
    // Product Details (the "from" side) has an Error status — this relation is left exactly as
    // "suggested" here (never rewritten to "error"), but can't be Confirmed until that Entity
    // Type's own Error is resolved. See buildConfirmPlan's Relation-error-dependency rule.
    status: "suggested",
  },
];

/** Whether a Property gets the key-icon Identifier treatment — true for an explicit
 * `isIdentifier: true` flag (set only by the Entity-creation wizard, which lets a user pick any
 * name for their Identifier — see `Property`'s own doc comment) OR, for every existing seed
 * Property (none of which carry that flag), the original naming convention: literally named "id".
 * Both checks stay OR'd together rather than one replacing the other, so this never disagrees
 * with the hundred or so seed Properties already named "id" with no flag set. */
export function isIdentifierProperty(property: { name: string; isIdentifier?: boolean }): boolean {
  return property.isIdentifier === true || property.name.trim().toLowerCase() === "id";
}

export const IDENTIFIER_UNMAPPED_ERROR_REASON = "Identifier must be mapped to a source column.";
export const MISSING_IDENTIFIER_ERROR_REASON = "Entity Type requires an Identifier.";
/** The Entity-level aggregation of `IDENTIFIER_UNMAPPED_ERROR_REASON` — same underlying issue,
 * worded for the owning Entity Type rather than the Property itself. Exported (not just inlined
 * in `entityErrorReason` below) so callers like the Issues popover can recognize this exact string
 * to group it back with its Property-level counterpart, without duplicating the sentence. */
export const ENTITY_UNMAPPED_IDENTIFIER_REASON =
  "This Entity Type has an Identifier property that isn't mapped to a source column yet.";

/** A Property's true review status for display and confirmation — the stored `status` field,
 * except for the one Error case this app ever computes automatically rather than hand-sets: an
 * Identifier property (see `isIdentifierProperty`) with no active column mapping. Low confidence
 * alone is never an Error, and every other status (including "warning") is exactly whatever is
 * stored — this never invents a status or silently clears one that isn't the Identifier case. */
export function propertyStatus(property: Property): ReviewStatus {
  if (isIdentifierProperty(property) && property.mapping === null) return "error";
  return property.status;
}

/** The explanation shown alongside `propertyStatus`'s Error — the fixed Identifier-mapping
 * sentence when that's why it's Error, otherwise whatever `errorReason` is stored on the property
 * itself (which only ever matters while `status` is independently "error" for some other reason). */
export function propertyErrorReason(property: Property): string | undefined {
  if (isIdentifierProperty(property) && property.mapping === null) {
    return IDENTIFIER_UNMAPPED_ERROR_REASON;
  }
  return property.errorReason;
}

/** An Entity Type's true review status — "error" whenever it has no Identifier Property at all
 * (deleted, or renamed/un-flagged away from `isIdentifierProperty`), or whenever at least one of
 * its own Properties is (per `propertyStatus`) currently blocked by the Identifier-mapping rule.
 * Both are purely inherited/aggregated and never a status the entity itself is ever directly set
 * to; otherwise it's exactly whatever `status` is stored on the entity. Editing the ontology into
 * either invalid state is always allowed (see Editing Mode's own "allow the edit, then surface the
 * Error" rule) — this just reflects the CURRENT state, live, every call, so gaining or losing an
 * Identifier (or mapping one) clears or sets it the moment that becomes true, never cached. */
export function entityStatus(entity: Entity): ReviewStatus {
  if (!entity.properties.some(isIdentifierProperty)) return "error";
  if (entity.properties.some((p) => propertyStatus(p) === "error")) return "error";
  return entity.status;
}

/** The Entity Type's DISPLAYED status — a pure, read-only roll-up of the badge/icon shown wherever
 * an Entity's status is rendered (Overview canvas node, Editing Mode card header, "Entity types"
 * toolbox row): the highest-priority status found across the Entity itself and every one of its
 * own Properties, in the order Error > Warning > Suggested > Confirmed (`entityStatus` above is
 * already one of the candidates, so its own "no Identifier"/"unmapped Identifier" auto-Error rules
 * still apply here too). This never rewrites any Property's own stored status — purely a display
 * fact, recomputed live every call, exactly like `entityStatus` itself.
 *
 * Deliberately a SEPARATE function from `entityStatus`, not a replacement for it: several other
 * call sites key off `entityStatus`'s narrower meaning — "is this Entity's OWN status (or its
 * Identifier-mapping rule) Error" — and would silently change behavior if broadened to "is ANY
 * Property anything other than Confirmed" (e.g. `EntitySelectionBar`'s Accept/Decline eligibility,
 * `AiReviewBar`'s "how many Entities are themselves a pending AI suggestion" breakdown, and the
 * Entity Inspector's own Warning explanation box, which must only appear for the Entity's own real
 * Warning — never a stand-in for some other Property's unrelated one). Use this one only for an
 * actual displayed badge; use `entityStatus` for anything that gates behavior or explains itself
 * with the Entity's own `warningReason`/`errorReason` text. */
export function entityDisplayStatus(entity: Entity): ReviewStatus {
  const priority: ReviewStatus[] = ["error", "warning", "suggested", "confirmed"];
  const statuses = [entityStatus(entity), ...entity.properties.map(propertyStatus)];
  for (const level of priority) {
    if (statuses.includes(level)) return level;
  }
  return entityStatus(entity);
}

/** The explanation shown alongside `entityStatus`'s aggregated Error — never the generic
 * `entity.errorReason` (that only applies while the entity's own stored `status` is independently
 * "error", which neither of these two automatic rules ever sets directly). Checked in the same
 * order as `entityStatus` above: missing an Identifier entirely takes priority over merely having
 * one that isn't mapped yet, since the latter can't even be evaluated without one. */
export function entityErrorReason(entity: Entity): string | undefined {
  if (!entity.properties.some(isIdentifierProperty)) {
    return MISSING_IDENTIFIER_ERROR_REASON;
  }
  if (entity.properties.some((p) => propertyStatus(p) === "error")) {
    return ENTITY_UNMAPPED_IDENTIFIER_REASON;
  }
  return entity.errorReason;
}

/** Whichever connected Entity Type is CURRENTLY blocking this Relation from being confirmed —
 * `null` if neither side has an Error right now. Shared by `buildConfirmPlan` (which uses it to
 * decide whether a Relation belongs in the Errors list at all) and the Issues popover / Editing
 * Mode's own Relation Inspector (which need to show the SAME fact, just in a different place) —
 * extracted here once so neither ever drifts from the other. Purely read-derived, same as
 * `entityStatus` itself; never writes anything. */
export function relationBlockingEntity(relation: Relation, entities: Entity[]): Entity | null {
  const fromEntity = entities.find((e) => e.id === relation.from);
  const toEntity = entities.find((e) => e.id === relation.to);
  if (fromEntity && entityStatus(fromEntity) === "error") return fromEntity;
  if (toEntity && entityStatus(toEntity) === "error") return toEntity;
  return null;
}

/** A Relation's true review status — "error" whenever it's blocked by a connected Entity Type's
 * own Error (see `relationBlockingEntity`), even though the Relation's own stored `status` might
 * still be "suggested"/"confirmed"/"warning"; otherwise exactly whatever `status` is stored.
 * Mirrors `entityStatus`'s own "purely inherited, recomputed live" shape. */
export function relationStatus(relation: Relation, entities: Entity[]): ReviewStatus {
  if (relation.status === "error") return "error";
  return relationBlockingEntity(relation, entities) ? "error" : relation.status;
}

/** The explanation shown alongside `relationStatus`'s Error — the Relation's own stored
 * `errorReason` when it's independently Error, otherwise the same "resolve the connected Entity
 * Type's Error first" sentence `buildConfirmPlan` already builds for this exact case. */
export function relationErrorReason(relation: Relation, entities: Entity[]): string | undefined {
  if (relation.status === "error") return relation.errorReason;
  const blockingEntity = relationBlockingEntity(relation, entities);
  if (blockingEntity) {
    return `Resolve errors in connected Entity Types before confirming this Relation. (${blockingEntity.name || "Untitled entity"} has an unresolved error.)`;
  }
  return relation.errorReason;
}

export const tableByName = (name: string) => tables.find((t) => t.name === name);

/** Real example values for one column, drawn straight from the table's own mock `rows` (never a
 * separately-authored sample list, so it can't drift from the data actually shown elsewhere) —
 * deduplicated, blanks dropped, in first-seen order. Empty when the table has no sample rows or
 * every value for this column happens to be blank. */
export function columnSampleValues(table: TableSchema, columnName: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  table.rows.forEach((row) => {
    const v = row[columnName];
    if (v && !seen.has(v)) {
      seen.add(v);
      values.push(v);
    }
  });
  return values;
}

/** How many of an entity's own properties have a CONFIRMED ("mapped") source-column connection —
 * never just "has a connector at all" (see `ColumnRef`'s own doc comment: a Suggested Mapping
 * doesn't count until it's actually accepted). This is the Header's own "how mapped is my
 * ontology?" ground truth for Entities/Properties, so it has to agree with `tableMappingCompleteness`
 * below on what "mapped" means, or the same navbar row would tell two different stories about the
 * exact same data. */
export function entityMappingCompleteness(entity: Entity): { mapped: number; total: number } {
  return {
    mapped: entity.properties.filter(
      (p) => p.mapping !== null && mappingStatus(p.mapping) === "mapped",
    ).length,
    total: entity.properties.length,
  };
}

export type ColumnUsage = {
  name: string;
  type: string;
  mappedBy: {
    entityId: string;
    entityName: string;
    propertyId: string;
    propertyName: string;
    /** This ONE mapper's own connector state — a column can have several mappers with a mix of
     * `"suggested"`/`"mapped"` at once (see `ColGroupEntry`'s own doc comment in DetailView.tsx for
     * how the canvas resolves that mix into one displayed state). */
    status: MappingStatus;
  }[];
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
        .map((p) => ({
          entityId: e.id,
          entityName: e.name,
          propertyId: p.id,
          propertyName: p.name,
          status: mappingStatus(p.mapping!),
        })),
    ),
  }));
}

/** How many of a table's own columns have at least one CONFIRMED ("mapped") connection — a column
 * whose only mappers are still Suggested Mappings does NOT count (see `ColumnRef`'s own doc
 * comment). Mirrors `entityMappingCompleteness`'s own "confirmed only" rule so the Header's
 * Entities/Properties/Tables/Columns pills all describe the same underlying fact consistently. */
export function tableMappingCompleteness(
  tableName: string,
  entities: Entity[],
): { mapped: number; total: number } {
  const usage = tableColumnUsage(tableName, entities);
  return {
    mapped: usage.filter((c) => c.mappedBy.some((m) => m.status === "mapped")).length,
    total: usage.length,
  };
}

/** Whether a table's columns are entirely unmapped, entirely mapped, or somewhere in between —
 * drives the three-state mapping badge shown next to a table wherever it's listed. */
export function tableMappingStatus(
  tableName: string,
  entities: Entity[],
): "unmapped" | "partial" | "full" {
  const { mapped, total } = tableMappingCompleteness(tableName, entities);
  if (total === 0 || mapped === 0) return "unmapped";
  return mapped === total ? "full" : "partial";
}

/** Every entity that draws at least one property from this table. */
export function entitiesUsingTable(tableName: string, entities: Entity[]): Entity[] {
  return entities.filter((e) => e.properties.some((p) => p.mapping?.table === tableName));
}

/** Every distinct table this entity draws at least one property from — the mirror of
 * `entitiesUsingTable` above, from the entity's own side of the same mapping. */
export function tablesUsedByEntity(entity: Entity): string[] {
  return Array.from(
    new Set(entity.properties.filter((p) => p.mapping).map((p) => p.mapping!.table)),
  );
}

// --- Confidence reasoning (per object-kind, grounded in live data) -----------------------------
// The "Why this confidence score?" panel (see ContextPanel.tsx) needs a genuinely different
// explanation depending on what's being scored — an Entity suggestion, a Property suggestion, a
// Relation suggestion, and a Property<->Column Mapping are all different questions, so they get
// different evidence shapes rather than one generic bucketed sentence (that's still `aiReasoning`
// in ConfidenceChip.tsx, kept as the fallback for spots with no object context to reason from, e.g.
// the Overview<->Detail morph transition). Entity/Property/Relation share one shape ("Reasoning"
// prose + a "Top datasets" evidence table); Mapping gets a deeper shape of its own (a match summary
// + the same prose + a per-column breakdown) since it's explaining a specific Column<->Property
// pairing, not just "how much do I believe this suggestion."
export type ReasoningEvidenceRow = { table: string; detail: string; score: number };
export type ReasoningContent =
  | { kind: "evidence"; reasoning: string; topDatasets: ReasoningEvidenceRow[] }
  | {
      kind: "mapping";
      matchSummary: string;
      reasoning: string;
      column: { name: string; entityMatchPct: number; entityType: string; property: string };
    };

/** Entity suggestion reasoning: how much of the entity's own primary source table (`entity.table`)
 * its mapped Properties strongly account for, plus which tables it actually draws support from.
 * "Strongly match" reuses `aiReasoning`'s own 85%-confidence bar, so this never disagrees with what
 * that same Property would say about itself. */
export function entityReasoningContent(entity: Entity): ReasoningContent {
  const byTable = new Map<string, { columns: string[]; maxConfidence: number }>();
  entity.properties.forEach((p) => {
    if (!p.mapping) return;
    const row = byTable.get(p.mapping.table) ?? { columns: [], maxConfidence: 0 };
    row.columns.push(p.mapping.column);
    row.maxConfidence = Math.max(row.maxConfidence, p.confidence);
    byTable.set(p.mapping.table, row);
  });
  const topDatasets = Array.from(byTable.entries())
    .map(([table, row]) => ({
      table,
      detail: row.columns.join(", "),
      score: Math.round(row.maxConfidence * 100),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const primaryTable = tableByName(entity.table);
  const strongMatches = entity.properties.filter(
    (p) => p.mapping?.table === entity.table && p.confidence >= 0.85,
  ).length;
  const reasoning = primaryTable
    ? `${strongMatches} out of ${primaryTable.columns.length} columns in ${entity.table} strongly match this entity.`
    : `${strongMatches} of this entity's own properties strongly match a source column.`;
  return { kind: "evidence", reasoning, topDatasets };
}

/** Property suggestion reasoning: how consistently a property with this exact name recurs, mapped,
 * across every Entity in the ontology — not just this one Property's own mapping. A property named
 * "id" that maps into several different tables' own primary keys is real, load-bearing evidence
 * that the concept itself is consistent, independent of whether any single mapping is strong. */
export function propertyReasoningContent(property: Property, entities: Entity[]): ReasoningContent {
  const name = property.name.trim().toLowerCase();
  const matches: { table: string; column: string; score: number }[] = [];
  if (name) {
    entities.forEach((e) => {
      e.properties.forEach((p) => {
        if (!p.mapping || p.name.trim().toLowerCase() !== name) return;
        matches.push({
          table: p.mapping.table,
          column: p.mapping.column,
          score: Math.round(p.confidence * 100),
        });
      });
    });
  }
  const distinctTables = new Set(matches.map((m) => m.table)).size;
  const reasoning =
    matches.length > 0
      ? `This property appears consistently across ${distinctTables} table${distinctTables === 1 ? "" : "s"}, in ${matches.length} column${matches.length === 1 ? "" : "s"}.`
      : "This property isn't mapped anywhere yet, so there's no cross-table pattern to compare it against.";
  const topDatasets = matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => ({ table: m.table, detail: m.column, score: m.score }));
  return { kind: "evidence", reasoning, topDatasets };
}

/** Relation suggestion reasoning: does either connected Entity's own Identifier column show up, by
 * name, inside the OTHER entity's source table — the real foreign-key shape a Customer->Order
 * relation would leave behind (e.g. `customers.customer_id` reappearing as `orders.customer_id`).
 * Checked in both directions since either entity could be the one holding the foreign key. */
export function relationReasoningContent(relation: Relation, entities: Entity[]): ReasoningContent {
  const fromEntity = entities.find((e) => e.id === relation.from);
  const toEntity = entities.find((e) => e.id === relation.to);
  const scorePct = Math.round(relation.confidence * 100);
  const evidence: { table: string; column: string }[] = [];

  const checkForeignKey = (owner: Entity | undefined, other: Entity | undefined) => {
    if (!owner || !other) return;
    const identifier = owner.properties.find((p) => isIdentifierProperty(p) && p.mapping);
    const fkColumn = identifier?.mapping?.column;
    if (!fkColumn) return;
    const otherTable = tableByName(other.table);
    if (otherTable?.columns.some((c) => c.name === fkColumn)) {
      evidence.push({ table: other.table, column: fkColumn });
    }
  };
  checkForeignKey(fromEntity, toEntity);
  checkForeignKey(toEntity, fromEntity);

  const distinctTables = new Set(evidence.map((e) => e.table)).size;
  const reasoning =
    evidence.length > 0
      ? `This relation appears consistently across ${distinctTables} table${distinctTables === 1 ? "" : "s"}, in ${evidence.length} column${evidence.length === 1 ? "" : "s"}.`
      : "No foreign-key-shaped column was found linking these two Entity Types' own source tables.";
  const topDatasets = evidence.map((e) => ({ table: e.table, detail: e.column, score: scorePct }));
  return { kind: "evidence", reasoning, topDatasets };
}

/** Property<->Column mapping reasoning — the deepest of the four, since it's explaining one
 * specific pairing rather than "how much do I believe this suggestion." `entity`/`property` must
 * be the Property's own owner — every value here (Entity name, Property name, mapped Column,
 * Mapping confidence = `property.confidence`) is read straight off that pairing, never a second,
 * separately-authored example. Returns `null` for an unmapped Property, since there's no Mapping
 * to explain yet. */
export function mappingReasoningContent(
  entity: Entity,
  property: Property,
): ReasoningContent | null {
  if (!property.mapping) return null;
  const pct = Math.round(property.confidence * 100);
  const strength =
    property.confidence >= 0.85
      ? "a strong match"
      : property.confidence >= 0.6
        ? "a likely match"
        : "a low-confidence match";
  const matchSummary =
    `Based on the column name, this appears to be ${strength} to ${entity.name} → ${property.name}. ` +
    `${entity.name} → ${property.name} is the closest match to column ${property.mapping.column} with ${pct}% confidence.`;
  return {
    kind: "mapping",
    matchSummary,
    reasoning:
      "We use embeddings of the semantic representation of the column based on the table name, column name, and sample values.",
    column: {
      name: property.mapping.column,
      entityMatchPct: pct,
      entityType: entity.name,
      property: property.name,
    },
  };
}

// --- Confidence/Filter scope (shared review-relevance predicate) -------------------------------
// One predicate for "is this Entity/Property/Relation/Mapping currently in review scope", reused
// everywhere Confidence range + Filter (`statusFilter`) decide what to visually de-emphasize — an
// item is in scope when it's already Confirmed (Confidence range only governs ACTIVE review; an
// Accepted item is never re-hidden just because its old suggestion score falls outside the current
// range) or its own confidence is within the range, AND its own status is one Filter still has
// checked. Data Tables and Columns have no status/confidence of their own (see their own doc
// comments above) — see `isColumnInScope`/`isTableInScope` below for how their relevance is derived
// instead, from whichever Property↔Column Mapping(s) touch them. Out-of-scope never means "doesn't
// exist" — every call site here only ever feeds a dim/mute visual treatment, never a removal from a
// list or canvas, so users can still see how the ontology is structured even outside the active
// review scope.
export function isReviewItemInScope(
  status: ReviewStatus,
  confidence: number,
  confidenceRange: { min: number; max: number },
  statusFilter: Set<ReviewStatus>,
): boolean {
  const pct = Math.round(confidence * 100);
  const inRange =
    status === "confirmed" || (pct >= confidenceRange.min && pct <= confidenceRange.max);
  return inRange && statusFilter.has(status);
}

/** A Column's own review-scope — derived from whichever Property↔Column Mapping(s) touch it, since
 * Columns carry no Confidence or ReviewStatus of their own (see `TableSchema`'s own doc comment —
 * a Column is raw source data; Confidence belongs to the Mapping, not the Column). An unmapped column has no
 * mapping to derive a scope from, so it's always in scope — the same "no data renders as no
 * opinion" rule Confidence filtering already follows everywhere else. A column mapped by more than
 * one Property (structurally possible, if rare) is in scope if ANY ONE of its mappings is — being
 * relevant to even one Property's active review is enough to keep the column at full emphasis, the
 * same "any qualifying connection wins" rule `isTableInScope` below also follows. */
export function isColumnInScope(
  tableName: string,
  columnName: string,
  entities: Entity[],
  confidenceRange: { min: number; max: number },
  statusFilter: Set<ReviewStatus>,
): boolean {
  const mappingProperties: Property[] = [];
  entities.forEach((e) => {
    e.properties.forEach((p) => {
      if (p.mapping?.table === tableName && p.mapping.column === columnName) {
        mappingProperties.push(p);
      }
    });
  });
  if (mappingProperties.length === 0) return true;
  return mappingProperties.some((p) =>
    isReviewItemInScope(p.status, p.confidence, confidenceRange, statusFilter),
  );
}

/** A Table's own review-scope — same derivation as `isColumnInScope`, aggregated across every
 * column the table actually has: a table with nothing mapped into it yet has nothing to derive a
 * scope from either, so it stays in scope (no opinion); once it has at least one mapped column, the
 * table is in scope exactly when at least one of them is — a table with several mappings never dims
 * just because ONE of them happens to be out of scope, but a table whose every mapping is out of
 * scope does. */
export function isTableInScope(
  tableName: string,
  entities: Entity[],
  confidenceRange: { min: number; max: number },
  statusFilter: Set<ReviewStatus>,
): boolean {
  const usage = tableColumnUsage(tableName, entities);
  const mappedColumns = usage.filter((c) => c.mappedBy.length > 0);
  if (mappedColumns.length === 0) return true;
  return mappedColumns.some((c) =>
    isColumnInScope(tableName, c.name, entities, confidenceRange, statusFilter),
  );
}

/** NOT a Table's own Confidence — a Table doesn't have one (see `TableSchema`'s own doc comment).
 * This is the highest Mapping Confidence among whatever Properties currently map into any of the
 * table's columns (a Mapping's confidence IS a Property's `confidence` — see `Property.mapping`),
 * used ONLY to sort the Data Tables list by "how relevant is this table to the active review right
 * now" — never displayed as a labeled value. `undefined` (sorts as "no value") when nothing maps
 * into the table yet, same as every other Confidence display in the app. */
export function tableHighestMappingConfidence(
  tableName: string,
  entities: Entity[],
): number | undefined {
  let max: number | undefined;
  entities.forEach((e) => {
    e.properties.forEach((p) => {
      if (p.mapping?.table === tableName && (max == null || p.confidence > max)) max = p.confidence;
    });
  });
  return max;
}

/** Display-only fallback for a Relation with no name yet — e.g. one just auto-created as an
 * unresolved placeholder (see app-state's `createPlaceholderRelation`). Never written back to the
 * Relation itself, so an actually-empty `name` is still exactly what "hasn't been named yet"
 * checks (like `renameRelation`'s own Error-clearing rule) keep looking for. */
export function relationLabel(relation: Relation): string {
  return relation.name.trim() || "Unnamed relation";
}

// --- Global Search ------------------------------------------------------------------------------
// One search covering the whole Ontology + Data model (Entity Types, Properties, Relations, Data
// Tables, Columns) rather than separate per-panel searches — see the Header's `GlobalSearchPalette`
// and app-state's `searchFocus`/`selectSearchResult`, which together are what actually act on the
// ref a search result resolves to.

/** What a search result actually points at — enough to both look it up again and act on it (pan
 * Overview's canvas to it, or navigate Editing to it via the same `openDetail` every other
 * in-workspace navigation already uses). */
export type SearchResultRef =
  | { kind: "entity"; id: string }
  | { kind: "property"; entityId: string; propertyId: string }
  | { kind: "relation"; id: string }
  | { kind: "table"; name: string }
  | { kind: "column"; table: string; column: string };

export type SearchResult = {
  ref: SearchResultRef;
  /** The matched object's own name. */
  label: string;
  /** Owning Entity Type / Data Table name, shown alongside `label` to disambiguate a duplicate
   * name across different parents (e.g. two different Entities each with their own `id` Property) —
   * omitted only for Entity/Relation/Table results, which have no parent of their own. */
  parentLabel?: string;
};

export type SearchResults = {
  entities: SearchResult[];
  properties: SearchResult[];
  relations: SearchResult[];
  tables: SearchResult[];
  columns: SearchResult[];
};

const SEARCH_RESULT_LIMIT_PER_GROUP = 8;

/** The single search index behind Global Search — a plain case-insensitive substring match on
 * each object's own name, grouped by kind. Deliberately simple (no fuzzy matching, no ranking
 * beyond "Entities/Tables before their own children") since the point of this pass is giving the
 * whole Ontology + Data model ONE search surface, not a sophisticated matcher. Returns every group
 * empty for a blank query — this is a results list, not a browse-everything list. */
export function searchOntologyAndData(
  entities: Entity[],
  relations: Relation[],
  tables: TableSchema[],
  query: string,
): SearchResults {
  const q = query.trim().toLowerCase();
  const empty: SearchResults = {
    entities: [],
    properties: [],
    relations: [],
    tables: [],
    columns: [],
  };
  if (!q) return empty;

  const results: SearchResults = {
    entities: [],
    properties: [],
    relations: [],
    tables: [],
    columns: [],
  };

  for (const e of entities) {
    if (
      results.entities.length < SEARCH_RESULT_LIMIT_PER_GROUP &&
      e.name.toLowerCase().includes(q)
    ) {
      results.entities.push({
        ref: { kind: "entity", id: e.id },
        label: e.name || "Untitled entity",
      });
    }
    for (const p of e.properties) {
      if (results.properties.length >= SEARCH_RESULT_LIMIT_PER_GROUP) break;
      if (p.name.toLowerCase().includes(q)) {
        results.properties.push({
          ref: { kind: "property", entityId: e.id, propertyId: p.id },
          label: p.name || "Untitled property",
          parentLabel: e.name || "Untitled entity",
        });
      }
    }
  }

  for (const r of relations) {
    if (results.relations.length >= SEARCH_RESULT_LIMIT_PER_GROUP) break;
    if (relationLabel(r).toLowerCase().includes(q)) {
      results.relations.push({ ref: { kind: "relation", id: r.id }, label: relationLabel(r) });
    }
  }

  for (const t of tables) {
    if (results.tables.length < SEARCH_RESULT_LIMIT_PER_GROUP && t.name.toLowerCase().includes(q)) {
      results.tables.push({ ref: { kind: "table", name: t.name }, label: t.name });
    }
    for (const c of t.columns) {
      if (results.columns.length >= SEARCH_RESULT_LIMIT_PER_GROUP) break;
      if (c.name.toLowerCase().includes(q)) {
        results.columns.push({
          ref: { kind: "column", table: t.name, column: c.name },
          label: c.name,
          parentLabel: t.name,
        });
      }
    }
  }

  return results;
}

export function searchResultCount(results: SearchResults): number {
  return (
    results.entities.length +
    results.properties.length +
    results.relations.length +
    results.tables.length +
    results.columns.length
  );
}

/** One Entity/Property/Relation that needs attention before (or instead of) being confirmed —
 * shown in the global Confirm dialog's summary list. `reason` is the item's own warningReason/
 * errorReason, or, for a Relation blocked purely by a connected Entity Type's error, an explicit
 * note naming that entity — never a sentence derived from confidence. */
export type ConfirmIssue = {
  kind: "warning" | "error";
  itemKind: "entity" | "property" | "relation";
  id: string;
  name: string;
  reason: string;
};

export type ConfirmPlan = {
  errors: ConfirmIssue[];
  warnings: ConfirmIssue[];
  /** Everything not currently blocked by an Error — safe to flip to "confirmed" in one atomic
   * pass. Includes plain "suggested" items and "warning" items alike (a Warning never blocks). */
  eligible: {
    entityIds: string[];
    propertyIds: { entityId: string; propertyId: string }[];
    relationIds: string[];
  };
};

/** Classifies every not-yet-confirmed Entity/Property/Relation as Ready, Warning, or Error ahead
 * of the global Confirm action — see the confirmation-model spec this implements. Blocking is
 * driven exclusively by `propertyStatus`/`entityStatus` being "error" — never by confidence alone
 * — so a low-confidence "suggested" item is Ready and a Warning never blocks; a Property is only
 * ever Error via the Identifier-mapping rule those two functions compute, and an Entity Type only
 * ever Error by inheriting that from one of its own Properties. A Relation is additionally blocked
 * (without ever having its own status rewritten) when either connected Entity Type currently has
 * an Error — that dependency is re-derived here from live `entities`/`relations` on every call, so
 * it always reflects whatever those two Entity Types' status is *right now*. Tables/Columns carry
 * no ReviewStatus of their own (they're tracked separately via mapping completeness) and are
 * outside this plan entirely. */
export function buildConfirmPlan(entities: Entity[], relations: Relation[]): ConfirmPlan {
  const errors: ConfirmIssue[] = [];
  const warnings: ConfirmIssue[] = [];
  const entityIds: string[] = [];
  const propertyIds: { entityId: string; propertyId: string }[] = [];
  const relationIds: string[] = [];

  entities.forEach((e) => {
    if (e.status === "confirmed") return;
    if (entityStatus(e) === "error") {
      errors.push({
        kind: "error",
        itemKind: "entity",
        id: e.id,
        name: e.name || "Untitled entity",
        reason: entityErrorReason(e) ?? "No error details available.",
      });
      return;
    }
    if (e.status === "warning") {
      warnings.push({
        kind: "warning",
        itemKind: "entity",
        id: e.id,
        name: e.name || "Untitled entity",
        reason: e.warningReason ?? "No warning details available.",
      });
    }
    entityIds.push(e.id);
  });

  entities.forEach((e) => {
    e.properties.forEach((p) => {
      if (p.status === "confirmed") return;
      if (propertyStatus(p) === "error") {
        errors.push({
          kind: "error",
          itemKind: "property",
          id: p.id,
          name: `${e.name || "Untitled entity"} — ${p.name || "Untitled property"}`,
          reason: propertyErrorReason(p) ?? "No error details available.",
        });
        return;
      }
      if (p.status === "warning") {
        warnings.push({
          kind: "warning",
          itemKind: "property",
          id: p.id,
          name: `${e.name || "Untitled entity"} — ${p.name || "Untitled property"}`,
          reason: p.warningReason ?? "No warning details available.",
        });
      }
      propertyIds.push({ entityId: e.id, propertyId: p.id });
    });
  });

  relations.forEach((r) => {
    if (r.status === "confirmed") return;
    if (r.status === "error" || relationBlockingEntity(r, entities)) {
      errors.push({
        kind: "error",
        itemKind: "relation",
        id: r.id,
        name: r.name || "Untitled relation",
        reason: relationErrorReason(r, entities) ?? "No error details available.",
      });
      return;
    }
    if (r.status === "warning") {
      warnings.push({
        kind: "warning",
        itemKind: "relation",
        id: r.id,
        name: r.name || "Untitled relation",
        reason: r.warningReason ?? "No warning details available.",
      });
    }
    relationIds.push(r.id);
  });

  return { errors, warnings, eligible: { entityIds, propertyIds, relationIds } };
}
