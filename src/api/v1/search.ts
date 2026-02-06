import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { apiData } from "../../db/schema";
import { eq, and, desc, gte, lte, count } from "drizzle-orm";
import { PaginacaoSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SearchResultSchema = z
  .object({
    id: z.string().openapi({ description: "Identificador único do registo" }),
    apiSource: z.string().openapi({ description: "Identificador do adapter", example: "ipma-weather" }),
    payloadType: z.string().openapi({ description: "Tipo do payload", example: "daily-forecast" }),
    locationId: z.string().nullable().openapi({ description: "Identificador da localização associada" }),
    timestamp: z.string().openapi({ description: "Hora de observação/captura (ISO 8601)" }),
    payload: z.record(z.string(), z.unknown()).openapi({ description: "Payload JSON" }),
    tags: z.array(z.string()).nullable().openapi({ description: "Etiquetas" }),
    scrapedAt: z.string().openapi({ description: "Hora de ingestão (ISO 8601)" }),
  })
  .openapi("SearchResult");

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const search = createRoute({
  method: "get",
  path: "/v1/search",
  tags: ["Search"],
  summary: "Pesquisar em todas as fontes",
  description:
    "Pesquisa em api_data por adapter, localização ou intervalo de tempo. Devolve registos com payload JSON.",
  request: {
    query: z.object({
      adapterId: z.string().optional().openapi({
        param: { name: "adapterId", in: "query" },
        description: "Filtrar por identificador do adapter",
        example: "ipma-weather",
      }),
      payloadType: z.string().optional().openapi({
        param: { name: "payloadType", in: "query" },
        description: "Filtrar por tipo de payload",
        example: "daily-forecast",
      }),
      locationId: z.string().optional().openapi({
        param: { name: "locationId", in: "query" },
        description: "Filtrar por identificador da localização",
        example: "lisboa",
      }),
      from: z.string().optional().openapi({
        param: { name: "from", in: "query" },
        description: "Início do intervalo (ISO 8601)",
        example: "2026-01-01T00:00:00Z",
      }),
      to: z.string().optional().openapi({
        param: { name: "to", in: "query" },
        description: "Fim do intervalo (ISO 8601)",
        example: "2026-02-05T00:00:00Z",
      }),
      limit: z.coerce.number().int().min(1).max(500).default(50).openapi({
        param: { name: "limit", in: "query" },
        description: "Número máximo de resultados",
        example: 50,
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
          schema: z.object({
            data: z.array(SearchResultSchema),
            pagination: PaginacaoSchema,
          }),
        },
      },
      description: "Resultados da pesquisa",
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<{ Bindings: Env }>();

app.openapi(search, async (c) => {
  const { adapterId, payloadType, locationId, from, to, limit, offset } = c.req.valid("query");
  const db = getDb(c.env);

  const conditions = [];
  if (adapterId) conditions.push(eq(apiData.apiSource, adapterId));
  if (payloadType) conditions.push(eq(apiData.payloadType, payloadType));
  if (locationId) conditions.push(eq(apiData.locationId, locationId));
  if (from) conditions.push(gte(apiData.timestamp, new Date(from)));
  if (to) conditions.push(lte(apiData.timestamp, new Date(to)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(apiData)
    .where(whereClause);

  const rows = await db
    .select()
    .from(apiData)
    .where(whereClause)
    .orderBy(desc(apiData.timestamp))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      apiSource: r.apiSource,
      payloadType: r.payloadType,
      locationId: r.locationId,
      timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      tags: r.tags ? (JSON.parse(r.tags) as string[]) : null,
      scrapedAt: r.scrapedAt instanceof Date ? r.scrapedAt.toISOString() : String(r.scrapedAt),
    })),
    pagination: { total, limit, offset, hasMore: offset + rows.length < total },
  });
});

export default app;
