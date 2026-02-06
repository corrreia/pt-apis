import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { locations, latestValues, documents, snapshots } from "../../db/schema";
import { eq, and, like, desc, count } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { ErroSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const LocationSchema = z
  .object({
    id: z.string().openapi({ description: "Unique identifier (slug)", example: "lisboa" }),
    name: z.string().openapi({ description: "Location name", example: "Lisboa" }),
    latitude: z.number().nullable().openapi({ description: "Latitude" }),
    longitude: z.number().nullable().openapi({ description: "Longitude" }),
    type: z.string().openapi({ description: "Location type (city, district, station, sensor)", example: "city" }),
    region: z.string().nullable().openapi({ description: "Region", example: "Lisboa" }),
    district: z.string().nullable().openapi({ description: "District", example: "Lisboa" }),
    municipality: z.string().nullable().openapi({ description: "Municipality" }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Additional JSON metadata" }),
  })
  .openapi("Location");

const LocationDataSchema = z
  .object({
    latestValues: z.array(
      z.object({
        adapterId: z.string().openapi({ description: "Adapter identifier" }),
        metric: z.string().openapi({ description: "Metric name" }),
        entityId: z.string().openapi({ description: "Entity identifier" }),
        value: z.number().openapi({ description: "Numeric value" }),
        metadata: z.record(z.string(), z.unknown()).nullable(),
        observedAt: z.string(),
      }),
    ).openapi({ description: "Latest values from all sources for this location" }),
    documents: z.array(
      z.object({
        id: z.string(),
        adapterId: z.string(),
        name: z.string(),
        contentType: z.string(),
        capturedAt: z.string(),
      }),
    ).openapi({ description: "Documents associated with this location" }),
    snapshots: z.array(
      z.object({
        id: z.number(),
        adapterId: z.string(),
        snapshotType: z.string(),
        capturedAt: z.string(),
      }),
    ).openapi({ description: "Snapshots associated with this location" }),
  })
  .openapi("LocationData");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listLocations = createRoute({
  method: "get",
  path: "/v1/locations",
  tags: ["Locations"],
  summary: "List all locations",
  description:
    "Returns all shared locations registered by adapters. Supports filtering by type, region, district or searching by name.",
  request: {
    query: z.object({
      type: z.string().optional().openapi({
        param: { name: "type", in: "query" },
        description: "Filter by location type (city, district, station, sensor)",
        example: "city",
      }),
      region: z.string().optional().openapi({
        param: { name: "region", in: "query" },
        description: "Filter by region",
        example: "Norte",
      }),
      district: z.string().optional().openapi({
        param: { name: "district", in: "query" },
        description: "Filter by district",
        example: "Porto",
      }),
      q: z.string().optional().openapi({
        param: { name: "q", in: "query" },
        description: "Search by location name",
        example: "lisb",
      }),
      limit: z.coerce.number().int().min(1).max(500).default(100).openapi({
        param: { name: "limit", in: "query" },
        description: "Maximum number of results",
        example: 100,
      }),
      offset: z.coerce.number().int().min(0).default(0).openapi({
        param: { name: "offset", in: "query" },
        description: "Pagination offset",
        example: 0,
      }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(LocationSchema),
            total: z.number(),
          }),
        },
      },
      description: "List of locations",
    },
  },
});

const getLocation = createRoute({
  method: "get",
  path: "/v1/locations/{locationId}",
  tags: ["Locations"],
  summary: "Get location details",
  description: "Returns details for a specific location.",
  request: {
    params: z.object({
      locationId: z.string().openapi({
        param: { name: "locationId", in: "path" },
        description: "Location identifier (slug)",
        example: "lisboa",
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ data: LocationSchema }) } },
      description: "Location details",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Location not found",
    },
  },
});

const getLocationData = createRoute({
  method: "get",
  path: "/v1/locations/{locationId}/data",
  tags: ["Locations"],
  summary: "Get all data for a location",
  description:
    "Cross-source query: returns latest values, documents and snapshots associated with this location from all adapters.",
  request: {
    params: z.object({
      locationId: z.string().openapi({
        param: { name: "locationId", in: "path" },
        description: "Location identifier (slug)",
        example: "lisboa",
      }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            location: LocationSchema,
            data: LocationDataSchema,
          }),
        },
      },
      description: "All data associated with this location from all sources",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Location not found",
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use("/v1/locations", kvCache({ ttlSeconds: 600, prefix: "loc" }));
app.use("/v1/locations/*/data", kvCache({ ttlSeconds: 300, prefix: "locdata" }));

app.openapi(listLocations, async (c) => {
  const { type, region, district, q, limit, offset } = c.req.valid("query");
  const db = getDb(c.env);

  const conditions = [];
  if (type) conditions.push(eq(locations.type, type));
  if (region) conditions.push(eq(locations.region, region));
  if (district) conditions.push(eq(locations.district, district));
  if (q) conditions.push(like(locations.name, `%${q}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(locations)
    .where(whereClause);

  const rows = await db
    .select()
    .from(locations)
    .where(whereClause)
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    type: r.type,
    region: r.region,
    district: r.district,
    municipality: r.municipality,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));

  return c.json({ data, total });
});

app.openapi(getLocation, async (c) => {
  const { locationId } = c.req.valid("param");
  const db = getDb(c.env);

  const [row] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Location not found" } as const, 404);
  }

  return c.json(
    {
      data: {
        id: row.id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        type: row.type,
        region: row.region,
        district: row.district,
        municipality: row.municipality,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      },
    },
    200,
  );
});

app.openapi(getLocationData, async (c) => {
  const { locationId } = c.req.valid("param");
  const db = getDb(c.env);

  const [loc] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!loc) {
    return c.json({ error: "Location not found" } as const, 404);
  }

  const [lvRows, docRows, snapRows] = await Promise.all([
    db
      .select()
      .from(latestValues)
      .where(eq(latestValues.locationId, locationId))
      .limit(500),
    db
      .select()
      .from(documents)
      .where(eq(documents.locationId, locationId))
      .orderBy(desc(documents.capturedAt))
      .limit(100),
    db
      .select({
        id: snapshots.id,
        adapterId: snapshots.adapterId,
        snapshotType: snapshots.snapshotType,
        capturedAt: snapshots.capturedAt,
      })
      .from(snapshots)
      .where(eq(snapshots.locationId, locationId))
      .orderBy(desc(snapshots.capturedAt))
      .limit(100),
  ]);

  return c.json(
    {
      location: {
        id: loc.id,
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        type: loc.type,
        region: loc.region,
        district: loc.district,
        municipality: loc.municipality,
        metadata: loc.metadata ? JSON.parse(loc.metadata) : null,
      },
      data: {
        latestValues: lvRows.map((r) => ({
          adapterId: r.adapterId,
          metric: r.metric,
          entityId: r.entityId,
          value: r.value,
          metadata: r.metadata ? JSON.parse(r.metadata) : null,
          observedAt: r.observedAt.toISOString(),
        })),
        documents: docRows.map((r) => ({
          id: r.id,
          adapterId: r.adapterId,
          name: r.name,
          contentType: r.contentType,
          capturedAt: r.capturedAt.toISOString(),
        })),
        snapshots: snapRows.map((r) => ({
          id: r.id,
          adapterId: r.adapterId,
          snapshotType: r.snapshotType,
          capturedAt: r.capturedAt.toISOString(),
        })),
      },
    },
    200,
  );
});

export default app;
