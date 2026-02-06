import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { snapshots } from "../../db/schema";
import { registry } from "../../core/registry";
import { eq, and, desc } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { ErroSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SnapshotSchema = z
  .object({
    id: z.number().openapi({ description: "Unique snapshot identifier" }),
    snapshotType: z.string().openapi({ description: "Snapshot type (e.g. daily-forecast, uv-index)", example: "daily-forecast" }),
    data: z.unknown().openapi({ description: "Captured JSON data" }),
    capturedAt: z.string().openapi({ description: "Capture time (ISO 8601)" }),
  })
  .openapi("Snapshot");

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const listSnapshots = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/snapshots",
  tags: ["Snapshots"],
  summary: "List point-in-time snapshots for a source",
  description:
    "Returns point-in-time (snapshot) JSON captures for this source. Use for time-travel and querying the full state of data at any capture time.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Adapter identifier",
        example: "ipma-weather",
      }),
    }),
    query: z.object({
      type: z
        .string()
        .optional()
        .openapi({
          param: { name: "type", in: "query" },
          description: "Filter by snapshot type",
          example: "daily-forecast",
        }),
      limit: z.coerce.number().int().min(1).max(100).default(20).openapi({
        param: { name: "limit", in: "query" },
        description: "Maximum number of results",
        example: 20,
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
          schema: z.object({ data: z.array(SnapshotSchema) }),
        },
      },
      description: "List of snapshots",
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

app.use("/v1/sources/*/snapshots", kvCache({ ttlSeconds: 600, prefix: "snap" }));

app.openapi(listSnapshots, async (c) => {
  const { sourceId } = c.req.valid("param");

  if (!registry.has(sourceId)) {
    return c.json({ error: "Source not found" } as const, 404);
  }

  const { type, limit, offset } = c.req.valid("query");
  const db = getDb(c.env);

  const conditions = [eq(snapshots.adapterId, sourceId)];
  if (type) conditions.push(eq(snapshots.snapshotType, type));

  const rows = await db
    .select()
    .from(snapshots)
    .where(and(...conditions))
    .orderBy(desc(snapshots.capturedAt))
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    id: r.id,
    snapshotType: r.snapshotType,
    data: JSON.parse(r.data),
    capturedAt: r.capturedAt.toISOString(),
  }));

  return c.json({ data }, 200);
});

export default app;
