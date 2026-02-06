# Template de Adapter

Utiliza este template para criar um novo adapter de fonte de dados.

## Inicio Rapido

**Checklist:** Copiar pasta → Editar adapter.ts → Adicionar import em index.ts → (Se custom schema) renomear schema.ts.example → db:generate → wrangler dev

```bash
# 1. Copiar o template
cp -r src/adapters/_template src/adapters/my-source

# 2. Editar src/adapters/my-source/adapter.ts
#    - Preencher todos os campos TODO
#    - Implementar a logica de recolha
#    - Descomentar registry.register(adapter) no fundo

# 3. Registar o adapter
#    Adicionar esta linha a src/adapters/index.ts:
#    import "./my-source/adapter";

# 4. (Opcional) Se usas tabelas personalizadas:
#    - Renomear schema.ts.example para schema.ts
#    - Executar wrangler dev uma vez para criar a BD local
#    - Depois: bun run db:generate

# 5. Testar localmente
bun run dev
# Noutro terminal:
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

**Nota:** O `db:generate` requer que a BD D1 local exista. Executa `wrangler dev` uma vez antes de gerar migracoes.

## Campos do Adapter

| Campo         | Obrigatorio | Descricao                                            |
| ------------- | ----------- | ---------------------------------------------------- |
| `id`          | Sim         | Slug unico (minusculas, hifens). Usado em URLs e DB. |
| `name`        | Sim         | Nome legivel para exibicao.                          |
| `description` | Sim         | O que este adapter faz.                              |
| `sourceUrl`   | Sim         | URL da fonte de dados publica upstream.              |
| `dataTypes`   | Sim         | Array de: `"api_data"`, `"document"` |
| `schedules`   | Sim         | Array de configuracoes de agendamento cron.          |
| `openApiTag`  | Nao         | Tag curta para docs OpenAPI (default: name).         |
| `features`    | Nao         | `{ hasLocations?: boolean }` — default true.         |
| `routes`      | Nao         | Sub-app OpenAPIHono personalizada (montada automaticamente + na documentacao). |
| `schema`      | Nao         | Referencia a tabelas Drizzle personalizadas.         |

## Frequencias de Agendamento

| Frequencia          | Executa em             | Cron trigger CF |
| ------------------- | ---------------------- | --------------- |
| `every_minute`      | Todos os minutos       | `* * * * *`     |
| `every_5_minutes`   | :00, :05, :10, ...    | `* * * * *`     |
| `every_15_minutes`  | :00, :15, :30, :45    | `* * * * *`     |
| `hourly`            | Inicio de cada hora    | `0 * * * *`     |
| `every_6_hours`     | 00:00, 06:00, 12:00, 18:00 | `0 * * * *` |
| `daily`             | Meia-noite UTC         | `0 0 * * *`     |
| `weekly`            | Domingo meia-noite UTC | `0 0 * * *`     |

## Helpers de Armazenamento

Dentro do handler de agendamento, `ctx` disponibiliza:

```typescript
// Registar uma localizacao partilhada (upsert, seguro chamar sempre)
await ctx.registerLocation({
  id: "lisbon",
  name: "Lisboa",
  latitude: 38.7223,
  longitude: -9.1393,
  type: "city",
  region: "Lisboa",
  district: "Lisboa",
});

// Armazenar dados em api_data (payload JSON, location_id e timestamp para queries consistentes)
await ctx.storeApiData(adapter.id, "my-type", { temperature: 22.5, unit: "°C" }, {
  locationId: "lisbon",  // opcional, permite queries por localizacao
  tags: ["weather"],
  timestamp: new Date(),  // hora de observacao
});

// Fazer upload de um ficheiro para o R2
const docId = await ctx.uploadDocument(adapter.id, {
  name: "relatorio.pdf",
  contentType: "application/pdf",
  data: arrayBuffer,
  locationId: "lisbon",  // opcional
});
```

## Localizacoes

As localizacoes sao um conceito partilhado entre todos os adapters. Quando os
teus dados estao associados a um local geografico, regista-o como localizacao
para que os utilizadores possam consultar "da-me todos os dados de Lisboa"
cruzando todas as fontes.

```typescript
await ctx.registerLocation({
  id: "porto-campanha",
  name: "Porto - Campanha",
  latitude: 41.1496,
  longitude: -8.5855,
  type: "station",
  region: "Norte",
  district: "Porto",
  municipality: "Porto",
  metadata: { stationType: "train" },
});
```

Depois referencia `locationId: "porto-campanha"` ao chamar storeApiData
ou fazer upload de documentos.

## Tabelas Personalizadas

Se os teus dados nao encaixam no modelo generico de api_data/documentos,
podes definir as tuas proprias tabelas Drizzle:

1. Renomear `schema.ts.example` para `schema.ts`
2. Definir as tuas tabelas (prefixar nomes com o id do adapter para evitar colisoes)
3. Importar e utilizar no teu adapter e rotas
4. Executar `wrangler dev` uma vez para criar a BD D1 local (necessario antes de db:generate)
5. Executar `bun run db:generate` para criar a migracao

A configuracao do Drizzle descobre automaticamente os ficheiros `src/adapters/*/schema.ts`.

## Armazenamento R2

- As chaves usam o formato `{adapterId}/{docId}/{filename}` — uma pasta por adapter.
- Boa pratica: um folder por adapter.
- Leitura cross-adapter: permitida.
- Escrita cross-adapter: desencorajada.

## Rotas Personalizadas

Para endpoints de API especificos do adapter que vao alem do CRUD generico.
Usa uma funcao factory que recebe o adapter — a tag OpenAPI e derivada automaticamente
de `adapter.openApiTag ?? adapter.name`.

```typescript
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export function createMyRoutes(adapter: AdapterDefinition) {
  const tag = adapter.openApiTag ?? adapter.name;
  const routes = new OpenAPIHono<{ Bindings: Env }>();

  const myRoute = createRoute({
    method: "get",
    path: "/departures/{stationId}",
    tags: [tag],
    summary: "Obter partidas de uma estacao",
    request: {
      params: z.object({
        stationId: z.string().openapi({ param: { name: "stationId", in: "path" } }),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ departures: z.array(z.unknown()) }) } },
        description: "Partidas da estacao",
      },
    },
  });

  routes.openapi(myRoute, async (c) => {
    const { stationId } = c.req.valid("param");
    return c.json({ departures: [] });
  });

  return routes;
}
```

No adapter.ts: `adapter.routes = createMyRoutes(adapter);`

As rotas sao montadas automaticamente em `/v1/{adapter.id}/...` e aparecem
na especificacao OpenAPI / Scalar (a tag e derivada do adapter).

## Dicas

- Valida sempre as respostas das APIs upstream com schemas Zod.
- Utiliza `ctx.log(...)` para logging estruturado (aparece no dashboard da Cloudflare).
- Mantem os adapters focados: um adapter por API upstream / fonte de dados.
- Se a API upstream requer autenticacao, documenta as variaveis de ambiente necessarias.
- Utiliza localizacoes para tornar os teus dados descubriveis juntamente com outros adapters.
