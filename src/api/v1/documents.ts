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
    id: z.string().openapi({ description: "Unique document identifier" }),
    name: z.string().openapi({ description: "File name" }),
    contentType: z.string().openapi({ description: "File MIME type", example: "application/pdf" }),
    sizeBytes: z.number().nullable().openapi({ description: "File size in bytes" }),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: "Additional JSON metadata" }),
    capturedAt: z.string().openapi({ description: "Capture time (ISO 8601)" }),
    downloadUrl: z.string().openapi({ description: "URL to download the document" }),
  })
  .openapi("Document");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listDocuments = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/documents",
  tags: ["Documents"],
  summary: "List documents for a source",
  description:
    "Returns metadata for all documents captured by this data source. Documents are files stored in R2 (PDFs, CSVs, etc.).",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Adapter identifier",
        example: "dados-gov",
      }),
    }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50).openapi({
        param: { name: "limit", in: "query" },
        description: "Maximum number of results",
        example: 50,
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
          schema: z.object({ data: z.array(DocumentSchema) }),
        },
      },
      description: "List of documents",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Source not found",
    },
  },
});

const getDocument = createRoute({
  method: "get",
  path: "/v1/sources/{sourceId}/documents/{docId}",
  tags: ["Documents"],
  summary: "Download a document",
  description:
    "Streams the document content directly from R2 storage.",
  request: {
    params: z.object({
      sourceId: z.string().openapi({
        param: { name: "sourceId", in: "path" },
        description: "Adapter identifier",
        example: "dados-gov",
      }),
      docId: z.string().openapi({
        param: { name: "docId", in: "path" },
        description: "Document identifier",
        example: "abc-123",
      }),
    }),
  },
  responses: {
    200: {
      description: "File content (stream)",
    },
    404: {
      content: { "application/json": { schema: ErroSchema } },
      description: "Document not found",
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
