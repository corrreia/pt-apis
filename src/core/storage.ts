import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  apiData,
  documents,
  locations,
  ingestLog,
} from "../db/schema";
import type {
  ApiDataInput,
  DocumentInput,
  LocationInput,
  AdapterContext,
} from "./adapter";

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

/**
 * Retry a function with exponential backoff for transient D1/network errors.
 * Only retries on errors that look transient (network, D1 internal, busy).
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isTransient =
        message.includes("SQLITE_BUSY") ||
        message.includes("D1_ERROR") ||
        message.includes("network") ||
        message.includes("fetch failed") ||
        message.includes("Too many requests");
      if (!isTransient || attempt === MAX_RETRIES - 1) throw error;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      console.warn(`[storage] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms:`, message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Location registration
// ---------------------------------------------------------------------------

/** Upsert a location into the shared locations table. */
export async function registerLocation(
  db: Db,
  loc: LocationInput,
): Promise<void> {
  await withRetry(
    () =>
      db
        .insert(locations)
        .values({
          id: loc.id,
          name: loc.name,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          type: loc.type,
          region: loc.region ?? null,
          district: loc.district ?? null,
          municipality: loc.municipality ?? null,
          metadata: loc.metadata ? JSON.stringify(loc.metadata) : null,
        })
        .onConflictDoUpdate({
          target: locations.id,
          set: {
            name: loc.name,
            latitude: loc.latitude ?? null,
            longitude: loc.longitude ?? null,
            type: loc.type,
            region: loc.region ?? null,
            district: loc.district ?? null,
            municipality: loc.municipality ?? null,
            metadata: loc.metadata ? JSON.stringify(loc.metadata) : null,
          },
        }),
    "registerLocation",
  );
}

// ---------------------------------------------------------------------------
// ApiData storage
// ---------------------------------------------------------------------------

/**
 * Store a row in api_data.
 * Returns the id of the inserted row.
 */
export async function storeApiData(
  db: Db,
  adapterId: string,
  payloadType: string,
  payload: unknown,
  options?: ApiDataInput,
): Promise<string> {
  const now = new Date();
  const timestamp = options?.timestamp ?? now;
  const scrapedAt = options?.scrapedAt ?? now;
  const id = `${adapterId}:${payloadType}:${options?.locationId ?? "global"}:${timestamp.getTime()}:${crypto.randomUUID().slice(0, 8)}`;

  await withRetry(
    () =>
      db.insert(apiData).values({
        id,
        apiSource: adapterId,
        payloadType,
        timestamp,
        locationId: options?.locationId ?? null,
        payload: JSON.stringify(payload),
        tags: options?.tags ? JSON.stringify(options.tags) : null,
        scrapedAt,
      }),
    "storeApiData",
  );

  return id;
}

/**
 * D1 max variables per statement is ~100 columns × rows.
 * api_data has 8 columns, so ~100 rows per chunk is safe with margin.
 */
const BATCH_CHUNK_SIZE = 100;

/**
 * Batch-insert multiple rows into api_data.
 * Chunks large arrays to stay within D1 statement limits and wraps
 * the entire operation in a transaction for atomicity.
 * Returns the ids of all inserted rows.
 */
export async function storeBatchApiData(
  db: Db,
  adapterId: string,
  payloadType: string,
  items: Array<{ payload: unknown; options?: ApiDataInput }>,
): Promise<string[]> {
  if (items.length === 0) return [];

  const now = new Date();
  const rows = items.map((item) => {
    const timestamp = item.options?.timestamp ?? now;
    const scrapedAt = item.options?.scrapedAt ?? now;
    const id = `${adapterId}:${payloadType}:${item.options?.locationId ?? "global"}:${timestamp.getTime()}:${crypto.randomUUID().slice(0, 8)}`;

    return {
      id,
      apiSource: adapterId,
      payloadType,
      timestamp,
      locationId: item.options?.locationId ?? null,
      payload: JSON.stringify(item.payload),
      tags: item.options?.tags ? JSON.stringify(item.options.tags) : null,
      scrapedAt,
    };
  });

  // D1 supports batch() which wraps multiple statements in a transaction
  await withRetry(async () => {
    if (rows.length <= BATCH_CHUNK_SIZE) {
      await db.insert(apiData).values(rows);
    } else {
      const chunks: (typeof rows)[] = [];
      for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
        chunks.push(rows.slice(i, i + BATCH_CHUNK_SIZE));
      }
      // db.batch() requires a tuple with at least one element — we know chunks is non-empty
      const statements = chunks.map((chunk) => db.insert(apiData).values(chunk));
      await db.batch(statements as unknown as [typeof statements[0], ...typeof statements]);
    }
  }, "storeBatchApiData");

  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Document upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to R2 and record its metadata in D1.
 * Returns the document id.
 */
export async function uploadDocument(
  db: Db,
  r2: R2Bucket,
  adapterId: string,
  doc: DocumentInput,
): Promise<string> {
  const docId = crypto.randomUUID();
  const r2Key = `${adapterId}/${docId}/${doc.name}`;

  // Upload to R2
  await r2.put(r2Key, doc.data, {
    httpMetadata: { contentType: doc.contentType },
    customMetadata: doc.metadata
      ? Object.fromEntries(
          Object.entries(doc.metadata).map(([k, v]) => [k, String(v)]),
        )
      : undefined,
  });

  // Get object info for size
  const head = await r2.head(r2Key);
  const sizeBytes = head?.size ?? null;

  // Record in D1
  await db.insert(documents).values({
    id: docId,
    adapterId,
    name: doc.name,
    contentType: doc.contentType,
    r2Key,
    locationId: doc.locationId ?? null,
    sizeBytes,
    metadata: doc.metadata ? JSON.stringify(doc.metadata) : null,
    capturedAt: new Date(),
  });

  return docId;
}

// ---------------------------------------------------------------------------
// Ingest log helpers
// ---------------------------------------------------------------------------

export async function logIngestStart(
  db: Db,
  adapterId: string,
): Promise<number> {
  const result = await db
    .insert(ingestLog)
    .values({
      adapterId,
      status: "running",
      recordsCount: 0,
      startedAt: new Date(),
    })
    .returning({ id: ingestLog.id });

  return result[0].id;
}

export async function logIngestSuccess(
  db: Db,
  logId: number,
  recordsCount: number,
): Promise<void> {
  await db
    .update(ingestLog)
    .set({
      status: "success",
      recordsCount,
      finishedAt: new Date(),
    })
    .where(eq(ingestLog.id, logId));
}

export async function logIngestError(
  db: Db,
  logId: number,
  error: string,
): Promise<void> {
  await db
    .update(ingestLog)
    .set({
      status: "error",
      error,
      finishedAt: new Date(),
    })
    .where(eq(ingestLog.id, logId));
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

/** Build an AdapterContext from the Worker env. */
export function createAdapterContext(env: Env, db: Db): AdapterContext {
  return {
    env,
    db,
    r2: env.DOCUMENTS,
    cache: env.CACHE,
    log: (...args: unknown[]) => console.log("[adapter]", ...args),

    storeApiData: (adapterId, payloadType, payload, options) =>
      storeApiData(db, adapterId, payloadType, payload, options),

    storeBatchApiData: (adapterId, payloadType, items) =>
      storeBatchApiData(db, adapterId, payloadType, items),

    uploadDocument: (adapterId, doc) =>
      uploadDocument(db, env.DOCUMENTS, adapterId, doc),

    registerLocation: (loc) => registerLocation(db, loc),
  };
}
