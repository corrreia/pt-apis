import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  timeseries,
  latestValues,
  documents,
  snapshots,
  locations,
  ingestLog,
} from "../db/schema";
import type {
  TimeseriesPoint,
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
// Timeseries ingestion
// ---------------------------------------------------------------------------

/**
 * Batch-insert timeseries rows and upsert the latest_values table.
 * Returns the number of rows inserted.
 */
export async function ingestTimeseries(
  db: Db,
  adapterId: string,
  points: TimeseriesPoint[],
): Promise<number> {
  if (points.length === 0) return 0;

  const now = new Date();

  // Insert into the append-only timeseries table
  const rows = points.map((p) => ({
    adapterId,
    metric: p.metric,
    entityId: p.entityId,
    locationId: p.locationId ?? null,
    value: p.value,
    metadata: p.metadata ? JSON.stringify(p.metadata) : null,
    observedAt: p.observedAt,
    ingestedAt: now,
  }));

  await db.insert(timeseries).values(rows);

  // Upsert latest values
  for (const p of points) {
    await db
      .insert(latestValues)
      .values({
        adapterId,
        metric: p.metric,
        entityId: p.entityId,
        locationId: p.locationId ?? null,
        value: p.value,
        metadata: p.metadata ? JSON.stringify(p.metadata) : null,
        observedAt: p.observedAt,
      })
      .onConflictDoUpdate({
        target: [latestValues.adapterId, latestValues.metric, latestValues.entityId],
        set: {
          value: p.value,
          locationId: p.locationId ?? null,
          metadata: p.metadata ? JSON.stringify(p.metadata) : null,
          observedAt: p.observedAt,
        },
      });
  }

  return rows.length;
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
// Snapshot storage
// ---------------------------------------------------------------------------

/** Store a JSON snapshot in D1. */
export async function storeSnapshot(
  db: Db,
  adapterId: string,
  snapshotType: string,
  data: unknown,
  locationId?: string,
): Promise<void> {
  await db.insert(snapshots).values({
    adapterId,
    snapshotType,
    locationId: locationId ?? null,
    data: JSON.stringify(data),
    capturedAt: new Date(),
  });
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

    ingestTimeseries: (adapterId, points) =>
      ingestTimeseries(db, adapterId, points),

    uploadDocument: (adapterId, doc) =>
      uploadDocument(db, env.DOCUMENTS, adapterId, doc),

    storeSnapshot: (adapterId, type, data, locationId) =>
      storeSnapshot(db, adapterId, type, data, locationId),

    registerLocation: (loc) => registerLocation(db, loc),
  };
}
