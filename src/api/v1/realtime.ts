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
    metric: z.string().openapi({ description: "Nome da métrica", example: "temperature_max" }),
    entityId: z.string().openapi({ description: "Identificador da entidade", example: "lisboa" }),
    locationId: z.string().nullable().openapi({ description: "Identificador da localização associada" }),
    value: z.number().openapi({ description: "Valor numérico da métrica", example: 18.2 }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Metadados JSON adicionais" }),
    observedAt: z.string().openapi({ description: "Hora de observação (ISO 8601)" }),
  })
  .openapi("RealtimeItem");

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const getRealtime = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/realtime",
  tags: ["Realtime"],
  summary: "Valores mais recentes de uma fonte",
  description:
    "Devolve o valor mais recente de cada par métrica/entidade ingerido por esta fonte. Ideal para dashboards e monitorização em tempo real.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Identificador do adapter",
        example: "ipma-weather",
      }),
    }),
    query: z.object({
      metric: z
        .string()
        .optional()
        .openapi({
          param: { name: "metric", in: "query" },
          description: "Filtrar por nome da métrica",
          example: "temperature_max",
        }),
      entityId: z
        .string()
        .optional()
        .openapi({
          param: { name: "entityId", in: "query" },
          description: "Filtrar por identificador da entidade",
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
            updatedAt: z.string().openapi({ description: "Hora da resposta (ISO 8601)" }),
          }),
        },
      },
      description: "Valores mais recentes",
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
