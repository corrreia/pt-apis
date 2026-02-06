import { z } from "@hono/zod-openapi";

/**
 * IPMA air quality index response.
 * Source: https://api.ipma.pt/open-data/forecast/meteorology/uv/uv.json
 *
 * We use IPMA's UV index as a simple, publicly accessible air-quality-related
 * metric. For a production adapter you'd integrate with QualAr (APA) or
 * the Porto Digital FIWARE endpoint.
 */
export const IpmaUvResponseSchema = z.object({
  owner: z.string().optional(),
  data: z.array(
    z.object({
      globalIdLocal: z.number(),
      iUv: z.number(),
      intervpicoMin: z.string().optional(),
      intervpicoMax: z.string().optional(),
      data: z.string(), // date string "YYYY-MM-DD"
    }),
  ),
});

export type IpmaUvResponse = z.infer<typeof IpmaUvResponseSchema>;

/**
 * For a real QualAr adapter, you'd integrate with:
 *
 * - APA QualAr: https://qualar.apambiente.pt/
 * - Porto Digital FIWARE: https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?type=AirQualityObserved
 * - AQICN: https://aqicn.org/api/ (requires token)
 *
 * This adapter uses IPMA's UV index as a simpler, zero-auth alternative
 * to demonstrate the adapter pattern.
 */
