# PT Public Data API

API aberta que agrega, faz cache e serve dados publicos de fontes governamentais e institucionais portuguesas. Construida com **Cloudflare Workers**, **Hono.js**, **Drizzle ORM** e documentacao **Scalar OpenAPI**.

Qualquer pessoa pode contribuir com uma nova fonte de dados escrevendo um **adapter** -- um modulo pequeno e autonomo. A framework trata do agendamento, armazenamento, cache e geracao da API automaticamente.

## Arquitetura

```
                 ┌─────────────────────────────────────────────┐
                 │            Cloudflare Worker                 │
                 │                                             │
  Cron triggers  │  ┌────────────┐     ┌──────────────────┐   │
  ─────────────► │  │  Scheduler │────►│ Adapter Registry │   │
                 │  └────────────┘     └──────────────────┘   │
                 │                            │                │
                 │         ┌──────────────────┼────────┐       │
                 │         ▼                  ▼        ▼       │
                 │   ┌───────────┐   ┌──────────┐ ┌───────┐   │
                 │   │IPMA Weather│   │QualAr/UV│ │  ...  │   │
                 │   └─────┬─────┘   └────┬─────┘ └───┬───┘   │
                 │         │              │            │        │
                 │         ▼              ▼            ▼        │
                 │  ┌────────┐  ┌─────────┐  ┌──────────┐     │
                 │  │D1 (SQL)│  │R2 (files)│  │KV (cache)│     │
                 │  └────┬───┘  └────┬─────┘  └────┬─────┘     │
                 │       └───────────┼─────────────┘           │
  HTTP requests  │                   ▼                         │
  ─────────────► │          ┌──────────────┐                   │
                 │          │  Hono API    │                   │
                 │          │  + OpenAPI   │                   │
                 │          │  + Scalar UI │                   │
                 │          └──────────────┘                   │
                 └─────────────────────────────────────────────┘
```

Os **Adapters** recolhem dados de APIs publicas portuguesas com base num agendamento. Escrevem em tres camadas de armazenamento:

| Armazenamento      | Finalidade                              | Utilizado para                  |
| ------------------ | --------------------------------------- | ------------------------------- |
| **D1** (SQLite)    | Timeseries estruturadas e metadados     | Dados numericos, valores atuais |
| **R2** (Objetos)   | Ficheiros grandes (PDFs, CSVs, datasets)| Documentos, exportacoes em massa|
| **KV** (Key-Value) | Cache de respostas                      | Respostas rapidas da API        |

A **camada de API** serve tudo atraves de endpoints REST versionados com geracao automatica de especificacao OpenAPI e interface Scalar.

## Inicio Rapido

### Pre-requisitos

- [Bun](https://bun.sh/) (ou Node.js 20+)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`bun i -g wrangler`)
- Uma conta Cloudflare (o plano gratuito funciona)

### Configuracao

```bash
# Clonar e instalar
git clone https://github.com/corrreia/pt-apis.git
cd pt-apis
bun install

# Executar migracoes da base de dados
wrangler d1 migrations apply pt-apis-d1

# Iniciar servidor de desenvolvimento local
bun run dev
```

### Verificar que Funciona

```bash
# Raiz da API (lista todos os adapters)
curl http://localhost:8787/

# Listar todas as fontes de dados
curl http://localhost:8787/v1/sources

# Especificacao OpenAPI
curl http://localhost:8787/doc

# Referencia Scalar da API (abrir no browser)
open http://localhost:8787/reference

# Health check
curl http://localhost:8787/health

# Executar tarefas agendadas localmente
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

## Endpoints da API

| Metodo | Caminho                                      | Descricao                            |
| ------ | -------------------------------------------- | ------------------------------------ |
| GET    | `/v1/sources`                                | Listar todas as fontes de dados      |
| GET    | `/v1/sources/:sourceId`                      | Detalhes da fonte + log de ingestao  |
| GET    | `/v1/sources/:sourceId/realtime`             | Valores mais recentes de uma fonte   |
| GET    | `/v1/sources/:sourceId/history`              | Timeseries historicas com paginacao  |
| GET    | `/v1/sources/:sourceId/documents`            | Listar documentos de uma fonte       |
| GET    | `/v1/sources/:sourceId/documents/:docId`     | Descarregar um documento do R2       |
| GET    | `/v1/sources/:sourceId/snapshots`            | Snapshots JSON de um momento no tempo|
| GET    | `/v1/locations`                              | Listar/pesquisar todas as localizacoes partilhadas |
| GET    | `/v1/locations/:locationId`                  | Detalhes de uma localizacao          |
| GET    | `/v1/locations/:locationId/data`             | Todos os dados de uma localizacao (cross-source) |
| GET    | `/v1/search`                                 | Pesquisa cross-source (suporta filtro locationId) |
| GET    | `/v1/:adapterId/*`                           | Rotas personalizadas do adapter      |
| GET    | `/doc`                                       | Especificacao OpenAPI 3.1 JSON       |
| GET    | `/reference`                                 | Interface Scalar de referencia da API|
| GET    | `/health`                                    | Health check                         |

Todos os endpoints suportam filtragem por query parameters. Consulta a interface Scalar em `/reference` para documentacao completa dos parametros.

**API contract:** All endpoints, request/response body fields, query and path parameter names, and descriptions are in **English**. This is a breaking change for clients that relied on the previous Portuguese field names (e.g. `dados`, `erro`, `limite`, `desvio`). Use the Scalar reference at `/reference` for the current schema.

## Estrutura do Projeto

```
src/
├── index.ts                    # Ponto de entrada: handlers fetch + scheduled
├── env.d.ts                    # Declaracoes de tipos dos bindings Cloudflare
│
├── core/                       # Internos da framework
│   ├── adapter.ts              # Interface AdapterDefinition e tipos
│   ├── registry.ts             # Registo global de adapters
│   ├── scheduler.ts            # Logica de despacho cron -> adapter
│   ├── storage.ts              # Helpers de armazenamento (ingerir, upload, snapshot)
│   ├── cache.ts                # Middleware de cache KV
│   └── errors.ts               # Tipos de erro partilhados
│
├── db/                         # Camada de base de dados
│   ├── schema.ts               # Schema Drizzle ORM (7 tabelas)
│   └── client.ts               # Factory do cliente Drizzle
│
├── api/                        # Rotas HTTP da API
│   ├── openapi.ts              # Configuracao OpenAPI + Scalar UI
│   └── v1/
│       ├── sources.ts          # /v1/sources
│       ├── realtime.ts         # /v1/sources/:id/realtime
│       ├── history.ts          # /v1/sources/:id/history
│       ├── documents.ts        # /v1/sources/:id/documents
│       ├── snapshots.ts        # /v1/sources/:id/snapshots
│       ├── locations.ts        # /v1/locations (consultas geo cross-source)
│       └── search.ts           # /v1/search
│
├── adapters/                   # Adapters de fontes de dados
│   ├── index.ts                # Barrel file (importar todos os adapters aqui)
│   ├── seed.ts                 # Seed automatico da tabela sources no arranque
│   ├── _template/              # Copiar para criar um novo adapter
│   │   ├── adapter.ts
│   │   ├── schema.ts.example   # Exemplo de tabelas Drizzle personalizadas
│   │   └── README.md
│   ├── ipma/                   # Previsoes meteorologicas IPMA
│   │   ├── adapter.ts
│   │   └── types.ts
│   └── qualidade-ar/           # Indice UV / qualidade do ar
│       ├── adapter.ts
│       └── types.ts
│
migrations/                     # Migracoes SQL D1 (geradas automaticamente)
wrangler.jsonc                  # Configuracao Cloudflare Workers
drizzle.config.ts               # Configuracao Drizzle Kit
```

## Contribuir com um Adapter

Adicionar uma nova fonte de dados publica portuguesa demora ~30 minutos. Eis como:

### Passo 1: Copiar o Template

```bash
cp -r src/adapters/_template src/adapters/my-source
```

### Passo 2: Implementar o Adapter

Editar `src/adapters/my-source/adapter.ts`:

```typescript
import type { AdapterDefinition, AdapterContext, TimeseriesPoint } from "../../core/adapter";
import { registry } from "../../core/registry";

const API_URL = "https://api.example.pt/data";

async function fetchData(ctx: AdapterContext): Promise<void> {
  ctx.log("A recolher dados...");

  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`API devolveu ${res.status}`);
  const raw = await res.json();

  // Registar localizacoes (upsert, seguro chamar sempre)
  await ctx.registerLocation({
    id: "lisbon", name: "Lisboa", latitude: 38.72, longitude: -9.14,
    type: "city", region: "Lisboa", district: "Lisboa",
  });

  // Converter para pontos de timeseries com ligacao a localizacao
  const points: TimeseriesPoint[] = raw.items.map((item: any) => ({
    metric: "my_metric",
    entityId: item.id,
    locationId: "lisbon",  // liga a tabela partilhada de localizacoes
    value: item.value,
    metadata: { unit: "°C" },
    observedAt: new Date(item.timestamp),
  }));

  await ctx.ingestTimeseries(adapter.id, points);
  ctx.log(`Ingeridos ${points.length} pontos.`);
}

const adapter: AdapterDefinition = {
  id: "my-source",
  name: "A Minha Fonte de Dados",
  description: "Recolhe ... de ...",
  sourceUrl: API_URL,
  dataTypes: ["timeseries"],
  schedules: [
    {
      frequency: "hourly",
      handler: fetchData,
      description: "Recolher dados mais recentes",
    },
  ],
};

registry.register(adapter);
export default adapter;
```

### Passo 3: Registar

Adicionar uma linha a `src/adapters/index.ts`:

```typescript
import "./my-source/adapter";
```

### Passo 4: Testar

```bash
# Iniciar servidor de desenvolvimento
bun run dev

# Executar o cron manualmente
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"

# Verificar que os dados apareceram
curl http://localhost:8787/v1/sources/my-source/realtime
```

### Passo 5: Submeter um PR

E ja esta! Abre um pull request e os maintainers irao reve-lo.

## Tipos de Dados

Os adapters podem produzir tres tipos de dados:

### Timeseries

Pontos de dados numericos ao longo do tempo. Cada ponto tem uma **metrica** (o que), uma **entidade** (onde/quem), um **valor** e um **timestamp**. Exemplos: leituras de temperatura, indices de qualidade do ar, precos de energia.

```typescript
await ctx.ingestTimeseries(adapter.id, [
  { metric: "temperature", entityId: "lisbon", value: 22.5, observedAt: new Date() },
]);
```

A framework mantem automaticamente uma tabela `latest_values` para consultas rapidas do "estado atual", e uma tabela append-only `timeseries` para consultas historicas.

### Documentos

Ficheiros armazenados no R2 (PDFs, CSVs, datasets, imagens). Os metadados sao indexados no D1.

```typescript
const docId = await ctx.uploadDocument(adapter.id, {
  name: "relatorio-2026-Q1.pdf",
  contentType: "application/pdf",
  data: await response.arrayBuffer(),
  metadata: { year: 2026, quarter: 1 },
});
```

### Snapshots

Capturas JSON completas das respostas das APIs upstream. Uteis para viajar no tempo: comparar como uma resposta de API se apresentava em diferentes momentos.

```typescript
await ctx.storeSnapshot(adapter.id, "full-forecast", rawApiResponse);
```

## Localizacoes

As localizacoes sao um conceito geografico partilhado entre todos os adapters. Qualquer adapter pode registar localizacoes (cidades, estacoes, sensores) e ligar os seus dados a elas. Isto permite consultas cross-source poderosas como "da-me todos os dados de Lisboa."

```typescript
// No handler de fetch do teu adapter:
await ctx.registerLocation({
  id: "lisbon",
  name: "Lisboa",
  latitude: 38.7223,
  longitude: -9.1393,
  type: "city",
  region: "Lisboa",
  district: "Lisboa",
});

// Depois referencia ao ingerir dados:
await ctx.ingestTimeseries(adapter.id, [{
  metric: "temperature",
  entityId: "lisbon-sensor-1",
  locationId: "lisbon",      // <-- ligacao cross-source
  value: 22.5,
  observedAt: new Date(),
}]);
```

Os utilizadores podem depois consultar:
- `GET /v1/locations` -- listar todas as localizacoes (filtrar por tipo, regiao, distrito)
- `GET /v1/locations/lisbon` -- obter detalhes da localizacao
- `GET /v1/locations/lisbon/data` -- todos os dados de Lisboa de todos os adapters
- `GET /v1/search?locationId=lisbon` -- pesquisar entre fontes para esta localizacao

## Tabelas e Rotas Personalizadas

Os adapters nao precisam de usar o modelo generico de timeseries/documentos/snapshots. Podem definir as suas proprias tabelas Drizzle e as suas proprias rotas de API.

### Tabelas Personalizadas

Cria um `schema.ts` na pasta do teu adapter com as tuas proprias tabelas Drizzle. O gerador de migracoes deteta-as automaticamente:

```typescript
// src/adapters/cp-trains/schema.ts
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const cpStations = sqliteTable("cp_stations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  locationId: text("location_id"),   // FK para localizacoes partilhadas
  line: text("line"),
});

export const cpDepartures = sqliteTable("cp_departures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stationId: text("station_id").notNull(),
  trainNumber: text("train_number").notNull(),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
  delayMinutes: integer("delay_minutes"),
});
```

### Rotas Personalizadas

Define uma sub-app `OpenAPIHono` no teu adapter. E montada automaticamente em `/v1/{adapter.id}/...` e aparece na documentacao Scalar:

```typescript
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const routes = new OpenAPIHono<{ Bindings: Env }>();

const getDeparturesRoute = createRoute({
  method: "get",
  path: "/departures/{stationId}",
  tags: ["CP Comboios"],
  summary: "Obter partidas de uma estacao",
  // ... schemas de request/response
});

routes.openapi(getDeparturesRoute, async (c) => {
  // Consultar as tuas tabelas personalizadas, devolver resposta personalizada
});

const adapter: AdapterDefinition = {
  id: "cp-trains",
  // ...
  routes,  // montado automaticamente em /v1/cp-trains/departures/:stationId
};
```

## Agendamento Cron

Os Cloudflare Workers suportam ate 3 cron triggers. A framework mapeia as frequencias dos adapters em tres grupos:

| Frequencia do Adapter  | Cron Real      | Quando Executa                        |
| ---------------------- | -------------- | ------------------------------------- |
| `every_minute`         | `* * * * *`    | Todos os minutos                      |
| `every_5_minutes`      | `* * * * *`    | Minutos divisiveis por 5              |
| `every_15_minutes`     | `* * * * *`    | Minutos divisiveis por 15             |
| `hourly`               | `0 * * * *`    | Inicio de cada hora                   |
| `every_6_hours`        | `0 * * * *`    | 00:00, 06:00, 12:00, 18:00 UTC       |
| `daily`                | `0 0 * * *`    | Meia-noite UTC                        |
| `weekly`               | `0 0 * * *`    | Domingo a meia-noite UTC              |

Nao precisas de mexer no wrangler.jsonc. Basta definir `frequency` no agendamento do teu adapter e a framework trata do resto.

### Testar Cron Jobs Localmente

```bash
# Iniciar dev com suporte a agendamento
wrangler dev --test-scheduled

# Executar o grupo de minuto
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"

# Executar o grupo de hora
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"

# Executar o grupo diario
curl "http://localhost:8787/__scheduled?cron=0+0+*+*+*"
```

## Adapters Incluidos

| ID do Adapter    | Fonte  | Tipos de Dados      | Frequencia     | Descricao                                    |
| ---------------- | ------ | ------------------- | -------------- | -------------------------------------------- |
| `ipma-weather`   | IPMA   | timeseries, snapshot | A cada 15 min | Previsoes meteorologicas diarias para todas as capitais de distrito |
| `qualidade-ar`   | IPMA   | timeseries, snapshot | De hora a hora | Previsoes do indice UV para cidades portuguesas |

## Base de Dados

O projeto utiliza **Cloudflare D1** (SQLite) com **Drizzle ORM**. Sete tabelas base (os adapters podem adicionar as suas):

| Tabela          | Finalidade                                                 |
| --------------- | ---------------------------------------------------------- |
| `sources`       | Adapters registados e o seu estado                         |
| `locations`     | Localizacoes geograficas partilhadas entre todos os adapters|
| `timeseries`    | Dados de timeseries append-only (o armazenamento principal)|
| `latest_values` | Vista materializada do "estado atual" (upsert automatico)  |
| `documents`     | Metadados de ficheiros armazenados no R2                   |
| `snapshots`     | Capturas JSON de um momento no tempo                       |
| `ingest_log`    | Registo de auditoria de todas as execucoes cron            |

Todas as tabelas de dados (`timeseries`, `latest_values`, `documents`, `snapshots`) tem uma coluna opcional `location_id` que liga a tabela partilhada `locations`. Os adapters tambem podem definir as suas proprias tabelas em `src/adapters/{id}/schema.ts`.

### Migracoes

```bash
# Gerar uma migracao apos alterar o schema.ts
bun run db:generate

# Aplicar migracoes localmente
bun run db:migrate:dev

# Aplicar migracoes em producao
bun run db:migrate:prod
```

## Deploy

```bash
# Deploy para Cloudflare Workers
bun run deploy
```

Certifica-te de que criaste a base de dados D1, o bucket R2 e o namespace KV na tua conta Cloudflare primeiro, e atualizaste os IDs no `wrangler.jsonc`.

## Stack Tecnologica

- **Runtime**: Cloudflare Workers
- **Framework**: [Hono](https://hono.dev/) + [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
- **Base de Dados**: Cloudflare D1 (SQLite) + [Drizzle ORM](https://orm.drizzle.team/)
- **Armazenamento de Objetos**: Cloudflare R2
- **Cache**: Cloudflare KV
- **Validacao**: [Zod](https://zod.dev/) v4
- **Documentacao da API**: [Scalar](https://scalar.com/) API Reference
- **Gestor de Pacotes**: [Bun](https://bun.sh/)

## Ideias de Adapters

A procura de uma fonte de dados para contribuir? Aqui ficam algumas APIs publicas portuguesas:

- **IPMA Dados Sismicos** -- monitorizacao de sismos do IPMA
- **CP Comboios** -- horarios e atrasos de comboios
- **Metro de Lisboa / Porto** -- horarios do metro
- **Carris / STCP** -- redes de autocarros
- **ERSE** -- precos de eletricidade e gas
- **INE** -- Instituto Nacional de Estatistica
- **dados.gov.pt** -- portal de dados abertos do governo
- **APA / QualAr** -- monitorizacao completa da qualidade do ar
- **Turismo de Portugal** -- estatisticas de turismo
- **DGES** -- dados do ensino superior
- **SNS** -- tempos de espera do Servico Nacional de Saude
- **IMT** -- dados de veiculos e conducao
- **Porto Digital** -- sensores de cidade inteligente (qualidade do ar, ruido, trafego)
- **RNAP** -- areas naturais protegidas
- **ICNF** -- indices de risco de incendio florestal

## Roadmap

Funcionalidades futuras em consideracao:

1. **Webhooks / Subscricoes de eventos** -- notificar servicos externos quando chegam novos dados
2. **Pontuacao de qualidade de dados** -- monitorizar frescura, completude e anomalias por fonte
3. **Camada GraphQL** -- gateway GraphQL opcional sobre REST
4. **Rate limiting e chaves de API** -- via rate limiting da Cloudflare + chaves baseadas em KV
5. **Exportacao de dados** -- endpoints de exportacao em massa CSV/Parquet
6. **Dashboard** -- interface web a mostrar todas as fontes e o seu estado
7. **API de Agregacoes** -- rollups pre-calculados por hora/dia/mes
8. **Consultas geo** -- filtragem espacial para dados baseados em localizacao
9. **Diff/changelog** -- mostrar o que mudou entre dois snapshots
10. **Replicacao multi-regiao** -- replicas de leitura D1 para acesso global de baixa latencia
11. **Alertas** -- alertas baseados em limiares via email/Telegram quando valores excedem limites
12. **Linhagem de dados** -- rastrear que chamada upstream produziu que registos
13. **Geracao de SDKs** -- gerar automaticamente SDKs TypeScript/Python a partir da especificacao OpenAPI
14. **API Batch** -- pedido unico para consultar multiplas fontes de uma vez
15. **Streaming / SSE** -- server-sent events para push de dados em tempo real

## Licenca

MIT
