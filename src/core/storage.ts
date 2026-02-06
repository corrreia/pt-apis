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
// Location registration
// ---------------------------------------------------------------------------

/** Upsert a location into the shared locations table. */
export async function registerLocation(
  db: Db,
  loc: LocationInput,
): Promise<void> {
  await db
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
    });
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

  await db.insert(apiData).values({
    id,
    apiSource: adapterId,
    payloadType,
    timestamp,
    locationId: options?.locationId ?? null,
    payload: JSON.stringify(payload),
    tags: options?.tags ? JSON.stringify(options.tags) : null,
    scrapedAt,
  });

  return id;
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

    uploadDocument: (adapterId, doc) =>
      uploadDocument(db, env.DOCUMENTS, adapterId, doc),

    registerLocation: (loc) => registerLocation(db, loc),
  };
}
