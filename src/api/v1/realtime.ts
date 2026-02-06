import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { latestValues } from "../../db/schema";
import { registry } from "../../core/registry";
import { eq, and } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { ErroSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RealtimeItemSchema = z
  .object({
    metric: z.string().openapi({ description: "Metric name", example: "temperature_max" }),
    entityId: z.string().openapi({ description: "Entity identifier", example: "lisboa" }),
    locationId: z.string().nullable().openapi({ description: "Associated location identifier" }),
    value: z.number().openapi({ description: "Numeric metric value", example: 18.2 }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Additional JSON metadata" }),
    observedAt: z.string().openapi({ description: "Observation time (ISO 8601)" }),
  })
  .openapi("RealtimeItem");

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const getRealtime = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/realtime",
  tags: ["Realtime"],
  summary: "Get latest values for a source",
  description:
    "Returns the most recent value for each metric/entity pair ingested by this data source. Ideal for dashboards and real-time monitoring.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Adapter identifier",
        example: "ipma-weather",
      }),
    }),
    query: z.object({
      metric: z
        .string()
        .optional()
        .openapi({
          param: { name: "metric", in: "query" },
          description: "Filter by metric name",
          example: "temperature_max",
        }),
      entityId: z
        .string()
        .optional()
        .openapi({
          param: { name: "entityId", in: "query" },
          description: "Filter by entity identifier",
          example: "lisboa",
        }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(RealtimeItemSchema),
            updatedAt: z.string().openapi({ description: "Response time (ISO 8601)" }),
          }),
        },
      },
      description: "Latest values",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Source not found",
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use("/v1/sources/*/realtime", kvCache({ ttlSeconds: 300, prefix: "rt" }));

app.openapi(getRealtime, async (c) => {
  const { sourceId } = c.req.valid("param");

  if (!registry.has(sourceId)) {
    return c.json({ error: "Source not found" } as const, 404);
  }

  const { metric, entityId } = c.req.valid("query");
  const db = getDb(c.env);

  const conditions = [eq(latestValues.adapterId, sourceId)];
  if (metric) conditions.push(eq(latestValues.metric, metric));
  if (entityId) conditions.push(eq(latestValues.entityId, entityId));

  const rows = await db
    .select()
    .from(latestValues)
    .where(and(...conditions))
    .limit(1000);

  const data = rows.map((r) => ({
    metric: r.metric,
    entityId: r.entityId,
    locationId: r.locationId,
    value: r.value,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    observedAt: r.observedAt.toISOString(),
  }));

  return c.json({ data, updatedAt: new Date().toISOString() }, 200);
});

export default app;
