// torre_expedicao_operacional — bloco `ldr` (LDR de ML e Shopee). Nada aqui toca rede.
// Grupos: caminho feliz, ausencia x zero, falha da LDR nao derruba a fila, contrato
// quebrado, entrada estrita, parametros enviados, sem PII.
import { test } from "node:test";
import assert from "node:assert/strict";

import { OracleToolError } from "../src/server/oracle/errors.ts";
import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { expedicaoTool } from "../src/server/oracle/tools-expedicao.ts";
import { FIXED_NOW } from "./oracle-fixtures.ts";
import { EXP_ML, EXP_SHOPEE, EXP_TREND_ML, EXP_TREND_SHOPEE } from "./oracle-fixtures-operacional.ts";

const ML_LDR = {
  availability: "available", unavailable_reason: null, channel: "mercadolivre",
  from: "2026-11-12", to: "2026-11-18", requested_days: 7, series_start: "2026-11-03", mature_days: 7,
  brands: [
    { brand: "barbours", base: 100, late: 4, rate: 0.04, without_pickup_mark: 2 },
    { brand: "kokeshi", base: 100, late: 0, rate: 0, without_pickup_mark: 0 },
  ],
  daily: [
    { due_date: "2026-11-17", base: 120, late: 4, rate: 4 / 120, is_mature: true },
    { due_date: "2026-11-18", base: 0, late: 0, rate: null, is_mature: true },
  ],
};

const SHOPEE_LDR = {
  availability: "available", unavailable_reason: null, channel: "shopee", metric_name: "ldr_operacional_shopee",
  official: false, disclaimer: "Indicador interno: nao e' a taxa que a Shopee usa para penalizacao.",
  event: "coleta", thresholds: { coverage_warning: 0.02, coverage_hide_rate: 0.1 },
  snapshot: { refresh_batch_id: "b1", effective_at: "2026-08-18T10:00:00Z", today_brt: "2026-08-18", age_hours: 2, source_age_hours: 2, stale: false },
  ldr: {
    from: "2026-08-11", to: "2026-08-18", days: 7, rate: 0.03, rate_hidden_reason: null, base: 300, late: 9,
    shipped_on_time: 280, shipped_late: 7, pending_overdue: 2, pending_on_time: 40, pending_at_risk: 15,
    mature_due_days: 6, partial_due_days: 1,
    daily: [
      { due_date: "2026-08-17", base: 100, late: 3, shipped_on_time: 95, shipped_late: 2, pending_overdue: 1, pending_on_time: 0, excluded_fbs: 5, excluded_cancelled: 1, shipped_without_pickup: 0, rate: 0.03, is_mature: true },
      { due_date: "2026-08-18", base: 0, late: 0, shipped_on_time: 0, shipped_late: 0, pending_overdue: 0, pending_on_time: 40, excluded_fbs: 0, excluded_cancelled: 0, shipped_without_pickup: 0, rate: null, is_mature: false },
    ],
  },
  exclusions: { fbs: 5, cancelled_without_pickup: 1, cancelled_seller_did_not_ship: 0, cancelled_unknown_reason: 0, shipped_without_pickup: 0, without_deadline: 0 },
  coverage: { state: "completa", missing_share: 0.0, missing: 0, eligible: 300, without_deadline: 0, shipped_without_pickup: 0 },
  brands: [
    { brand: "apice", base: 200, late: 6, rate: 0.03, coverage_state: "completa", excluded_fbs: 3, excluded_cancelled: 1, source_watermark_at: null },
    { brand: "kokeshi", base: 0, late: 0, rate: null, coverage_state: "sem_base", excluded_fbs: 0, excluded_cancelled: 0, source_watermark_at: null },
  ],
  alerts: [{ severity: "critical", code: "pendentes_vencidos", message: "2 pedido(s) passaram do prazo e ainda nao foram coletados." }],
  queue_by_flow: null,
};

type Handler = (u: URL) => { status?: number; body: unknown } | unknown;

const ROTAS: Record<string, Handler> = {
  "/api/v1/expedicao": (u) => (u.searchParams.get("channel") === "mercadolivre" ? EXP_ML : EXP_SHOPEE),
  "/api/v1/expedicao/trend": (u) => (u.searchParams.get("channel") === "mercadolivre" ? EXP_TREND_ML : EXP_TREND_SHOPEE),
  "/api/v1/expedicao/ml/ldr": () => ML_LDR,
  "/api/v1/expedicao/shopee/ldr": () => SHOPEE_LDR,
};

function deps(rotas: Record<string, Handler>, calls: URL[] = []) {
  const client = new TorreClient({
    baseUrl: "https://mktplace-api-6wif.onrender.com",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const u = new URL(typeof input === "string" ? input : input.toString());
      calls.push(u);
      const h = rotas[u.pathname];
      if (!h) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      const r = h(u) as { status?: number; body?: unknown };
      const status = r && typeof r === "object" && "status" in r && "body" in r ? r.status! : 200;
      const body = r && typeof r === "object" && "status" in r && "body" in r ? r.body : r;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch,
  });
  return { client, now: () => FIXED_NOW };
}

async function run(args: Record<string, unknown> = {}, rotas = ROTAS, calls: URL[] = []) {
  const res = await expedicaoTool.run({ canais: ["shopee", "ml"], ...args }, deps(rotas, calls));
  expedicaoTool.config.outputSchema.parse(res.structuredContent);
  return res.structuredContent as { meta: Record<string, any>; data: any };
}

test("ldr: caminho feliz — ML soma contagens das marcas, Shopee traz a taxa da API e o aviso de medicao interna", async () => {
  const calls: URL[] = [];
  const env = await run({}, ROTAS, calls);
  const ml = env.data.ml.ldr;
  assert.equal(ml.disponibilidade, "available");
  assert.equal(ml.medicao, "interna_nao_oficial");
  assert.equal(ml.base, 200);
  assert.equal(ml.atrasados, 4);
  assert.equal(ml.taxa, 0.02);
  assert.equal(ml.taxa_origem, "soma_das_marcas");
  assert.equal(ml.por_marca[1].taxa, 0, "zero medido na marca continua 0");
  assert.equal(ml.por_vencimento[1].taxa, null, "dia sem base: taxa nula");
  assert.deepEqual(ml.janela, { inicio: "2026-11-12", fim: "2026-11-18", dias_pedidos: 7, dias_fechados: 7 });

  const sh = env.data.shopee.ldr;
  assert.equal(sh.medicao, "interna_nao_oficial");
  assert.match(sh.aviso_medicao, /nao e' a taxa/);
  assert.equal(sh.taxa, 0.03);
  assert.equal(sh.taxa_origem, "api");
  assert.equal(sh.vencem_hoje_ou_amanha, 15);
  assert.equal(sh.pendentes_vencidos, 2);
  assert.equal(sh.cobertura, "completa");
  assert.equal(sh.por_marca[0].cobertura, "completa");
  assert.equal(sh.alertas[0].codigo, "pendentes_vencidos");

  assert.ok(env.data.limitations.some((l: any) => l.topic === "ldr_ml_shopee_interna"));
  assert.ok(env.data.limitations.some((l: any) => l.topic === "expedicao_vencem_hoje"));
  assert.ok(env.meta.warnings.some((w: string) => /LDR e' medicao INTERNA/.test(w)));
  assert.equal(env.meta.filters_applied.ldr_dias, 7);
  // A fila continua la.
  assert.equal(env.data.shopee.totais.backlog, 30);
});

test("ldr: ldr_dias e marcas vao como `days` e CSV (Shopee le brands como string)", async () => {
  const calls: URL[] = [];
  await run({ ldr_dias: 14, marcas: ["kokeshi", "apice"] }, ROTAS, calls);
  for (const p of ["/api/v1/expedicao/ml/ldr", "/api/v1/expedicao/shopee/ldr"]) {
    const u = calls.find((c) => c.pathname === p)!;
    assert.equal(u.searchParams.get("days"), "14");
    assert.deepEqual(u.searchParams.getAll("brands"), ["apice,kokeshi"]);
  }
});

test("ldr: sem base / taxa oculta / marca sem linha -> null e aviso, nunca 0%", async () => {
  const env = await run(
    { marcas: ["kokeshi", "apice"] },
    {
      ...ROTAS,
      "/api/v1/expedicao/ml/ldr": () => ({ ...ML_LDR, brands: [], daily: [] }),
      "/api/v1/expedicao/shopee/ldr": () => ({
        ...SHOPEE_LDR,
        ldr: { ...SHOPEE_LDR.ldr, rate: null, rate_hidden_reason: "coverage_insufficient" },
        coverage: { state: "insuficiente", missing_share: 0.2, missing: 60, eligible: 300, without_deadline: 60, shipped_without_pickup: 0 },
        brands: [SHOPEE_LDR.brands[0]],
      }),
    },
  );
  const ml = env.data.ml.ldr;
  assert.equal(ml.taxa, null);
  assert.equal(ml.taxa_origem, null);
  assert.equal(ml.base, 0);
  assert.deepEqual([...ml.marcas_sem_base].sort(), ["apice", "kokeshi"]);
  const sh = env.data.shopee.ldr;
  assert.equal(sh.taxa, null);
  assert.equal(sh.taxa_oculta_motivo, "coverage_insufficient");
  assert.equal(sh.cobertura, "insuficiente");
  assert.deepEqual(sh.marcas_sem_base, ["kokeshi"]);
  assert.ok(env.meta.warnings.some((w: string) => /taxa oculta/.test(w)));
});

test("ldr: janela parcial do ML (serie comecou ha menos dias) e' avisada", async () => {
  const env = await run({ canais: ["ml"] }, { ...ROTAS, "/api/v1/expedicao/ml/ldr": () => ({ ...ML_LDR, mature_days: 3 }) });
  assert.equal(env.data.ml.ldr.janela.dias_fechados, 3);
  assert.ok(env.meta.warnings.some((w: string) => /janela parcial da LDR \(3 de 7/.test(w)));
});

test("ldr: indisponivel na fonte (Shopee) -> sem numero, com motivo", async () => {
  const env = await run(
    {},
    {
      ...ROTAS,
      "/api/v1/expedicao/shopee/ldr": () => ({ ...SHOPEE_LDR, availability: "unavailable", unavailable_reason: "disabled", ldr: null, coverage: null, brands: [], alerts: [] }),
    },
  );
  const sh = env.data.shopee.ldr;
  assert.equal(sh.disponibilidade, "unavailable");
  assert.equal(sh.motivo_indisponivel, "disabled");
  assert.equal(sh.taxa, null);
  assert.equal(sh.base, null);
  assert.match(sh.aviso_medicao, /nao e' a taxa/);
  assert.ok(env.meta.warnings.some((w: string) => /Shopee: LDR 7d indisponivel \(disabled\)/.test(w)));
});

test("ldr: flag desligada (404) ou contrato quebrado na LDR NAO derrubam a fila", async () => {
  const rotas404 = { ...ROTAS };
  delete rotas404["/api/v1/expedicao/ml/ldr"];
  const env = await run({}, {
    ...rotas404,
    "/api/v1/expedicao/shopee/ldr": () => ({ availability: "available", official: "talvez" }),
  });
  for (const c of ["ml", "shopee"]) {
    assert.equal(env.data[c].ldr.disponibilidade, "unavailable");
    assert.equal(env.data[c].ldr.motivo_indisponivel, "falha_ao_ler_ldr");
    assert.equal(env.data[c].ldr.taxa, null);
    assert.ok(env.data[c].totais, "fila intacta");
  }
  assert.ok(env.meta.warnings.some((w: string) => /LDR 7d indisponivel/.test(w)));
});

test("ldr: contrato quebrado na FILA continua sendo INVALID_UPSTREAM_RESPONSE", async () => {
  await assert.rejects(
    () => run({}, { ...ROTAS, "/api/v1/expedicao": () => ({ foo: 1 }) }),
    (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE",
  );
});

test("ldr: entrada estrita — ldr_dias fora de 1..30 e campo desconhecido falham antes do GET", async () => {
  for (const args of [{ ldr_dias: 0 }, { ldr_dias: 31 }, { ldr_dias: 1.5 }, { ldr_dias: "7" }, { dias: 7 }]) {
    const calls: URL[] = [];
    await assert.rejects(() => run(args, ROTAS, calls));
    assert.equal(calls.length, 0, `${JSON.stringify(args)} nao pode chegar ao fetch`);
  }
});

test("ldr: nenhum campo pessoal na saida e nenhuma rota por pedido consultada", async () => {
  const calls: URL[] = [];
  const env = await run({}, ROTAS, calls);
  // Os textos de `limitations` citam "cliente/endereco" justamente para negar; so' os blocos de dados contam.
  const txt = JSON.stringify({ shopee: env.data.shopee, ml: env.data.ml });
  assert.doesNotMatch(txt, /order_id|order_ref|buyer|customer|cliente|endereco|address|"pedidos"|"pedido"|"queue"/i);
  assert.ok(!calls.some((u) => /ldr\/pedidos/.test(u.pathname)));
});
