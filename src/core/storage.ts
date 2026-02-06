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
// Content hashing (deduplication)
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hex digest of a string.
 * Used to fingerprint payloads so duplicate data is silently skipped.
 */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
 * Duplicate payloads (same source + type + content hash) are silently skipped.
 * Returns the id of the inserted (or already-existing) row.
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
  const payloadJson = JSON.stringify(payload);
  const contentHash = await sha256(payloadJson);
  const id = `${adapterId}:${payloadType}:${options?.locationId ?? "global"}:${timestamp.getTime()}:${crypto.randomUUID().slice(0, 8)}`;

  await withRetry(
    () =>
      db
        .insert(apiData)
        .values({
          id,
          apiSource: adapterId,
          payloadType,
          timestamp,
          locationId: options?.locationId ?? null,
          payload: payloadJson,
          tags: options?.tags ? JSON.stringify(options.tags) : null,
          contentHash,
          scrapedAt,
        })
        .onConflictDoNothing({
          target: [apiData.apiSource, apiData.payloadType, apiData.contentHash],
        }),
    "storeApiData",
  );

  return id;
}

/**
 * Maximum number of single-row INSERT statements per db.batch() call.
 * Each INSERT has 9 variables (one per column), so 50 × 9 = 450 vars max
 * across the batch – well within D1/SQLite limits even on local miniflare.
 */
const BATCH_STMT_LIMIT = 50;

/**
 * Batch-insert multiple rows into api_data.
 * Uses individual single-row INSERT statements grouped via db.batch()
 * to avoid hitting per-statement SQL variable limits on miniflare.
 * Duplicate payloads (same source + type + content hash) are silently skipped.
 * Returns the ids of all attempted rows.
 */
export async function storeBatchApiData(
  db: Db,
  adapterId: string,
  payloadType: string,
  items: Array<{ payload: unknown; options?: ApiDataInput }>,
): Promise<string[]> {
  if (items.length === 0) return [];

  const now = new Date();

  // Compute hashes in parallel
  const payloadsJson = items.map((item) => JSON.stringify(item.payload));
  const hashes = await Promise.all(payloadsJson.map((json) => sha256(json)));

  const rows = items.map((item, i) => {
    const timestamp = item.options?.timestamp ?? now;
    const scrapedAt = item.options?.scrapedAt ?? now;
    const id = `${adapterId}:${payloadType}:${item.options?.locationId ?? "global"}:${timestamp.getTime()}:${crypto.randomUUID().slice(0, 8)}`;

    return {
      id,
      apiSource: adapterId,
      payloadType,
      timestamp,
      locationId: item.options?.locationId ?? null,
      payload: payloadsJson[i],
      tags: item.options?.tags ? JSON.stringify(item.options.tags) : null,
      contentHash: hashes[i],
      scrapedAt,
    };
  });

  // Use single-row inserts with onConflictDoNothing for dedup
  await withRetry(async () => {
    const makeStmt = (row: (typeof rows)[number]) =>
      db
        .insert(apiData)
        .values(row)
        .onConflictDoNothing({
          target: [apiData.apiSource, apiData.payloadType, apiData.contentHash],
        });

    if (rows.length <= BATCH_STMT_LIMIT) {
      const statements = rows.map(makeStmt);
      await db.batch(statements as unknown as [typeof statements[0], ...typeof statements]);
    } else {
      for (let i = 0; i < rows.length; i += BATCH_STMT_LIMIT) {
        const chunk = rows.slice(i, i + BATCH_STMT_LIMIT);
        const statements = chunk.map(makeStmt);
        await db.batch(statements as unknown as [typeof statements[0], ...typeof statements]);
      }
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
