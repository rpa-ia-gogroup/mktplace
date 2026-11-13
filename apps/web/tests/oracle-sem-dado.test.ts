// T-0111 (MCP-02) — `torre_desempenho_marketplaces`: recorte sem linha na fonte
// sai com total NULO e a limitacao `sem_dado`, na resposta ANTIGA da API (0 com
// `brands: []` e `refreshed_at: null`) e na NOVA (null). Zero so' com linha.
// Deterministico, sem rede e sem relogio real.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { SlidingWindowRateLimiter } from "../src/server/oracle/rate-limit.ts";
import { buildOracleServer } from "../src/server/oracle/server.ts";
import { BRANDS, jsonFetch, OVERVIEW, TREND } from "./oracle-fixtures.ts";

/** Relogio fixo do dia da medicao (13/11/2026): out/26 e' passado. */
const AGORA = new Date("2026-11-13T18:00:00.000Z");

const BRANDS_VAZIO = { ref_month: "2026-10", brands: [], refreshed_at: null };

// /overview?channels=ml&brands=apice&... medido em 13/11 (VAL-MCP, MCP-02).
const ANTIGA = {
  ref_month: "2026-10",
  marketplace: "ml",
  current: { gmv: 0, tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, orders: 0, avg_ticket: 0 },
  previous: { gmv: 0, tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, orders: 0, avg_ticket: 0 },
  gmv_mom_pct: null,
  date_from: "2026-10-01",
  date_to: "2026-10-31",
  compare_date_from: "2026-09-01",
  compare_date_to: "2026-09-30",
  filters: { channels: "ml", brands: ["apice"] },
  refreshed_at: null,
};
const NOVA = {
  ...ANTIGA,
  current: { gmv: null, tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, orders: null, avg_ticket: null },
  previous: { gmv: null, tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, orders: null, avg_ticket: null },
};

type Env = { meta: Record<string, any>; data: any };

async function chamar(overview: unknown, brands: unknown, args: Record<string, unknown>): Promise<Env> {
  const server = buildOracleServer({
    backendBaseUrl: "https://mktplace-api.onrender.com",
    fetchImpl: jsonFetch({
      "/api/v1/performance/overview": overview,
      "/api/v1/performance/brands": brands,
      "/api/v1/performance/trend": TREND,
    }),
    now: () => AGORA,
    rateLimiter: new SlidingWindowRateLimiter({ limit: 1000, windowMs: 60_000 }),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t0111", version: "0.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  const res = await client.callTool({ name: "torre_desempenho_marketplaces", arguments: args });
  assert.notEqual(res.isError, true, JSON.stringify(res.content));
  return res.structuredContent as Env;
}

const APICE_ML = {
  periodo: "personalizado", data_inicio: "2026-10-01", data_fim: "2026-10-31",
  canais: ["ml"], marcas: ["apice"], comparar: true,
};

for (const [nome, overview] of [["antiga (0 + refreshed_at nulo)", ANTIGA], ["nova (null)", NOVA]] as const) {
  test(`T-0111 MCP-02 resposta ${nome}: total nulo, nunca 0`, async () => {
    const env = await chamar(overview, BRANDS_VAZIO, APICE_ML);
    assert.deepEqual(env.data.total, {
      gmv: null, orders: null, avg_ticket: null, gmv_previous: null, change_pct: null,
    });
    assert.equal(env.data.by_channel[0].gmv, null);
  });

  test(`T-0111 MCP-02 resposta ${nome}: limitacao sem_dado nomeia o recorte (atual e anterior)`, async () => {
    const env = await chamar(overview, BRANDS_VAZIO, APICE_ML);
    const sem = env.data.limitations.filter((l: any) => l.topic === "sem_dado");
    assert.equal(sem.length, 2, "atual e anterior");
    assert.match(sem[0].scope, /Mercado Livre x apice/);
    assert.match(sem[0].scope, /2026-10-01 a 2026-10-31/);
    assert.match(sem[1].scope, /anterior, 2026-09-01 a 2026-09-30/);
    assert.match(sem[0].description, /nunca venda zero/);
    assert.ok(env.meta.warnings.some((w: string) => /Sem dado para Mercado Livre x apice/.test(w)));
  });
}

test("T-0111 MCP-02 atual vazio com anterior real: anterior medido e sem variacao inventada", async () => {
  const overview = { ...ANTIGA, previous: { gmv: 800, orders: 32, avg_ticket: 25 }, gmv_mom_pct: -100 };
  const env = await chamar(overview, BRANDS_VAZIO, APICE_ML);
  assert.equal(env.data.total.gmv, null);
  assert.equal(env.data.total.gmv_previous, 800);
  assert.equal(env.data.total.change_pct, null, "nao repassa o -100% da API antiga");
  const sem = env.data.limitations.filter((l: any) => l.topic === "sem_dado");
  assert.equal(sem.length, 1, "so' o atual esta' sem dado");
});

test("T-0111 MCP-02 zero COM linha (refreshed_at presente) continua 0 e sem limitacao", async () => {
  const overview = { ...ANTIGA, refreshed_at: "2026-11-13T17:40:29Z", previous: { gmv: 10, orders: 1, avg_ticket: 10 } };
  const env = await chamar(overview, BRANDS_VAZIO, APICE_ML);
  assert.equal(env.data.total.gmv, 0);
  assert.equal(env.data.total.orders, 0);
  assert.equal(env.data.limitations.filter((l: any) => l.topic === "sem_dado").length, 0);
});

test("T-0111 MCP-02 recorte com dado: nada muda", async () => {
  const env = await chamar(OVERVIEW, BRANDS, { periodo: "mes_anterior", comparar: true });
  assert.equal(env.data.total.gmv, 1000);
  assert.equal(env.data.total.orders, 40);
  assert.equal(env.data.total.gmv_previous, 800);
  assert.equal(env.data.total.change_pct, 25);
  assert.equal(env.data.limitations.filter((l: any) => l.topic === "sem_dado").length, 0);
});
