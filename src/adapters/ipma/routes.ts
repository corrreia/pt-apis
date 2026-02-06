import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { latestValues, timeseries, locations } from "../../db/schema";
import { eq, and, desc, gte, lte, count } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { LocalidadeResumoSchema, ErroSchema, PaginacaoSchema } from "../../api/schemas";
import type { AdapterDefinition } from "../../core/adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wind speed class to English description. */
const WIND_DESCRIPTION: Record<number, string> = {
  1: "Weak",
  2: "Moderate",
  3: "Strong",
  4: "Very strong",
};

/** Precipitation intensity class to English description. */
const PRECIPITATION_DESCRIPTION: Record<number, string> = {
  0: "No precipitation",
  1: "Weak",
  2: "Moderate",
  3: "Strong",
};

// ---------------------------------------------------------------------------
// Zod models (exposed as components in Scalar)
// ---------------------------------------------------------------------------

const TemperatureSchema = z
  .object({
    min: z.number().openapi({ description: "Minimum temperature in °C", example: 10.5 }),
    max: z.number().openapi({ description: "Maximum temperature in °C", example: 18.2 }),
    unit: z.string().openapi({ description: "Unit of measure", example: "°C" }),
  })
  .openapi("Temperature");

const WindSchema = z
  .object({
    direction: z.string().openapi({ description: "Predominant wind direction", example: "NW" }),
    speedClass: z.number().openapi({
      description: "Speed class (1=Weak, 2=Moderate, 3=Strong, 4=Very strong)",
      example: 2,
    }),
    windSpeedDescription: z.string().openapi({
      description: "Wind speed description in English",
      example: "Moderate",
    }),
  })
  .openapi("Wind");

const PrecipitationSchema = z
  .object({
    probability: z.number().openapi({
      description: "Precipitation probability in %",
      example: 15.0,
    }),
    intensityClass: z.number().openapi({
      description: "Intensity class (0=None, 1=Weak, 2=Moderate, 3=Strong)",
      example: 0,
    }),
    precipitationDescription: z.string().openapi({
      description: "Precipitation intensity description in English",
      example: "No precipitation",
    }),
  })
  .openapi("Precipitation");

const WeatherTypeSchema = z
  .object({
    id: z.number().openapi({ description: "IPMA weather type code", example: 2 }),
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
      description: "Observation time (ISO 8601)",
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
    ingestedAt: z.string().optional().openapi({ description: "Ingestion time in system (ISO 8601)" }),
  })
  .openapi("DailyForecastHistory");

// ---------------------------------------------------------------------------
// Helper: group flat rows into rich models
// ---------------------------------------------------------------------------

interface FlatRow {
  metric: string;
  entityId: string;
  locationId: string | null;
  value: number;
  metadata: string | null;
  observedAt: Date;
  ingestedAt?: Date;
}

interface LocationRow {
  id: string;
  name: string;
  district: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
}

function buildForecast(
  rows: FlatRow[],
  locMap: Map<string, LocationRow>,
): Record<string, {
  location: z.infer<typeof LocalidadeResumoSchema>;
  temperature: z.infer<typeof TemperatureSchema>;
  wind: z.infer<typeof WindSchema>;
  precipitation: z.infer<typeof PrecipitationSchema>;
  weatherType: z.infer<typeof WeatherTypeSchema>;
  observedAt: string;
  ingestedAt?: string;
}> {
  const grouped: Record<string, FlatRow[]> = {};
  for (const r of rows) {
    const key = r.entityId;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  const result: Record<string, any> = {};
  for (const [entityId, metrics] of Object.entries(grouped)) {
    const locId = metrics[0].locationId;
    const loc = locId ? locMap.get(locId) : undefined;
    const meta = metrics[0].metadata ? JSON.parse(metrics[0].metadata) : {};

    const valMap: Record<string, number> = {};
    let windDir = "N/A";
    let observedAt = metrics[0].observedAt;
    let ingestedAt = (metrics[0] as any).ingestedAt;

    for (const m of metrics) {
      valMap[m.metric] = m.value;
      if (m.metric === "wind_speed_class") {
        const parsed = m.metadata ? JSON.parse(m.metadata) : {};
        windDir = parsed.windDirection ?? "N/A";
      }
      if (m.observedAt > observedAt) observedAt = m.observedAt;
    }

    const windClass = valMap["wind_speed_class"] ?? 0;
    const precIntClass = valMap["precipitation_intensity_class"] ?? 0;

    result[entityId] = {
      location: {
        id: locId ?? entityId,
        name: loc?.name ?? meta.city ?? entityId,
        district: loc?.district ?? null,
        region: loc?.region ?? null,
        latitude: loc?.latitude ?? meta.latitude ?? null,
        longitude: loc?.longitude ?? meta.longitude ?? null,
      },
      temperature: {
        min: valMap["temperature_min"] ?? 0,
        max: valMap["temperature_max"] ?? 0,
        unit: "°C",
      },
      wind: {
        direction: windDir,
        speedClass: windClass,
        windSpeedDescription: WIND_DESCRIPTION[windClass] ?? "Unknown",
      },
      precipitation: {
        probability: valMap["precipitation_probability"] ?? 0,
        intensityClass: precIntClass,
        precipitationDescription: PRECIPITATION_DESCRIPTION[precIntClass] ?? "Unknown",
      },
      weatherType: {
        id: valMap["weather_type_id"] ?? 0,
      },
      observedAt: observedAt instanceof Date ? observedAt.toISOString() : String(observedAt),
      ...(ingestedAt
        ? {
            ingestedAt:
              ingestedAt instanceof Date ? ingestedAt.toISOString() : String(ingestedAt),
          }
        : {}),
    };
  }

  return result;
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
  summary: "Daily forecast for all cities",
  description:
    "Returns the latest daily weather forecast for all Portuguese district capitals and islands. Includes temperature, wind, precipitation and weather type with nested models.",
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
      description: "Daily forecasts for all cities",
    },
  },
});

  const dailyForecastCityRoute = createRoute({
    method: "get",
    path: "/previsao/diaria/{locationId}",
    tags: [tag],
  summary: "Daily forecast for one city",
  description:
    "Returns the latest daily weather forecast for a specific location. Use the location slug (e.g. 'lisboa', 'porto', 'funchal').",
  request: {
    params: z.object({
      locationId: z.string().openapi({
        param: { name: "locationId", in: "path" },
        description: "Location slug",
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
      description: "Daily forecast for the location",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Location not found",
    },
  },
});

  const forecastHistoryRoute = createRoute({
    method: "get",
    path: "/previsao/historico",
    tags: [tag],
  summary: "Weather forecast history",
  description:
    "Returns weather forecast history with pagination and time filters. Enables time-travel and querying past forecasts.",
  request: {
    query: z.object({
      locationId: z.string().optional().openapi({
        param: { name: "locationId", in: "query" },
        description: "Filter by location (slug)",
        example: "lisboa",
      }),
      metric: z
        .enum([
          "temperature_min",
          "temperature_max",
          "precipitation_probability",
          "wind_speed_class",
          "precipitation_intensity_class",
          "weather_type_id",
        ])
        .optional()
        .openapi({
          param: { name: "metric", in: "query" },
          description: "Filter by specific metric",
          example: "temperature_max",
        }),
      from: z.string().optional().openapi({
        param: { name: "from", in: "query" },
        description: "Start date (ISO 8601)",
        example: "2026-01-01T00:00:00Z",
      }),
      to: z.string().optional().openapi({
        param: { name: "to", in: "query" },
        description: "End date (ISO 8601)",
        example: "2026-02-05T00:00:00Z",
      }),
      limit: z.coerce.number().int().min(1).max(500).default(100).openapi({
        param: { name: "limit", in: "query" },
        description: "Maximum number of results",
        example: 100,
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
            data: z.array(DailyForecastHistorySchema),
            pagination: PaginacaoSchema,
          }),
        },
      },
      description: "Forecast history with pagination",
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

    const rows = await db
      .select()
      .from(latestValues)
      .where(eq(latestValues.adapterId, adapterId));

    const locMap = await getLocationMap(
      db,
      rows.map((r) => r.locationId),
    );

    const forecasts = buildForecast(
      rows.map((r) => ({
        metric: r.metric,
        entityId: r.entityId,
        locationId: r.locationId,
        value: r.value,
        metadata: r.metadata,
        observedAt: r.observedAt,
      })),
      locMap,
    );

    const data = Object.values(forecasts);

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
      .from(latestValues)
      .where(
        and(eq(latestValues.adapterId, adapterId), eq(latestValues.locationId, locationId)),
      );

    if (rows.length === 0) {
      return c.json(
        { error: "Location not found", details: `No data for '${locationId}'` } as const,
        404,
      );
    }

    const locMap = await getLocationMap(
      db,
      rows.map((r) => r.locationId),
    );

    const forecasts = buildForecast(
      rows.map((r) => ({
        metric: r.metric,
        entityId: r.entityId,
        locationId: r.locationId,
        value: r.value,
        metadata: r.metadata,
        observedAt: r.observedAt,
      })),
      locMap,
    );

    const data = Object.values(forecasts)[0];
    if (!data) {
      return c.json(
        { error: "Location not found", details: `No data for '${locationId}'` } as const,
        404,
      );
    }

    return c.json(
      {
        data,
        updatedAt: new Date().toISOString(),
      },
      200,
    );
  });

  app.openapi(forecastHistoryRoute, async (c) => {
    const { locationId, metric, from, to, limit, offset } = c.req.valid("query");
    const db = getDb(c.env);

    const conditions = [eq(timeseries.adapterId, adapterId)];
    if (locationId) conditions.push(eq(timeseries.locationId, locationId));
    if (metric) conditions.push(eq(timeseries.metric, metric));
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

    const locMap = await getLocationMap(
      db,
      rows.map((r) => r.locationId),
    );

    const forecasts = buildForecast(
      rows.map((r) => ({
        metric: r.metric,
        entityId: r.entityId,
        locationId: r.locationId,
        value: r.value,
        metadata: r.metadata,
        observedAt: r.observedAt,
        ingestedAt: r.ingestedAt,
      })),
      locMap,
    );

    const data = Object.values(forecasts);

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
