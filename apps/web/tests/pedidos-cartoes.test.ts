/**
 * Pedidos no padrao da Gerencial: cartoes (4 totais + 2 grupos por canal), series
 * reais para o mini grafico e detalhe por marca. Logica em `src/lib/pedidos-cartoes.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  linhasPorCanal,
  linhasPorMarca,
  serieDoDetalhe,
  seriesDoPeriodo,
  tomDoCancelamento,
  valorExato,
  variacaoEmPp,
  type Dados,
} from "../src/lib/pedidos-cartoes.ts";
import type { PedidosBrandRow, PedidosDailyRow } from "../src/lib/api-client.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

const dia = (n: number, tk: number, tkc: number, ml: number, mlc: number, gmv: number): PedidosDailyRow => ({
  date: `2026-10-${String(n).padStart(2, "0")}`, tiktok_orders: tk, tiktok_canceled: tkc, ml_orders: ml, ml_canceled: mlc, total_orders: tk + ml, total_gmv: gmv,
});
const marca = (brand: string, label: string, x: Partial<PedidosBrandRow>): PedidosBrandRow =>
  ({ brand, label, tiktok_orders: null, tiktok_canceled: null, tiktok_cancel_rate_pct: null, tiktok_gmv: null, ml_orders: null, ml_canceled: null, ml_cancel_rate_pct: null, ml_gmv: null, total_orders: 0, total_gmv: 0, ...x });

const AMBOS = { tiktok: true, ml: true };

test("cancelamento: a regra de severidade que ja' existia (<2 bom, <5 atencao, senao critico; sem valor = ausente)", () => {
  assert.equal(tomDoCancelamento(null), "ausente");
  assert.equal(tomDoCancelamento(1.99), "bom");
  assert.equal(tomDoCancelamento(2), "atencao");
  assert.equal(tomDoCancelamento(4.99), "atencao");
  assert.equal(tomDoCancelamento(5), "critico");
});

test("series: reais, com a cauda sem pedido cortada (o 'hoje' zerado do D-1 nao puxa a tendencia)", () => {
  const daily = [dia(1, 10, 1, 20, 2, 1000), dia(2, 12, 0, 18, 1, 1100), dia(3, 11, 1, 22, 2, 1200), dia(4, 9, 0, 21, 3, 900), dia(5, 0, 0, 0, 0, 0)];
  const s = seriesDoPeriodo(daily, AMBOS);
  assert.deepEqual(s.pedidos, [30, 30, 33, 30]);
  assert.deepEqual(s.gmv, [1000, 1100, 1200, 900]);
  assert.deepEqual(s.tkPedidos, [10, 12, 11, 9]);
  assert.deepEqual(s.mlCancelados, [2, 1, 2, 3]);
  // ticket e' razao ponto a ponto; taxa = cancelados / pedidos dos canais selecionados
  assert.deepEqual(s.ticket.map((v) => Math.round(v * 100) / 100), [33.33, 36.67, 36.36, 30]);
  assert.equal(Math.round(s.cancelamento[0] * 100) / 100, 10);
});

test("series: sem pedido em nenhum dia nao inventa ponto; selecao de canal vale para a taxa", () => {
  assert.deepEqual(seriesDoPeriodo([dia(1, 0, 0, 0, 0, 0)], AMBOS).pedidos, []);
  const daily = [dia(1, 10, 5, 100, 0, 1)];
  assert.equal(seriesDoPeriodo(daily, { tiktok: true, ml: false }).cancelamento[0], 50);
  assert.equal(seriesDoPeriodo(daily, { tiktok: false, ml: true }).cancelamento[0], 0);
  assert.deepEqual(serieDoDetalhe("tk_pedidos", seriesDoPeriodo(daily, AMBOS)), [10]);
});

test("detalhe por marca: com valor primeiro (maior -> menor), 'Sem dado' depois, formato da casa", () => {
  const marcas = [
    marca("b", "KOKESHI", { total_orders: 11_000, total_gmv: 790_000 }),
    marca("c", "LESCENT", { total_orders: 0, total_gmv: 0 }),
    marca("a", "BARBOURS", { total_orders: 21_000, total_gmv: 2_580_000 }),
  ];
  const ped = linhasPorMarca("total_pedidos", marcas, AMBOS);
  assert.deepEqual(ped.map((l) => [l.label, l.valor]), [["BARBOURS", "21,0 mil"], ["KOKESHI", "11,0 mil"], ["LESCENT", "0"]]);
  assert.equal(ped[0].pct, 100);
  assert.equal(linhasPorMarca("total_gmv", marcas, AMBOS)[0].valor, "R$ 2,58 mi");
  // ticket: marca sem pedido nao tem ticket -> "Sem dado", nunca R$ 0
  const tk = linhasPorMarca("ticket", marcas, AMBOS);
  assert.equal(tk[tk.length - 1].label, "LESCENT");
  assert.deepEqual([tk[2].valor, tk[2].ausente, tk[2].pct], ["Sem dado", true, null]);
});

test("detalhe por marca: cancelamento por canal usa a taxa da API e diz quantos cancelados; sem taxa = Sem dado", () => {
  const marcas = [
    marca("a", "A", { tiktok_cancel_rate_pct: 3.2, tiktok_canceled: 1200 }),
    marca("b", "B", { tiktok_cancel_rate_pct: null }),
    marca("c", "C", { tiktok_cancel_rate_pct: 1.1, tiktok_canceled: 80 }),
  ];
  const l = linhasPorMarca("tk_cancelados", marcas, AMBOS);
  assert.deepEqual(l.map((x) => x.valor), ["3,2% · 1,2 mil cancelados", "1,1% · 80 cancelados", "Sem dado"]);
  assert.equal(l[0].pct, 100);
});

test("detalhe por marca: taxa total soma so' os canais selecionados", () => {
  const m = [marca("a", "A", { tiktok_orders: 100, tiktok_canceled: 10, ml_orders: 100, ml_canceled: 0 })];
  assert.equal(linhasPorMarca("cancelamento", m, AMBOS)[0].valor, "5,0% · 10 cancelados");
  assert.equal(linhasPorMarca("cancelamento", m, { tiktok: false, ml: true })[0].valor, "0,0% · 0 cancelados");
});

test("detalhe por canal: so' nos 4 totais e so' com canal selecionado", () => {
  const d: Dados = {
    kpis: { total_orders: 100, total_gmv: 5000, avg_ticket: 50, cancel_rate_pct: 2 },
    tk: { orders: 60, canceled: 3, gmv: 3000, cancel_rate_pct: 5, delivered: null },
    ml: { orders: 40, canceled: 1, gmv: 2000, cancel_rate_pct: 2.5, delivered: 30 },
  };
  assert.deepEqual(linhasPorCanal("total_pedidos", d, AMBOS).map((l) => [l.label, l.valor]), [["TikTok Shop", "60"], ["Mercado Livre", "40"]]);
  assert.equal(linhasPorCanal("total_gmv", d, AMBOS)[0].valor, "R$ 3,0 mil");
  assert.equal(linhasPorCanal("ticket", d, AMBOS)[1].valor, "R$ 50,00");
  assert.equal(linhasPorCanal("cancelamento", d, AMBOS)[0].valor, "5,0%");
  assert.equal(linhasPorCanal("total_pedidos", d, { tiktok: true, ml: false }).length, 1);
  assert.deepEqual(linhasPorCanal("tk_pedidos", d, AMBOS), []);
});

test("valor exato do detalhe (o cartao mostra o curto)", () => {
  const d: Dados = {
    kpis: { total_orders: 39400, total_gmv: 3878644, avg_ticket: 98.44, cancel_rate_pct: 4.6 },
    tk: { orders: 1234, canceled: 56, gmv: 1, cancel_rate_pct: 4.5, delivered: null },
    ml: undefined,
  };
  assert.equal(valorExato("total_pedidos", d), "39.400");
  assert.equal(valorExato("total_gmv", d).replace(/\s/g, " "), "R$ 3.878.644");
  assert.equal(valorExato("ticket", d).replace(/\s/g, " "), "R$ 98,44");
  assert.equal(valorExato("cancelamento", d), "4,6%");
  assert.equal(valorExato("tk_pedidos", d), "1.234");
  assert.equal(valorExato("ml_pedidos", d), "—"); // canal ausente nunca vira 0
  assert.equal(valorExato("total_pedidos", { kpis: null, tk: null, ml: null }), "—");
});

test("pagina de Pedidos: sem KpiCard legado nem CanalCard, formato da casa, dialogo unico, estados via StateBlock", () => {
  const pag = ler("app/pedidos/page.tsx");
  assert.ok(!pag.includes("KpiCard") && !pag.includes("CanalCard"), "cartoes do padrao no lugar dos legados");
  assert.ok(!/\bfmtBrl\(/.test(pag) && !/\.toFixed\(/.test(pag), "sem fmtBrl()/toFixed (K/M e ponto decimal)");
  assert.equal((pag.match(/<KpiDrilldownDialog/g) ?? []).length, 1, "um dialogo na pagina");
  assert.ok(pag.includes("icone={detalhe ?") && pag.includes("identidade={detalhe ?"), "o modal herda icone e cor do cartao");
  assert.ok(pag.includes("{detalhe && dataIsFresh && ("), "detalhe so' com dado fresco");
  // ALVO-GRADE: uma faixa so' (a da aba ativa), um esqueleto so'.
  assert.equal((pag.match(/<FaixaCarregando/g) ?? []).length, 1);
  for (const t of ['tipo="erro"', 'tipo="indisponivel" titulo="API offline — pedidos indisponíveis."', 'tipo="vazio" titulo="Sem dados de canais disponíveis."']) {
    assert.ok(pag.includes(t), t);
  }
  assert.ok(!pag.includes("bg-rose-50 border border-rose-200"), "sem a caixa de erro feita a mao");
});

test("cartoes de Pedidos: so' as 7 identidades existentes; canal e' ponto; so' Entregues por canal nao abre detalhe", () => {
  const src = ler("src/components/pedidos/PedidosCartoes.tsx");
  const usadas = [...src.matchAll(/identidade[:=]\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(usadas.length >= 10);
  for (const id of new Set(usadas)) assert.ok(["gmv", "pedidos", "ticket", "ads", "roas", "prazo", "atendimento"].includes(id), id);
  // ALVO-GRADE: o canal e' o ponto da aba (`visoes` na pagina), nunca cor de cartao.
  assert.ok(ler("app/pedidos/page.tsx").includes('ponto: "bg-canal-tiktok"'));
  assert.ok(src.includes("cor={`rgb(var(--tc-kpi-${identidade}))`}"), "cor do cartao so' por token de identidade");
  assert.ok(src.includes("valor={fmtBrlCurto(dados.gmv)} onAbrir={() => onAbrir(chaveGmv)}"), "GMV do canal abre o detalhe por marca (a API traz tiktok_gmv/ml_gmv por marca)");
  assert.ok(/rotulo="Entregues"[^\n]*\/>/.test(src) && !/rotulo="Entregues"[^\n]*onAbrir/.test(src));
  assert.ok(src.includes("legenda={ausente ? AUSENTE : legenda}") && src.includes("onAbrir={ausente ? undefined : onAbrir}"), "ausencia = N/D com o motivo escrito, nunca zero");
});

test("GMV por canal: detalhe por marca existe, sem tendencia (a API nao traz GMV por canal por dia)", () => {
  const marcas = [
    marca("a", "A", { tiktok_gmv: 2_000_000, ml_gmv: 500_000 }),
    marca("b", "B", { tiktok_gmv: 900_000, ml_gmv: null }),
    marca("c", "C", { tiktok_gmv: null, ml_gmv: 1_200_000 }),
  ];
  assert.deepEqual(linhasPorMarca("tk_gmv", marcas, AMBOS).map((l) => [l.label, l.valor]), [["A", "R$ 2,00 mi"], ["B", "R$ 900,0 mil"], ["C", "Sem dado"]]);
  assert.deepEqual(linhasPorMarca("ml_gmv", marcas, AMBOS).map((l) => l.label), ["C", "A", "B"]);
  const s0 = seriesDoPeriodo([dia(1, 1, 0, 1, 0, 1), dia(2, 1, 0, 1, 0, 1), dia(3, 1, 0, 1, 0, 1), dia(4, 1, 0, 1, 0, 1)], AMBOS);
  assert.deepEqual(serieDoDetalhe("tk_gmv", s0), []);
  const d: Dados = { kpis: null, tk: { orders: 1, canceled: 0, gmv: 3_360_000, cancel_rate_pct: 0, delivered: null }, ml: null };
  assert.equal(valorExato("tk_gmv", d).split(String.fromCharCode(160)).join(" "), "R$ 3.360.000");
  assert.equal(valorExato("ml_gmv", d), "—");
});

test("taxa: a variacao do detalhe e' em pontos percentuais (nao relativa); sem serie curta", () => {
  assert.equal(variacaoEmPp([1, 2, 3]), null);
  assert.equal(variacaoEmPp([4, 4, 4, 5, 5, 5]), 1);
  assert.ok(Object.is(variacaoEmPp([3.8, 3.8, 3.8, 3.78, 3.78, 3.78]), 0), "-0,02 arredonda para 0, sem sinal");
  assert.ok(Math.abs(variacaoEmPp([3.8, 3.8, 3.8, 3.3, 3.3, 3.3])! - -0.5) < 1e-9, "3,8% -> 3,3% = -0,5 p.p.");
  const src = ler("src/components/pedidos/PedidosDrilldownContent.tsx");
  assert.ok(src.includes('fmtDelta(variacaoEmPp(t.pontos)!, "pp")') && src.includes('chave === "cancelamento"'));
});

test("KpiTile: o rodape ocupa a largura do cartao (o grafico fica sempre a direita, em qualquer largura)", () => {
  const kpi = ler("src/components/ui/KpiTile.tsx");
  assert.ok(kpi.includes("self-stretch pt-1"), "rodape com self-stretch (o <button> traz align-items:flex-start)");
  assert.ok(kpi.includes('<span className="ml-auto">'), "e o grafico com ml-auto quando quebra para a linha de baixo");
});

test("B1-04: o cartao de pedidos e' LIQUIDO (sem cancelados), o mesmo do grafico diario e do ticket", async () => {
  const { paraPedidosLiquidos, pedidosLiquidosDaMarca, TITULO_DETALHE } = await import("../src/lib/pedidos-cartoes.ts");
  // Numeros do QA (12/10 a 10/11, so' ML): API bruto 63.948 = 61.792 pagos + 2.156 cancelados.
  const bruto: Dados = {
    kpis: { total_orders: 63_948, total_gmv: 4_962_256.9, avg_ticket: 80.31, cancel_rate_pct: 3.37 },
    tk: undefined,
    ml: { orders: 63_948, canceled: 2_156, gmv: 4_962_256.9, cancel_rate_pct: 3.37, delivered: null },
  };
  const liq = paraPedidosLiquidos(bruto);
  assert.equal(liq.kpis!.total_orders, 61_792, "card = soma do grafico diario");
  assert.equal(Math.round((liq.kpis!.total_gmv / liq.kpis!.total_orders) * 100) / 100, 80.31, "ticket fecha com o card");
  assert.equal(liq.ml!.orders, 61_792);
  assert.equal(liq.ml!.canceled, 2_156, "cancelados ficam a parte, intactos");
  assert.equal(valorExato("total_pedidos", liq), "61.792", "o detalhe nao contradiz o cartao");
  // TikTok: a API ja' manda tiktok.orders liquido -> nao desconta de novo
  const tk = paraPedidosLiquidos({
    kpis: { total_orders: 110, total_gmv: 1, avg_ticket: 1, cancel_rate_pct: 1 },
    tk: { orders: 60, canceled: 5, gmv: 1, cancel_rate_pct: 1, delivered: null },
    ml: { orders: 50, canceled: 5, gmv: 1, cancel_rate_pct: 1, delivered: null },
  });
  assert.deepEqual([tk.kpis!.total_orders, tk.tk!.orders, tk.ml!.orders], [100, 60, 45]);
  assert.deepEqual(paraPedidosLiquidos({ kpis: null, tk: null, ml: null }), { kpis: null, tk: null, ml: null });
  // por marca: total da API (tk + ml + ml_canceled) sem os cancelados do ML
  const m = marca("a", "BARBOURS", { ml_orders: 17_890, ml_canceled: 684, total_orders: 18_574, total_gmv: 1_000 });
  assert.equal(pedidosLiquidosDaMarca(m), 17_890);
  assert.equal(linhasPorMarca("total_pedidos", [m], AMBOS)[0].valor, "17,9 mil");
  assert.equal(TITULO_DETALHE.total_pedidos, "Pedidos (sem cancelados)");
  const cart = ler("src/components/pedidos/PedidosCartoes.tsx");
  assert.ok(!cart.includes('"Total de pedidos"') && cart.includes("rotulo={TITULO_DETALHE.total_pedidos}"));
  assert.ok(ler("app/pedidos/page.tsx").includes("paraPedidosLiquidos({ kpis, tk, ml, sh })"));
});
