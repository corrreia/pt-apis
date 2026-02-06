import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { timeseries } from "../../db/schema";
import { registry } from "../../core/registry";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { ErroSchema, PaginacaoSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const HistoryItemSchema = z
  .object({
    id: z.number().openapi({ description: "Identificador único do registo" }),
    metric: z.string().openapi({ description: "Nome da métrica", example: "temperature_max" }),
    entityId: z.string().openapi({ description: "Identificador da entidade", example: "lisboa" }),
    locationId: z.string().nullable().openapi({ description: "Identificador da localização associada" }),
    value: z.number().openapi({ description: "Valor numérico da métrica", example: 18.2 }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Metadados JSON adicionais" }),
    observedAt: z.string().openapi({ description: "Hora de observação (ISO 8601)" }),
    ingestedAt: z.string().openapi({ description: "Hora de ingestão no sistema (ISO 8601)" }),
  })
  .openapi("HistoryItem");

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const getHistory = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/history",
  tags: ["History"],
  summary: "Consultar séries temporais históricas",
  description:
    "Devolve pontos históricos de uma fonte num intervalo de tempo, com paginação. Permite time-travel e análise de tendências.",
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
      from: z
        .string()
        .optional()
        .openapi({
          param: { name: "from", in: "query" },
          description: "Início do intervalo (ISO 8601)",
          example: "2026-01-01T00:00:00Z",
        }),
      to: z
        .string()
        .optional()
        .openapi({
          param: { name: "to", in: "query" },
          description: "Fim do intervalo (ISO 8601)",
          example: "2026-02-05T00:00:00Z",
        }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .openapi({
          param: { name: "limit", in: "query" },
          description: "Máximo de resultados por página",
          example: 100,
        }),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .openapi({
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
          schema: z.object({
            data: z.array(HistoryItemSchema),
            pagination: PaginacaoSchema,
          }),
        },
      },
      description: "Dados históricos com paginação",
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

app.use("/v1/sources/*/history", kvCache({ ttlSeconds: 3600, prefix: "hist" }));

app.openapi(getHistory, async (c) => {
  const { sourceId } = c.req.valid("param");

  if (!registry.has(sourceId)) {
    return c.json({ error: "Source not found" } as const, 404);
  }

  const { metric, entityId, from, to, limit, offset } = c.req.valid("query");
  const db = getDb(c.env);

  const conditions = [eq(timeseries.adapterId, sourceId)];
  if (metric) conditions.push(eq(timeseries.metric, metric));
  if (entityId) conditions.push(eq(timeseries.entityId, entityId));
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

  const data = rows.map((r) => ({
    id: r.id,
    metric: r.metric,
    entityId: r.entityId,
    locationId: r.locationId,
    value: r.value,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    observedAt: r.observedAt.toISOString(),
    ingestedAt: r.ingestedAt.toISOString(),
  }));

  return c.json(
    {
      data,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + data.length < total,
      },
    },
    200,
  );
});

export default app;
