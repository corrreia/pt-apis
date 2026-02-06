import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { apiData, locations } from "../../db/schema";
import { eq, and, desc, gte, lte, count } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { LocalidadeResumoSchema, ErroSchema, PaginacaoSchema } from "../../api/schemas";
import type { AdapterDefinition } from "../../core/adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zod models (exposed as components in Scalar)
// ---------------------------------------------------------------------------

const TemperatureSchema = z
  .object({
    min: z.number().openapi({ description: "Temperatura mínima em °C", example: 10.5 }),
    max: z.number().openapi({ description: "Temperatura máxima em °C", example: 18.2 }),
    unit: z.string().openapi({ description: "Unidade de medida", example: "°C" }),
  })
  .openapi("Temperature");

const WindSchema = z
  .object({
    direction: z.string().openapi({ description: "Direção predominante do vento", example: "NW" }),
    speedClass: z.number().openapi({
      description: "Classe de velocidade (1=Fraco, 2=Moderado, 3=Forte, 4=Muito forte)",
      example: 2,
    }),
    windSpeedDescription: z.string().openapi({
      description: "Descrição da velocidade do vento (inglês)",
      example: "Moderate",
    }),
  })
  .openapi("Wind");

const PrecipitationSchema = z
  .object({
    probability: z.number().openapi({
      description: "Probabilidade de precipitação em %",
      example: 15.0,
    }),
    intensityClass: z.number().openapi({
      description: "Classe de intensidade (0=Nenhuma, 1=Fraca, 2=Moderada, 3=Forte)",
      example: 0,
    }),
    precipitationDescription: z.string().openapi({
      description: "Descrição da intensidade da precipitação (inglês)",
      example: "No precipitation",
    }),
  })
  .openapi("Precipitation");

const WeatherTypeSchema = z
  .object({
    id: z.number().openapi({ description: "Código do tipo de tempo IPMA", example: 2 }),
  })
  .openapi("WeatherType");

const DailyForecastSchema = z
  .object({
    location: LocalidadeResumoSchema,
    temperature: TemperatureSchema,
    wind: WindSchema,
    precipitation: PrecipitationSchema,
    weatherType: WeatherTypeSchema,
    observedAt: z.string().openapi({
      description: "Hora de observação (ISO 8601)",
      example: "2026-02-05T10:30:00.000Z",
    }),
  })
  .openapi("DailyForecast");

const DailyForecastHistorySchema = z
  .object({
    location: LocalidadeResumoSchema,
    temperature: TemperatureSchema,
    wind: WindSchema,
    precipitation: PrecipitationSchema,
    weatherType: WeatherTypeSchema,
    observedAt: z.string(),
    scrapedAt: z.string().optional().openapi({ description: "Hora de ingestão no sistema (ISO 8601)" }),
  })
  .openapi("DailyForecastHistory");

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

function rowToForecast(
  row: { payload: string; locationId: string | null; timestamp: Date; scrapedAt: Date },
  locMap: Map<string, LocationRow>,
) {
  const payload = JSON.parse(row.payload) as {
    temperature: { min: number; max: number; unit: string };
    wind: { direction: string; speedClass: number; windSpeedDescription: string };
    precipitation: { probability: number; intensityClass: number; precipitationDescription: string };
    weatherType: { id: number };
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
    temperature: payload.temperature,
    wind: payload.wind,
    precipitation: payload.precipitation,
    weatherType: payload.weatherType,
    observedAt: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
    scrapedAt: row.scrapedAt instanceof Date ? row.scrapedAt.toISOString() : undefined,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createIpmaRoutes(adapter: AdapterDefinition): OpenAPIHono<{ Bindings: Env }> {
  const tag = adapter.openApiTag ?? adapter.name;
  const adapterId = adapter.id;

  const dailyForecastRoute = createRoute({
    method: "get",
    path: "/previsao/diaria",
    tags: [tag],
    summary: "Previsão diária para todas as cidades",
    description:
      "Devolve a previsão meteorológica diária mais recente para as capitais de distrito e ilhas. Inclui temperatura, vento, precipitação e tipo de tempo com modelos aninhados.",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              data: z.array(DailyForecastSchema),
              locationCount: z.number(),
              updatedAt: z.string(),
            }),
          },
        },
        description: "Previsões diárias para todas as cidades",
      },
    },
  });

  const dailyForecastCityRoute = createRoute({
    method: "get",
    path: "/previsao/diaria/{locationId}",
    tags: [tag],
    summary: "Previsão diária para uma cidade",
    description:
      "Devolve a previsão meteorológica diária mais recente para uma localização. Use o slug (ex.: 'lisboa', 'porto', 'funchal').",
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
              data: DailyForecastSchema,
              updatedAt: z.string(),
            }),
          },
        },
        description: "Previsão diária para a localização",
      },
      404: {
        content: { "application/json": { schema: ErroSchema } },
        description: "Localização não encontrada",
      },
    },
  });

  const forecastHistoryRoute = createRoute({
    method: "get",
    path: "/previsao/historico",
    tags: [tag],
    summary: "Histórico de previsões meteorológicas",
    description:
      "Devolve o histórico de previsões com paginação e filtros de tempo. Permite time-travel e consulta de previsões passadas.",
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
              data: z.array(DailyForecastHistorySchema),
              pagination: PaginacaoSchema,
            }),
          },
        },
        description: "Histórico de previsões com paginação",
      },
    },
  });

  // ---------------------------------------------------------------------------
  // App
  // ---------------------------------------------------------------------------

  const app = new OpenAPIHono<{ Bindings: Env }>();

  app.use("/previsao/diaria", kvCache({ ttlSeconds: 300, prefix: "ipma-prev" }));
  app.use("/previsao/diaria/*", kvCache({ ttlSeconds: 300, prefix: "ipma-prev-c" }));
  app.use("/previsao/historico", kvCache({ ttlSeconds: 600, prefix: "ipma-hist" }));

  app.openapi(dailyForecastRoute, async (c) => {
    const db = getDb(c.env);

    // Get latest batch: order by timestamp desc, take first row's timestamp, then get all rows with that timestamp
    const latestRow = await db
      .select({ timestamp: apiData.timestamp })
      .from(apiData)
      .where(and(eq(apiData.apiSource, adapterId), eq(apiData.payloadType, "daily-forecast")))
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
          eq(apiData.payloadType, "daily-forecast"),
          eq(apiData.timestamp, maxTimestamp),
        ),
      );

    const locMap = await getLocationMap(db, rows.map((r) => r.locationId));
    const data = rows.map((r) =>
      rowToForecast(
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

  app.openapi(dailyForecastCityRoute, async (c) => {
    const { locationId } = c.req.valid("param");
    const db = getDb(c.env);

    const rows = await db
      .select()
      .from(apiData)
      .where(
        and(
          eq(apiData.apiSource, adapterId),
          eq(apiData.payloadType, "daily-forecast"),
          eq(apiData.locationId, locationId),
        ),
      )
      .orderBy(desc(apiData.timestamp))
      .limit(1);

    if (rows.length === 0) {
      return c.json(
        { error: "Location not found", details: `No data for '${locationId}'` } as const,
        404,
      );
    }

    const locMap = await getLocationMap(db, [locationId]);
    const data = rowToForecast(
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

  app.openapi(forecastHistoryRoute, async (c) => {
    const { locationId, from, to, limit, offset } = c.req.valid("query");
    const db = getDb(c.env);

    const conditions = [
      eq(apiData.apiSource, adapterId),
      eq(apiData.payloadType, "daily-forecast"),
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
      rowToForecast(
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
