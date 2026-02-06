import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { apiData, locations } from "../../db/schema";
import { eq, and, desc, gte, lte, count } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { LocalidadeResumoSchema, ErroSchema, PaginacaoSchema } from "../../api/schemas";
import type { AdapterDefinition } from "../../core/adapter";

// ---------------------------------------------------------------------------
// Zod models
// ---------------------------------------------------------------------------

const UvIndexReadingSchema = z
  .object({
    location: LocalidadeResumoSchema,
    uvIndex: z.number().openapi({
      description: "Valor do índice UV",
      example: 6.5,
    }),
    riskLevel: z.string().openapi({
      description: "Nível de risco UV (Low, Moderate, High, Very high, Extreme)",
      example: "High",
    }),
    date: z.string().openapi({
      description: "Data da leitura (YYYY-MM-DD)",
      example: "2026-02-05",
    }),
    peakStartTime: z.string().nullable().openapi({
      description: "Hora de início do pico de UV",
      example: "12:00",
    }),
    peakEndTime: z.string().nullable().openapi({
      description: "Hora de fim do pico de UV",
      example: "15:00",
    }),
    observedAt: z.string().openapi({
      description: "Hora de observação (ISO 8601)",
      example: "2026-02-05T10:30:00.000Z",
    }),
  })
  .openapi("UvIndexReading");

const UvIndexReadingHistorySchema = UvIndexReadingSchema.extend({
  scrapedAt: z.string().optional().openapi({
    description: "Hora de ingestão no sistema (ISO 8601)",
  }),
}).openapi("UvIndexReadingHistory");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LocationRow {
  id: string;
  name: string;
  district: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
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

function rowToReading(
  row: { payload: string; locationId: string | null; timestamp: Date; scrapedAt: Date },
  locMap: Map<string, LocationRow>,
) {
  const payload = JSON.parse(row.payload) as {
    uvIndex: number;
    riskLevel: string;
    date: string;
    peakStartTime: string | null;
    peakEndTime: string | null;
  };
  const locId = row.locationId;
  const loc = locId ? locMap.get(locId) : undefined;
  const locationName = loc?.name ?? locId ?? "unknown";

  return {
    location: {
      id: locId ?? locationName.toLowerCase().replace(/\s+/g, "-"),
      name: locationName,
      district: loc?.district ?? null,
      region: loc?.region ?? null,
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
    },
    uvIndex: payload.uvIndex,
    riskLevel: payload.riskLevel,
    date: payload.date,
    peakStartTime: payload.peakStartTime,
    peakEndTime: payload.peakEndTime,
    observedAt: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
    scrapedAt: row.scrapedAt instanceof Date ? row.scrapedAt.toISOString() : undefined,
  };
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
    summary: "Índice UV atual para todas as cidades",
    description:
      "Devolve o índice UV mais recente para todas as localizações monitorizadas pelo IPMA. Inclui nível de risco, horas de pico e dados da localização.",
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
        description: "Índice UV para todas as cidades",
      },
    },
  });

  const uvIndexCityRoute = createRoute({
    method: "get",
    path: "/indice-uv/{locationId}",
    tags: [tag],
    summary: "Índice UV para uma cidade",
    description:
      "Devolve o índice UV mais recente para uma localização. Use o slug (ex.: 'lisboa', 'porto', 'faro').",
    request: {
      params: z.object({
        locationId: z.string().openapi({
          param: { name: "locationId", in: "path" },
          description: "Slug da localização",
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
        description: "Índice UV para a localização",
      },
      404: {
        content: { "application/json": { schema: ErroSchema } },
        description: "Localização não encontrada",
      },
    },
  });

  const uvHistoryRoute = createRoute({
    method: "get",
    path: "/indice-uv/historico",
    tags: [tag],
    summary: "Histórico do índice UV",
    description:
      "Devolve o histórico de leituras do índice UV com paginação e filtros de tempo. Permite consultar dados passados para análise.",
    request: {
      query: z.object({
        locationId: z.string().optional().openapi({
          param: { name: "locationId", in: "query" },
          description: "Filtrar por localização (slug)",
          example: "lisboa",
        }),
        from: z.string().optional().openapi({
          param: { name: "from", in: "query" },
          description: "Data de início (ISO 8601)",
          example: "2026-01-01T00:00:00Z",
        }),
        to: z.string().optional().openapi({
          param: { name: "to", in: "query" },
          description: "Data de fim (ISO 8601)",
          example: "2026-02-05T00:00:00Z",
        }),
        limit: z.coerce.number().int().min(1).max(500).default(100).openapi({
          param: { name: "limit", in: "query" },
          description: "Número máximo de resultados",
          example: 100,
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
              data: z.array(UvIndexReadingHistorySchema),
              pagination: PaginacaoSchema,
            }),
          },
        },
        description: "Histórico do índice UV com paginação",
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

    const latestRow = await db
      .select({ timestamp: apiData.timestamp })
      .from(apiData)
      .where(and(eq(apiData.apiSource, adapterId), eq(apiData.payloadType, "uv-index")))
      .orderBy(desc(apiData.timestamp))
      .limit(1);

    if (latestRow.length === 0) {
      return c.json({
        data: [],
        locationCount: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    const maxTimestamp = latestRow[0].timestamp;

    const rows = await db
      .select()
      .from(apiData)
      .where(
        and(
          eq(apiData.apiSource, adapterId),
          eq(apiData.payloadType, "uv-index"),
          eq(apiData.timestamp, maxTimestamp),
        ),
      );

    const locMap = await getLocationMap(db, rows.map((r) => r.locationId));
    const data = rows.map((r) =>
      rowToReading(
        {
          payload: r.payload,
          locationId: r.locationId,
          timestamp: r.timestamp,
          scrapedAt: r.scrapedAt,
        },
        locMap,
      ),
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
      .from(apiData)
      .where(
        and(
          eq(apiData.apiSource, adapterId),
          eq(apiData.payloadType, "uv-index"),
          eq(apiData.locationId, locationId),
        ),
      )
      .orderBy(desc(apiData.timestamp))
      .limit(1);

    if (rows.length === 0) {
      return c.json(
        { error: "Location not found", details: `No UV data for '${locationId}'` } as const,
        404,
      );
    }

    const locMap = await getLocationMap(db, [locationId]);
    const data = rowToReading(
      {
        payload: rows[0].payload,
        locationId: rows[0].locationId,
        timestamp: rows[0].timestamp,
        scrapedAt: rows[0].scrapedAt,
      },
      locMap,
    );

    return c.json({
      data,
      updatedAt: new Date().toISOString(),
    });
  });

  app.openapi(uvHistoryRoute, async (c) => {
    const { locationId, from, to, limit, offset } = c.req.valid("query");
    const db = getDb(c.env);

    const conditions = [
      eq(apiData.apiSource, adapterId),
      eq(apiData.payloadType, "uv-index"),
    ];
    if (locationId) conditions.push(eq(apiData.locationId, locationId));
    if (from) conditions.push(gte(apiData.timestamp, new Date(from)));
    if (to) conditions.push(lte(apiData.timestamp, new Date(to)));

    const whereClause = and(...conditions);

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

    const locMap = await getLocationMap(db, rows.map((r) => r.locationId));
    const data = rows.map((r) =>
      rowToReading(
        {
          payload: r.payload,
          locationId: r.locationId,
          timestamp: r.timestamp,
          scrapedAt: r.scrapedAt,
        },
        locMap,
      ),
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
