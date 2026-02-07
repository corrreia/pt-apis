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
import type { AdapterDefinition, AdapterContext, DocumentInput } from "../../core/adapter";
import { registry } from "../../core/registry";

// Import your types — see types.ts for upstream schemas, payload interfaces,
// and API response schemas.
// import { MyUpstreamResponseSchema, type MyReadingPayload } from "./types";

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
 *   - `ctx.storeApiData(adapterId, payloadType, payload, opts?)` → store one row in api_data
 *   - `ctx.storeBatchApiData(adapterId, payloadType, items)` → batch-insert multiple rows (recommended for loops)
 *   - `ctx.uploadDocument(adapterId, doc)`       → upload a file to R2
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
  //   metadata: { region: "Lisboa" },  // any adapter-specific fields
  // });

  // ── Example: Batch-store api_data (recommended for multiple records) ─
  // Build an array of { payload, options } and insert them all at once.
  // Each adapter defines its own payload interfaces in types.ts.
  //
  // const items = parsed.data.map((item) => ({
  //   payload: { value: item.value, unit: "°C", label: item.label },
  //   options: {
  //     locationId: "lisbon",  // optional, enables location-based queries
  //     tags: ["weather", "temperature"],
  //     timestamp: new Date(item.timestamp),
  //   },
  // }));
  // const ids = await ctx.storeBatchApiData(adapter.id, "my-reading", items);
  // ctx.log(`Stored ${ids.length} records.`);
  //
  // For a single record, use storeApiData instead:
  // await ctx.storeApiData(adapter.id, "my-reading", payload, { locationId, tags, timestamp });

  // ── Example: Upload a document ──────────────────────────────────────
  // const doc: DocumentInput = {
  //   name: "report-2026-01.pdf",
  //   contentType: "application/pdf",
  //   data: await res.arrayBuffer(),
  //   locationId: "lisbon",  // optional
  //   metadata: { year: 2026, month: 1 },
  // };
  // await ctx.uploadDocument(adapter.id, doc);

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
  // Options: "api_data" | "document"
  dataTypes: ["api_data"],

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
