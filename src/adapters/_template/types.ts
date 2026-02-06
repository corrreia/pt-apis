/**
 * ─── Adapter Types ────────────────────────────────────────────────────────
 *
 * This file defines TypeScript interfaces and Zod schemas that this adapter
 * owns. The core framework only stores/retrieves JSON — all domain-specific
 * types live here.
 *
 * Convention:
 *
 *   1. **Upstream schemas** — Zod schemas that validate the raw API response
 *      from the data source. Use these in your schedule handler to catch
 *      upstream format changes early.
 *
 *   2. **Payload interfaces** — TypeScript types describing what you store
 *      in `api_data.payload`. One adapter can have multiple payload types
 *      (e.g. "daily-forecast" and "hourly-observation").
 *
 *   3. **API response schemas** — Zod schemas for your custom route
 *      responses (used in @hono/zod-openapi for validation + docs).
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { z } from "@hono/zod-openapi";

// ---------------------------------------------------------------------------
// 1. Upstream API response schema (validates raw JSON from the data source)
// ---------------------------------------------------------------------------

/**
 * Zod schema for the upstream API response.
 * Parsing with this schema in your handler catches breaking changes early:
 *
 *   const parsed = MyUpstreamResponseSchema.parse(await res.json());
 */
export const MyUpstreamResponseSchema = z.object({
  // TODO: Match the shape of the upstream API response
  updatedAt: z.string(),
  data: z.array(
    z.object({
      id: z.number(),
      value: z.number(),
      label: z.string(),
      // ... add more fields as needed
    }),
  ),
});

export type MyUpstreamResponse = z.infer<typeof MyUpstreamResponseSchema>;

// ---------------------------------------------------------------------------
// 2. Payload interfaces (what goes into api_data.payload)
// ---------------------------------------------------------------------------

/**
 * Payload stored in api_data for payload_type = "my-reading".
 *
 * You have full freedom here — the core only sees JSON. Define whatever
 * structure makes sense for your data source. One adapter can have
 * multiple payload types with different interfaces.
 */
export interface MyReadingPayload {
  // TODO: Define the shape stored in api_data.payload
  value: number;
  unit: string;
  label: string;
  // ... add more fields as needed
}

/**
 * Example of a second payload type for the same adapter.
 * Each payload type gets its own payload_type string in api_data.
 *
 * export interface MySummaryPayload {
 *   totalReadings: number;
 *   average: number;
 *   period: { from: string; to: string };
 * }
 */

// ---------------------------------------------------------------------------
// 3. API response schemas (for custom Hono routes / OpenAPI docs)
// ---------------------------------------------------------------------------

/**
 * Zod schema for the reading response returned by custom API routes.
 * Used with @hono/zod-openapi for automatic validation and documentation.
 */
export const MyReadingSchema = z
  .object({
    // TODO: Define the shape of your API response
    value: z.number().openapi({ description: "The measured value", example: 22.5 }),
    unit: z.string().openapi({ description: "Unit of measurement", example: "°C" }),
    label: z.string().openapi({ description: "Human-readable label" }),
    location: z.string().nullable().openapi({ description: "Location slug" }),
    timestamp: z.string().openapi({ description: "Observation time (ISO 8601)" }),
  })
  .openapi("MyReading");
