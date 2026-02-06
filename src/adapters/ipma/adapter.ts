import type { AdapterDefinition, AdapterContext } from "../../core/adapter";
import { registry } from "../../core/registry";
import {
  IpmaForecastResponseSchema,
  IPMA_LOCATIONS,
  toLocationSlug,
  toLocationInput,
} from "./types";
import { createIpmaRoutes } from "./routes";

const WIND_DESCRIPTION: Record<number, string> = {
  1: "Weak",
  2: "Moderate",
  3: "Strong",
  4: "Very strong",
};

const PRECIPITATION_DESCRIPTION: Record<number, string> = {
  0: "No precipitation",
  1: "Weak",
  2: "Moderate",
  3: "Strong",
};

// ---------------------------------------------------------------------------
// Fetch logic
// ---------------------------------------------------------------------------

const FORECAST_URL =
  "https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/hp-daily-forecast-day0.json";

async function fetchWeatherForecast(ctx: AdapterContext): Promise<void> {
  ctx.log("Fetching IPMA daily weather forecast...");

  const res = await fetch(FORECAST_URL);
  if (!res.ok) {
    throw new Error(`IPMA API returned ${res.status}: ${res.statusText}`);
  }

  const raw = await res.json();
  const parsed = IpmaForecastResponseSchema.parse(raw);

  // Register all known IPMA locations in the shared locations table
  for (const [idStr, info] of Object.entries(IPMA_LOCATIONS)) {
    await ctx.registerLocation(toLocationInput(Number(idStr), info));
  }

  const observedAt = new Date(parsed.dataUpdate);
  let count = 0;

  for (const item of parsed.data) {
    const info = IPMA_LOCATIONS[item.globalIdLocal];
    const cityName = info?.name ?? String(item.globalIdLocal);
    const locationId = info ? toLocationSlug(info.name) : undefined;

    const windClass = item.classWindSpeed;
    const precIntClass = item.classPrecInt;

    const payload = {
      temperature: {
        min: item.tMin,
        max: item.tMax,
        unit: "°C",
      },
      wind: {
        direction: item.predWindDir ?? "N/A",
        speedClass: windClass,
        windSpeedDescription: WIND_DESCRIPTION[windClass] ?? "Unknown",
      },
      precipitation: {
        probability: parseFloat(item.precipitaProb),
        intensityClass: precIntClass,
        precipitationDescription: PRECIPITATION_DESCRIPTION[precIntClass] ?? "Unknown",
      },
      weatherType: { id: item.idWeatherType },
      forecastDate: parsed.forecastDate,
      dataUpdate: parsed.dataUpdate,
    };

    await ctx.storeApiData(adapter.id, "daily-forecast", payload, {
      locationId,
      tags: ["weather", "forecast"],
      timestamp: observedAt,
    });
    count++;
  }

  ctx.log(`Ingested ${count} daily-forecast payloads from ${parsed.data.length} locations.`);
}

// ---------------------------------------------------------------------------
// Adapter definition
// ---------------------------------------------------------------------------

const adapter: AdapterDefinition = {
  id: "ipma-weather",
  name: "IPMA — Weather Forecast",
  openApiTag: "IPMA Weather",
  description:
    "Previsões meteorológicas diárias para as capitais de distrito e ilhas, do Instituto do Mar e da Atmosfera (IPMA). Inclui temperatura, precipitação, vento e tipo de tempo.",
  sourceUrl: "https://api.ipma.pt/open-data/",
  dataTypes: ["api_data"],
  schedules: [
    {
      frequency: "every_15_minutes",
      handler: fetchWeatherForecast,
      description: "Recolher previsão meteorológica diária para todas as cidades",
    },
  ],
};

adapter.routes = createIpmaRoutes(adapter);
registry.register(adapter);

export default adapter;
