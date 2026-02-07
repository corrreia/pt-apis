/**
 * ─── Adaptador Tempo (IPMA) ──────────────────────────────────────────────
 *
 * Obtém dados meteorológicos e oceanográficos a partir da API aberta do
 * IPMA (Instituto Português do Mar e da Atmosfera).
 *
 * Fontes de dados:
 *   - Previsões meteorológicas diárias (por local e agregadas)
 *   - Avisos meteorológicos (até 3 dias)
 *   - Previsão do estado do mar (até 3 dias)
 *   - Risco de incêndio / RCM (até 2 dias)
 *   - Índice ultravioleta (até 3 dias)
 *   - Observações de estações meteorológicas (horárias, últimas 24h)
 *
 * Dados de referência disponíveis como rotas personalizadas (tipos de
 * tempo, classes de vento, classes de precipitação, locais, estações).
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AdapterDefinition, AdapterContext } from "../../core/adapter";
import { registry } from "../../core/registry";
import { locations } from "../../db/schema";
import { kvCache, cacheControl } from "../../core/cache";
import {
  // Schemas upstream
  IpmaLocaisResponseSchema,
  IpmaLocaisCosteirosResponseSchema,
  IpmaEstacoesResponseSchema,
  IpmaTiposTempoResponseSchema,
  IpmaClassesVentoResponseSchema,
  IpmaClassesPrecipResponseSchema,
  IpmaAvisosResponseSchema,
  IpmaPrevisaoAgregadaResponseSchema,
  IpmaPrevisaoMarResponseSchema,
  IpmaRiscoIncendioResponseSchema,
  IpmaUvResponseSchema,
  IpmaObservacoesResponseSchema,
  // Schemas de resposta da API
  PrevisaoDiariaSchema,
  AvisoMeteorologicoSchema,
  PrevisaoMarSchema,
  RiscoIncendioSchema,
  IndiceUvSchema,
  ObservacaoEstacaoSchema,
  TipoTempoRefSchema,
  ClasseVentoRefSchema,
  ClassePrecipitacaoRefSchema,
  LocalIpmaRefSchema,
  EstacaoRefSchema,
} from "./types";

// ---------------------------------------------------------------------------
// URLs base da API do IPMA
// ---------------------------------------------------------------------------

const BASE = "https://api.ipma.pt/open-data";

const URLS = {
  // Previsões
  previsaoDiariaPorDia: (dia: number) =>
    `${BASE}/forecast/meteorology/cities/daily/hp-daily-forecast-day${dia}.json`,
  previsaoDiariaPorLocal: (globalIdLocal: number) =>
    `${BASE}/forecast/meteorology/cities/daily/${globalIdLocal}.json`,

  // Avisos
  avisos: `${BASE}/forecast/warnings/warnings_www.json`,

  // Mar
  previsaoMarPorDia: (dia: number) =>
    `${BASE}/forecast/oceanography/daily/hp-daily-sea-forecast-day${dia}.json`,

  // Risco de incêndio
  riscoIncendioPorDia: (dia: number) =>
    `${BASE}/forecast/meteorology/rcm/rcm-d${dia}.json`,

  // Índice UV
  indiceUv: `${BASE}/forecast/meteorology/uv/uv.json`,

  // Observações
  observacoesEstacoes: `${BASE}/observation/meteorology/stations/observations.json`,

  // Dados de referência
  locais: `${BASE}/distrits-islands.json`,
  locaisCosteiros: `${BASE}/sea-locations.json`,
  estacoes: `${BASE}/observation/meteorology/stations/stations.json`,
  tiposTempo: `${BASE}/weather-type-classe.json`,
  classesVento: `${BASE}/wind-speed-daily-classe.json`,
  classesPrecipitacao: `${BASE}/precipitation-classe.json`,
};

// ---------------------------------------------------------------------------
// Auxiliar: nome da região
// ---------------------------------------------------------------------------

function nomeRegiao(idRegiao: number): string {
  switch (idRegiao) {
    case 1: return "Continente";
    case 2: return "Arquipélago da Madeira";
    case 3: return "Arquipélago dos Açores";
    default: return "Desconhecido";
  }
}

// ---------------------------------------------------------------------------
// Auxiliar: fetch seguro com validação
// ---------------------------------------------------------------------------

async function ipmaFetch<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API do IPMA devolveu ${res.status} para ${url}`);
  }
  const raw = await res.json();
  return schema.parse(raw);
}

// ---------------------------------------------------------------------------
// Handler de agendamento: Sincronizar locais do IPMA
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Nominatim reverse geocoding (OpenStreetMap)
// ---------------------------------------------------------------------------

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_USER_AGENT = "pt-apis/1.0 (https://github.com/corrreia/pt-apis)";

interface NominatimAddress {
  country?: string;
  state?: string;
  county?: string;
  city?: string;
  town?: string;
  village?: string;
  postcode?: string;
  road?: string;
}

interface NominatimResult {
  display_name?: string;
  address?: NominatimAddress;
}

async function reverseGeocode(lat: number, lon: number): Promise<NominatimResult | null> {
  try {
    const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&accept-language=pt&zoom=10`;
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
    });
    if (!res.ok) return null;
    return (await res.json()) as NominatimResult;
  } catch {
    return null;
  }
}

/** Sleep helper to respect Nominatim's 1 req/sec policy. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Handler de agendamento: Sincronizar locais do IPMA
// ---------------------------------------------------------------------------

async function sincronizarLocais(ctx: AdapterContext): Promise<void> {
  ctx.log("A sincronizar locais do IPMA...");

  // Collect all locations to register, then enrich with Nominatim
  const toRegister: Array<{ id: string; name: string; lat: number; lon: number; type: string; metadata: Record<string, unknown> }> = [];

  // Capitais de distrito e ilhas
  const locais = await ipmaFetch(URLS.locais, IpmaLocaisResponseSchema);
  for (const loc of locais.data) {
    toRegister.push({
      id: `ipma-${loc.globalIdLocal}`,
      name: loc.local,
      lat: parseFloat(loc.latitude),
      lon: parseFloat(loc.longitude),
      type: "city",
      metadata: {
        regiao: nomeRegiao(loc.idRegiao),
        globalIdLocal: loc.globalIdLocal,
        idDistrito: loc.idDistrito,
        idConcelho: loc.idConcelho,
        idAreaAviso: loc.idAreaAviso,
        idRegiao: loc.idRegiao,
      },
    });
  }

  // Locais costeiros
  const costeiros = await ipmaFetch(URLS.locaisCosteiros, IpmaLocaisCosteirosResponseSchema);
  for (const loc of costeiros) {
    toRegister.push({
      id: `ipma-mar-${loc.globalIdLocal}`,
      name: loc.local,
      lat: parseFloat(loc.latitude),
      lon: parseFloat(loc.longitude),
      type: "coastal",
      metadata: {
        regiao: nomeRegiao(loc.idRegiao),
        globalIdLocal: loc.globalIdLocal,
        idLocal: loc.idLocal,
        idAreaAviso: loc.idAreaAviso,
        idRegiao: loc.idRegiao,
      },
    });
  }

  // Estações meteorológicas
  const estacoes = await ipmaFetch(URLS.estacoes, IpmaEstacoesResponseSchema);
  for (const estacao of estacoes) {
    toRegister.push({
      id: `ipma-estacao-${estacao.properties.idEstacao}`,
      name: estacao.properties.localEstacao,
      lat: estacao.geometry.coordinates[1],
      lon: estacao.geometry.coordinates[0],
      type: "station",
      metadata: {
        idEstacao: estacao.properties.idEstacao,
      },
    });
  }

  // Check which locations already have Nominatim data (skip re-geocoding)
  const existingLocs = await ctx.db
    .select({ id: locations.id, metadata: locations.metadata })
    .from(locations);
  const enrichedIds = new Set(
    existingLocs
      .filter((l) => {
        if (!l.metadata) return false;
        try {
          const m = JSON.parse(l.metadata);
          return m.nominatim != null;
        } catch { return false; }
      })
      .map((l) => l.id),
  );

  // Register all locations first
  for (const loc of toRegister) {
    await ctx.registerLocation({
      id: loc.id,
      name: loc.name,
      latitude: loc.lat,
      longitude: loc.lon,
      type: loc.type,
      metadata: loc.metadata,
    });
  }

  // Enrich unenriched locations with Nominatim reverse geocoding
  const needEnrichment = toRegister.filter(
    (l) => !enrichedIds.has(l.id) && !isNaN(l.lat) && !isNaN(l.lon),
  );

  if (needEnrichment.length > 0) {
    ctx.log(`A enriquecer ${needEnrichment.length} locais com dados do Nominatim (OpenStreetMap)...`);

    for (const loc of needEnrichment) {
      const result = await reverseGeocode(loc.lat, loc.lon);
      if (result?.address) {
        const enrichedMetadata = {
          ...loc.metadata,
          nominatim: {
            pais: result.address.country,
            distrito: result.address.state,
            concelho: result.address.county,
            cidade: result.address.city ?? result.address.town ?? result.address.village,
            codigoPostal: result.address.postcode,
            nomeCompleto: result.display_name,
          },
        };
        await ctx.registerLocation({
          id: loc.id,
          name: loc.name,
          latitude: loc.lat,
          longitude: loc.lon,
          type: loc.type,
          metadata: enrichedMetadata,
        });
      }
      // Respect Nominatim TOS: max 1 request per second
      await sleep(1100);
    }

    ctx.log(`Enriquecimento concluído.`);
  }

  ctx.log(`Sincronizados ${locais.data.length} locais, ${costeiros.length} locais costeiros e ${estacoes.length} estações.`);
}

// ---------------------------------------------------------------------------
// Handler: Previsões meteorológicas diárias (agregadas, 3 dias)
// ---------------------------------------------------------------------------

async function obterPrevisoesDiarias(ctx: AdapterContext): Promise<void> {
  ctx.log("A obter previsões meteorológicas diárias (3 dias)...");

  for (let dia = 0; dia <= 2; dia++) {
    const dados = await ipmaFetch(
      URLS.previsaoDiariaPorDia(dia),
      IpmaPrevisaoAgregadaResponseSchema,
    );

    const itens = dados.data.map((item) => {
      const locationId = `ipma-${item.globalIdLocal}`;
      return {
        payload: {
          dataPrevisao: dados.forecastDate,
          globalIdLocal: item.globalIdLocal,
          probabilidadePrecipitacao: item.precipitaProb,
          temperaturaMinima: item.tMin,
          temperaturaMaxima: item.tMax,
          dirVentoPredominante: item.predWindDir,
          idTipoTempo: item.idWeatherType,
          classeIntensidadeVento: item.classWindSpeed,
          classeIntensidadePrecipitacao: item.classPrecInt,
          dataAtualizacao: dados.dataUpdate,
        },
        options: {
          locationId,
          tags: ["meteorologia", "previsao", "diaria", `dia-${dia}`],
          timestamp: new Date(dados.forecastDate),
        },
      };
    });

    await ctx.storeBatchApiData(adaptador.id, "previsao-diaria", itens);
    ctx.log(`Armazenadas ${itens.length} previsões para o dia ${dia} (${dados.forecastDate}).`);
  }
}

// ---------------------------------------------------------------------------
// Handler: Avisos meteorológicos
// ---------------------------------------------------------------------------

async function obterAvisos(ctx: AdapterContext): Promise<void> {
  ctx.log("A obter avisos meteorológicos...");
  const avisos = await ipmaFetch(URLS.avisos, IpmaAvisosResponseSchema);

  // Armazenar apenas avisos ativos (não verdes)
  const ativos = avisos.filter((a) => a.awarenessLevelID !== "green");

  if (ativos.length === 0) {
    ctx.log("Sem avisos ativos.");
    return;
  }

  const itens = ativos.map((a) => ({
    payload: {
      texto: a.text,
      tipoAviso: a.awarenessTypeName,
      idAreaAviso: a.idAreaAviso,
      nivelAviso: a.awarenessLevelID,
      inicio: a.startTime,
      fim: a.endTime,
    },
    options: {
      tags: ["meteorologia", "aviso", a.awarenessLevelID, a.awarenessTypeName.toLowerCase()],
      timestamp: new Date(a.startTime),
    },
  }));

  await ctx.storeBatchApiData(adaptador.id, "aviso-meteorologico", itens);
  ctx.log(`Armazenados ${itens.length} avisos ativos.`);
}

// ---------------------------------------------------------------------------
// Handler: Previsão do estado do mar (3 dias)
// ---------------------------------------------------------------------------

async function obterPrevisoesMar(ctx: AdapterContext): Promise<void> {
  ctx.log("A obter previsões do estado do mar (3 dias)...");

  for (let dia = 0; dia <= 2; dia++) {
    const dados = await ipmaFetch(
      URLS.previsaoMarPorDia(dia),
      IpmaPrevisaoMarResponseSchema,
    );

    const itens = dados.data.map((item) => ({
      payload: {
        dataPrevisao: dados.forecastDate,
        globalIdLocal: item.globalIdLocal,
        periodoOndulacaoMin: item.wavePeriodMin,
        periodoOndulacaoMax: item.wavePeriodMax,
        alturaOndulacaoMin: item.waveHighMin,
        alturaOndulacaoMax: item.waveHighMax,
        dirOndaPredominante: item.predWaveDir,
        alturaSignificativaMin: item.totalSeaMin,
        alturaSignificativaMax: item.totalSeaMax,
        tempSuperficieMarMin: item.sstMin,
        tempSuperficieMarMax: item.sstMax,
        dataAtualizacao: dados.dataUpdate,
      },
      options: {
        locationId: `ipma-mar-${item.globalIdLocal}`,
        tags: ["mar", "previsao", `dia-${dia}`],
        timestamp: new Date(dados.forecastDate),
      },
    }));

    await ctx.storeBatchApiData(adaptador.id, "previsao-mar", itens);
    ctx.log(`Armazenadas ${itens.length} previsões do mar para o dia ${dia}.`);
  }
}

// ---------------------------------------------------------------------------
// Handler: Risco de incêndio (RCM, 2 dias)
// ---------------------------------------------------------------------------

async function obterRiscoIncendio(ctx: AdapterContext): Promise<void> {
  ctx.log("A obter risco de incêndio (RCM)...");

  for (let dia = 0; dia <= 1; dia++) {
    const dados = await ipmaFetch(
      URLS.riscoIncendioPorDia(dia),
      IpmaRiscoIncendioResponseSchema,
    );

    const entradas = Object.entries(dados.local);
    const itens = entradas.map(([_dico, loc]) => ({
      payload: {
        dataPrevisao: dados.dataPrev,
        dico: loc.dico,
        rcm: loc.data.rcm,
        latitude: loc.latitude,
        longitude: loc.longitude,
      },
      options: {
        tags: ["incendio", "risco", `rcm-${loc.data.rcm}`, `dia-${dia}`],
        timestamp: new Date(dados.dataPrev),
      },
    }));

    await ctx.storeBatchApiData(adaptador.id, "risco-incendio", itens);
    ctx.log(`Armazenados ${itens.length} registos de risco de incêndio para o dia ${dia} (${dados.dataPrev}).`);
  }
}

// ---------------------------------------------------------------------------
// Handler: Índice ultravioleta
// ---------------------------------------------------------------------------

async function obterIndiceUv(ctx: AdapterContext): Promise<void> {
  ctx.log("A obter índice ultravioleta...");

  const dados = await ipmaFetch(URLS.indiceUv, IpmaUvResponseSchema);

  const itens = dados.map((item) => ({
    payload: {
      data: item.data,
      globalIdLocal: item.globalIdLocal,
      iUv: item.iUv,
      intervaloHora: item.intervaloHora,
      idPeriodo: item.idPeriodo,
    },
    options: {
      locationId: `ipma-${item.globalIdLocal}`,
      tags: ["uv", "indice"],
      timestamp: new Date(item.data),
    },
  }));

  await ctx.storeBatchApiData(adaptador.id, "indice-uv", itens);
  ctx.log(`Armazenados ${itens.length} registos de índice UV.`);
}

// ---------------------------------------------------------------------------
// Handler: Observações de estações (horárias)
// ---------------------------------------------------------------------------

async function obterObservacoesEstacoes(ctx: AdapterContext): Promise<void> {
  ctx.log("A obter observações de estações meteorológicas...");

  const dados = await ipmaFetch(URLS.observacoesEstacoes, IpmaObservacoesResponseSchema);
  const todosItens: Array<{ payload: unknown; options: { locationId: string; tags: string[]; timestamp: Date } }> = [];

  for (const [dataHora, estacoes] of Object.entries(dados)) {
    for (const [idEstacao, obs] of Object.entries(estacoes)) {
      // Ignorar estações offline (null) ou sem dados (-99.0)
      if (!obs || (obs.temperatura === -99.0 && obs.humidade === -99.0 && obs.pressao === -99.0)) {
        continue;
      }

      todosItens.push({
        payload: {
          dataObservacao: dataHora,
          idEstacao,
          temperatura: obs.temperatura,
          humidade: obs.humidade,
          pressao: obs.pressao,
          intensidadeVento: obs.intensidadeVento,
          intensidadeVentoKM: obs.intensidadeVentoKM,
          idDireccVento: obs.idDireccVento,
          precipitacaoAcumulada: obs.precAcumulada,
          radiacao: obs.radiacao,
        },
        options: {
          locationId: `ipma-estacao-${idEstacao}`,
          tags: ["observacao", "estacao", "horaria"],
          timestamp: new Date(dataHora),
        },
      });
    }
  }

  if (todosItens.length > 0) {
    await ctx.storeBatchApiData(adaptador.id, "observacao-estacao", todosItens);
  }
  ctx.log(`Armazenadas ${todosItens.length} observações de estações.`);
}

// ---------------------------------------------------------------------------
// Rotas personalizadas
// ---------------------------------------------------------------------------

function criarRotasTempo(def: AdapterDefinition) {
  const tag = def.openApiTag ?? def.name;
  const app = new OpenAPIHono<{ Bindings: Env }>();

  // ── GET /previsoes ─────────────────────────────────────────────────────

  const rotaPrevisoes = createRoute({
    method: "get",
    path: "/previsoes",
    tags: [tag],
    summary: "Obter previsões meteorológicas diárias para todos os locais",
    request: {
      query: z.object({
        dia: z
          .string()
          .optional()
          .openapi({ description: "Dia relativo: 0=hoje, 1=amanhã, 2=depois de amanhã (omissão: 0)", example: "0" }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              dataPrevisao: z.string(),
              dataAtualizacao: z.string(),
              dados: z.array(PrevisaoDiariaSchema),
            }),
          },
        },
        description: "Previsões meteorológicas diárias",
      },
    },
  });

  app.use("/previsoes", kvCache({ ttlSeconds: 1800 }));
  app.use("/previsoes", cacheControl(900, 1800));

  app.openapi(rotaPrevisoes, async (c) => {
    const dia = Math.min(Math.max(parseInt(c.req.valid("query").dia ?? "0", 10) || 0, 0), 2);
    const dados = await ipmaFetch(
      URLS.previsaoDiariaPorDia(dia),
      IpmaPrevisaoAgregadaResponseSchema,
    );

    return c.json({
      dataPrevisao: dados.forecastDate,
      dataAtualizacao: dados.dataUpdate,
      dados: dados.data.map((item) => ({
        dataPrevisao: dados.forecastDate,
        localidade: `ipma-${item.globalIdLocal}`,
        globalIdLocal: item.globalIdLocal,
        temperaturaMinima: item.tMin,
        temperaturaMaxima: item.tMax,
        probabilidadePrecipitacao: item.precipitaProb,
        dirVentoPredominante: item.predWindDir,
        idTipoTempo: item.idWeatherType,
        classeIntensidadeVento: item.classWindSpeed,
        classeIntensidadePrecipitacao: item.classPrecInt,
        dataAtualizacao: dados.dataUpdate,
      })),
    });
  });

  // ── GET /previsoes/:globalIdLocal ──────────────────────────────────────

  const rotaPrevisaoLocal = createRoute({
    method: "get",
    path: "/previsoes/{globalIdLocal}",
    tags: [tag],
    summary: "Obter previsão até 5 dias para um local específico",
    request: {
      params: z.object({
        globalIdLocal: z.string().openapi({ description: "Identificador globalIdLocal do IPMA", example: "1110600" }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              globalIdLocal: z.number(),
              dataAtualizacao: z.string(),
              dados: z.array(PrevisaoDiariaSchema),
            }),
          },
        },
        description: "Previsão até 5 dias para o local",
      },
    },
  });

  app.use("/previsoes/:globalIdLocal", kvCache({ ttlSeconds: 1800 }));
  app.use("/previsoes/:globalIdLocal", cacheControl(900, 1800));

  app.openapi(rotaPrevisaoLocal, async (c) => {
    const { globalIdLocal } = c.req.valid("param");
    const id = parseInt(globalIdLocal, 10);
    const res = await fetch(URLS.previsaoDiariaPorLocal(id));
    if (!res.ok) {
      throw new HTTPException(404, { message: `Local ${globalIdLocal} não encontrado ou erro na API upstream` });
    }
    const raw = await res.json() as Record<string, unknown>;

    return c.json({
      globalIdLocal: id,
      dataAtualizacao: raw.dataUpdate as string,
      dados: (raw.data as Array<Record<string, unknown>>).map((item) => ({
        dataPrevisao: item.forecastDate as string,
        localidade: `ipma-${id}`,
        globalIdLocal: id,
        temperaturaMinima: item.tMin as string,
        temperaturaMaxima: item.tMax as string,
        probabilidadePrecipitacao: item.precipitaProb as string,
        dirVentoPredominante: item.predWindDir as string,
        idTipoTempo: item.idWeatherType as number,
        classeIntensidadeVento: item.classWindSpeed as number,
        classeIntensidadePrecipitacao: item.classPrecInt as number | undefined,
        dataAtualizacao: raw.dataUpdate as string,
      })),
    });
  });

  // ── GET /avisos ────────────────────────────────────────────────────────

  const rotaAvisos = createRoute({
    method: "get",
    path: "/avisos",
    tags: [tag],
    summary: "Obter avisos meteorológicos ativos (até 3 dias)",
    request: {
      query: z.object({
        nivel: z
          .enum(["yellow", "orange", "red"])
          .optional()
          .openapi({ description: "Filtrar por nível de aviso" }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number(),
              dados: z.array(AvisoMeteorologicoSchema),
            }),
          },
        },
        description: "Avisos meteorológicos ativos",
      },
    },
  });

  app.use("/avisos", kvCache({ ttlSeconds: 600 }));
  app.use("/avisos", cacheControl(300, 600));

  app.openapi(rotaAvisos, async (c) => {
    const { nivel } = c.req.valid("query");
    const avisos = await ipmaFetch(URLS.avisos, IpmaAvisosResponseSchema);
    let ativos = avisos.filter((a) => a.awarenessLevelID !== "green");
    if (nivel) {
      ativos = ativos.filter((a) => a.awarenessLevelID === nivel);
    }

    return c.json({
      total: ativos.length,
      dados: ativos.map((a) => ({
        texto: a.text,
        tipoAviso: a.awarenessTypeName,
        nivelAviso: a.awarenessLevelID,
        idAreaAviso: a.idAreaAviso,
        inicio: a.startTime,
        fim: a.endTime,
      })),
    });
  });

  // ── GET /mar ───────────────────────────────────────────────────────────

  const rotaMar = createRoute({
    method: "get",
    path: "/mar",
    tags: [tag],
    summary: "Obter previsão do estado do mar para todos os locais costeiros",
    request: {
      query: z.object({
        dia: z
          .string()
          .optional()
          .openapi({ description: "Dia relativo: 0=hoje, 1=amanhã, 2=depois de amanhã (omissão: 0)" }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              dataPrevisao: z.string(),
              dataAtualizacao: z.string(),
              dados: z.array(PrevisaoMarSchema),
            }),
          },
        },
        description: "Previsões do estado do mar",
      },
    },
  });

  app.use("/mar", kvCache({ ttlSeconds: 1800 }));
  app.use("/mar", cacheControl(900, 1800));

  app.openapi(rotaMar, async (c) => {
    const dia = Math.min(Math.max(parseInt(c.req.valid("query").dia ?? "0", 10) || 0, 0), 2);
    const dados = await ipmaFetch(URLS.previsaoMarPorDia(dia), IpmaPrevisaoMarResponseSchema);

    return c.json({
      dataPrevisao: dados.forecastDate,
      dataAtualizacao: dados.dataUpdate,
      dados: dados.data.map((item) => ({
        dataPrevisao: dados.forecastDate,
        localidade: `ipma-mar-${item.globalIdLocal}`,
        globalIdLocal: item.globalIdLocal,
        periodoOndulacaoMin: item.wavePeriodMin,
        periodoOndulacaoMax: item.wavePeriodMax,
        alturaOndulacaoMin: item.waveHighMin,
        alturaOndulacaoMax: item.waveHighMax,
        dirOndaPredominante: item.predWaveDir,
        alturaSignificativaMin: item.totalSeaMin,
        alturaSignificativaMax: item.totalSeaMax,
        tempSuperficieMarMin: item.sstMin,
        tempSuperficieMarMax: item.sstMax,
        dataAtualizacao: dados.dataUpdate,
      })),
    });
  });

  // ── GET /risco-incendio ────────────────────────────────────────────────

  const rotaRiscoIncendio = createRoute({
    method: "get",
    path: "/risco-incendio",
    tags: [tag],
    summary: "Obter índice de risco de incêndio (RCM) por concelho",
    request: {
      query: z.object({
        dia: z
          .string()
          .optional()
          .openapi({ description: "Dia relativo: 0=hoje, 1=amanhã (omissão: 0)" }),
        riscoMinimo: z
          .string()
          .optional()
          .openapi({ description: "Nível mínimo de risco a incluir (1-5, omissão: 1)" }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              dataPrevisao: z.string(),
              total: z.number(),
              dados: z.array(RiscoIncendioSchema),
            }),
          },
        },
        description: "Risco de incêndio por concelho",
      },
    },
  });

  app.use("/risco-incendio", kvCache({ ttlSeconds: 3600 }));
  app.use("/risco-incendio", cacheControl(1800, 3600));

  app.openapi(rotaRiscoIncendio, async (c) => {
    const dia = Math.min(Math.max(parseInt(c.req.valid("query").dia ?? "0", 10) || 0, 0), 1);
    const riscoMinimo = parseInt(c.req.valid("query").riscoMinimo ?? "1", 10) || 1;
    const dados = await ipmaFetch(URLS.riscoIncendioPorDia(dia), IpmaRiscoIncendioResponseSchema);

    let entradas = Object.values(dados.local).map((loc) => ({
      dataPrevisao: dados.dataPrev,
      dico: loc.dico,
      rcm: loc.data.rcm,
      latitude: loc.latitude,
      longitude: loc.longitude,
    }));

    if (riscoMinimo > 1) {
      entradas = entradas.filter((e) => e.rcm >= riscoMinimo);
    }

    return c.json({
      dataPrevisao: dados.dataPrev,
      total: entradas.length,
      dados: entradas,
    });
  });

  // ── GET /uv ────────────────────────────────────────────────────────────

  const rotaUv = createRoute({
    method: "get",
    path: "/uv",
    tags: [tag],
    summary: "Obter previsão do índice ultravioleta",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number(),
              dados: z.array(IndiceUvSchema),
            }),
          },
        },
        description: "Previsão do índice ultravioleta",
      },
    },
  });

  app.use("/uv", kvCache({ ttlSeconds: 3600 }));
  app.use("/uv", cacheControl(1800, 3600));

  app.openapi(rotaUv, async (c) => {
    const dados = await ipmaFetch(URLS.indiceUv, IpmaUvResponseSchema);

    return c.json({
      total: dados.length,
      dados: dados.map((item) => ({
        data: item.data,
        globalIdLocal: item.globalIdLocal,
        iUv: item.iUv,
        intervaloHora: item.intervaloHora,
        idPeriodo: item.idPeriodo,
      })),
    });
  });

  // ── GET /observacoes ───────────────────────────────────────────────────

  const rotaObservacoes = createRoute({
    method: "get",
    path: "/observacoes",
    tags: [tag],
    summary: "Obter observações meteorológicas mais recentes (últimas 24 horas)",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number(),
              dados: z.array(ObservacaoEstacaoSchema),
            }),
          },
        },
        description: "Observações de estações meteorológicas (horárias, últimas 24h)",
      },
    },
  });

  app.use("/observacoes", kvCache({ ttlSeconds: 600 }));
  app.use("/observacoes", cacheControl(300, 600));

  app.openapi(rotaObservacoes, async (c) => {
    const dados = await ipmaFetch(URLS.observacoesEstacoes, IpmaObservacoesResponseSchema);

    const itens: Array<z.infer<typeof ObservacaoEstacaoSchema>> = [];
    for (const [dataHora, estacoes] of Object.entries(dados)) {
      for (const [idEstacao, obs] of Object.entries(estacoes)) {
        if (!obs || (obs.temperatura === -99.0 && obs.humidade === -99.0 && obs.pressao === -99.0)) continue;
        itens.push({
          dataObservacao: dataHora,
          idEstacao,
          localidade: `ipma-estacao-${idEstacao}`,
          temperatura: obs.temperatura,
          humidade: obs.humidade,
          pressao: obs.pressao,
          intensidadeVento: obs.intensidadeVento,
          intensidadeVentoKM: obs.intensidadeVentoKM,
          idDireccVento: obs.idDireccVento,
          precipitacaoAcumulada: obs.precAcumulada,
          radiacao: obs.radiacao,
        });
      }
    }

    return c.json({ total: itens.length, dados: itens });
  });

  // ── GET /referencia/tipos-tempo ────────────────────────────────────────

  const rotaTiposTempo = createRoute({
    method: "get",
    path: "/referencia/tipos-tempo",
    tags: [tag],
    summary: "Listar códigos e descrições dos tipos de tempo",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ dados: z.array(TipoTempoRefSchema) }),
          },
        },
        description: "Dados de referência dos tipos de tempo",
      },
    },
  });

  app.use("/referencia/tipos-tempo", kvCache({ ttlSeconds: 86400 }));
  app.use("/referencia/tipos-tempo", cacheControl(43200, 86400));

  app.openapi(rotaTiposTempo, async (c) => {
    const dados = await ipmaFetch(URLS.tiposTempo, IpmaTiposTempoResponseSchema);
    return c.json({
      dados: dados.data.map((t) => ({
        idTipoTempo: t.idWeatherType,
        descricaoPT: t.descWeatherTypePT,
        descricaoEN: t.descWeatherTypeEN,
      })),
    });
  });

  // ── GET /referencia/classes-vento ──────────────────────────────────────

  const rotaClassesVento = createRoute({
    method: "get",
    path: "/referencia/classes-vento",
    tags: [tag],
    summary: "Listar códigos e descrições das classes de intensidade do vento",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ dados: z.array(ClasseVentoRefSchema) }),
          },
        },
        description: "Dados de referência das classes de vento",
      },
    },
  });

  app.use("/referencia/classes-vento", kvCache({ ttlSeconds: 86400 }));
  app.use("/referencia/classes-vento", cacheControl(43200, 86400));

  app.openapi(rotaClassesVento, async (c) => {
    const dados = await ipmaFetch(URLS.classesVento, IpmaClassesVentoResponseSchema);
    return c.json({
      dados: dados.data.map((v) => ({
        classeVento: v.classWindSpeed,
        descricaoPT: v.descClassWindSpeedPT,
        descricaoEN: v.descClassWindSpeedEN,
      })),
    });
  });

  // ── GET /referencia/classes-precipitacao ────────────────────────────────

  const rotaClassesPrecip = createRoute({
    method: "get",
    path: "/referencia/classes-precipitacao",
    tags: [tag],
    summary: "Listar códigos e descrições das classes de intensidade de precipitação",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ dados: z.array(ClassePrecipitacaoRefSchema) }),
          },
        },
        description: "Dados de referência das classes de precipitação",
      },
    },
  });

  app.use("/referencia/classes-precipitacao", kvCache({ ttlSeconds: 86400 }));
  app.use("/referencia/classes-precipitacao", cacheControl(43200, 86400));

  app.openapi(rotaClassesPrecip, async (c) => {
    const dados = await ipmaFetch(URLS.classesPrecipitacao, IpmaClassesPrecipResponseSchema);
    return c.json({
      dados: dados.data.map((p) => ({
        classePrecipitacao: p.classPrecInt,
        descricaoPT: p.descClassPrecIntPT,
        descricaoEN: p.descClassPrecIntEN,
      })),
    });
  });

  // ── GET /referencia/locais ─────────────────────────────────────────────

  const rotaLocaisRef = createRoute({
    method: "get",
    path: "/referencia/locais",
    tags: [tag],
    summary: "Listar locais de previsão do IPMA (capitais de distrito e ilhas)",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ dados: z.array(LocalIpmaRefSchema) }),
          },
        },
        description: "Locais de previsão do IPMA",
      },
    },
  });

  app.use("/referencia/locais", kvCache({ ttlSeconds: 86400 }));
  app.use("/referencia/locais", cacheControl(43200, 86400));

  app.openapi(rotaLocaisRef, async (c) => {
    const dados = await ipmaFetch(URLS.locais, IpmaLocaisResponseSchema);
    return c.json({
      dados: dados.data.map((l) => ({
        globalIdLocal: l.globalIdLocal,
        local: l.local,
        idRegiao: l.idRegiao,
        idDistrito: l.idDistrito,
        idConcelho: l.idConcelho,
        idAreaAviso: l.idAreaAviso,
        latitude: l.latitude,
        longitude: l.longitude,
      })),
    });
  });

  // ── GET /referencia/estacoes ───────────────────────────────────────────

  const rotaEstacoesRef = createRoute({
    method: "get",
    path: "/referencia/estacoes",
    tags: [tag],
    summary: "Listar estações meteorológicas de observação",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ dados: z.array(EstacaoRefSchema) }),
          },
        },
        description: "Estações meteorológicas",
      },
    },
  });

  app.use("/referencia/estacoes", kvCache({ ttlSeconds: 86400 }));
  app.use("/referencia/estacoes", cacheControl(43200, 86400));

  app.openapi(rotaEstacoesRef, async (c) => {
    const dados = await ipmaFetch(URLS.estacoes, IpmaEstacoesResponseSchema);
    return c.json({
      dados: dados.map((e) => ({
        idEstacao: e.properties.idEstacao,
        localEstacao: e.properties.localEstacao,
        latitude: e.geometry.coordinates[1],
        longitude: e.geometry.coordinates[0],
      })),
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Definição do adaptador
// ---------------------------------------------------------------------------

const adaptador: AdapterDefinition = {
  id: "tempo",
  name: "Tempo (IPMA)",
  description:
    "Previsões meteorológicas, avisos, estado do mar, risco de incêndio, índice ultravioleta e observações de estações do IPMA (Instituto Português do Mar e da Atmosfera).",
  sourceUrl: "https://api.ipma.pt/",
  dataTypes: ["api_data"],

  openApiTag: "Tempo (IPMA)",

  schedules: [
    {
      frequency: "daily",
      handler: sincronizarLocais,
      description: "Sincronizar locais, locais costeiros e estações meteorológicas do IPMA",
    },
    {
      frequency: "hourly",
      handler: obterPrevisoesDiarias,
      description: "Obter previsões meteorológicas diárias (3 dias, todos os locais)",
    },
    {
      frequency: "hourly",
      handler: obterAvisos,
      description: "Obter avisos meteorológicos ativos",
    },
    {
      frequency: "hourly",
      handler: obterPrevisoesMar,
      description: "Obter previsões do estado do mar (3 dias)",
    },
    {
      frequency: "hourly",
      handler: obterRiscoIncendio,
      description: "Obter índice de risco de incêndio (RCM, 2 dias)",
    },
    {
      frequency: "hourly",
      handler: obterIndiceUv,
      description: "Obter previsão do índice ultravioleta",
    },
    {
      frequency: "hourly",
      handler: obterObservacoesEstacoes,
      description: "Obter observações horárias das estações meteorológicas (últimas 24h)",
    },
  ],
};

adaptador.routes = criarRotasTempo(adaptador);

registry.register(adaptador);

export default adaptador;
