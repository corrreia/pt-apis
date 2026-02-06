import { Scalar } from "@scalar/hono-api-reference";
import { registry } from "../core/registry";

/**
 * Mounts the OpenAPI JSON spec and Scalar UI on the Hono app.
 *
 * Usage:
 *   import { mountDocs } from "./api/openapi";
 *   mountDocs(app);
 */
export function mountDocs(app: import("@hono/zod-openapi").OpenAPIHono<{ Bindings: Env }>) {
  const coreTags = [
    { name: "Sources", description: "Descobrir fontes de dados disponíveis (adapters)" },
    { name: "Documents", description: "PDFs, CSVs e outros ficheiros armazenados em R2" },
    { name: "Search", description: "Pesquisa entre todas as fontes (api_data)" },
    { name: "Locations", description: "Modelo de localizações partilhado e dados por local" },
  ];

  const adapterTags = registry.getAll().map((a) => ({
    name: a.openApiTag ?? a.name,
    description: a.description,
  }));

  app.doc("/doc", {
    openapi: "3.1.0",
    info: {
      title: "Portugal Public Data API",
      description:
        "API aberta que agrega, faz cache e serve dados públicos de fontes governamentais e institucionais portuguesas. Dados em api_data (JSON payloads) com location e timestamp consistentes. Cada adapter pode definir os seus próprios modelos e endpoints.",
      version: "1.0.0",
      contact: {
        name: "PT APIs Contributors",
        url: "https://github.com/corrreia/pt-apis",
      },
      license: {
        name: "MIT",
      },
    },
    servers: [
      { url: "https://pt-apis.corrreia.workers.dev", description: "Produção" },
      { url: "http://localhost:8787", description: "Desenvolvimento local" },
    ],
    tags: [...coreTags, ...adapterTags],
  });

  app.get(
    "/reference",
    Scalar({
      url: "/doc",
      theme: "kepler",
      pageTitle: "Portugal Public Data API — Referência",
    }),
  );
}
