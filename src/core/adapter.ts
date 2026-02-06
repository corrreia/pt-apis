import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Db } from "../db/client";

// ---------------------------------------------------------------------------
// Data & Schedule Types
// ---------------------------------------------------------------------------

/** The kinds of data an adapter can produce. */
export type DataType = "timeseries" | "document" | "snapshot";

/**
 * Predefined cron frequencies.
 * The scheduler maps these to the 3 Cloudflare Workers cron triggers:
 *   - `* * * * *`   -> every_minute, every_5_minutes, every_15_minutes
 *   - `0 * * * *`   -> hourly, every_6_hours
 *   - `0 0 * * *`   -> daily, weekly
 */
export type CronFrequency =
  | "every_minute"
  | "every_5_minutes"
  | "every_15_minutes"
  | "hourly"
  | "every_6_hours"
  | "daily"
  | "weekly";

// ---------------------------------------------------------------------------
// Storage Input Types
// ---------------------------------------------------------------------------

/** A single timeseries data point to ingest. */
export interface TimeseriesPoint {
  metric: string;
  entityId: string;
  value: number;
  /** Optional link to a shared location. */
  locationId?: string;
  metadata?: Record<string, unknown>;
  observedAt: Date;
}

/** A document to upload to R2. */
export interface DocumentInput {
  name: string;
  contentType: string;
  data: ArrayBuffer | ReadableStream;
  /** Optional link to a shared location. */
  locationId?: string;
  metadata?: Record<string, unknown>;
}

/** A location to register in the shared locations table. */
export interface LocationInput {
  /** Slug id, e.g. "lisbon", "porto-campanha". */
  id: string;
  /** Display name, e.g. "Lisboa". */
  name: string;
  latitude?: number;
  longitude?: number;
  /** Location type: "city", "district", "station", "sensor", etc. */
  type: string;
  region?: string;
  district?: string;
  municipality?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter Context  (passed to schedule handlers)
// ---------------------------------------------------------------------------

/**
 * Everything an adapter needs to do its job.
 * Created fresh for each schedule invocation by the scheduler.
 */
export interface AdapterContext {
  env: Env;
  db: Db;
  r2: R2Bucket;
  cache: KVNamespace;
  log: (...args: unknown[]) => void;

  /** Batch-insert timeseries points + upsert latest values. */
  ingestTimeseries(adapterId: string, points: TimeseriesPoint[]): Promise<number>;

  /** Upload a document to R2 and record metadata in D1. */
  uploadDocument(adapterId: string, doc: DocumentInput): Promise<string>;

  /** Store a JSON snapshot in D1. */
  storeSnapshot(adapterId: string, type: string, data: unknown, locationId?: string): Promise<void>;

  /** Upsert a location into the shared locations table. */
  registerLocation(loc: LocationInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapter Schedule
// ---------------------------------------------------------------------------

export interface AdapterSchedule {
  /** How often this job runs. */
  frequency: CronFrequency;
  /** The actual work to perform. */
  handler: (ctx: AdapterContext) => Promise<void>;
  /** Human-readable description shown in logs and docs. */
  description: string;
}

// ---------------------------------------------------------------------------
// Adapter Definition  (what every adapter must export)
// ---------------------------------------------------------------------------

export interface AdapterFeatures {
  /** True if this adapter contributes to the shared locations table. Default: true. */
  hasLocations?: boolean;
}

/**
 * Adapter definition. Conventions (not enforced):
 *
 * **R2 storage:** Keys use `{adapterId}/{docId}/{filename}`. Best practice:
 * one folder per adapter. Cross-adapter read is allowed; cross-adapter write
 * is discouraged.
 *
 * **Cron:** Cloudflare Workers allows 3 cron triggers. The scheduler maps
 * CronFrequency to the right trigger.
 *
 * **Optional features:** Not all data has localization. Set `features.hasLocations: false`
 * if your adapter does not contribute to the shared locations table.
 */
export interface AdapterDefinition {
  /** Unique slug, e.g. "ipma-weather". Used in URLs and DB. */
  id: string;
  /** Display name, e.g. "IPMA Weather Forecast". */
  name: string;
  /** What this adapter does. */
  description: string;
  /** URL of the upstream public data source. */
  sourceUrl: string;
  /** Which data types this adapter produces. */
  dataTypes: DataType[];
  /** Cron schedules for data fetching. */
  schedules: AdapterSchedule[];
  /**
   * Optional short tag for OpenAPI docs. Defaults to `name`.
   * Use when you want a shorter tag, e.g. "Air Quality" vs "Air Quality — UV Index".
   */
  openApiTag?: string;
  /**
   * Optional features for docs and API responses (e.g. hasLocations).
   * Not enforced — locationId remains optional in data types.
   */
  features?: AdapterFeatures;
  /**
   * Optional: custom Drizzle schema tables defined by this adapter.
   * Used for discovery/documentation. The adapter imports its own tables
   * directly at runtime. Drizzle Kit picks them up via the glob in
   * drizzle.config.ts.
   */
  schema?: Record<string, unknown>;
  /**
   * Optional: custom OpenAPIHono sub-app with adapter-specific routes.
   * Auto-mounted at `/v1/{adapter.id}/...` so routes appear in the
   * OpenAPI spec automatically.
   *
   * Example: a trains adapter defines `GET /departures/:stationId`
   * -> served at `/v1/cp-trains/departures/:stationId`
   */
  routes?: OpenAPIHono<{ Bindings: Env }>;
}
