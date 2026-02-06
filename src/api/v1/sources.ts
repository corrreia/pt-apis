import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { registry } from "../../core/registry";
import { getDb } from "../../db/client";
import { sources, ingestLog } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { ErroSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SourceSchema = z
  .object({
    id: z.string().openapi({ description: "Unique adapter identifier", example: "ipma-weather" }),
    name: z.string().openapi({ description: "Data source name" }),
    description: z.string().nullable().openapi({ description: "Data source description" }),
    sourceUrl: z.string().nullable().openapi({ description: "Original data source URL" }),
    dataTypes: z.array(z.string()).openapi({ description: "Data types produced (timeseries, document, snapshot)" }),
    state: z.string().openapi({ description: "Current source state", example: "active" }),
    lastCollectedAt: z.string().nullable().openapi({ description: "Last data collection time (ISO 8601)" }),
    hasCustomRoutes: z.boolean().openapi({ description: "Whether the adapter defines custom routes" }),
    hasCustomSchema: z.boolean().openapi({ description: "Whether the adapter defines custom tables" }),
    hasLocations: z.boolean().openapi({
      description: "Whether this adapter contributes to the shared locations table",
    }),
  })
  .openapi("Source");

const SourceDetailSchema = SourceSchema.extend({
  schedules: z.array(
    z.object({
      frequency: z.string().openapi({ description: "Schedule frequency (e.g. hourly, daily)" }),
      description: z.string().openapi({ description: "Scheduled job description" }),
    }),
  ).openapi({ description: "Configured schedules (cron jobs)" }),
  recentIngestions: z.array(
    z.object({
      id: z.number(),
      state: z.string().openapi({ description: "Ingestion state (running, success, error)" }),
      recordCount: z.number().nullable().openapi({ description: "Number of records ingested" }),
      error: z.string().nullable().openapi({ description: "Error message if applicable" }),
      startedAt: z.string().openapi({ description: "Start time (ISO 8601)" }),
      finishedAt: z.string().nullable().openapi({ description: "Finish time (ISO 8601)" }),
    }),
  ).openapi({ description: "Recent data ingestions" }),
}).openapi("SourceDetail");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listSources = createRoute({
  method: "get",
  path: "/v1/sources",
  tags: ["Sources"],
  summary: "List all data sources",
  description:
    "Returns all registered adapters (data sources), including their current state, data types and whether they have custom routes.",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ data: z.array(SourceSchema) }) } },
      description: "List of all data sources",
    },
  },
});

const getSource = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}",
  tags: ["Sources"],
  summary: "Get data source details",
  description:
    "Returns detailed information about a specific data source, including schedules and recent ingestion history.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Adapter identifier",
        example: "ipma-weather",
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ data: SourceDetailSchema }) } },
      description: "Data source details",
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

app.openapi(listSources, async (c) => {
  const adapters = registry.getAll();
  const db = getDb(c.env);

  const sourceRows = await db.select().from(sources);
  const fetchedMap = new Map(sourceRows.map((r) => [r.id, r.lastFetchedAt]));

  const data = adapters.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    sourceUrl: a.sourceUrl,
    dataTypes: a.dataTypes as string[],
    state: "active",
    lastCollectedAt: fetchedMap.get(a.id)?.toISOString() ?? null,
    hasCustomRoutes: !!a.routes,
    hasCustomSchema: !!a.schema,
    hasLocations: a.features?.hasLocations ?? true,
  }));

  return c.json({ data });
});

app.openapi(getSource, async (c) => {
  const { sourceId } = c.req.valid("param");
  const adapter = registry.get(sourceId);

  if (!adapter) {
    return c.json(
      { error: "Source not found", details: `No adapter with id '${sourceId}'` } as const,
      404,
    );
  }

  const db = getDb(c.env);
  const [sourceRow] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  const recentLogs = await db
    .select()
    .from(ingestLog)
    .where(eq(ingestLog.adapterId, sourceId))
    .orderBy(desc(ingestLog.startedAt))
    .limit(20);

  const data = {
    id: adapter.id,
    name: adapter.name,
    description: adapter.description,
    sourceUrl: adapter.sourceUrl,
    dataTypes: adapter.dataTypes as string[],
    state: sourceRow?.status ?? "active",
    lastCollectedAt: sourceRow?.lastFetchedAt?.toISOString() ?? null,
    hasCustomRoutes: !!adapter.routes,
    hasCustomSchema: !!adapter.schema,
    hasLocations: adapter.features?.hasLocations ?? true,
    schedules: adapter.schedules.map((s) => ({
      frequency: s.frequency as string,
      description: s.description,
    })),
    recentIngestions: recentLogs.map((l) => ({
      id: l.id,
      state: l.status,
      recordCount: l.recordsCount ?? null,
      error: l.error ?? null,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
    })),
  };

  return c.json({ data }, 200);
});

export default app;
