import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { latestValues, timeseries, locations } from "../../db/schema";
import { eq, and, desc, gte, lte, count } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { LocalidadeResumoSchema, ErroSchema, PaginacaoSchema } from "../../api/schemas";
import type { AdapterDefinition } from "../../core/adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map UV index to risk level in English. */
function uvRiskLevel(iUv: number): string {
  if (iUv <= 2) return "Low";
  if (iUv <= 5) return "Moderate";
  if (iUv <= 7) return "High";
  if (iUv <= 10) return "Very high";
  return "Extreme";
}

// ---------------------------------------------------------------------------
// Zod models
// ---------------------------------------------------------------------------

const UvIndexReadingSchema = z
  .object({
    location: LocalidadeResumoSchema,
    uvIndex: z.number().openapi({
      description: "UV index value",
      example: 6.5,
    }),
    riskLevel: z.string().openapi({
      description: "UV risk level (Low, Moderate, High, Very high, Extreme)",
      example: "High",
    }),
    date: z.string().openapi({
      description: "Reading date (YYYY-MM-DD)",
      example: "2026-02-05",
    }),
    peakStartTime: z.string().nullable().openapi({
      description: "Start time of UV peak period",
      example: "12:00",
    }),
    peakEndTime: z.string().nullable().openapi({
      description: "End time of UV peak period",
      example: "15:00",
    }),
    observedAt: z.string().openapi({
      description: "Observation time (ISO 8601)",
      example: "2026-02-05T10:30:00.000Z",
    }),
  })
  .openapi("UvIndexReading");

const UvIndexReadingHistorySchema = UvIndexReadingSchema.extend({
  ingestedAt: z.string().optional().openapi({
    description: "Ingestion time in system (ISO 8601)",
  }),
}).openapi("UvIndexReadingHistory");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FlatRow {
  entityId: string;
  locationId: string | null;
  value: number;
  metadata: string | null;
  observedAt: Date;
  ingestedAt?: Date;
}

interface LocationRow {
  id: string;
  name: string;
  district: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
}

function buildReadings(
  rows: FlatRow[],
  locMap: Map<string, LocationRow>,
) {
  return rows.map((r) => {
    const locId = r.locationId;
    const loc = locId ? locMap.get(locId) : undefined;
    const meta = r.metadata ? JSON.parse(r.metadata) : {};

    const out: Record<string, unknown> = {
      location: {
        id: locId ?? r.entityId,
        name: loc?.name ?? meta.city ?? r.entityId,
        district: loc?.district ?? null,
        region: loc?.region ?? null,
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
      },
      uvIndex: r.value,
      riskLevel: uvRiskLevel(r.value),
      date: meta.date ?? r.observedAt.toISOString().slice(0, 10),
      peakStartTime: meta.peakStart ?? null,
      peakEndTime: meta.peakEnd ?? null,
      observedAt: r.observedAt.toISOString(),
    };
    if (r.ingestedAt) out.ingestedAt = r.ingestedAt.toISOString();
    return out;
  });
}

async function getLocationMap(db: ReturnType<typeof getDb>, locationIds: (string | null)[]) {
  const ids = [...new Set(locationIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map<string, LocationRow>();

  const rows = await db.select().from(locations);
  const map = new Map<string, LocationRow>();
  for (const r of rows) {
    if (ids.includes(r.id)) {
      map.set(r.id, r);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createQualidadeArRoutes(adapter: AdapterDefinition): OpenAPIHono<{ Bindings: Env }> {
  const tag = adapter.openApiTag ?? adapter.name;
  const adapterId = adapter.id;

  const uvIndexRoute = createRoute({
    method: "get",
    path: "/indice-uv",
    tags: [tag],
  summary: "Current UV index for all cities",
  description:
    "Returns the latest UV index for all locations monitored by IPMA. Includes risk level, peak hours and location data.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(UvIndexReadingSchema),
            locationCount: z.number(),
            updatedAt: z.string(),
          }),
        },
      },
      description: "UV index for all cities",
    },
  },
});

  const uvIndexCityRoute = createRoute({
    method: "get",
    path: "/indice-uv/{locationId}",
    tags: [tag],
  summary: "UV index for one city",
  description:
    "Returns the latest UV index for a specific location. Use the location slug (e.g. 'lisboa', 'porto', 'faro').",
  request: {
    params: z.object({
      locationId: z.string().openapi({
        param: { name: "locationId", in: "path" },
        description: "Location slug",
        example: "lisboa",
      }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: UvIndexReadingSchema,
            updatedAt: z.string(),
          }),
        },
      },
      description: "UV index for the location",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Location not found",
    },
  },
});

  const uvHistoryRoute = createRoute({
    method: "get",
    path: "/indice-uv/historico",
    tags: [tag],
  summary: "UV index history",
  description:
    "Returns UV index reading history with pagination and time filters. Enables querying past data for analysis.",
  request: {
    query: z.object({
      locationId: z.string().optional().openapi({
        param: { name: "locationId", in: "query" },
        description: "Filter by location (slug)",
        example: "lisboa",
      }),
      from: z.string().optional().openapi({
        param: { name: "from", in: "query" },
        description: "Start date (ISO 8601)",
        example: "2026-01-01T00:00:00Z",
      }),
      to: z.string().optional().openapi({
        param: { name: "to", in: "query" },
        description: "End date (ISO 8601)",
        example: "2026-02-05T00:00:00Z",
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
            data: z.array(UvIndexReadingHistorySchema),
            pagination: PaginacaoSchema,
          }),
        },
      },
      description: "UV index history with pagination",
    },
  },
});

  // ---------------------------------------------------------------------------
  // App
  // ---------------------------------------------------------------------------

  const app = new OpenAPIHono<{ Bindings: Env }>();

  app.use("/indice-uv", kvCache({ ttlSeconds: 300, prefix: "uv-all" }));
  app.use("/indice-uv/historico", kvCache({ ttlSeconds: 600, prefix: "uv-hist" }));

  app.openapi(uvIndexRoute, async (c) => {
    const db = getDb(c.env);

    const rows = await db
      .select()
      .from(latestValues)
      .where(and(eq(latestValues.adapterId, adapterId), eq(latestValues.metric, "uv_index")));

    const locMap = await getLocationMap(
      db,
      rows.map((r) => r.locationId),
    );

    const data = buildReadings(
      rows.map((r) => ({
        entityId: r.entityId,
        locationId: r.locationId,
        value: r.value,
        metadata: r.metadata,
        observedAt: r.observedAt,
      })),
      locMap,
    );

    return c.json({
      data,
      locationCount: data.length,
      updatedAt: new Date().toISOString(),
    });
  });

  app.openapi(uvIndexCityRoute, async (c) => {
    const { locationId } = c.req.valid("param");
    const db = getDb(c.env);

    const rows = await db
      .select()
      .from(latestValues)
      .where(
        and(
          eq(latestValues.adapterId, adapterId),
          eq(latestValues.metric, "uv_index"),
          eq(latestValues.locationId, locationId),
        ),
      );

    if (rows.length === 0) {
      return c.json(
        { error: "Location not found", details: `No UV data for '${locationId}'` } as const,
        404,
      );
    }

    const locMap = await getLocationMap(
      db,
      rows.map((r) => r.locationId),
    );

    const readings = buildReadings(
      rows.map((r) => ({
        entityId: r.entityId,
        locationId: r.locationId,
        value: r.value,
        metadata: r.metadata,
        observedAt: r.observedAt,
      })),
      locMap,
    );

    return c.json(
      {
        data: readings[0],
        updatedAt: new Date().toISOString(),
      },
      200,
    );
  });

  app.openapi(uvHistoryRoute, async (c) => {
    const { locationId, from, to, limit, offset } = c.req.valid("query");
    const db = getDb(c.env);

    const conditions = [
      eq(timeseries.adapterId, adapterId),
      eq(timeseries.metric, "uv_index"),
    ];
    if (locationId) conditions.push(eq(timeseries.locationId, locationId));
    if (from) conditions.push(gte(timeseries.observedAt, new Date(from)));
    if (to) conditions.push(lte(timeseries.observedAt, new Date(to)));

    const whereClause = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(timeseries)
      .where(whereClause);

    const rows = await db
      .select()
      .from(timeseries)
      .where(whereClause)
      .orderBy(desc(timeseries.observedAt))
      .limit(limit)
      .offset(offset);

    const locMap = await getLocationMap(
      db,
      rows.map((r) => r.locationId),
    );

    const data = buildReadings(
      rows.map((r) => ({
        entityId: r.entityId,
        locationId: r.locationId,
        value: r.value,
        metadata: r.metadata,
        observedAt: r.observedAt,
        ingestedAt: r.ingestedAt,
      })),
      locMap,
    );

    return c.json({
      data,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + data.length < total,
      },
    });
  });

  return app;
}
