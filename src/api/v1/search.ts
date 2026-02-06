import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { latestValues, timeseries } from "../../db/schema";
import { eq, and, like, desc, gte, lte, count } from "drizzle-orm";
import { PaginacaoSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SearchResultSchema = z
  .object({
    adapterId: z.string().openapi({ description: "Source adapter identifier" }),
    metric: z.string().openapi({ description: "Metric name", example: "temperature_max" }),
    entityId: z.string().openapi({ description: "Entity identifier", example: "lisboa" }),
    locationId: z.string().nullable().openapi({ description: "Associated location identifier" }),
    value: z.number().openapi({ description: "Numeric metric value" }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Additional JSON metadata" }),
    observedAt: z.string().openapi({ description: "Observation time (ISO 8601)" }),
  })
  .openapi("SearchResult");

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const search = createRoute({
  method: "get",
  path: "/v1/search",
  tags: ["Search"],
  summary: "Search across all data sources",
  description:
    "Cross-source search by metric, entity, location or time range. By default searches latest values; use `mode=historical` to search time series data.",
  request: {
    query: z.object({
      q: z
        .string()
        .optional()
        .openapi({
          param: { name: "q", in: "query" },
          description: "Free-text search on metric name",
          example: "temperature",
        }),
      metric: z.string().optional().openapi({
        param: { name: "metric", in: "query" },
        description: "Filter by exact metric name",
        example: "temperature_max",
      }),
      entityId: z.string().optional().openapi({
        param: { name: "entityId", in: "query" },
        description: "Filter by entity identifier",
        example: "lisboa",
      }),
      adapterId: z.string().optional().openapi({
        param: { name: "adapterId", in: "query" },
        description: "Filter by adapter identifier",
        example: "ipma-weather",
      }),
      locationId: z.string().optional().openapi({
        param: { name: "locationId", in: "query" },
        description: "Filter by location identifier",
        example: "lisboa",
      }),
      mode: z
        .enum(["recent", "historical"])
        .default("recent")
        .openapi({
          param: { name: "mode", in: "query" },
          description: "Search mode: 'recent' (current values) or 'historical' (time series)",
          example: "recent",
        }),
      from: z.string().optional().openapi({
        param: { name: "from", in: "query" },
        description: "Start of time range (ISO 8601, historical mode only)",
        example: "2026-01-01T00:00:00Z",
      }),
      to: z.string().optional().openapi({
        param: { name: "to", in: "query" },
        description: "End of time range (ISO 8601, historical mode only)",
        example: "2026-02-05T00:00:00Z",
      }),
      limit: z.coerce.number().int().min(1).max(500).default(50).openapi({
        param: { name: "limit", in: "query" },
        description: "Maximum number of results",
        example: 50,
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
            data: z.array(SearchResultSchema),
            pagination: PaginacaoSchema,
          }),
        },
      },
      description: "Search results",
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<{ Bindings: Env }>();

app.openapi(search, async (c) => {
  const { q, metric, entityId, adapterId, locationId, mode, from, to, limit, offset } =
    c.req.valid("query");
  const db = getDb(c.env);

  if (mode === "historical") {
    const conditions = [];
    if (adapterId) conditions.push(eq(timeseries.adapterId, adapterId));
    if (metric) conditions.push(eq(timeseries.metric, metric));
    else if (q) conditions.push(like(timeseries.metric, `%${q}%`));
    if (entityId) conditions.push(eq(timeseries.entityId, entityId));
    if (locationId) conditions.push(eq(timeseries.locationId, locationId));
    if (from) conditions.push(gte(timeseries.observedAt, new Date(from)));
    if (to) conditions.push(lte(timeseries.observedAt, new Date(to)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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

    return c.json({
      data: rows.map((r) => ({
        adapterId: r.adapterId,
        metric: r.metric,
        entityId: r.entityId,
        locationId: r.locationId,
        value: r.value,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        observedAt: r.observedAt.toISOString(),
      })),
      pagination: { total, limit, offset, hasMore: offset + rows.length < total },
    });
  }

  const conditions = [];
  if (adapterId) conditions.push(eq(latestValues.adapterId, adapterId));
  if (metric) conditions.push(eq(latestValues.metric, metric));
  else if (q) conditions.push(like(latestValues.metric, `%${q}%`));
  if (entityId) conditions.push(eq(latestValues.entityId, entityId));
  if (locationId) conditions.push(eq(latestValues.locationId, locationId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(latestValues)
    .where(whereClause);

  const rows = await db
    .select()
    .from(latestValues)
    .where(whereClause)
    .orderBy(desc(latestValues.observedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map((r) => ({
      adapterId: r.adapterId,
      metric: r.metric,
      entityId: r.entityId,
      locationId: r.locationId,
      value: r.value,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      observedAt: r.observedAt.toISOString(),
    })),
    pagination: { total, limit, offset, hasMore: offset + rows.length < total },
  });
});

export default app;
