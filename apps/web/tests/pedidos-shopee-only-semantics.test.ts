// T-0116 — a aba /pedidos inclui a Shopee e "sem dado" deixa de virar 0 (B1-10).
//
// Este arquivo testava a selecao Shopee-isolada SEM fetch (Gate U5: "fonte sem
// cobertura Shopee"). Desde a T-0116 o mart tem pedidos da Shopee (daily_shopee,
// API) e a Shopee entra como TikTok e ML: a selecao Shopee-isolada busca dado.
// Os testes abaixo cobrem o comportamento novo: logica pura (pedidos-cartoes) e
// a fiacao estatica da pagina (sem harness React).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  avisoParcial,
  canaisSemDado,
  canalOuNulo,
  kpisOuNulo,
  linhasPorCanal,
  linhasPorMarca,
  paraPedidosLiquidos,
  rotuloConsolidado,
  seriesDoPeriodo,
  valorExato,
  type Dados,
} from "../src/lib/pedidos-cartoes.ts";
import type { PedidosBrandRow, PedidosDailyRow } from "../src/lib/api-client.ts";

// CRLF -> LF uma vez (core.autocrlf=true no Windows).
const SRC = fs
  .readFileSync(path.join(import.meta.dirname, "..", "app", "pedidos", "page.tsx"), "utf8")
  .replace(/\r\n/g, "\n");

const TRES = { tiktok: true, ml: true, shopee: true };
const SO_SHOPEE = { tiktok: false, ml: false, shopee: true };
const marca = (x: Partial<PedidosBrandRow>): PedidosBrandRow => ({
  brand: "apice", label: "ÁPICE",
  tiktok_orders: null, tiktok_canceled: null, tiktok_cancel_rate_pct: null, tiktok_gmv: null,
  ml_orders: null, ml_canceled: null, ml_cancel_rate_pct: null, ml_gmv: null,
  shopee_orders: null, shopee_canceled: null, shopee_cancel_rate_pct: null, shopee_gmv: null,
  total_orders: 0, total_gmv: 0, ...x,
});

test("Shopee aparece: canal, total liquido e quebra por canal com os 3", () => {
  const sh = canalOuNulo({ orders: 80, canceled: 20, gmv: 4000, cancel_rate_pct: 20, delivered: 70 });
  assert.deepEqual(sh, { orders: 80, canceled: 20, gmv: 4000, cancel_rate_pct: 20, delivered: 70 });
  // API: total bruto = (100+10) + (55 bruto ML) + (80+20); liquido desconta os cancelados dos 3
  const d: Dados = {
    kpis: { total_orders: 265, total_gmv: 19000, avg_ticket: 82.61, cancel_rate_pct: 13.21 },
    tk: { orders: 100, canceled: 10, gmv: 10000, cancel_rate_pct: 9.09, delivered: null },
    ml: { orders: 55, canceled: 5, gmv: 5000, cancel_rate_pct: 9.09, delivered: null },
    sh,
  };
  const liq = paraPedidosLiquidos(d);
  assert.equal(liq.kpis!.total_orders, 230, "100 + 50 + 80 pagos");
  assert.equal(liq.sh!.orders, 80, "Shopee ja' vem liquida da API: nao desconta de novo");
  assert.deepEqual(linhasPorCanal("total_pedidos", liq, TRES).map((l) => l.label), ["TikTok Shop", "Mercado Livre", "Shopee"]);
  assert.equal(valorExato("sh_pedidos", liq), "80");
  assert.equal(valorExato("sh_cancelados", liq), "20");
  assert.equal(rotuloConsolidado(TRES), "Consolidado (TikTok Shop + Mercado Livre + Shopee)");
  assert.equal(rotuloConsolidado({ tiktok: true, ml: true }), "Consolidado (TikTok Shop + Mercado Livre)");
});

test("Shopee na serie diaria e na tabela por marca", () => {
  const dia: PedidosDailyRow = { date: "2026-10-01", tiktok_orders: null, tiktok_canceled: null, ml_orders: null, ml_canceled: null, shopee_orders: 40, shopee_canceled: 10, total_orders: 40, total_gmv: 400 };
  const s = seriesDoPeriodo([dia], SO_SHOPEE);
  assert.deepEqual(s.shPedidos, [40]);
  assert.deepEqual(s.tkPedidos, [], "canal sem linha no dia nao vira ponto 0");
  assert.equal(s.cancelamento[0], 25);
  const linhas = linhasPorMarca("sh_pedidos", [marca({ shopee_orders: 40 }), marca({ brand: "kokeshi", label: "KOKESHI" })], SO_SHOPEE);
  assert.deepEqual(linhas.map((l) => l.valor), ["40", "Sem dado"]);
});

test("null vira '—', nunca 0 nem R$ 0,00 (B1-10: ÁPICE x ML)", () => {
  // API: nenhum canal pedido com linha -> totais e campos do canal null
  const kpis = kpisOuNulo({ total_orders: null, total_gmv: null, avg_ticket: null, cancel_rate_pct: null });
  const ml = canalOuNulo({ orders: null, canceled: null, gmv: null, cancel_rate_pct: null, delivered: null });
  assert.equal(kpis, null);
  assert.equal(ml, null);
  const d: Dados = { kpis, tk: undefined, ml, sh: undefined };
  for (const chave of ["total_pedidos", "total_gmv", "ticket", "cancelamento", "ml_pedidos", "ml_gmv", "sh_pedidos", "sh_gmv"] as const) {
    assert.equal(valorExato(chave, d), "—", chave);
  }
  // ticket sem pedido pago: null -> "—", mesmo com total presente
  const soCancelados = kpisOuNulo({ total_orders: 3, total_gmv: 0, avg_ticket: null, cancel_rate_pct: 100 });
  assert.equal(valorExato("ticket", { kpis: soCancelados, tk: null, ml: null }), "—");
  // zero real continua 0
  const zero = canalOuNulo({ orders: 0, canceled: 0, gmv: 0, cancel_rate_pct: 0, delivered: null });
  assert.equal(valorExato("sh_pedidos", { kpis: null, tk: null, ml: null, sh: zero }), "0");
  // tabela por marca: canal sem linha mostra "—" (fmtNum(null))
  assert.match(SRC, /fmtNum\(row\.shopee_orders \?\? null\)/);
  assert.match(SRC, /function fmtNum\(v: number \| null\): string \{\n  if \(v == null\) return "—";/);
});

test("total parcial: canal do filtro sem linha gera aviso; resposta antiga deduz pelo bloco null", () => {
  const data = { tiktok: { orders: 10, canceled: 1, gmv: 1, cancel_rate_pct: 1, delivered: null }, ml: { orders: null, canceled: null, gmv: null, cancel_rate_pct: null, delivered: null }, shopee: { orders: 5, canceled: 0, gmv: 1, cancel_rate_pct: 0, delivered: null } };
  assert.deepEqual(canaisSemDado(data, TRES), ["ml"]);
  assert.deepEqual(canaisSemDado({ ...data, canais_sem_dado: ["ml"] }, { tiktok: true, ml: false, shopee: true }), [], "canal fora do filtro nao avisa");
  assert.equal(avisoParcial(["ml"], TRES), "Mercado Livre sem dado no período · total parcial, só de TikTok Shop e Shopee");
  assert.equal(avisoParcial(["shopee"], SO_SHOPEE), "Shopee sem dado no período (ausência de dado, não zero)");
  assert.equal(avisoParcial([], TRES), null);
});

test("pagina: Shopee isolada busca dado (sem branch de 'sem cobertura'), aba e colunas da Shopee", () => {
  assert.doesNotMatch(SRC, /showShopeeOnly|showShopeeMixed|avisoCoberturaShopee|sem cobertura/i);
  assert.match(SRC, /fetchPedidos\(filters\.channels, opts\)/);
  assert.match(SRC, /id: "shopee" as const, rotulo: "Shopee", ponto: "bg-canal-shopee"/);
  assert.match(SRC, /<SortableHeader label="Shopee · Pedidos" column="sh_orders"/);
  assert.match(SRC, /showShopee=\{verShopee\}/);
  assert.match(SRC, /consolidado=\{rotuloConsolidado\(selecao\)\}/);
  assert.match(SRC, /"Dados de pedidos carregados\."/);
});
