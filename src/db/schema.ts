import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";

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
// Timeseries  (append-only data store)
// ---------------------------------------------------------------------------

export const timeseries = sqliteTable(
  "timeseries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adapterId: text("adapter_id").notNull(),
    metric: text("metric").notNull(),
    entityId: text("entity_id").notNull(),
    locationId: text("location_id"), // optional FK to locations.id
    value: real("value").notNull(),
    metadata: text("metadata"), // JSON string
    observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
    ingestedAt: integer("ingested_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("ts_adapter_metric_entity_idx").on(
      table.adapterId,
      table.metric,
      table.entityId,
      table.observedAt,
    ),
    index("ts_observed_at_idx").on(table.observedAt),
    index("ts_location_idx").on(table.locationId),
  ],
);

// ---------------------------------------------------------------------------
// Latest values  (materialized "current" view – upserted on ingest)
// ---------------------------------------------------------------------------

export const latestValues = sqliteTable(
  "latest_values",
  {
    adapterId: text("adapter_id").notNull(),
    metric: text("metric").notNull(),
    entityId: text("entity_id").notNull(),
    locationId: text("location_id"), // optional FK to locations.id
    value: real("value").notNull(),
    metadata: text("metadata"), // JSON string
    observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.adapterId, table.metric, table.entityId],
    }),
    index("lv_location_idx").on(table.locationId),
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
// Snapshots  (point-in-time JSON captures)
// ---------------------------------------------------------------------------

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adapterId: text("adapter_id").notNull(),
    snapshotType: text("snapshot_type").notNull(),
    locationId: text("location_id"), // optional FK to locations.id
    data: text("data").notNull(), // JSON blob
    capturedAt: integer("captured_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("snap_adapter_type_idx").on(
      table.adapterId,
      table.snapshotType,
      table.capturedAt,
    ),
    index("snap_location_idx").on(table.locationId),
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
  timeseries,
  latestValues,
  documents,
  snapshots,
  ingestLog,
};
