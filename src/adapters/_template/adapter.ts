/**
 * ─── Adapter Template ─────────────────────────────────────────────────────
 *
 * Copy this folder to create a new adapter:
 *
 *   cp -r src/adapters/_template src/adapters/my-source
 *
 * Then:
 *   1. Rename and fill in all the TODO fields below.
 *   2. Add `import "./my-source/adapter"` to `src/adapters/index.ts`.
 *   3. Run `wrangler dev` and test your adapter.
 *   4. Submit a pull request!
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type {
  AdapterDefinition,
  AdapterContext,
  TimeseriesPoint,
  DocumentInput,
  LocationInput,
} from "../../core/adapter";
import { registry } from "../../core/registry";

// ---------------------------------------------------------------------------
// TODO: Define Zod schemas for the upstream API response (optional but nice)
// import { z } from "@hono/zod-openapi";
// const MyApiResponseSchema = z.object({ ... });
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TODO: Set the upstream API URL
// ---------------------------------------------------------------------------
const API_URL = "https://example.com/api/data";

// ---------------------------------------------------------------------------
// Schedule handlers
// ---------------------------------------------------------------------------

/**
 * Main fetch handler – called by the scheduler on the configured frequency.
 *
 * Use `ctx` to:
 *   - `ctx.ingestTimeseries(adapterId, points)` → store numeric timeseries
 *   - `ctx.uploadDocument(adapterId, doc)`       → upload a file to R2
 *   - `ctx.storeSnapshot(adapterId, type, data)` → store a JSON snapshot
 *   - `ctx.registerLocation(loc)`                → register a shared location
 *   - `ctx.log(...)`                             → structured logging
 */
async function fetchData(ctx: AdapterContext): Promise<void> {
  ctx.log("Fetching data from upstream...");

  // TODO: Fetch data from the upstream API
  // const res = await fetch(API_URL);
  // if (!res.ok) throw new Error(`API returned ${res.status}`);
  // const raw = await res.json();

  // TODO: Parse & validate (optional but recommended)
  // const parsed = MyApiResponseSchema.parse(raw);

  // ── Example: Register locations ─────────────────────────────────────
  // Locations are shared across all adapters. Register them so users can
  // query "all data for location X" across every source.
  //
  // await ctx.registerLocation({
  //   id: "lisbon",
  //   name: "Lisboa",
  //   latitude: 38.7223,
  //   longitude: -9.1393,
  //   type: "city",           // "city", "station", "sensor", etc.
  //   region: "Lisboa",
  //   district: "Lisboa",
  // });

  // ── Example: Ingest timeseries with location ────────────────────────
  // const points: TimeseriesPoint[] = parsed.items.map((item) => ({
  //   metric: "my_metric",
  //   entityId: item.id,
  //   locationId: "lisbon",   // <-- links to the shared locations table
  //   value: item.value,
  //   metadata: { unit: "°C", location: item.name },
  //   observedAt: new Date(item.timestamp),
  // }));
  // await ctx.ingestTimeseries(adapter.id, points);

  // ── Example: Upload a document ──────────────────────────────────────
  // const doc: DocumentInput = {
  //   name: "report-2026-01.pdf",
  //   contentType: "application/pdf",
  //   data: await res.arrayBuffer(),
  //   locationId: "lisbon",  // optional
  //   metadata: { year: 2026, month: 1 },
  // };
  // await ctx.uploadDocument(adapter.id, doc);

  // ── Example: Store a snapshot ───────────────────────────────────────
  // await ctx.storeSnapshot(adapter.id, "full-response", raw);

  ctx.log("Done.");
}

// ---------------------------------------------------------------------------
// Optional: Custom routes
// ---------------------------------------------------------------------------
//
// Export createMyRoutes(adapter) — the tag is derived from adapter.openApiTag ?? adapter.name.
// Routes are auto-mounted at /v1/{adapter.id}/... and appear in OpenAPI/Scalar docs.
//
// export function createMyRoutes(adapter: AdapterDefinition) {
//   const tag = adapter.openApiTag ?? adapter.name;
//   const app = new OpenAPIHono<{ Bindings: Env }>();
//   const summaryRoute = createRoute({
//     method: "get",
//     path: "/summary",
//     tags: [tag],
//     summary: "Get a custom summary",
//     responses: {
//       200: {
//         content: { "application/json": { schema: z.object({ total: z.number() }) } },
//         description: "Summary data",
//       },
//     },
//   });
//   app.openapi(summaryRoute, async (c) => c.json({ total: 42 }));
//   return app;
// }

// ---------------------------------------------------------------------------
// Optional: Custom schema
// ---------------------------------------------------------------------------
//
// If your data doesn't fit the generic timeseries/documents/snapshots model,
// define your own Drizzle tables in a `schema.ts` file in this folder.
// The Drizzle config glob picks them up automatically for migration generation.
//
// See src/adapters/_template/schema.ts.example for an example.

// ---------------------------------------------------------------------------
// Adapter definition
// ---------------------------------------------------------------------------

const adapter: AdapterDefinition = {
  // TODO: Choose a unique slug (lowercase, hyphens, no spaces)
  id: "my-source",

  // TODO: Human-readable name
  name: "My Data Source",

  // TODO: Describe what this adapter does
  description: "Fetches data from ...",

  // TODO: URL of the upstream public data source
  sourceUrl: API_URL,

  // TODO: Which data types does this adapter produce?
  // Options: "timeseries" | "document" | "snapshot"
  dataTypes: ["timeseries"],

  // TODO: Configure schedule(s)
  // Options: "every_minute" | "every_5_minutes" | "every_15_minutes"
  //          "hourly" | "every_6_hours" | "daily" | "weekly"
  schedules: [
    {
      frequency: "hourly",
      handler: fetchData,
      description: "Fetch latest data from the upstream API",
    },
  ],

  // Optional: short OpenAPI tag (defaults to name). E.g. "Air Quality" vs "Air Quality — UV Index"
  // openApiTag: "My Source",

  // Optional: set features.hasLocations: false if your data has no geographic locations
  // features: { hasLocations: false },
};

// Optional: if you have custom routes, add:
// adapter.routes = createMyRoutes(adapter);

// ⚠️  Uncomment the line below when your adapter is ready:
// registry.register(adapter);

export default adapter;
