/**
 * ─── Tipos do Adaptador Sismos (IPMA) ─────────────────────────────────────
 *
 * Schemas upstream, interfaces de payload e schemas de resposta da API
 * para o adaptador de sismologia do IPMA.
 *
 * Abrange:
 *   - Atividade sísmica em Portugal Continental e Madeira (últimos 30 dias)
 *   - Atividade sísmica no Arquipélago dos Açores (últimos 30 dias)
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { z } from "@hono/zod-openapi";

// ===========================================================================
// 1. Schemas das respostas da API upstream
// ===========================================================================

export const IpmaSismoEventoSchema = z.object({
  googlemapref: z.string(),
  degree: z.union([z.string(), z.number(), z.null()]),
  sismoId: z.string(),
  dataUpdate: z.string(),
  magType: z.string(),
  obsRegion: z.string(),
  lon: z.string(),
  lat: z.string(),
  source: z.string(),
  depth: z.number(),
  tensorRef: z.string(),
  sensed: z.union([z.boolean(), z.null()]),
  shakemapid: z.string(),
  time: z.string(),
  shakemapref: z.string(),
  local: z.union([z.string(), z.null()]),
  magnitud: z.string(),
});

export type IpmaSismoEvento = z.infer<typeof IpmaSismoEventoSchema>;

export const IpmaSismosResponseSchema = z.object({
  idArea: z.number(),
  country: z.string(),
  lastSismicActivityDate: z.string(),
  updateDate: z.string(),
  owner: z.string(),
  data: z.array(IpmaSismoEventoSchema),
});

export type IpmaSismosResponse = z.infer<typeof IpmaSismosResponseSchema>;

// ===========================================================================
// 2. Interfaces de payload (o que fica em api_data.payload)
// ===========================================================================

export interface SismoPayload {
  sismoId: string;
  dataEvento: string;
  latitude: number;
  longitude: number;
  profundidade: number;
  magnitude: number;
  tipoMagnitude: string;
  regiao: string;
  intensidade: string | null;
  sentido: boolean;
  localSentido: string | null;
  fonte: string;
  shakemapUrl: string | null;
}

// ===========================================================================
// 3. Schemas de resposta da API (para rotas personalizadas)
// ===========================================================================

export const SismoSchema = z
  .object({
    sismoId: z.string().openapi({ description: "Identificador único do evento sísmico" }),
    dataEvento: z.string().openapi({ description: "Data e hora do evento (ISO 8601)" }),
    latitude: z.number().openapi({ description: "Latitude do epicentro", example: 38.72 }),
    longitude: z.number().openapi({ description: "Longitude do epicentro", example: -9.14 }),
    profundidade: z.number().openapi({ description: "Profundidade em km", example: 10 }),
    magnitude: z.number().openapi({ description: "Magnitude do evento", example: 2.1 }),
    tipoMagnitude: z.string().openapi({ description: "Tipo de magnitude (ex.: L = Richter local)", example: "L" }),
    regiao: z.string().openapi({ description: "Região observada", example: "NE Arraiolos" }),
    intensidade: z.string().nullable().openapi({ description: "Intensidade na escala de Mercalli (ex.: III/IV)" }),
    sentido: z.boolean().openapi({ description: "Se o sismo foi sentido pela população" }),
    localSentido: z.string().nullable().openapi({ description: "Locais onde o sismo foi sentido" }),
    fonte: z.string().openapi({ description: "Fonte dos dados", example: "IPMA" }),
    shakemapUrl: z.string().nullable().openapi({ description: "URL do mapa de intensidade (shakemap)" }),
  })
  .openapi("Sismo");
