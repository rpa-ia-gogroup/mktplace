// Grupo de DADOS (D1-D10) + as reconciliacoes do plano.
// Foco: null nunca vira zero, zero nunca vira null, total so quando verdadeiro,
// nenhuma PII, e nenhuma "correcao" artificial de numero.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { buildOracleServer } from "../src/server/oracle/server.ts";
import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { SlidingWindowRateLimiter } from "../src/server/oracle/rate-limit.ts";
import {
  BRANDS, CANAIS, FIXED_NOW, HEALTH, jsonFetch, OVERVIEW, PRODUTOS_ML,
  QUALITY, REFRESHED_AT, REGIOES_BY_UF, REGIOES_SUMMARY, TREND, type CallLog,
} from "./oracle-fixtures.ts";
import {
  ML_FULL, ML_FULL_ESTOQUE, ML_FULL_ESTOQUE_INDISPONIVEL, SHOPEE_ESTOQUE, SHOPEE_FBS,
} from "./oracle-fixtures-operacional.ts";
import { mlFullEstoqueContract } from "../src/server/oracle/upstream-operacional.ts";

const ROUTES = {
  "/api/v1/performance/overview": OVERVIEW,
  "/api/v1/performance/brands": BRANDS,
  "/api/v1/performance/trend": TREND,
  "/api/v1/performance/canais": CANAIS,
  "/api/v1/performance/quality": QUALITY,
  "/api/v1/performance/produtos/ml": PRODUTOS_ML,
  "/api/v1/performance/health-datasource": HEALTH,
  "/api/v1/regioes/summary": REGIOES_SUMMARY,
  "/api/v1/regioes/by-uf": REGIOES_BY_UF,
};

async function connect(routes: Record<string, unknown> = ROUTES, log?: CallLog) {
  const server = buildOracleServer({
    backendBaseUrl: "https://mktplace-api.onrender.com",
    fetchImpl: jsonFetch(routes, log),
    now: () => FIXED_NOW,
    rateLimiter: new SlidingWindowRateLimiter({ limit: 1000, windowMs: 60_000 }),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "data", version: "0.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

type Env = { meta: Record<string, any>; data: any };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  assert.notEqual(res.isError, true, `${name} deveria ter sucesso`);
  return res.structuredContent as Env;
}

// ---------------------------------------------------------------------------
// D3/D4 — null preservado, zero preservado
// ---------------------------------------------------------------------------

test("D3: canal sem dado permanece null e NUNCA vira zero", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
  });

  const shopee = env.data.by_channel.find((c: any) => c.channel === "shopee");
  assert.equal(shopee.gmv, null, "shopee sem dado deve continuar null");
  assert.notEqual(shopee.gmv, 0);
  // Share tambem nao pode ser fabricado a partir de null.
  assert.equal(shopee.share_pct, null);
});

test("D4: GMV zero REAL permanece zero e nao vira null", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
  });

  const kokeshi = env.data.by_brand.find((b: any) => b.brand === "kokeshi");
  assert.equal(kokeshi.gmv, 0, "zero medido deve permanecer 0");
  assert.notEqual(kokeshi.gmv, null);
  assert.equal(kokeshi.orders, 0);
});

test("comissao do ML ausente permanece null, nunca zero", async () => {
  const env = await call(await connect(), "torre_comparar_canais_marcas", {
    periodo: "mes_anterior",
  });

  const ml = env.data.rows.find((r: any) => r.channel === "ml");
  assert.equal(ml.marketplace_cost_pct, null);
  assert.notEqual(ml.marketplace_cost_pct, 0);
  // "aplicavel mas indisponivel" precisa ser distinguivel de "nao aplicavel".
  assert.equal(ml.marketplace_cost_applicable, true);
  assert.equal(ml.marketplace_cost_available, false);
});

test("N/A (nao aplicavel) e' distinto de sem dado e de zero", async () => {
  const env = await call(await connect(), "torre_comparar_canais_marcas", {
    periodo: "mes_anterior",
  });

  const tiktok = env.data.rows.find((r: any) => r.channel === "tiktok");
  // Frete seller nao e' operado pelo TikTok neste contrato: nao aplicavel.
  assert.equal(tiktok.seller_shipping_applicable, false);
  assert.equal(tiktok.seller_shipping_available, false);
  assert.equal(tiktok.seller_shipping_pct, null);
  assert.notEqual(tiktok.seller_shipping_pct, 0);
});

test("Ads do TikTok: aplicavel, sem fonte — sem dado, nunca zero nem comissao de afiliado", async () => {
  const env = await call(await connect(), "torre_comparar_canais_marcas", {
    periodo: "mes_anterior",
  });

  const tiktok = env.data.rows.find((r: any) => r.channel === "tiktok");
  assert.equal(tiktok.ads_applicable, true);
  assert.equal(tiktok.ads_available, false);
  for (const campo of ["ad_spend", "roas", "acos_pct", "ads_over_gmv_pct"]) {
    assert.equal(tiktok[campo], null, campo);
  }
  const lim = env.data.limitations.find((l: any) => l.topic === "ads_tiktok_sem_fonte");
  assert.ok(lim, "a limitacao de fonte ausente acompanha a resposta");
  assert.match(lim.description, /nunca 'nao se aplica' nem zero/);
  assert.match(lim.description, /comissao de afiliado .* NAO e' investimento em midia/);
});

test("mediana inexistente (uma marca so) permanece null — sem comparacao fabricada", async () => {
  const env = await call(await connect(), "torre_comparar_canais_marcas", {
    periodo: "mes_anterior",
  });

  const ml = env.data.channel_medians.find((m: any) => m.channel === "ml");
  assert.equal(ml.roas_median, null);
  assert.equal(ml.gmv_median, null);
  assert.equal(ml.brands_with_data, 1);
});

// ---------------------------------------------------------------------------
// D10 — total_count so quando verdadeiro
// ---------------------------------------------------------------------------

test("D10: produtos expoem total verdadeiro e marcam truncamento", async () => {
  const env = await call(await connect(), "torre_produtos_prioritarios", {
    canal: "ml",
    limite: 2,
  });

  assert.equal(env.meta.total_count, 1648, "total verdadeiro vem do backend");
  assert.equal(env.meta.returned_count, 2);
  assert.equal(env.meta.truncated, true);
  assert.match(env.meta.coverage, /top-2/);
});

test("D10: tools sem total verdadeiro NAO inventam total_count", async () => {
  const client = await connect();
  for (const name of [
    "torre_desempenho_marketplaces",
    "torre_comparar_canais_marcas",
    "torre_regioes_vendas",
  ]) {
    const env = await call(client, name, {});
    assert.equal(env.meta.total_count, null, `${name} nao pode fabricar total`);
    assert.equal(env.meta.truncated, false);
  }
});

// ---------------------------------------------------------------------------
// Proibicoes de conteudo
// ---------------------------------------------------------------------------

test("estimated_margin NUNCA aparece na saida", async () => {
  const env = await call(await connect(), "torre_produtos_prioritarios", {
    canal: "ml",
    limite: 2,
  });
  const serialized = JSON.stringify(env);
  assert.ok(!serialized.includes("estimated_margin"));
  assert.ok(!serialized.includes("0.42"), "valor da margem estimada nao pode vazar");
});

test("nenhuma resposta contem PII (creator, e-mail, pedido, cliente, CPF)", async () => {
  const client = await connect();
  const names = [
    "torre_desempenho_marketplaces",
    "torre_comparar_canais_marcas",
    "torre_qualidade_dados",
    "torre_regioes_vendas",
  ];
  for (const name of names) {
    const env = await call(client, name, {});
    const s = JSON.stringify(env).toLowerCase();
    for (const forbidden of ["creator", "buyer_name", "customer_name", "cpf", "email", "order_id", "@"]) {
      assert.ok(!s.includes(forbidden), `${name} nao pode conter "${forbidden}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// Qualidade — 0 nao mensurado nunca vira 0%
// ---------------------------------------------------------------------------

test("cancelamento do TikTok = 0 e' reportado como NAO MENSURADO", async () => {
  const env = await call(await connect(), "torre_qualidade_dados", {});

  const tk = env.data.quality_indicators.find(
    (i: any) => i.channel === "tiktok" && i.metric === "taxa_cancelamento",
  );
  assert.equal(tk.measured, false, "0 do TikTok significa ausencia de medicao");
  assert.equal(tk.value_pct, null, "nao pode ser apresentado como 0%");
  assert.match(tk.note, /NAO MENSURADO/i);

  // E a limitacao precisa estar declarada explicitamente.
  const topics = env.data.limitations.map((l: any) => l.topic);
  assert.ok(topics.includes("cancelamento_tiktok"));
});

test("canais com medicao real preservam o valor, inclusive decimais", async () => {
  const env = await call(await connect(), "torre_qualidade_dados", {});
  const ml = env.data.quality_indicators.find(
    (i: any) => i.channel === "ml" && i.metric === "taxa_cancelamento",
  );
  assert.equal(ml.measured, true);
  assert.equal(ml.value_pct, 1.5);
});

test("saude tecnica e frescor vem da fonte, sem timestamp inventado", async () => {
  const env = await call(await connect(), "torre_qualidade_dados", {});
  assert.equal(env.data.technical_health.active_source, "neon_marts");
  assert.equal(env.data.technical_health.database_connected, true);
  assert.equal(env.data.freshness.refreshed_at, REFRESHED_AT);
  assert.equal(env.meta.refreshed_at, REFRESHED_AT);
});

test("refreshed_at ausente na fonte permanece null (nunca fabricado)", async () => {
  const semRefresh = { ...ROUTES, "/api/v1/performance/produtos/ml": { ...PRODUTOS_ML, refreshed_at: undefined } };
  const env = await call(await connect(semRefresh), "torre_produtos_prioritarios", {
    canal: "ml",
    limite: 2,
  });
  assert.equal(env.meta.refreshed_at, null);
});

// ---------------------------------------------------------------------------
// Regioes — cobertura declarada, sem reconciliacao artificial
// ---------------------------------------------------------------------------

test("R7: regioes sempre avisa cobertura parcial e NAO reconcilia com a gerencial", async () => {
  const client = await connect();
  const regioes = await call(client, "torre_regioes_vendas", { periodo: "mes_anterior" });
  const gerencial = await call(client, "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
  });

  // Aviso obrigatorio, mesmo sem o usuario pedir.
  assert.ok(
    regioes.meta.warnings.some((w: string) => /cobertura regional/i.test(w)),
    "aviso de cobertura e' obrigatorio",
  );
  assert.ok(regioes.data.limitations.some((l: any) => l.topic === "cobertura_regional"));

  // Os numeros DIVERGEM de proposito e nenhum ajuste e' aplicado.
  assert.equal(regioes.data.summary.gmv, 700);
  assert.equal(gerencial.data.total.gmv, 1000);
  assert.notEqual(regioes.data.summary.gmv, gerencial.data.total.gmv);
});

test("canais sem cobertura regional vem da FONTE, nao de lista fixa", async () => {
  const env = await call(await connect(), "torre_regioes_vendas", {});
  assert.deepEqual(env.data.channels_without_regional_coverage, ["tiktok"]);

  // Provar que e' lido: mudando a fonte, a saida muda.
  const alt = {
    ...ROUTES,
    "/api/v1/regioes/summary": {
      ...REGIOES_SUMMARY,
      channels_sem_cobertura_regional: ["tiktok", "shopee"],
    },
  };
  const env2 = await call(await connect(alt), "torre_regioes_vendas", {});
  assert.deepEqual(env2.data.channels_without_regional_coverage, ["tiktok", "shopee"]);
});

test("UFs sao ordenadas por GMV e respeitam o limite", async () => {
  const env = await call(await connect(), "torre_regioes_vendas", { limite: 1 });
  assert.equal(env.data.by_uf.length, 1);
  assert.equal(env.data.by_uf[0].uf, "SP", "maior GMV primeiro");
  assert.equal(env.meta.returned_count, 1);
});

// ---------------------------------------------------------------------------
// Reconciliacoes internas
// ---------------------------------------------------------------------------

test("R3: soma dos canais bate com o total do periodo", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
  });
  const soma = env.data.by_channel.reduce((acc: number, c: any) => acc + (c.gmv ?? 0), 0);
  assert.equal(soma, env.data.total.gmv);
});

test("R4: soma da serie bate com o total do periodo", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
    granularidade: "day",
  });
  const soma = env.data.series.reduce((acc: number, p: any) => acc + (p.gmv ?? 0), 0);
  assert.equal(soma, env.data.total.gmv);
});

// ---------------------------------------------------------------------------
// D5/D6/D7 — periodo, filtros e limite
// ---------------------------------------------------------------------------

test("D5: periodo resolvido e' inclusivo e corresponde ao mes anterior", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
  });
  // Relogio fixo em 2026-08-18 (BRT) -> mes anterior = julho inteiro.
  assert.deepEqual(env.meta.period, {
    start: "2026-07-01",
    end: "2026-07-31",
    inclusive: true,
  });
});

test("D6: filtros aplicados sao o ECO do backend", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
    canais: ["ml"],
  });
  // O fixture ecoa channels=all; prevalece o backend, nao o input do modelo.
  assert.equal(env.meta.filters_applied.channels, "all");
});

test("D6: o escopo pedido chega ao backend como querystring allowlisted", async () => {
  const log: CallLog = [];
  const client = await connect(ROUTES, log);
  await call(client, "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
    canais: ["ml", "tiktok"],
    marcas: ["barbours"],
  });

  const overviewCall = log.find((c) => c.url.includes("/overview"));
  assert.ok(overviewCall);
  assert.ok(overviewCall.url.includes("channels=ml%2Ctiktok"));
  assert.ok(overviewCall.url.includes("brands=barbours"));
  assert.ok(overviewCall.url.includes("date_from=2026-07-01"));
  assert.ok(overviewCall.url.includes("date_to=2026-07-31"));
});

test("D9: periodo que inclui hoje traz o aviso de dia parcial", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_atual",
  });
  assert.equal(env.meta.period.end, "2026-08-18");
  assert.ok(
    env.meta.warnings.some((w: string) => /dia corrente/i.test(w)),
    "aviso de carga parcial e' obrigatorio",
  );
});

test("mes fechado NAO recebe aviso de dia parcial", async () => {
  const env = await call(await connect(), "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
  });
  assert.ok(!env.meta.warnings.some((w: string) => /dia corrente/i.test(w)));
});

// ---------------------------------------------------------------------------
// D2 — vazio verdadeiro e' diferente de fonte indisponivel
// ---------------------------------------------------------------------------

test("D2: resultado vazio VERDADEIRO devolve lista vazia, nao erro", async () => {
  const vazio = {
    ...ROUTES,
    "/api/v1/regioes/summary": { ...REGIOES_SUMMARY, gmv: 0, orders: 0, ufs_com_venda: 0 },
    "/api/v1/regioes/by-uf": { ...REGIOES_BY_UF, data: [] },
  };
  const env = await call(await connect(vazio), "torre_regioes_vendas", {});

  assert.deepEqual(env.data.by_uf, []);
  assert.equal(env.meta.returned_count, 0);
  // Zero medido continua zero — nao vira null nem erro.
  assert.equal(env.data.summary.gmv, 0);
});

test("comparacao so aparece quando solicitada", async () => {
  const client = await connect();

  const sem = await call(client, "torre_desempenho_marketplaces", { periodo: "mes_anterior" });
  assert.equal(sem.data.total.gmv_previous, null);
  assert.equal(sem.data.total.change_pct, null);

  const com = await call(client, "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
    comparar: true,
  });
  assert.equal(com.data.total.gmv_previous, 800);
  assert.equal(com.data.total.change_pct, 25);
});

test("serie e' null quando nao solicitada (distinto de vazia)", async () => {
  const client = await connect();
  const sem = await call(client, "torre_desempenho_marketplaces", { periodo: "mes_anterior" });
  assert.equal(sem.data.series, null, "null = nao solicitada");

  const com = await call(client, "torre_desempenho_marketplaces", {
    periodo: "mes_anterior",
    granularidade: "day",
  });
  assert.ok(Array.isArray(com.data.series));
});

// ---------------------------------------------------------------------------
// D8 — proveniencia completa
// ---------------------------------------------------------------------------

test("D8: toda tool devolve proveniencia completa no envelope", async () => {
  const client = await connect();
  for (const name of [
    "torre_desempenho_marketplaces",
    "torre_comparar_canais_marcas",
    "torre_qualidade_dados",
    "torre_regioes_vendas",
  ]) {
    const env = await call(client, name, {});
    assert.ok(env.meta.source.includes("Torre"), `${name}: source`);
    assert.equal(env.meta.layer, "marts (Neon)", `${name}: layer`);
    assert.equal(env.meta.timezone, "America/Sao_Paulo", `${name}: timezone`);
    assert.equal(env.meta.currency, "BRL", `${name}: currency`);
    assert.equal(env.meta.monetary_unit, "reais", `${name}: unidade monetaria`);
    assert.ok(env.meta.metric_definition.length > 20, `${name}: definicao da metrica`);
    assert.ok(env.meta.coverage.length > 5, `${name}: cobertura`);
    assert.ok(Array.isArray(env.meta.warnings), `${name}: warnings`);
  }
});

test("produtos do ML declaram escopo cumulativo e recusam filtro de mes", async () => {
  const client = await connect();
  const env = await call(client, "torre_produtos_prioritarios", { canal: "ml", limite: 2 });
  assert.equal(env.data.temporal_scope, "cumulativo");
  assert.equal(env.meta.period, null, "produtos ML nao tem periodo");
  assert.ok(env.data.limitations.some((l: any) => l.topic === "produtos_ml_cumulativo"));

  // Pedir mes para o ML e' erro explicito, nunca ignorado em silencio.
  const res = await client.callTool({
    name: "torre_produtos_prioritarios",
    arguments: { canal: "ml", mes: "2026-07" },
  });
  assert.equal(res.isError, true);
});

// ---------------------------------------------------------------------------
// Chave de servico (AUTH-GOOGLE-7): o MCP chama a API sem cookie de usuario.
// ---------------------------------------------------------------------------

const SERVICE_KEY = "k".repeat(32);

function capturingFetch(status = 200) {
  const seen: Array<Record<string, string>> = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    seen.push({ ...(init?.headers as Record<string, string>) });
    return new Response("{}", {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

test("TorreClient envia x-torre-service-key quando serviceKey esta definida", async () => {
  const { seen, fetchImpl } = capturingFetch();
  const client = new TorreClient({
    baseUrl: "https://mktplace-api.onrender.com",
    serviceKey: SERVICE_KEY,
    fetchImpl,
  });
  await client.get("overview");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]["x-torre-service-key"], SERVICE_KEY);
  assert.equal(seen[0].accept, "application/json");
});

test("TorreClient sem serviceKey (ou so com espacos) nao envia header extra", async () => {
  for (const serviceKey of [undefined, "", "   "]) {
    const { seen, fetchImpl } = capturingFetch();
    const client = new TorreClient({
      baseUrl: "https://mktplace-api.onrender.com",
      serviceKey,
      fetchImpl,
    });
    await client.get("overview");
    assert.deepEqual(Object.keys(seen[0]), ["accept"]);
  }
});

test("a chave de servico nunca aparece nos erros do TorreClient", async () => {
  const leaky = (async () => {
    throw new Error(`falha com ${SERVICE_KEY}`);
  }) as typeof fetch;
  for (const fetchImpl of [leaky, capturingFetch(401).fetchImpl, capturingFetch(500).fetchImpl]) {
    const client = new TorreClient({
      baseUrl: "https://mktplace-api.onrender.com",
      serviceKey: SERVICE_KEY,
      fetchImpl,
    });
    await assert.rejects(client.get("overview"), (err: unknown) => {
      const e = err as Error;
      assert.ok(!JSON.stringify(e).includes(SERVICE_KEY));
      assert.ok(!String(e.message).includes(SERVICE_KEY));
      assert.ok(!String(e.stack).includes(SERVICE_KEY));
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// T-0080 — torre_estoque_full le o estoque Full REAL do Mercado Livre
// ---------------------------------------------------------------------------

const ML_STOCK_ROUTES = {
  "/api/v1/performance/ml-fulfillment": ML_FULL,
  "/api/v1/performance/ml-full-estoque": ML_FULL_ESTOQUE,
};

test("T-0080 estoque ML: marca com itens projeta SKU, titulo e curva; zero medido continua 0", async () => {
  const env = await call(await connect(ML_STOCK_ROUTES), "torre_estoque_full", { canais: ["ml"] });
  const est = env.data.ml_estoque;
  assert.equal(est.disponibilidade, "available");
  assert.equal(est.fotografia.ref_date, "2026-08-18");
  const [ruptura, suficiente, semLeitura] = est.itens;
  assert.equal(suficiente.sku, "40125");
  assert.equal(suficiente.titulo, "Kit Skincare Kokeshi");
  assert.equal(suficiente.curva, "A");
  assert.equal(suficiente.disponivel, 12);
  assert.equal(suficiente.cobertura_dias, 12);
  assert.equal(suficiente.estado_estoque, "medido");
  // Sem curva: null com motivo, nunca "C".
  assert.equal(ruptura.curva, null);
  assert.equal(ruptura.curva_motivo, "sem_ponte");
  assert.equal(ruptura.disponivel, 0, "ruptura medida e' zero real");
  assert.equal(ruptura.estado_estoque, "zero_real");
  assert.equal(ruptura.cobertura_dias, 0);
  // Inventario sem leitura: nulo, nunca 0.
  assert.equal(semLeitura.disponivel, null);
  assert.equal(semLeitura.estado_estoque, "sem_dado");
  assert.equal(semLeitura.cobertura_dias, null);
  assert.equal(semLeitura.sku, null);
  assert.equal(env.meta.total_count, 3);
  assert.ok(env.data.limitations.some((l: any) => l.topic === "estoque_ml_cobertura_torre"));
});

test("T-0080 estoque ML: marca sem fotografia vem NULA com limitacao; sem_estoque_full e' zero medido", async () => {
  const env = await call(await connect(ML_STOCK_ROUTES), "torre_estoque_full", { canais: ["ml"] });
  const est = env.data.ml_estoque;
  const marca = Object.fromEntries(est.marcas.map((m: any) => [m.brand, m]));
  assert.equal(marca.barbours.estado, "sem_fotografia");
  assert.equal(marca.barbours.disponivel_full, null);
  assert.notEqual(marca.barbours.disponivel_full, 0);
  assert.equal(marca.barbours.estado_estoque, "sem_dado");
  assert.equal(marca.rituaria.estado, "sem_estoque_full");
  assert.equal(marca.rituaria.disponivel_full, 0);
  assert.equal(marca.rituaria.estado_estoque, "zero_real");
  assert.equal(est.total_parcial, true);
  const lim = env.data.limitations.find((l: any) => l.topic === "estoque_ml_ausente");
  assert.ok(lim, "limitacao de ausencia presente");
  assert.match(lim.scope, /barbours/);
  assert.doesNotMatch(lim.scope, /rituaria/, "sem_estoque_full nao e' ausencia");
  assert.ok(env.meta.warnings.some((w: string) => /sem fotografia no dia para barbours/.test(w)));
});

test("T-0080 estoque ML: fonte indisponivel vira sem_dado + limitacao, nunca estoque zero", async () => {
  const env = await call(
    await connect({ ...ML_STOCK_ROUTES, "/api/v1/performance/ml-full-estoque": ML_FULL_ESTOQUE_INDISPONIVEL }),
    "torre_estoque_full",
    { canais: ["ml"] },
  );
  const est = env.data.ml_estoque;
  assert.equal(est.disponibilidade, "unavailable");
  assert.equal(est.estado, "sem_dado");
  assert.equal(est.indicadores, null);
  assert.deepEqual(est.itens, []);
  assert.ok(env.data.limitations.some((l: any) => l.topic === "estoque_ml_ausente" && /fonte indisponivel/.test(l.scope)));
});

test("T-0080 estoque ML: contrato rejeita formato quebrado (vira erro, nao sucesso vazio)", async () => {
  assert.equal(mlFullEstoqueContract.safeParse(ML_FULL_ESTOQUE).success, true);
  const inv = ML_FULL_ESTOQUE.inventarios[1];
  const quebrados = [
    { ...ML_FULL_ESTOQUE, inventarios: [{ ...inv, disponivel: "12" }] },
    { ...ML_FULL_ESTOQUE, inventarios: [{ ...inv, curva: "D" }] },
    { ...ML_FULL_ESTOQUE, inventarios: [{ ...inv, classificacao_torre: "PROVAVELMENTE_OK" }] },
    // Marca "sem fotografia" com estado: ausencia x zero ficaria ambigua.
    { ...ML_FULL_ESTOQUE, marcas: [{ ...ML_FULL_ESTOQUE.marcas[0], estado: "sem_estoque_full" }] },
    { ...ML_FULL_ESTOQUE, indicadores: undefined },
    { status: "unavailable", scope_label: "x" },
  ];
  for (const q of quebrados) assert.equal(mlFullEstoqueContract.safeParse(q).success, false, JSON.stringify(q).slice(0, 80));
  // R146: contrato quebrado na fonte ML degrada o bloco (nunca "sucesso vazio"
  // com numero inventado): ml_estoque sem dado + motivo = classe do erro.
  const env = await call(
    await connect({ ...ML_STOCK_ROUTES, "/api/v1/performance/ml-full-estoque": quebrados[0] }),
    "torre_estoque_full",
    { canais: ["ml"] },
  );
  assert.equal(env.data.ml_estoque.estado, "sem_dado");
  assert.deepEqual(env.data.ml_estoque.itens, []);
  const lim = env.data.limitations.find((l: any) => l.topic === "estoque_ml_indisponivel");
  assert.equal(lim.motivo, "INVALID_UPSTREAM_RESPONSE");
});

test("T-0080 estoque ML: limite sempre enviado; ref_date/incluir_fora_do_full nunca; marca fora da fonte nao vai ao GET", async () => {
  const log: CallLog = [];
  const env = await call(await connect(ML_STOCK_ROUTES, log), "torre_estoque_full", {
    canais: ["ml"], marcas: ["kokeshi", "apice"], limite: 5,
  });
  const est = log.filter((c) => c.url.includes("/ml-full-estoque")).map((c) => new URL(c.url));
  assert.equal(est.length, 2, "preflight + chamada filtrada");
  assert.equal(est[0].searchParams.get("limite"), "1");
  assert.deepEqual(est[1].searchParams.getAll("brands"), ["kokeshi"]);
  assert.equal(est[1].searchParams.get("limite"), "5");
  for (const u of est) {
    assert.equal(u.searchParams.has("ref_date"), false);
    assert.equal(u.searchParams.has("incluir_fora_do_full"), false);
  }
  assert.deepEqual(env.data.ml_estoque.marcas_nao_cobertas, ["apice"]);
});

// ---------------------------------------------------------------------------
// T-0080 — GMV em maturacao (TikTok/ML) vira limitacao explicita
// ---------------------------------------------------------------------------

const MATURACAO = (desde: string, dias = 35) => ({
  em_maturacao_desde: desde, janela_dias: dias, motivo: "cancelamentos ate ~D+30; valor pode cair",
});

test("T-0080 desempenho: periodo em maturacao traz limitacao com canal e intervalo", async () => {
  const env = await call(
    await connect({
      ...ROUTES,
      "/api/v1/performance/brands": { ...BRANDS, tiktok_maturacao: MATURACAO("2026-07-14"), ml_maturacao: MATURACAO("2026-07-14") },
    }),
    "torre_desempenho_marketplaces",
    { periodo: "mes_anterior" },
  );
  const lims = env.data.limitations.filter((l: any) => l.topic === "gmv_em_maturacao");
  assert.equal(lims.length, 2);
  assert.ok(lims.some((l: any) => /TikTok/.test(l.scope) && /2026-07-14 a 2026-07-31/.test(l.scope)));
  assert.ok(lims.some((l: any) => /Mercado Livre/.test(l.scope)));
  assert.match(lims[0].description, /ainda pode mudar/);
  assert.ok(env.meta.warnings.some((w: string) => /em maturacao de 2026-07-14 a 2026-07-31/.test(w)));
  // So' rotulo: nenhum numero muda.
  assert.equal(env.data.total.gmv, 1000);
});

test("T-0080 desempenho: sem campo de maturacao, periodo maduro ou canal fora do pedido -> sem limitacao", async () => {
  const semCampo = await call(await connect(), "torre_desempenho_marketplaces", { periodo: "mes_anterior" });
  assert.deepEqual(semCampo.data.limitations, [], "campo ausente: nada inventado");

  const maduro = await call(
    await connect({ ...ROUTES, "/api/v1/performance/brands": { ...BRANDS, tiktok_maturacao: MATURACAO("2026-08-05"), ml_maturacao: null } }),
    "torre_desempenho_marketplaces",
    { periodo: "mes_anterior" },
  );
  assert.deepEqual(maduro.data.limitations, []);
  assert.ok(!maduro.meta.warnings.some((w: string) => /maturacao/.test(w)));

  const foraDoPedido = await call(
    await connect({ ...ROUTES, "/api/v1/performance/brands": { ...BRANDS, tiktok_maturacao: MATURACAO("2026-07-14") } }),
    "torre_desempenho_marketplaces",
    { periodo: "mes_anterior", canais: ["shopee"] },
  );
  assert.deepEqual(foraDoPedido.data.limitations, []);
});

test("T-0080 desempenho: bloco de maturacao malformado e' contrato quebrado", async () => {
  const res = await (await connect({
    ...ROUTES, "/api/v1/performance/brands": { ...BRANDS, tiktok_maturacao: { em_maturacao_desde: "ontem", janela_dias: 35, motivo: "x" } },
  })).callTool({ name: "torre_desempenho_marketplaces", arguments: { periodo: "mes_anterior" } });
  assert.equal(res.isError, true);
});

// ---------------------------------------------------------------------------
// R146 — falha da fonte ML Full (timeout, 5xx) NAO derruba a Shopee
// ---------------------------------------------------------------------------

/** Rotas por path; o ML Full estoque pendura ate o abort ou devolve 503. */
function mlFalhaFetch(modo: "timeout" | "5xx", log: string[] = []): typeof fetch {
  const rotas: Record<string, unknown> = {
    "/api/v1/performance/ml-fulfillment": ML_FULL,
    "/api/v1/performance/shopee-fbs": SHOPEE_FBS,
    "/api/v1/performance/shopee-fbs-estoque": SHOPEE_ESTOQUE,
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    log.push(path);
    if (path === "/api/v1/performance/ml-full-estoque") {
      if (modo === "5xx") {
        return new Response(JSON.stringify({ detail: "contrato" }), {
          status: 503, headers: { "content-type": "application/json" },
        });
      }
      return new Promise((_res, rej) => {
        const fail = () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); };
        if (init?.signal?.aborted) return fail();
        init?.signal?.addEventListener("abort", fail, { once: true });
      });
    }
    return new Response(JSON.stringify(rotas[path]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

async function connectMlFalha(modo: "timeout" | "5xx", log?: string[]) {
  const server = buildOracleServer({
    backendBaseUrl: "https://mktplace-api.onrender.com",
    fetchImpl: mlFalhaFetch(modo, log),
    now: () => FIXED_NOW,
    timeoutMs: 50,
    rateLimiter: new SlidingWindowRateLimiter({ limit: 1000, windowMs: 60_000 }),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "r146", version: "0.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

for (const [modo, motivo] of [["timeout", "SOURCE_TIMEOUT"], ["5xx", "SOURCE_UNAVAILABLE"]] as const) {
  test(`R146 estoque: ML Full em ${modo} com Shopee ok -> resposta ok, Shopee preenchida, ml_estoque sem dado (motivo ${motivo})`, async () => {
    const out = await call(await connectMlFalha(modo), "torre_estoque_full", {});
    // Shopee intacta.
    assert.equal(out.data.shopee_estoque.disponibilidade, "available");
    assert.ok(out.data.shopee_estoque.itens.length > 0);
    assert.notEqual(out.data.shopee_fbs, null);
    // Modalidade ML (outra fonte) intacta.
    assert.equal(typeof out.data.ml_full.share_full_gmv, "number");
    // Estoque ML sem dado — nunca zero.
    const est = out.data.ml_estoque;
    assert.equal(est.disponibilidade, "unavailable");
    assert.equal(est.estado, "sem_dado");
    assert.equal(est.indicadores, null);
    assert.deepEqual(est.itens, []);
    const lim = out.data.limitations.find((l: any) => l.topic === "estoque_ml_indisponivel");
    assert.ok(lim, "limitacao presente");
    assert.equal(lim.motivo, motivo, "motivo = classe do erro, sem texto livre");
    assert.ok(!out.data.limitations.some((l: any) => l.topic === "estoque_ml_ausente"), "falha nao e' 'sem fotografia'");
    const texto = JSON.stringify(out);
    assert.ok(!/onrender|aborted|503|"contrato"/.test(texto), "nada da excecao ou da URL vaza");
  });
}

test("R146 estoque: falha no PREFLIGHT de marcas tambem degrada; pedido so' ML segue ok com a modalidade", async () => {
  const log: string[] = [];
  const out = await call(await connectMlFalha("timeout", log), "torre_estoque_full", {
    canais: ["ml"], marcas: ["kokeshi"],
  });
  assert.equal(log.filter((p) => p.endsWith("/ml-full-estoque")).length, 1, "parou no preflight");
  assert.equal(out.data.shopee_estoque, null);
  assert.equal(out.data.ml_estoque.estado, "sem_dado");
  assert.equal(out.data.limitations.find((l: any) => l.topic === "estoque_ml_indisponivel").motivo, "SOURCE_TIMEOUT");
  assert.equal(typeof out.data.ml_full.share_full_gmv, "number");
});
