import type { AdapterDefinition, AdapterContext, TimeseriesPoint } from "../../core/adapter";
import { registry } from "../../core/registry";
import { IpmaUvResponseSchema } from "./types";
import { IPMA_LOCATIONS, toLocationSlug, toLocationInput } from "../ipma/types";
import { createQualidadeArRoutes } from "./routes";

// ---------------------------------------------------------------------------
// Fetch logic
// ---------------------------------------------------------------------------

const UV_INDEX_URL = "https://api.ipma.pt/open-data/forecast/meteorology/uv/uv.json";

async function fetchUvIndex(ctx: AdapterContext): Promise<void> {
  ctx.log("Fetching UV index data...");

  const res = await fetch(UV_INDEX_URL);
  if (!res.ok) {
    throw new Error(`IPMA UV API returned ${res.status}: ${res.statusText}`);
  }

  const raw = await res.json();
  const parsed = IpmaUvResponseSchema.parse(raw);

  // Register locations (shared with ipma-weather, upserts are idempotent)
  for (const [idStr, info] of Object.entries(IPMA_LOCATIONS)) {
    await ctx.registerLocation(toLocationInput(Number(idStr), info));
  }

  // Store snapshot
  await ctx.storeSnapshot(adapter.id, "uv-index", {
    locationCount: parsed.data.length,
    fetchedAt: new Date().toISOString(),
  });

  // Convert to timeseries
  const points: TimeseriesPoint[] = [];

  for (const item of parsed.data) {
    const info = IPMA_LOCATIONS[item.globalIdLocal];
    const cityName = info?.name ?? String(item.globalIdLocal);
    const entityId = toLocationSlug(cityName);
    const locationId = info ? toLocationSlug(info.name) : undefined;

    points.push({
      metric: "uv_index",
      entityId,
      locationId,
      value: item.iUv,
      metadata: {
        city: cityName,
        globalIdLocal: item.globalIdLocal,
        date: item.data,
        peakStart: item.intervpicoMin ?? null,
        peakEnd: item.intervpicoMax ?? null,
      },
      observedAt: new Date(item.data),
    });
  }

  const count = await ctx.ingestTimeseries(adapter.id, points);
  ctx.log(`Ingested ${count} UV index points.`);
}

// ---------------------------------------------------------------------------
// Adapter definition
// ---------------------------------------------------------------------------

const adapter: AdapterDefinition = {
  id: "qualidade-ar",
  name: "Air Quality — UV Index",
  openApiTag: "Air Quality",
  description:
    "Previsões de índice UV para cidades portuguesas (IPMA). Inclui nível de risco, horas de pico e dados por localização. Para dados completos de qualidade do ar, integrar com QualAr/APA ou Porto Digital FIWARE.",
  sourceUrl: "https://api.ipma.pt/open-data/",
  dataTypes: ["timeseries", "snapshot"],
  schedules: [
    {
      frequency: "hourly",
      handler: fetchUvIndex,
      description: "Recolher previsão de índice UV para todas as cidades",
    },
  ],
};

adapter.routes = createQualidadeArRoutes(adapter);
registry.register(adapter);

export default adapter;
