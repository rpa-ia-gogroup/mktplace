import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { BrandRow } from "../src/lib/api-client.ts";
import { buildBrandChannelMatrix } from "../src/lib/gerencial/brand-matrix.ts";
import {
  granularidadeEfetiva,
  inicioDoBucket,
  linhasDeMarcasMenores,
  rotuloDoBucket,
  seriesDeMenores,
  topProdutosDeMenores,
} from "../src/lib/gerencial/marcas-menores-adaptador.ts";
import { filtrarMarcasMenores, menoresNaGerencial, overviewDeMenores } from "../src/lib/gerencial/marcas-menores-gerencial.ts";
import { mergeChannelSeries, reconcileSeriesTotal } from "../src/lib/gerencial/trend-series.ts";

const dia = (data: string, sh: number | null, tk: number | null, pSh = 1, pTk = 1) => ({
  data,
  faturamento: (sh ?? 0) + (tk ?? 0),
  por_plataforma: { ...(sh != null ? { SHOPEE: sh } : {}), ...(tk != null ? { TIKTOK: tk } : {}) },
  pedidos_por_plataforma: { ...(sh != null ? { SHOPEE: pSh } : {}), ...(tk != null ? { TIKTOK: pTk } : {}) },
});
const yenzah = {
  id: "yenzah", label: "Yenzah", status: "ok", total: 460, total_anterior: 300,
  por_plataforma: [{ plataforma: "SHOPEE", faturamento: 300 }, { plataforma: "TIKTOK", faturamento: 160 }],
  por_plataforma_anterior: { SHOPEE: 200, TIKTOK: 100 },
  pedidos: 7, pedidos_por_plataforma: { SHOPEE: 5, TIKTOK: 2 }, pedidos_por_plataforma_anterior: { SHOPEE: 4, TIKTOK: 2 },
  // 03/11 (seg) e 05/11 (qua) na mesma semana; 10/11 (ter) na seguinte; TikTok so' em 2 dias
  serie: [dia("2026-11-03", 100, 60, 2, 1), dia("2026-11-05", 120, null, 2), dia("2026-11-10", 80, 100, 1, 1)],
};
const aua = {
  id: "aua", label: "Auá", status: "ok", total: 40, total_anterior: 30,
  por_plataforma: [{ plataforma: "SHOPEE", faturamento: 40 }],
  por_plataforma_anterior: { SHOPEE: 30 },
  pedidos: 1, pedidos_por_plataforma: { SHOPEE: 1 }, pedidos_por_plataforma_anterior: { SHOPEE: 1 },
  serie: [dia("2026-11-05", 40, null, 1)],
};
const BRUTO = {
  disponivel: true,
  periodo: { inicio: "2026-11-01", fim: "2026-11-10" },
  marcas: [yenzah, aua, { id: "denavita", label: "Denavita", status: "aguardando_autorizacao", total: null, por_plataforma: [], serie: [] }],
} as never;
const TODOS = ["ml", "shopee", "tiktok"] as const;
const F = filtrarMarcasMenores(BRUTO, ["yenzah", "aua"], TODOS);

test("granularidade: auto = diaria ate 92 dias, mensal acima; explicita vale", () => {
  assert.equal(granularidadeEfetiva("auto", 92), "day");
  assert.equal(granularidadeEfetiva("auto", 93), "month");
  assert.equal(granularidadeEfetiva("week", 10), "week");
});

test("bucket: semana comeca na segunda (ISO), mes no dia 1; rotulos como os do servidor", () => {
  assert.equal(inicioDoBucket("2026-11-10", "week"), "2026-11-09"); // terca -> segunda
  assert.equal(inicioDoBucket("2026-11-08", "week"), "2026-11-02"); // domingo -> segunda anterior
  assert.equal(inicioDoBucket("2026-11-10", "month"), "2026-11-01");
  assert.equal(rotuloDoBucket("2026-11-10", "day"), "10/11");
  assert.equal(rotuloDoBucket("2026-11-09", "week"), "Sem. 09/11");
  assert.equal(rotuloDoBucket("2026-11-01", "month"), "Nov/26");
});

test("serie diaria por canal: dias sem pedido do canal que vendeu valem zero; canal que nao vendeu nada fica sem dado", () => {
  const s = seriesDeMenores(F, TODOS, "day");
  const por = Object.fromEntries(s.map((x) => [x.channel, x]));
  const vendas = (c: string) => por[c].points.filter((p) => p.gmv > 0).map((p) => [p.date, p.label, p.gmv, p.orders]);
  assert.deepEqual(vendas("shopee"), [["2026-11-03", "03/11", 100, 2], ["2026-11-05", "05/11", 160, 3], ["2026-11-10", "10/11", 80, 1]]); // 05/11 soma Yenzah + Auá
  assert.deepEqual(vendas("tiktok"), [["2026-11-03", "03/11", 60, 1], ["2026-11-10", "10/11", 100, 1]]);
  assert.equal(por.shopee.points.length, 10); // 01/11..10/11, o eixo inteiro
  assert.equal(por.tiktok.points.find((p) => p.date === "2026-11-05")?.gmv, 0); // sem TikTok em 05/11: zero real (a lista do Bling e' completa)
  assert.deepEqual(por.ml.points, []); // ML: as menores nao vendem, nao e' uma linha de zeros
  assert.ok(s.every((x) => x.status === "fresh" && x.granularity === "day"));
});

test("serie semanal e mensal agregam a diaria (sem perder pedido nem real)", () => {
  const sem = seriesDeMenores(F, ["shopee"], "week")[0];
  assert.deepEqual(sem.points.map((p) => [p.date, p.label, p.gmv, p.orders]), [
    ["2026-10-26", "Sem. 26/10", 0, 0], ["2026-11-02", "Sem. 02/11", 260, 5], ["2026-11-09", "Sem. 09/11", 80, 1],
  ]);
  const mes = seriesDeMenores(F, ["shopee"], "month")[0];
  assert.deepEqual(mes.points.map((p) => [p.label, p.gmv, p.orders]), [["Nov/26", 340, 6]]);
});

test("mesma fusao e reconciliacao do Data Mart: a serie fecha com o GMV e os pedidos do topo", () => {
  const ov = overviewDeMenores(F, TODOS)!;
  const canais = ["shopee", "tiktok"] as const; // a Evolucao so' tem os canais onde elas vendem
  const serie = seriesDeMenores(F, canais, "auto");
  const gmv = mergeChannelSeries(serie, canais, "gmv", "auto");
  const ped = mergeChannelSeries(serie, canais, "orders", "auto");
  assert.equal(gmv.seriesTotal, ov.gmv);
  assert.equal(reconcileSeriesTotal(gmv, "gmv", ov.gmv).status, "ok");
  assert.equal(reconcileSeriesTotal(ped, "orders", ov.orders).status, "ok");
});

const itemP = (plataforma: string, sku: string, receita: number | null, quantidade: number | null) => ({ sku, produto: `Produto ${sku}`, plataforma, receita, quantidade, pedidos: 1 });
const PROD = {
  disponivel: true, completo: true, pedidos_total: 3, pedidos_lidos: 3,
  marcas: [
    { id: "yenzah", label: "Yenzah", status: "ok", produtos: [], itens_por_canal: [itemP("TIKTOK", "A", 300, 3), itemP("TIKTOK", "B", 100, null), itemP("SHOPEE", "C", 600, 6), itemP("TIKTOK", "Z", 0, 1)] },
    { id: "denavita", label: "Denavita", status: "aguardando_autorizacao", produtos: [], itens_por_canal: [itemP("TIKTOK", "X", 999, 9)] },
  ],
} as never;
const PERIODO = { inicio: "2026-11-01", fim: "2026-11-10" };

test("Mais vendidos: ranking por receita, % da marca, preco medio, pecas vazias sem quantidade, sem 'vs periodo'", () => {
  const r = topProdutosDeMenores(PROD, ["tiktok"], ["yenzah"], PERIODO)!;
  assert.equal(r.comparacao_inicio, null); // sem periodo anterior de produto no Bling: a coluna 'vs periodo' nao existe
  const m = r.marcas[0];
  assert.equal(m.marca, "yenzah");
  assert.equal(m.receita_marca, 400); // so' TikTok, sem o produto de receita 0
  assert.deepEqual(m.produtos.map((p) => [p.posicao, p.sku, p.canal, p.receita, p.pecas, p.preco_medio, p.share_marca]), [
    [1, "A", "tiktok", 300, 3, 100, 0.75],
    [2, "B", "tiktok", 100, null, null, 0.25], // sem quantidade: pecas e preco medio vazios (nunca 0)
  ]);
  assert.ok(m.produtos.every((p) => p.receita_ant === null && p.pecas_ant === null && p.kit === false));
  assert.deepEqual(m.canais.map((c) => [c.canal, c.receita]), [["tiktok", 400]]);
});

test("Mais vendidos: canal e marca do filtro, Denavita aguardando fora, carregando e falha passam como estao", () => {
  const todos = topProdutosDeMenores(PROD, ["tiktok", "ml", "shopee"], ["yenzah", "denavita"], PERIODO)!;
  assert.deepEqual(todos.marcas.map((m) => m.marca), ["yenzah"]); // Denavita nunca
  assert.deepEqual(todos.marcas[0].produtos.map((p) => p.sku), ["C", "A", "B"]); // C (Shopee 600) lidera
  assert.equal(topProdutosDeMenores(PROD, ["ml"], ["yenzah"], PERIODO)!.marcas.length, 0); // ML: sem venda
  assert.equal(topProdutosDeMenores(undefined, ["tiktok"], ["yenzah"], PERIODO), undefined);
  assert.equal(topProdutosDeMenores(null, ["tiktok"], ["yenzah"], PERIODO), null);
  assert.equal(topProdutosDeMenores({ ...(PROD as object), disponivel: false } as never, ["tiktok"], ["yenzah"], PERIODO), null);
});

const grande = (brand: string, tiktok: number, ml: number, shopee: number): BrandRow => ({
  brand, label: brand.toUpperCase(), tiktok_gmv: tiktok, ml_gmv: ml, shopee_gmv: shopee, total_gmv: tiktok + ml + shopee,
  orders: 1, avg_ticket: null, tiktok_avg_ticket: null, ml_avg_ticket: null, tiktok_gmv_prev: tiktok, ml_gmv_prev: ml, shopee_gmv_prev: shopee,
  total_gmv_prev: tiktok + ml + shopee, mom_pct: 0, cos_pct: null, gpm: null, ml_roas: null, ml_cancel_rate_pct: null,
});

test("Marca x Canal (Todos): as menores entram em TikTok e Shopee, ML sem dado, e no total da linha e das colunas", () => {
  const m = menoresNaGerencial(BRUTO, TODOS, true);
  if (m.estado !== "ok") throw new Error("esperava ok");
  const rows = [grande("apice", 1000, 4000, 2000), ...linhasDeMarcasMenores(m.marcas, true)];
  const matriz = buildBrandChannelMatrix(rows, ["tiktok", "ml", "shopee"], true);
  const y = matriz.rows.find((r) => r.brand === "yenzah")!;
  const cel = Object.fromEntries(y.cells.map((c) => [c.channel, c]));
  assert.equal(cel.tiktok.gmv, 160);
  assert.equal(cel.shopee.gmv, 300);
  assert.equal(cel.ml.gmv, null); // ML: sem dado, nunca 0
  assert.equal(cel.ml.available, false);
  assert.equal(y.brandTotal, 460); // total da linha
  // total das colunas = grandes + menores (Yenzah 160 + Auá 0 no TikTok; Shopee 300 + 40)
  assert.equal(matriz.channelTotals.tiktok, 1000 + 160);
  assert.equal(matriz.channelTotals.shopee, 2000 + 340);
  assert.equal(matriz.channelTotals.ml, 4000); // ML so' das grandes
  assert.equal(matriz.grandTotal, 7000 + 500);
  // variacao da linha com base nos dois periodos: (460 - 300) / 300
  assert.ok(Math.abs((y.brandMomPct ?? 0) - (160 / 300) * 100) < 1e-6);
});

test("linhas das menores: sem meta, sem pedidos de Data Mart inventados; anterior por canal quando ha base", () => {
  const m = menoresNaGerencial(BRUTO, TODOS, true);
  if (m.estado !== "ok") throw new Error("esperava ok");
  const [y] = linhasDeMarcasMenores(m.marcas, true);
  assert.deepEqual([y.brand, y.total_gmv, y.ml_gmv, y.shopee_gmv_prev, y.tiktok_gmv_prev, y.total_gmv_prev], ["yenzah", 460, null, 200, 100, 300]);
  const [semComparar] = linhasDeMarcasMenores(m.marcas, false);
  assert.equal(semComparar.mom_pct, null);
});

test("pagina so' menores: monta a Gerencial dos mesmos componentes, sem Data Mart, e a matriz inclui as menores", () => {
  const so = readFileSync(new URL("../app/GerencialMarcasMenores.tsx", import.meta.url), "utf8");
  for (const comp of ["<MetaHero", "<KpiBand", "<EvolutionCard", "<MarcasMeta", "<TopProdutosMarca"]) assert.ok(so.includes(comp), `falta ${comp}`);
  assert.doesNotMatch(so, /useGerencialSources/);
  assert.match(so, /fonte=\{\{ dadosPara:/);
  const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /buildBrandChannelMatrix\(brandsComMenores/);
  assert.ok(pagina.indexOf("const matrix = useMemo") > pagina.indexOf("const brandsComMenores"), "matriz declarada antes das menores (TDZ)");
  assert.match(pagina, /MARCAS_MENORES_KEYS\.includes\(brand\)\) setDialog/);
});
