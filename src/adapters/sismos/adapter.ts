/**
 * ─── Adaptador Sismos (IPMA) ───────────────────────────────────────────────
 *
 * Obtém dados de atividade sísmica a partir da API aberta do IPMA
 * (Instituto Português do Mar e da Atmosfera).
 *
 * Fontes de dados:
 *   - Sismos em Portugal Continental e Madeira (últimos 30 dias)
 *   - Sismos no Arquipélago dos Açores (últimos 30 dias)
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AdapterDefinition, AdapterContext } from "../../core/adapter";
import { registry } from "../../core/registry";
import { kvCache, cacheControl } from "../../core/cache";
import {
  IpmaSismosResponseSchema,
  SismoSchema,
  type IpmaSismoEvento,
  type SismoPayload,
} from "./types";

// ---------------------------------------------------------------------------
// URLs da API do IPMA — Sismologia
// ---------------------------------------------------------------------------

const BASE = "https://api.ipma.pt/open-data";

const URLS = {
  /** Portugal Continental + Madeira (últimos 30 dias) */
  continentalMadeira: `${BASE}/observation/seismic/7.json`,
  /** Arquipélago dos Açores (últimos 30 dias) */
  acores: `${BASE}/observation/seismic/3.json`,
};

const AREAS = [
  { url: URLS.continentalMadeira, nome: "Continental e Madeira", tag: "continental" },
  { url: URLS.acores, nome: "Açores", tag: "acores" },
];

// ---------------------------------------------------------------------------
// Auxiliar: fetch seguro com validação
// ---------------------------------------------------------------------------

async function ipmaFetch(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API do IPMA devolveu ${res.status} para ${url}`);
  }
  const raw = await res.json();
  return IpmaSismosResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Conversão: evento upstream → payload normalizado
// ---------------------------------------------------------------------------

function converterEvento(ev: IpmaSismoEvento): SismoPayload | null {
  const magnitude = parseFloat(ev.magnitud);
  // Filtrar eventos sem magnitude válida
  if (isNaN(magnitude) || magnitude <= -99) return null;

  const lat = parseFloat(ev.lat);
  const lon = parseFloat(ev.lon);
  if (isNaN(lat) || isNaN(lon)) return null;

  return {
    sismoId: ev.sismoId || `${ev.time}-${lat}-${lon}`,
    dataEvento: ev.time,
    latitude: lat,
    longitude: lon,
    profundidade: ev.depth,
    magnitude,
    tipoMagnitude: ev.magType,
    regiao: ev.obsRegion,
    intensidade: typeof ev.degree === "string" ? ev.degree : ev.degree != null ? String(ev.degree) : null,
    sentido: ev.sensed === true,
    localSentido: ev.local ?? null,
    fonte: ev.source,
    shakemapUrl: ev.shakemapref || null,
  };
}

// ---------------------------------------------------------------------------
// Handler de agendamento: Obter atividade sísmica
// ---------------------------------------------------------------------------

async function obterSismos(ctx: AdapterContext): Promise<void> {
  ctx.log("A obter atividade sísmica...");

  for (const area of AREAS) {
    const dados = await ipmaFetch(area.url);
    const itens: Array<{ payload: SismoPayload; options: { tags: string[]; timestamp: Date } }> = [];

    for (const ev of dados.data) {
      const payload = converterEvento(ev);
      if (!payload) continue;

      itens.push({
        payload,
        options: {
          tags: ["sismologia", area.tag, payload.sentido ? "sentido" : "nao-sentido"],
          timestamp: new Date(payload.dataEvento),
        },
      });
    }

    if (itens.length > 0) {
      await ctx.storeBatchApiData(adaptador.id, "sismo", itens);
    }
    ctx.log(`Armazenados ${itens.length} sismos (${area.nome}).`);
  }
}

// ---------------------------------------------------------------------------
// Rotas personalizadas
// ---------------------------------------------------------------------------

function criarRotasSismos(def: AdapterDefinition) {
  const tag = def.openApiTag ?? def.name;
  const app = new OpenAPIHono<{ Bindings: Env }>();

  // ── GET /recentes ──────────────────────────────────────────────────────

  const rotaRecentes = createRoute({
    method: "get",
    path: "/recentes",
    tags: [tag],
    summary: "Obter sismos recentes (últimos 30 dias)",
    request: {
      query: z.object({
        area: z
          .enum(["todos", "continental", "acores"])
          .optional()
          .openapi({ description: "Filtrar por área geográfica (omissão: todos)", example: "todos" }),
        magnitudeMinima: z
          .string()
          .optional()
          .openapi({ description: "Magnitude mínima a incluir (ex.: 2.0)", example: "2.0" }),
        limite: z.coerce
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .openapi({ description: "Número máximo de resultados", example: 100 }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number(),
              dados: z.array(SismoSchema),
            }),
          },
        },
        description: "Sismos recentes",
      },
    },
  });

  app.use("/recentes", kvCache({ ttlSeconds: 600 }));
  app.use("/recentes", cacheControl(300, 600));

  app.openapi(rotaRecentes, async (c) => {
    const { area, magnitudeMinima, limite } = c.req.valid("query");
    const minMag = magnitudeMinima ? parseFloat(magnitudeMinima) : 0;

    const urls = area === "continental"
      ? [URLS.continentalMadeira]
      : area === "acores"
        ? [URLS.acores]
        : [URLS.continentalMadeira, URLS.acores];

    const results = await Promise.all(urls.map(ipmaFetch));
    const todos: SismoPayload[] = [];

    for (const dados of results) {
      for (const ev of dados.data) {
        const payload = converterEvento(ev);
        if (payload && payload.magnitude >= minMag) {
          todos.push(payload);
        }
      }
    }

    // Ordenar por data (mais recente primeiro)
    todos.sort((a, b) => new Date(b.dataEvento).getTime() - new Date(a.dataEvento).getTime());

    const limitados = todos.slice(0, limite);

    return c.json({
      total: limitados.length,
      dados: limitados,
    });
  });

  // ── GET /sentidos ──────────────────────────────────────────────────────

  const rotaSentidos = createRoute({
    method: "get",
    path: "/sentidos",
    tags: [tag],
    summary: "Obter sismos sentidos pela população (últimos 30 dias)",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number(),
              dados: z.array(SismoSchema),
            }),
          },
        },
        description: "Sismos sentidos pela população",
      },
    },
  });

  app.use("/sentidos", kvCache({ ttlSeconds: 600 }));
  app.use("/sentidos", cacheControl(300, 600));

  app.openapi(rotaSentidos, async (c) => {
    const results = await Promise.all([
      ipmaFetch(URLS.continentalMadeira),
      ipmaFetch(URLS.acores),
    ]);

    const sentidos: SismoPayload[] = [];
    for (const dados of results) {
      for (const ev of dados.data) {
        const payload = converterEvento(ev);
        if (payload && payload.sentido) {
          sentidos.push(payload);
        }
      }
    }

    sentidos.sort((a, b) => new Date(b.dataEvento).getTime() - new Date(a.dataEvento).getTime());

    return c.json({
      total: sentidos.length,
      dados: sentidos,
    });
  });

  // ── GET /resumo ────────────────────────────────────────────────────────

  const rotaResumo = createRoute({
    method: "get",
    path: "/resumo",
    tags: [tag],
    summary: "Resumo da atividade sísmica recente",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              ultimaAtualizacao: z.string(),
              totalEventos: z.number(),
              eventosSentidos: z.number(),
              magnitudeMaxima: z.number().nullable(),
              profundidadeMedia: z.number(),
              areas: z.array(
                z.object({
                  nome: z.string(),
                  totalEventos: z.number(),
                  ultimaAtividade: z.string(),
                }),
              ),
            }),
          },
        },
        description: "Resumo estatístico da atividade sísmica",
      },
    },
  });

  app.use("/resumo", kvCache({ ttlSeconds: 600 }));
  app.use("/resumo", cacheControl(300, 600));

  app.openapi(rotaResumo, async (c) => {
    const results = await Promise.all([
      ipmaFetch(URLS.continentalMadeira),
      ipmaFetch(URLS.acores),
    ]);

    let totalEventos = 0;
    let eventosSentidos = 0;
    let magnitudeMaxima: number | null = null;
    let somaProf = 0;
    let contProf = 0;
    let ultimaAtualizacao = "";

    const areas = results.map((dados, i) => {
      let areaTotal = 0;
      for (const ev of dados.data) {
        const payload = converterEvento(ev);
        if (!payload) continue;
        areaTotal++;
        totalEventos++;
        if (payload.sentido) eventosSentidos++;
        if (magnitudeMaxima === null || payload.magnitude > magnitudeMaxima) {
          magnitudeMaxima = payload.magnitude;
        }
        somaProf += payload.profundidade;
        contProf++;
      }
      if (dados.updateDate > ultimaAtualizacao) {
        ultimaAtualizacao = dados.updateDate;
      }
      return {
        nome: AREAS[i].nome,
        totalEventos: areaTotal,
        ultimaAtividade: dados.lastSismicActivityDate,
      };
    });

    return c.json({
      ultimaAtualizacao,
      totalEventos,
      eventosSentidos,
      magnitudeMaxima,
      profundidadeMedia: contProf > 0 ? Math.round((somaProf / contProf) * 10) / 10 : 0,
      areas,
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Definição do adaptador
// ---------------------------------------------------------------------------

const adaptador: AdapterDefinition = {
  id: "sismos",
  name: "Sismos (IPMA)",
  description:
    "Atividade sísmica em Portugal Continental, Madeira e Açores — dados dos últimos 30 dias do IPMA (Instituto Português do Mar e da Atmosfera).",
  sourceUrl: "https://api.ipma.pt/",
  dataTypes: ["api_data"],

  openApiTag: "Sismos (IPMA)",

  features: { hasLocations: false },

  schedules: [
    {
      frequency: "hourly",
      handler: obterSismos,
      description: "Obter atividade sísmica recente (Continental, Madeira e Açores)",
    },
  ],
};

adaptador.routes = criarRotasSismos(adaptador);

registry.register(adaptador);

export default adaptador;
