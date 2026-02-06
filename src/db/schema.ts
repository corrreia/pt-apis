import { sqliteTable, integer, text, real, index } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Sources  (one row per registered adapter)
// ---------------------------------------------------------------------------

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sourceUrl: text("source_url"),
  dataTypes: text("data_types").notNull(), // JSON array, e.g. '["timeseries","document"]'
  status: text("status").notNull().default("active"),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Locations  (shared geographic reference across all adapters)
// ---------------------------------------------------------------------------

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(), // slug: "lisbon", "porto-campanha"
    name: text("name").notNull(), // display name: "Lisboa"
    latitude: real("latitude"),
    longitude: real("longitude"),
    type: text("type").notNull(), // "city", "district", "station", "sensor"
    region: text("region"), // "Centro", "Norte", "Algarve"
    district: text("district"), // "Lisboa", "Porto"
    municipality: text("municipality"), // "Lisboa", "Vila Nova de Gaia"
    metadata: text("metadata"), // JSON
  },
  (table) => [
    index("loc_type_idx").on(table.type),
    index("loc_district_idx").on(table.district),
    index("loc_region_idx").on(table.region),
  ],
);

// ---------------------------------------------------------------------------
// ApiData  (unified table for all adapter payloads)
// ---------------------------------------------------------------------------

export const apiData = sqliteTable(
  "api_data",
  {
    id: text("id").primaryKey(),
    apiSource: text("api_source").notNull(),
    payloadType: text("payload_type").notNull(),
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
    locationId: text("location_id"),
    payload: text("payload").notNull(), // JSON
    tags: text("tags"), // JSON array
    scrapedAt: integer("scraped_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_api_data_timestamp").on(table.timestamp),
    index("idx_api_data_source_time").on(table.apiSource, table.timestamp),
    index("idx_api_data_location").on(table.locationId),
    index("idx_api_data_source_type").on(table.apiSource, table.payloadType),
    index("idx_api_data_source_type_time").on(table.apiSource, table.payloadType, table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// Documents  (metadata for R2-stored files)
// ---------------------------------------------------------------------------

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    adapterId: text("adapter_id").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    r2Key: text("r2_key").notNull(),
    locationId: text("location_id"), // optional FK to locations.id
    sizeBytes: integer("size_bytes"),
    metadata: text("metadata"), // JSON string
    capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("doc_adapter_idx").on(table.adapterId),
    index("doc_location_idx").on(table.locationId),
  ],
);

// ---------------------------------------------------------------------------
// Ingest log  (audit trail for cron runs)
// ---------------------------------------------------------------------------

export const ingestLog = sqliteTable(
  "ingest_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adapterId: text("adapter_id").notNull(),
    status: text("status").notNull(), // "running" | "success" | "error"
    recordsCount: integer("records_count").default(0),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (table) => [
    index("log_adapter_status_idx").on(table.adapterId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Schema export  (for Drizzle client)
// ---------------------------------------------------------------------------

export const dbSchema = {
  sources,
  locations,
  apiData,
  documents,
  ingestLog,
};
