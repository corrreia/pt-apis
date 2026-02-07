import { z } from "@hono/zod-openapi";

// ---------------------------------------------------------------------------
// Shared schemas — used by core and adapter routes
// ---------------------------------------------------------------------------

/** Standard error response. */
export const ErroSchema = z
  .object({
    error: z.string().openapi({ description: "Mensagem de erro" }),
    details: z.string().optional().openapi({ description: "Detalhes adicionais do erro" }),
  })
  .openapi("Error");

/** Pagination metadata. */
export const PaginacaoSchema = z
  .object({
    total: z.number().openapi({ description: "Número total de resultados" }),
    limit: z.number().openapi({ description: "Limite de resultados por página" }),
    offset: z.number().openapi({ description: "Desvio atual" }),
    hasMore: z.boolean().openapi({ description: "Se existem mais resultados" }),
  })
  .openapi("Pagination");

/** Location summary — used in nested models. */
export const LocalidadeResumoSchema = z
  .object({
    id: z.string().openapi({ description: "Identificador único (slug)", example: "lisboa" }),
    name: z.string().openapi({ description: "Nome da localização", example: "Lisboa" }),
    latitude: z.number().nullable().openapi({ description: "Latitude", example: 38.766 }),
    longitude: z.number().nullable().openapi({ description: "Longitude", example: -9.1286 }),
  })
  .openapi("LocationSummary");

export type LocalidadeResumo = z.infer<typeof LocalidadeResumoSchema>;
