import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { registry } from "../../core/registry";
import { getDb } from "../../db/client";
import { sources, ingestLog } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { ErroSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SourceSchema = z
  .object({
    id: z.string().openapi({ description: "Identificador único do adapter", example: "ipma-weather" }),
    name: z.string().openapi({ description: "Nome da fonte de dados" }),
    description: z.string().nullable().openapi({ description: "Descrição da fonte" }),
    sourceUrl: z.string().nullable().openapi({ description: "URL original da fonte" }),
    dataTypes: z.array(z.string()).openapi({ description: "Tipos de dados produzidos (timeseries, document, snapshot)" }),
    state: z.string().openapi({ description: "Estado atual da fonte", example: "active" }),
    lastCollectedAt: z.string().nullable().openapi({ description: "Última recolha de dados (ISO 8601)" }),
    hasCustomRoutes: z.boolean().openapi({ description: "Se o adapter define rotas personalizadas" }),
    hasCustomSchema: z.boolean().openapi({ description: "Se o adapter define tabelas próprias" }),
    hasLocations: z.boolean().openapi({
      description: "Se este adapter contribui para a tabela de localizações partilhadas",
    }),
  })
  .openapi("Source");

const SourceDetailSchema = SourceSchema.extend({
  schedules: z.array(
    z.object({
      frequency: z.string().openapi({ description: "Frequência do agendamento (ex.: hourly, daily)" }),
      description: z.string().openapi({ description: "Descrição da tarefa agendada" }),
    }),
  ).openapi({ description: "Agendamentos configurados (cron)" }),
  recentIngestions: z.array(
    z.object({
      id: z.number(),
      state: z.string().openapi({ description: "Estado da ingestão (running, success, error)" }),
      recordCount: z.number().nullable().openapi({ description: "Número de registos ingeridos" }),
      error: z.string().nullable().openapi({ description: "Mensagem de erro se aplicável" }),
      startedAt: z.string().openapi({ description: "Hora de início (ISO 8601)" }),
      finishedAt: z.string().nullable().openapi({ description: "Hora de fim (ISO 8601)" }),
    }),
  ).openapi({ description: "Ingestões recentes" }),
}).openapi("SourceDetail");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listSources = createRoute({
  method: "get",
  path: "/v1/sources",
  tags: ["Sources"],
  summary: "Listar todas as fontes de dados",
  description:
    "Devolve todos os adapters (fontes) registados, incluindo estado, tipos de dados e se têm rotas personalizadas.",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ data: z.array(SourceSchema) }) } },
      description: "Lista de todas as fontes",
    },
  },
});

const getSource = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}",
  tags: ["Sources"],
  summary: "Detalhes de uma fonte",
  description:
    "Devolve informação detalhada de uma fonte: agendamentos e histórico de ingestões recentes.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Identificador do adapter",
        example: "ipma-weather",
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ data: SourceDetailSchema }) } },
      description: "Detalhes da fonte",
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

app.openapi(listSources, async (c) => {
  const adapters = registry.getAll();
  const db = getDb(c.env);

  const sourceRows = await db.select().from(sources);
  const fetchedMap = new Map(sourceRows.map((r) => [r.id, r.lastFetchedAt]));

  const data = adapters.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    sourceUrl: a.sourceUrl,
    dataTypes: a.dataTypes as string[],
    state: "active",
    lastCollectedAt: fetchedMap.get(a.id)?.toISOString() ?? null,
    hasCustomRoutes: !!a.routes,
    hasCustomSchema: !!a.schema,
    hasLocations: a.features?.hasLocations ?? true,
  }));

  return c.json({ data });
});

app.openapi(getSource, async (c) => {
  const { sourceId } = c.req.valid("param");
  const adapter = registry.get(sourceId);

  if (!adapter) {
    return c.json(
      { error: "Source not found", details: `No adapter with id '${sourceId}'` } as const,
      404,
    );
  }

  const db = getDb(c.env);
  const [sourceRow] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  const recentLogs = await db
    .select()
    .from(ingestLog)
    .where(eq(ingestLog.adapterId, sourceId))
    .orderBy(desc(ingestLog.startedAt))
    .limit(20);

  const data = {
    id: adapter.id,
    name: adapter.name,
    description: adapter.description,
    sourceUrl: adapter.sourceUrl,
    dataTypes: adapter.dataTypes as string[],
    state: sourceRow?.status ?? "active",
    lastCollectedAt: sourceRow?.lastFetchedAt?.toISOString() ?? null,
    hasCustomRoutes: !!adapter.routes,
    hasCustomSchema: !!adapter.schema,
    hasLocations: adapter.features?.hasLocations ?? true,
    schedules: adapter.schedules.map((s) => ({
      frequency: s.frequency as string,
      description: s.description,
    })),
    recentIngestions: recentLogs.map((l) => ({
      id: l.id,
      state: l.status,
      recordCount: l.recordsCount ?? null,
      error: l.error ?? null,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
    })),
  };

  return c.json({ data }, 200);
});

export default app;
