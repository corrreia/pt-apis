import { z } from "@hono/zod-openapi";
import type { LocationInput } from "../../core/adapter";

/** Raw IPMA daily forecast response. */
export const IpmaForecastResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  forecastDate: z.string(),
  dataUpdate: z.string(),
  data: z.array(
    z.object({
      precipitaProb: z.string(),
      tMin: z.number(),
      tMax: z.number(),
      predWindDir: z.string(),
      idWeatherType: z.number(),
      classWindSpeed: z.number(),
      longitude: z.string(),
      latitude: z.string(),
      classPrecInt: z.number(),
      globalIdLocal: z.number(),
    }),
  ),
});

export type IpmaForecastResponse = z.infer<typeof IpmaForecastResponseSchema>;

/**
 * IPMA globalIdLocal -> city info mapping (district capitals + islands).
 * Includes geo, district, and region data for the shared locations table.
 */
export interface IpmaLocationInfo {
  name: string;
  district: string;
  region: string;
  latitude: number;
  longitude: number;
}

export const IPMA_LOCATIONS: Record<number, IpmaLocationInfo> = {
  1010500: { name: "Aveiro",            district: "Aveiro",            region: "Centro",   latitude: 40.6413,  longitude: -8.6535 },
  1020500: { name: "Beja",              district: "Beja",              region: "Alentejo",  latitude: 38.0200,  longitude: -7.8700 },
  1030300: { name: "Braga",             district: "Braga",             region: "Norte",     latitude: 41.5475,  longitude: -8.4227 },
  1040200: { name: "Bragança",          district: "Bragança",          region: "Norte",     latitude: 41.8076,  longitude: -6.7606 },
  1050200: { name: "Castelo Branco",    district: "Castelo Branco",    region: "Centro",   latitude: 39.8217,  longitude: -7.4957 },
  1060300: { name: "Coimbra",           district: "Coimbra",           region: "Centro",   latitude: 40.2081,  longitude: -8.4194 },
  1070500: { name: "Évora",             district: "Évora",             region: "Alentejo",  latitude: 38.5701,  longitude: -7.9104 },
  1080500: { name: "Faro",              district: "Faro",              region: "Algarve",   latitude: 37.0146,  longitude: -7.9331 },
  1081505: { name: "Sagres",            district: "Faro",              region: "Algarve",   latitude: 37.0168,  longitude: -8.9403 },
  1090700: { name: "Guarda",            district: "Guarda",            region: "Centro",   latitude: 40.5379,  longitude: -7.2647 },
  1090821: { name: "Penhas Douradas",   district: "Guarda",            region: "Centro",   latitude: 40.4075,  longitude: -7.5665 },
  1100900: { name: "Leiria",            district: "Leiria",            region: "Centro",   latitude: 39.7473,  longitude: -8.8069 },
  1110600: { name: "Lisboa",            district: "Lisboa",            region: "Lisboa",    latitude: 38.7660,  longitude: -9.1286 },
  1121400: { name: "Portalegre",        district: "Portalegre",        region: "Alentejo",  latitude: 39.2900,  longitude: -7.4200 },
  1131200: { name: "Porto",             district: "Porto",             region: "Norte",     latitude: 41.1580,  longitude: -8.6294 },
  1141600: { name: "Santarém",          district: "Santarém",          region: "Centro",   latitude: 39.2000,  longitude: -8.7400 },
  1151200: { name: "Setúbal",           district: "Setúbal",           region: "Lisboa",    latitude: 38.5246,  longitude: -8.8856 },
  1151300: { name: "Sines",             district: "Setúbal",           region: "Alentejo",  latitude: 37.9560,  longitude: -8.8643 },
  1160900: { name: "Viana do Castelo",  district: "Viana do Castelo",  region: "Norte",     latitude: 41.6952,  longitude: -8.8365 },
  1171400: { name: "Vila Real",         district: "Vila Real",         region: "Norte",     latitude: 41.3053,  longitude: -7.7440 },
  1182300: { name: "Viseu",             district: "Viseu",             region: "Centro",   latitude: 40.6585,  longitude: -7.9120 },
  2310300: { name: "Funchal",           district: "Madeira",           region: "Madeira",   latitude: 32.6485,  longitude: -16.9084 },
  2320100: { name: "Porto Santo",       district: "Madeira",           region: "Madeira",   latitude: 33.0700,  longitude: -16.3400 },
  3420300: { name: "Ponta Delgada",     district: "Açores",            region: "Açores",    latitude: 37.7415,  longitude: -25.6677 },
  3430100: { name: "Angra do Heroísmo", district: "Açores",            region: "Açores",    latitude: 38.6700,  longitude: -27.2200 },
  3470100: { name: "Horta",             district: "Açores",            region: "Açores",    latitude: 38.5363,  longitude: -28.6315 },
  3480200: { name: "Flores",            district: "Açores",            region: "Açores",    latitude: 39.4500,  longitude: -31.1300 },
};

/** Convert a city name to a location slug. */
export function toLocationSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
}

/** Build a LocationInput from an IPMA location entry. */
export function toLocationInput(
  globalIdLocal: number,
  info: IpmaLocationInfo,
): LocationInput {
  return {
    id: toLocationSlug(info.name),
    name: info.name,
    latitude: info.latitude,
    longitude: info.longitude,
    type: "city",
    region: info.region,
    district: info.district,
    metadata: { ipmaGlobalIdLocal: globalIdLocal },
  };
}
