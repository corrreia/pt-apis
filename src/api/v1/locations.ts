import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { locations, apiData, documents } from "../../db/schema";
import { eq, and, like, desc, count } from "drizzle-orm";
import { kvCache } from "../../core/cache";
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
    region: z.string().nullable().openapi({ description: "Região", example: "Lisboa" }),
    district: z.string().nullable().openapi({ description: "Distrito", example: "Lisboa" }),
    municipality: z.string().nullable().openapi({ description: "Município" }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Metadados JSON adicionais" }),
  })
  .openapi("Location");

const LocationDataSchema = z
  .object({
    apiData: z.array(
      z.object({
        id: z.string(),
        apiSource: z.string().openapi({ description: "Identificador do adapter" }),
        payloadType: z.string().openapi({ description: "Tipo do payload" }),
        payload: z.record(z.string(), z.unknown()).openapi({ description: "Payload JSON" }),
        timestamp: z.string().openapi({ description: "Hora de observação (ISO 8601)" }),
        scrapedAt: z.string().openapi({ description: "Hora de ingestão (ISO 8601)" }),
      }),
    ).openapi({ description: "Dados api_data associados a esta localização" }),
    documents: z.array(
      z.object({
        id: z.string(),
        adapterId: z.string(),
        name: z.string(),
        contentType: z.string(),
        capturedAt: z.string(),
      }),
    ).openapi({ description: "Documentos associados a esta localização" }),
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
      region: z.string().optional().openapi({
        param: { name: "region", in: "query" },
        description: "Filtrar por região",
        example: "Norte",
      }),
      district: z.string().optional().openapi({
        param: { name: "district", in: "query" },
        description: "Filtrar por distrito",
        example: "Porto",
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
    "Consulta cross-source: devolve api_data e documentos associados a esta localização de todos os adapters.",
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
app.use("/v1/locations/*/data", kvCache({ ttlSeconds: 300, prefix: "locdata" }));

app.openapi(listLocations, async (c) => {
  const { type, region, district, q, limit, offset } = c.req.valid("query");
  const db = getDb(c.env);

  const conditions = [];
  if (type) conditions.push(eq(locations.type, type));
  if (region) conditions.push(eq(locations.region, region));
  if (district) conditions.push(eq(locations.district, district));
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
    region: r.region,
    district: r.district,
    municipality: r.municipality,
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
        region: row.region,
        district: row.district,
        municipality: row.municipality,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      },
    },
    200,
  );
});

app.openapi(getLocationData, async (c) => {
  const { locationId } = c.req.valid("param");
  const db = getDb(c.env);

  const [loc] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!loc) {
    return c.json({ error: "Location not found" } as const, 404);
  }

  const [apiDataRows, docRows] = await Promise.all([
    db
      .select()
      .from(apiData)
      .where(eq(apiData.locationId, locationId))
      .orderBy(desc(apiData.timestamp))
      .limit(500),
    db
      .select()
      .from(documents)
      .where(eq(documents.locationId, locationId))
      .orderBy(desc(documents.capturedAt))
      .limit(100),
  ]);

  return c.json(
    {
      location: {
        id: loc.id,
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        type: loc.type,
        region: loc.region,
        district: loc.district,
        municipality: loc.municipality,
        metadata: loc.metadata ? JSON.parse(loc.metadata) : null,
      },
      data: {
        apiData: apiDataRows.map((r) => ({
          id: r.id,
          apiSource: r.apiSource,
          payloadType: r.payloadType,
          payload: JSON.parse(r.payload) as Record<string, unknown>,
          timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
          scrapedAt: r.scrapedAt instanceof Date ? r.scrapedAt.toISOString() : String(r.scrapedAt),
        })),
        documents: docRows.map((r) => ({
          id: r.id,
          adapterId: r.adapterId,
          name: r.name,
          contentType: r.contentType,
          capturedAt: r.capturedAt.toISOString(),
        })),
      },
    },
    200,
  );
});

export default app;
