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
    id: z.number().openapi({ description: "Identificador único do snapshot" }),
    snapshotType: z.string().openapi({ description: "Tipo de snapshot (ex.: daily-forecast, uv-index)", example: "daily-forecast" }),
    data: z.unknown().openapi({ description: "Dados JSON capturados" }),
    capturedAt: z.string().openapi({ description: "Hora de captura (ISO 8601)" }),
  })
  .openapi("Snapshot");

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const listSnapshots = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/snapshots",
  tags: ["Snapshots"],
  summary: "Listar snapshots de uma fonte",
  description:
    "Devolve capturas JSON num momento no tempo para esta fonte. Útil para time-travel e consultar o estado completo dos dados numa dada altura.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Identificador do adapter",
        example: "ipma-weather",
      }),
    }),
    query: z.object({
      type: z
        .string()
        .optional()
        .openapi({
          param: { name: "type", in: "query" },
          description: "Filtrar por tipo de snapshot",
          example: "daily-forecast",
        }),
      limit: z.coerce.number().int().min(1).max(100).default(20).openapi({
        param: { name: "limit", in: "query" },
        description: "Número máximo de resultados",
        example: 20,
      }),
      offset: z.coerce.number().int().min(0).default(0).openapi({
        param: { name: "offset", in: "query" },
        description: "Desvio da paginação",
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
      description: "Lista de snapshots",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Fonte não encontrada",
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
