import type { AdapterDefinition, AdapterContext } from "../../core/adapter";
import { registry } from "../../core/registry";
import { IpmaUvResponseSchema } from "./types";
import { IPMA_LOCATIONS, toLocationInput, toLocationSlug } from "../ipma/types";
import { createQualidadeArRoutes } from "./routes";

function uvRiskLevel(iUv: number): string {
  if (iUv <= 2) return "Low";
  if (iUv <= 5) return "Moderate";
  if (iUv <= 7) return "High";
  if (iUv <= 10) return "Very high";
  return "Extreme";
}

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

  let count = 0;
  for (const item of parsed.data) {
    const info = IPMA_LOCATIONS[item.globalIdLocal];
    const cityName = info?.name ?? String(item.globalIdLocal);
    const locationId = info ? toLocationSlug(info.name) : undefined;

    const observedAt = new Date(item.data);

    const payload = {
      uvIndex: item.iUv,
      riskLevel: uvRiskLevel(item.iUv),
      date: item.data,
      peakStartTime: item.intervpicoMin ?? null,
      peakEndTime: item.intervpicoMax ?? null,
    };

    await ctx.storeApiData(adapter.id, "uv-index", payload, {
      locationId,
      tags: ["uv", "air-quality"],
      timestamp: observedAt,
    });
    count++;
  }

  ctx.log(`Ingested ${count} UV index payloads.`);
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
  dataTypes: ["api_data"],
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
