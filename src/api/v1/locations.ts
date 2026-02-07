import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { locations, apiData, documents } from "../../db/schema";
import { eq, and, like, desc, count } from "drizzle-orm";
import { kvCache, cacheControl } from "../../core/cache";
import { rateLimit } from "../../core/rate-limit";
import { ErroSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const LocationSchema = z
  .object({
    id: z.string().openapi({ description: "Identificador único (slug)", example: "lisboa" }),
    name: z.string().openapi({ description: "Nome da localização", example: "Lisboa" }),
    latitude: z.number().nullable().openapi({ description: "Latitude" }),
    longitude: z.number().nullable().openapi({ description: "Longitude" }),
    type: z.string().openapi({ description: "Tipo (city, district, station, sensor)", example: "city" }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Metadados JSON adicionais" }),
  })
  .openapi("Location");

const PaginationInfoSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

const LocationDataSchema = z
  .object({
    apiData: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          apiSource: z.string().openapi({ description: "Identificador do adapter" }),
          payloadType: z.string().openapi({ description: "Tipo do payload" }),
          payload: z.record(z.string(), z.unknown()).openapi({ description: "Payload JSON" }),
          timestamp: z.string().openapi({ description: "Hora de observação (ISO 8601)" }),
          scrapedAt: z.string().openapi({ description: "Hora de ingestão (ISO 8601)" }),
        }),
      ),
      pagination: PaginationInfoSchema,
    }).openapi({ description: "Dados api_data associados a esta localização" }),
    documents: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          adapterId: z.string(),
          name: z.string(),
          contentType: z.string(),
          capturedAt: z.string(),
        }),
      ),
      pagination: PaginationInfoSchema,
    }).openapi({ description: "Documentos associados a esta localização" }),
  })
  .openapi("LocationData");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listLocations = createRoute({
  method: "get",
  path: "/v1/locations",
  tags: ["Locations"],
  summary: "Listar todas as localizações",
  description:
    "Devolve todas as localizações partilhadas registadas pelos adapters. Suporta filtro por tipo, região, distrito ou pesquisa por nome.",
  request: {
    query: z.object({
      type: z.string().optional().openapi({
        param: { name: "type", in: "query" },
        description: "Filtrar por tipo (city, district, station, sensor)",
        example: "city",
      }),
      q: z.string().optional().openapi({
        param: { name: "q", in: "query" },
        description: "Pesquisar por nome da localização",
        example: "lisb",
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
            data: z.array(LocationSchema),
            total: z.number(),
          }),
        },
      },
      description: "Lista de localizações",
    },
  },
});

const getLocation = createRoute({
  method: "get",
  path: "/v1/locations/{locationId}",
  tags: ["Locations"],
  summary: "Detalhes de uma localização",
  description: "Devolve os detalhes de uma localização específica.",
  request: {
    params: z.object({
      locationId: z.string().openapi({
        param: { name: "locationId", in: "path" },
        description: "Identificador da localização (slug)",
        example: "lisboa",
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ data: LocationSchema }) } },
      description: "Detalhes da localização",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Localização não encontrada",
    },
  },
});

const getLocationData = createRoute({
  method: "get",
  path: "/v1/locations/{locationId}/data",
  tags: ["Locations"],
  summary: "Todos os dados de uma localização",
  description:
    "Consulta cross-source: devolve api_data e documentos associados a esta localização de todos os adapters. Suporta paginação independente para api_data e documentos.",
  request: {
    params: z.object({
      locationId: z.string().openapi({
        param: { name: "locationId", in: "path" },
        description: "Identificador da localização (slug)",
        example: "lisboa",
      }),
    }),
    query: z.object({
      apiDataLimit: z.coerce.number().int().min(1).max(500).default(50).openapi({
        param: { name: "apiDataLimit", in: "query" },
        description: "Número máximo de registos api_data",
        example: 50,
      }),
      apiDataOffset: z.coerce.number().int().min(0).default(0).openapi({
        param: { name: "apiDataOffset", in: "query" },
        description: "Offset de paginação para api_data",
        example: 0,
      }),
      docLimit: z.coerce.number().int().min(1).max(100).default(20).openapi({
        param: { name: "docLimit", in: "query" },
        description: "Número máximo de documentos",
        example: 20,
      }),
      docOffset: z.coerce.number().int().min(0).default(0).openapi({
        param: { name: "docOffset", in: "query" },
        description: "Offset de paginação para documentos",
        example: 0,
      }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            location: LocationSchema,
            data: LocationDataSchema,
          }),
        },
      },
      description: "Todos os dados desta localização de todas as fontes",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Localização não encontrada",
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use("/v1/locations", kvCache({ ttlSeconds: 600, prefix: "loc" }));
app.use("/v1/locations", cacheControl(300, 600));
app.use("/v1/locations/*", cacheControl(300, 600));
app.use("/v1/locations/*/data", rateLimit({ binding: "RATE_LIMITER_SEARCH", keyPrefix: "locdata" }));
app.use("/v1/locations/*/data", kvCache({ ttlSeconds: 300, prefix: "locdata" }));
app.use("/v1/locations/*/data", cacheControl(60, 120));

app.openapi(listLocations, async (c) => {
  const { type, q, limit, offset } = c.req.valid("query");
  const db = getDb(c.env);

  const conditions = [];
  if (type) conditions.push(eq(locations.type, type));
  if (q) conditions.push(like(locations.name, `%${q}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(locations)
    .where(whereClause);

  const rows = await db
    .select()
    .from(locations)
    .where(whereClause)
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    type: r.type,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));

  return c.json({ data, total });
});

app.openapi(getLocation, async (c) => {
  const { locationId } = c.req.valid("param");
  const db = getDb(c.env);

  const [row] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Location not found" } as const, 404);
  }

  return c.json(
    {
      data: {
        id: row.id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        type: row.type,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      },
    },
    200,
  );
});

app.openapi(getLocationData, async (c) => {
  const { locationId } = c.req.valid("param");
  const { apiDataLimit, apiDataOffset, docLimit, docOffset } = c.req.valid("query");
  const db = getDb(c.env);

  const [loc] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!loc) {
    return c.json({ error: "Location not found" } as const, 404);
  }

  const [apiDataRows, docRows, [{ apiDataTotal }], [{ docTotal }]] = await Promise.all([
    db
      .select()
      .from(apiData)
      .where(eq(apiData.locationId, locationId))
      .orderBy(desc(apiData.timestamp))
      .limit(apiDataLimit)
      .offset(apiDataOffset),
    db
      .select()
      .from(documents)
      .where(eq(documents.locationId, locationId))
      .orderBy(desc(documents.capturedAt))
      .limit(docLimit)
      .offset(docOffset),
    db
      .select({ apiDataTotal: count() })
      .from(apiData)
      .where(eq(apiData.locationId, locationId)),
    db
      .select({ docTotal: count() })
      .from(documents)
      .where(eq(documents.locationId, locationId)),
  ]);

  return c.json(
    {
      location: {
        id: loc.id,
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        type: loc.type,
        metadata: loc.metadata ? JSON.parse(loc.metadata) : null,
      },
      data: {
        apiData: {
          items: apiDataRows.map((r) => ({
            id: r.id,
            apiSource: r.apiSource,
            payloadType: r.payloadType,
            payload: JSON.parse(r.payload) as Record<string, unknown>,
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
            scrapedAt: r.scrapedAt instanceof Date ? r.scrapedAt.toISOString() : String(r.scrapedAt),
          })),
          pagination: {
            total: apiDataTotal,
            limit: apiDataLimit,
            offset: apiDataOffset,
            hasMore: apiDataOffset + apiDataRows.length < apiDataTotal,
          },
        },
        documents: {
          items: docRows.map((r) => ({
            id: r.id,
            adapterId: r.adapterId,
            name: r.name,
            contentType: r.contentType,
            capturedAt: r.capturedAt.toISOString(),
          })),
          pagination: {
            total: docTotal,
            limit: docLimit,
            offset: docOffset,
            hasMore: docOffset + docRows.length < docTotal,
          },
        },
      },
    },
    200,
  );
});

export default app;
