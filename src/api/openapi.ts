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
    { name: "Sources", description: "Discover available data sources (adapters)" },
    { name: "Realtime", description: "Latest values per data source" },
    { name: "History", description: "Historical time series with time-travel" },
    { name: "Documents", description: "PDFs, CSVs and other files stored in R2" },
    { name: "Snapshots", description: "Point-in-time JSON snapshots for time-travel" },
    { name: "Search", description: "Cross-source search" },
    { name: "Locations", description: "Shared location model and data by location" },
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
        "Open API that aggregates, caches and serves public data from Portuguese government and institutional sources. Supports real-time data, historical time series, documents and snapshots. Each adapter can define its own data models and custom endpoints.",
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
      { url: "https://pt-apis.corrreia.workers.dev", description: "Production" },
      { url: "http://localhost:8787", description: "Local development" },
    ],
    tags: [...coreTags, ...adapterTags],
  });

  app.get(
    "/reference",
    Scalar({
      url: "/doc",
      theme: "kepler",
      pageTitle: "Portugal Public Data API — Reference",
    }),
  );
}
