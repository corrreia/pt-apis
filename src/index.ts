import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// Import adapters (registers them in the global registry)
import "./adapters/index";

// API route modules
import sourcesApp from "./api/v1/sources";
import realtimeApp from "./api/v1/realtime";
import historyApp from "./api/v1/history";
import documentsApp from "./api/v1/documents";
import snapshotsApp from "./api/v1/snapshots";
import searchApp from "./api/v1/search";
import locationsApp from "./api/v1/locations";
import { mountDocs } from "./api/openapi";

// Core
import { handleScheduled } from "./core/scheduler";
import { seedSources } from "./adapters/seed";
import { registry } from "./core/registry";

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new OpenAPIHono<{ Bindings: Env }>();

// Global middleware
app.use("*", cors());
app.use("*", logger());

// Seed sources table on first request
let seeded = false;
app.use("*", async (c, next) => {
  if (!seeded) {
    try {
      await seedSources(c.env);
      seeded = true;
    } catch (e) {
      console.error("[seed] Failed to seed sources:", e);
    }
  }
  await next();
});

// Mount core API routes
app.route("/", sourcesApp);
app.route("/", realtimeApp);
app.route("/", historyApp);
app.route("/", documentsApp);
app.route("/", snapshotsApp);
app.route("/", searchApp);
app.route("/", locationsApp);

// Mount custom adapter routes (each adapter's OpenAPIHono sub-app)
for (const adapter of registry.getAll()) {
  if (adapter.routes) {
    app.route(`/v1/${adapter.id}`, adapter.routes);
  }
}

// Mount OpenAPI docs + Scalar UI
mountDocs(app);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    adapterCount: registry.size,
  });
});

// Root / discovery
app.get("/", (c) => {
  return c.json({
    name: "Portugal Public Data API",
    description:
      "Open API that aggregates public data from Portuguese government and institutional sources.",
    version: "1.0.0",
    adapters: registry.getAll().map((a) => ({
      id: a.id,
      name: a.name,
      dataTypes: a.dataTypes,
      hasCustomRoutes: !!a.routes,
      hasCustomSchema: !!a.schema,
    })),
    endpoints: {
      sources: "/v1/sources",
      locations: "/v1/locations",
      search: "/v1/search",
      documentation: "/doc",
      reference: "/reference",
      health: "/health",
    },
  });
});

// ---------------------------------------------------------------------------
// Export: fetch (HTTP) + scheduled (cron)
// ---------------------------------------------------------------------------

export default {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    await handleScheduled(controller, env, ctx);
  },
};
