import type { AdapterDefinition, AdapterContext, TimeseriesPoint } from "../../core/adapter";
import { registry } from "../../core/registry";
import {
  IpmaForecastResponseSchema,
  IPMA_LOCATIONS,
  toLocationSlug,
  toLocationInput,
} from "./types";
import { createIpmaRoutes } from "./routes";

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

  // Store the raw response as a snapshot (for time-travel)
  await ctx.storeSnapshot(adapter.id, "daily-forecast", {
    forecastDate: parsed.forecastDate,
    dataUpdate: parsed.dataUpdate,
    locationCount: parsed.data.length,
  });

  // Convert to timeseries points
  const points: TimeseriesPoint[] = [];
  const observedAt = new Date(parsed.dataUpdate);

  for (const item of parsed.data) {
    const info = IPMA_LOCATIONS[item.globalIdLocal];
    const cityName = info?.name ?? String(item.globalIdLocal);
    const entityId = toLocationSlug(cityName);
    const locationId = info ? toLocationSlug(info.name) : undefined;

    const baseMetadata = {
      city: cityName,
      globalIdLocal: item.globalIdLocal,
      latitude: parseFloat(item.latitude),
      longitude: parseFloat(item.longitude),
      forecastDate: parsed.forecastDate,
    };

    // Temperature min
    points.push({
      metric: "temperature_min",
      entityId,
      locationId,
      value: item.tMin,
      metadata: { ...baseMetadata, unit: "°C" },
      observedAt,
    });

    // Temperature max
    points.push({
      metric: "temperature_max",
      entityId,
      locationId,
      value: item.tMax,
      metadata: { ...baseMetadata, unit: "°C" },
      observedAt,
    });

    // Precipitation probability
    points.push({
      metric: "precipitation_probability",
      entityId,
      locationId,
      value: parseFloat(item.precipitaProb),
      metadata: { ...baseMetadata, unit: "%" },
      observedAt,
    });

    // Wind speed class (1=weak, 2=moderate, 3=strong, 4=very strong)
    points.push({
      metric: "wind_speed_class",
      entityId,
      locationId,
      value: item.classWindSpeed,
      metadata: {
        ...baseMetadata,
        windDirection: item.predWindDir,
        scale: "1=weak, 2=moderate, 3=strong, 4=very strong",
      },
      observedAt,
    });

    // Precipitation intensity class
    points.push({
      metric: "precipitation_intensity_class",
      entityId,
      locationId,
      value: item.classPrecInt,
      metadata: {
        ...baseMetadata,
        scale: "0=none, 1=weak, 2=moderate, 3=strong",
      },
      observedAt,
    });

    // Weather type id
    points.push({
      metric: "weather_type_id",
      entityId,
      locationId,
      value: item.idWeatherType,
      metadata: baseMetadata,
      observedAt,
    });
  }

  const count = await ctx.ingestTimeseries(adapter.id, points);
  ctx.log(`Ingested ${count} timeseries points from ${parsed.data.length} locations.`);
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
  dataTypes: ["timeseries", "snapshot"],
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
