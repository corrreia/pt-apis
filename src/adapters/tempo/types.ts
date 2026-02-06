/**
 * ─── Tipos do Adaptador Tempo (IPMA) ─────────────────────────────────────
 *
 * Schemas upstream, interfaces de payload e schemas de resposta da API
 * para o adaptador meteorológico do IPMA (Instituto Português do Mar e
 * da Atmosfera).
 *
 * Abrange:
 *   - Previsões meteorológicas diárias (até 5 dias por local)
 *   - Previsões diárias agregadas (dia 0/1/2)
 *   - Avisos meteorológicos (até 3 dias)
 *   - Previsão do estado do mar (até 3 dias)
 *   - Risco de incêndio / RCM (até 2 dias)
 *   - Índice ultravioleta (até 3 dias)
 *   - Observações de estações meteorológicas (horárias, últimas 24h)
 *   - Listas de referência auxiliares (locais, tipos de tempo, vento, precipitação)
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { z } from "@hono/zod-openapi";

// ===========================================================================
// 1. Schemas das respostas da API upstream
// ===========================================================================

// ─── Locais / Distritos / Ilhas ──────────────────────────────────────────

export const IpmaLocalSchema = z.object({
  idRegiao: z.number(),
  idAreaAviso: z.string(),
  idConcelho: z.number(),
  globalIdLocal: z.number(),
  latitude: z.string(),
  idDistrito: z.number(),
  local: z.string(),
  longitude: z.string(),
});

export const IpmaLocaisResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  data: z.array(IpmaLocalSchema),
});

export type IpmaLocal = z.infer<typeof IpmaLocalSchema>;

// ─── Locais Costeiros ────────────────────────────────────────────────────

export const IpmaLocalCosteirSchema = z.object({
  idRegiao: z.number(),
  idAreaAviso: z.string(),
  globalIdLocal: z.number(),
  idLocal: z.number(),
  latitude: z.string(),
  local: z.string(),
  longitude: z.string(),
});

export const IpmaLocaisCosteirosResponseSchema = z.array(IpmaLocalCosteirSchema);

export type IpmaLocalCosteir = z.infer<typeof IpmaLocalCosteirSchema>;

// ─── Classes de Tipo de Tempo ────────────────────────────────────────────

export const IpmaTipoTempoSchema = z.object({
  descWeatherTypeEN: z.string(),
  descWeatherTypePT: z.string(),
  idWeatherType: z.number(),
});

export const IpmaTiposTempoResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  data: z.array(IpmaTipoTempoSchema),
});

export type IpmaTipoTempo = z.infer<typeof IpmaTipoTempoSchema>;

// ─── Classes de Intensidade do Vento ─────────────────────────────────────

export const IpmaClasseVentoSchema = z.object({
  descClassWindSpeedEN: z.string(),
  descClassWindSpeedPT: z.string(),
  classWindSpeed: z.string(),
});

export const IpmaClassesVentoResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  data: z.array(IpmaClasseVentoSchema),
});

export type IpmaClasseVento = z.infer<typeof IpmaClasseVentoSchema>;

// ─── Classes de Intensidade de Precipitação ──────────────────────────────

export const IpmaClassePrecipSchema = z.object({
  descClassPrecIntEN: z.string(),
  descClassPrecIntPT: z.string(),
  classPrecInt: z.string(),
});

export const IpmaClassesPrecipResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  data: z.array(IpmaClassePrecipSchema),
});

export type IpmaClassePrecip = z.infer<typeof IpmaClassePrecipSchema>;

// ─── Estações Meteorológicas ─────────────────────────────────────────────

export const IpmaEstacaoSchema = z.object({
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  type: z.literal("Feature"),
  properties: z.object({
    idEstacao: z.number(),
    localEstacao: z.string(),
  }),
});

export const IpmaEstacoesResponseSchema = z.array(IpmaEstacaoSchema);

export type IpmaEstacao = z.infer<typeof IpmaEstacaoSchema>;

// ─── Previsão Diária (por local, até 5 dias) ────────────────────────────

export const IpmaPrevisaoDiariaItemSchema = z.object({
  precipitaProb: z.string(),
  tMin: z.string(),
  tMax: z.string(),
  predWindDir: z.string(),
  idWeatherType: z.number(),
  classWindSpeed: z.number(),
  classPrecInt: z.number().optional(),
  longitude: z.string(),
  forecastDate: z.string(),
  latitude: z.string(),
});

export const IpmaPrevisaoDiariaResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  data: z.array(IpmaPrevisaoDiariaItemSchema),
  globalIdLocal: z.number(),
  dataUpdate: z.string(),
});

export type IpmaPrevisaoDiariaItem = z.infer<typeof IpmaPrevisaoDiariaItemSchema>;

// ─── Previsão Diária Agregada (todos os locais, por dia) ─────────────────

export const IpmaPrevisaoAgregadaItemSchema = z.object({
  precipitaProb: z.string(),
  tMin: z.string(),
  tMax: z.string(),
  predWindDir: z.string(),
  idWeatherType: z.number(),
  classWindSpeed: z.number(),
  classPrecInt: z.number().optional(),
  longitude: z.string(),
  globalIdLocal: z.number(),
  latitude: z.string(),
});

export const IpmaPrevisaoAgregadaResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  forecastDate: z.string(),
  data: z.array(IpmaPrevisaoAgregadaItemSchema),
  dataUpdate: z.string(),
});

export type IpmaPrevisaoAgregadaItem = z.infer<typeof IpmaPrevisaoAgregadaItemSchema>;

// ─── Avisos Meteorológicos ───────────────────────────────────────────────

export const IpmaAvisoSchema = z.object({
  text: z.string(),
  awarenessTypeName: z.string(),
  idAreaAviso: z.string(),
  startTime: z.string(),
  awarenessLevelID: z.string(),
  endTime: z.string(),
});

export const IpmaAvisosResponseSchema = z.array(IpmaAvisoSchema);

export type IpmaAviso = z.infer<typeof IpmaAvisoSchema>;

// ─── Previsão do Estado do Mar ───────────────────────────────────────────

export const IpmaPrevisaoMarItemSchema = z.object({
  wavePeriodMin: z.string(),
  globalIdLocal: z.number(),
  totalSeaMax: z.number(),
  waveHighMax: z.string(),
  waveHighMin: z.string(),
  longitude: z.string(),
  wavePeriodMax: z.string(),
  latitude: z.string(),
  totalSeaMin: z.number(),
  sstMax: z.string(),
  predWaveDir: z.string(),
  sstMin: z.string(),
});

export const IpmaPrevisaoMarResponseSchema = z.object({
  owner: z.string(),
  country: z.string(),
  forecastDate: z.string(),
  data: z.array(IpmaPrevisaoMarItemSchema),
  dataUpdate: z.string(),
});

export type IpmaPrevisaoMarItem = z.infer<typeof IpmaPrevisaoMarItemSchema>;

// ─── Risco de Incêndio (RCM) ────────────────────────────────────────────

export const IpmaRiscoIncendioLocalSchema = z.object({
  data: z.object({
    rcm: z.number(),
  }),
  DICO: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

export const IpmaRiscoIncendioResponseSchema = z.object({
  dataPrev: z.string(),
  dataRun: z.string(),
  fileDate: z.string(),
  local: z.record(z.string(), IpmaRiscoIncendioLocalSchema),
});

export type IpmaRiscoIncendioLocal = z.infer<typeof IpmaRiscoIncendioLocalSchema>;

// ─── Índice Ultravioleta ─────────────────────────────────────────────────

export const IpmaUvItemSchema = z.object({
  idPeriodo: z.number(),
  intervaloHora: z.string(),
  data: z.string(),
  globalIdLocal: z.number(),
  iUv: z.string(),
});

export const IpmaUvResponseSchema = z.array(IpmaUvItemSchema);

export type IpmaUvItem = z.infer<typeof IpmaUvItemSchema>;

// ─── Observações de Estações (últimas 24h) ───────────────────────────────

export const IpmaObservacaoSchema = z.object({
  intensidadeVentoKM: z.number(),
  temperatura: z.number(),
  idDireccVento: z.number(),
  precAcumulada: z.number(),
  intensidadeVento: z.number(),
  humidade: z.number(),
  pressao: z.number(),
  radiacao: z.number(),
});

/** Resposta em bruto: { "YYYY-mm-ddThh:mi": { "idEstacao": { ... } } } */
export const IpmaObservacoesResponseSchema = z.record(
  z.string(),
  z.record(z.string(), IpmaObservacaoSchema),
);

export type IpmaObservacao = z.infer<typeof IpmaObservacaoSchema>;

// ===========================================================================
// 2. Interfaces de payload (conteúdo de api_data.payload)
// ===========================================================================

/** Payload para payload_type = "previsao-diaria" */
export interface PrevisaoDiariaPayload {
  dataPrevisao: string;
  globalIdLocal: number;
  probabilidadePrecipitacao: string;
  temperaturaMinima: string;
  temperaturaMaxima: string;
  dirVentoPredominante: string;
  idTipoTempo: number;
  classeIntensidadeVento: number;
  classeIntensidadePrecipitacao?: number;
  dataAtualizacao: string;
}

/** Payload para payload_type = "aviso-meteorologico" */
export interface AvisoMeteorologicoPayload {
  texto: string;
  tipoAviso: string;
  idAreaAviso: string;
  nivelAviso: string;
  inicio: string;
  fim: string;
}

/** Payload para payload_type = "previsao-mar" */
export interface PrevisaoMarPayload {
  dataPrevisao: string;
  globalIdLocal: number;
  periodoOndulacaoMin: string;
  periodoOndulacaoMax: string;
  alturaOndulacaoMin: string;
  alturaOndulacaoMax: string;
  dirOndaPredominante: string;
  alturaSignificativaMin: number;
  alturaSignificativaMax: number;
  tempSuperficieMarMin: string;
  tempSuperficieMarMax: string;
  dataAtualizacao: string;
}

/** Payload para payload_type = "risco-incendio" */
export interface RiscoIncendioPayload {
  dataPrevisao: string;
  dico: string;
  rcm: number;
  latitude: number;
  longitude: number;
}

/** Payload para payload_type = "indice-uv" */
export interface IndiceUvPayload {
  data: string;
  globalIdLocal: number;
  iUv: string;
  intervaloHora: string;
  idPeriodo: number;
}

/** Payload para payload_type = "observacao-estacao" */
export interface ObservacaoEstacaoPayload {
  dataObservacao: string;
  idEstacao: string;
  temperatura: number;
  humidade: number;
  pressao: number;
  intensidadeVento: number;
  intensidadeVentoKM: number;
  idDireccVento: number;
  precipitacaoAcumulada: number;
  radiacao: number;
}

// ===========================================================================
// 3. Schemas de resposta da API (para rotas Hono / documentação OpenAPI)
// ===========================================================================

export const PrevisaoDiariaSchema = z
  .object({
    dataPrevisao: z.string().openapi({ description: "Data da previsão (AAAA-MM-DD)" }),
    localidade: z.string().nullable().openapi({ description: "Identificador do local (slug)" }),
    globalIdLocal: z.number().openapi({ description: "Identificador do local no IPMA" }),
    temperaturaMinima: z.string().openapi({ description: "Temperatura mínima (°C)", example: "7.6" }),
    temperaturaMaxima: z.string().openapi({ description: "Temperatura máxima (°C)", example: "13.3" }),
    probabilidadePrecipitacao: z.string().openapi({ description: "Probabilidade de precipitação (%)", example: "0.0" }),
    dirVentoPredominante: z.string().openapi({ description: "Rumo predominante do vento", example: "N" }),
    idTipoTempo: z.number().openapi({ description: "Código do tipo de tempo significativo" }),
    classeIntensidadeVento: z.number().openapi({ description: "Classe da intensidade do vento" }),
    classeIntensidadePrecipitacao: z.number().optional().openapi({ description: "Classe da intensidade da precipitação" }),
    dataAtualizacao: z.string().openapi({ description: "Data/hora de atualização dos dados (ISO 8601)" }),
  })
  .openapi("PrevisaoDiaria");

export const AvisoMeteorologicoSchema = z
  .object({
    texto: z.string().openapi({ description: "Texto descritivo do aviso" }),
    tipoAviso: z.string().openapi({ description: "Tipo de parâmetro do aviso", example: "Precipitação" }),
    nivelAviso: z.string().openapi({ description: "Nível do aviso (green, yellow, orange, red)", example: "yellow" }),
    idAreaAviso: z.string().openapi({ description: "Identificador da área do aviso", example: "BGC" }),
    inicio: z.string().openapi({ description: "Início do aviso (ISO 8601)" }),
    fim: z.string().openapi({ description: "Fim do aviso (ISO 8601)" }),
  })
  .openapi("AvisoMeteorologico");

export const PrevisaoMarSchema = z
  .object({
    dataPrevisao: z.string().openapi({ description: "Data da previsão (AAAA-MM-DD)" }),
    localidade: z.string().nullable().openapi({ description: "Identificador do local (slug)" }),
    globalIdLocal: z.number().openapi({ description: "Identificador do local costeiro no IPMA" }),
    periodoOndulacaoMin: z.string().openapi({ description: "Período mínimo de ondulação (segundos)" }),
    periodoOndulacaoMax: z.string().openapi({ description: "Período máximo de ondulação (segundos)" }),
    alturaOndulacaoMin: z.string().openapi({ description: "Altura mínima de ondulação (metros)" }),
    alturaOndulacaoMax: z.string().openapi({ description: "Altura máxima de ondulação (metros)" }),
    dirOndaPredominante: z.string().openapi({ description: "Rumo predominante da onda" }),
    alturaSignificativaMin: z.number().openapi({ description: "Mínimo diário da altura significativa das ondas (metros)" }),
    alturaSignificativaMax: z.number().openapi({ description: "Máximo diário da altura significativa das ondas (metros)" }),
    tempSuperficieMarMin: z.string().openapi({ description: "Temperatura mínima da superfície do mar (°C)" }),
    tempSuperficieMarMax: z.string().openapi({ description: "Temperatura máxima da superfície do mar (°C)" }),
    dataAtualizacao: z.string().openapi({ description: "Data/hora de atualização dos dados (ISO 8601)" }),
  })
  .openapi("PrevisaoMar");

export const RiscoIncendioSchema = z
  .object({
    dataPrevisao: z.string().openapi({ description: "Data da previsão (AAAA-MM-DD)" }),
    dico: z.string().openapi({ description: "Código DICO do concelho" }),
    rcm: z.number().openapi({ description: "Nível de risco de incêndio (1=reduzido, 2=moderado, 3=elevado, 4=muito elevado, 5=máximo)" }),
    latitude: z.number().openapi({ description: "Latitude" }),
    longitude: z.number().openapi({ description: "Longitude" }),
  })
  .openapi("RiscoIncendio");

export const IndiceUvSchema = z
  .object({
    data: z.string().openapi({ description: "Data de referência (AAAA-MM-DD)" }),
    globalIdLocal: z.number().openapi({ description: "Identificador do local no IPMA" }),
    iUv: z.string().openapi({ description: "Valor do índice ultravioleta", example: "5.0" }),
    intervaloHora: z.string().openapi({ description: "Intervalo horário do valor máximo de UV", example: "14h-14h" }),
    idPeriodo: z.number().openapi({ description: "Código interno do período" }),
  })
  .openapi("IndiceUV");

export const ObservacaoEstacaoSchema = z
  .object({
    dataObservacao: z.string().openapi({ description: "Data/hora da observação (ISO 8601)" }),
    idEstacao: z.string().openapi({ description: "Identificador da estação" }),
    localidade: z.string().nullable().openapi({ description: "Identificador do local (slug)" }),
    temperatura: z.number().openapi({ description: "Temperatura do ar (°C)", example: 22.5 }),
    humidade: z.number().openapi({ description: "Humidade relativa do ar (%)", example: 65.0 }),
    pressao: z.number().openapi({ description: "Pressão atmosférica ao nível médio do mar (hPa)", example: 1013.0 }),
    intensidadeVento: z.number().openapi({ description: "Intensidade do vento (m/s)" }),
    intensidadeVentoKM: z.number().openapi({ description: "Intensidade do vento (km/h)" }),
    idDireccVento: z.number().openapi({ description: "Classe do rumo do vento (0-9)" }),
    precipitacaoAcumulada: z.number().openapi({ description: "Precipitação acumulada na hora (mm)" }),
    radiacao: z.number().openapi({ description: "Radiação solar (kJ/m²)" }),
  })
  .openapi("ObservacaoEstacao");

// ─── Schemas de dados de referência ──────────────────────────────────────

export const TipoTempoRefSchema = z
  .object({
    idTipoTempo: z.number().openapi({ description: "Código do tipo de tempo" }),
    descricaoPT: z.string().openapi({ description: "Descrição em português" }),
    descricaoEN: z.string().openapi({ description: "Descrição em inglês" }),
  })
  .openapi("TipoTempoRef");

export const ClasseVentoRefSchema = z
  .object({
    classeVento: z.string().openapi({ description: "Código da classe de intensidade do vento" }),
    descricaoPT: z.string().openapi({ description: "Descrição em português" }),
    descricaoEN: z.string().openapi({ description: "Descrição em inglês" }),
  })
  .openapi("ClasseVentoRef");

export const ClassePrecipitacaoRefSchema = z
  .object({
    classePrecipitacao: z.string().openapi({ description: "Código da classe de intensidade de precipitação" }),
    descricaoPT: z.string().openapi({ description: "Descrição em português" }),
    descricaoEN: z.string().openapi({ description: "Descrição em inglês" }),
  })
  .openapi("ClassePrecipitacaoRef");

export const LocalIpmaRefSchema = z
  .object({
    globalIdLocal: z.number().openapi({ description: "Identificador do local no IPMA" }),
    local: z.string().openapi({ description: "Nome do local" }),
    idRegiao: z.number().openapi({ description: "Região (1=Continente, 2=Madeira, 3=Açores)" }),
    idDistrito: z.number().openapi({ description: "Identificador do distrito" }),
    idConcelho: z.number().openapi({ description: "Identificador do concelho (DICO)" }),
    idAreaAviso: z.string().openapi({ description: "Identificador da área de aviso" }),
    latitude: z.string().openapi({ description: "Latitude (graus decimais)" }),
    longitude: z.string().openapi({ description: "Longitude (graus decimais)" }),
  })
  .openapi("LocalIpmaRef");

export const EstacaoRefSchema = z
  .object({
    idEstacao: z.number().openapi({ description: "Identificador da estação" }),
    localEstacao: z.string().openapi({ description: "Nome da estação" }),
    latitude: z.number().openapi({ description: "Latitude (graus decimais)" }),
    longitude: z.number().openapi({ description: "Longitude (graus decimais)" }),
  })
  .openapi("EstacaoRef");
