import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getDb } from "../../db/client";
import { documents } from "../../db/schema";
import { registry } from "../../core/registry";
import { eq, and, desc } from "drizzle-orm";
import { kvCache } from "../../core/cache";
import { ErroSchema } from "../schemas";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DocumentSchema = z
  .object({
    id: z.string().openapi({ description: "Identificador único do documento" }),
    name: z.string().openapi({ description: "Nome do ficheiro" }),
    contentType: z.string().openapi({ description: "Tipo MIME do ficheiro", example: "application/pdf" }),
    sizeBytes: z.number().nullable().openapi({ description: "Tamanho do ficheiro em bytes" }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Metadados JSON adicionais" }),
    capturedAt: z.string().openapi({ description: "Hora de captura (ISO 8601)" }),
    downloadUrl: z.string().openapi({ description: "URL para descarregar o documento" }),
  })
  .openapi("Document");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listDocuments = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/documents",
  tags: ["Documents"],
  summary: "Listar documentos de uma fonte",
  description:
    "Devolve metadados de todos os documentos capturados por esta fonte. Os documentos são ficheiros armazenados em R2 (PDFs, CSVs, etc.).",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Identificador do adapter",
        example: "dados-gov",
      }),
    }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50).openapi({
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
          schema: z.object({ data: z.array(DocumentSchema) }),
        },
      },
      description: "Lista de documentos",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Fonte não encontrada",
    },
  },
});

const getDocument = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/documents/{docId}",
  tags: ["Documents"],
  summary: "Descarregar um documento",
  description:
    "Transmite o conteúdo do documento diretamente do armazenamento R2.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Identificador do adapter",
        example: "dados-gov",
      }),
      docId: z.string().openapi({
        param: { name: "docId", in: "path" },
        description: "Identificador do documento",
        example: "abc-123",
      }),
    }),
  },
  responses: {
    200: {
      description: "Conteúdo do ficheiro (stream)",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Documento não encontrado",
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use("/v1/sources/*/documents", kvCache({ ttlSeconds: 600, prefix: "docs" }));

app.openapi(listDocuments, async (c) => {
  const { sourceId } = c.req.valid("param");

  if (!registry.has(sourceId)) {
    return c.json({ error: "Source not found" } as const, 404);
  }

  const { limit, offset } = c.req.valid("query");
  const db = getDb(c.env);

  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.adapterId, sourceId))
    .orderBy(desc(documents.capturedAt))
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    capturedAt: r.capturedAt.toISOString(),
    downloadUrl: `/v1/sources/${sourceId}/documents/${r.id}`,
  }));

  return c.json({ data }, 200);
});

app.openapi(getDocument, async (c) => {
  const { sourceId, docId } = c.req.valid("param");
  const db = getDb(c.env);

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.adapterId, sourceId), eq(documents.id, docId)))
    .limit(1);

  if (!doc) {
    return c.json({ error: "Document not found" } as const, 404);
  }

  const object = await c.env.DOCUMENTS.get(doc.r2Key);
  if (!object) {
    return c.json({ error: "File missing from storage" } as const, 404);
  }

  c.header("Content-Type", doc.contentType);
  c.header("Content-Disposition", `inline; filename="${doc.name}"`);
  if (doc.sizeBytes) c.header("Content-Length", String(doc.sizeBytes));

  return c.body(object.body as ReadableStream);
});

export default app;
