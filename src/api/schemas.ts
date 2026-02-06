import { z } from "@hono/zod-openapi";

// ---------------------------------------------------------------------------
// Shared schemas — used by core and adapter routes
// ---------------------------------------------------------------------------

/** Standard error response. */
export const ErroSchema = z
  .object({
    error: z.string().openapi({ description: "Error message" }),
    details: z.string().optional().openapi({ description: "Additional error details" }),
  })
  .openapi("Error");

/** Pagination metadata. */
export const PaginacaoSchema = z
  .object({
    total: z.number().openapi({ description: "Total number of results" }),
    limit: z.number().openapi({ description: "Results per page limit" }),
    offset: z.number().openapi({ description: "Current offset" }),
    hasMore: z.boolean().openapi({ description: "Whether more results exist" }),
  })
  .openapi("Pagination");

/** Location summary — used in nested models. */
export const LocalidadeResumoSchema = z
  .object({
    id: z.string().openapi({ description: "Unique identifier (slug)", example: "lisboa" }),
    name: z.string().openapi({ description: "Location name", example: "Lisboa" }),
    district: z.string().nullable().openapi({ description: "District", example: "Lisboa" }),
    region: z.string().nullable().openapi({ description: "Region", example: "Lisboa" }),
    latitude: z.number().nullable().openapi({ description: "Latitude", example: 38.766 }),
    longitude: z.number().nullable().openapi({ description: "Longitude", example: -9.1286 }),
  })
  .openapi("LocationSummary");

export type LocalidadeResumo = z.infer<typeof LocalidadeResumoSchema>;
