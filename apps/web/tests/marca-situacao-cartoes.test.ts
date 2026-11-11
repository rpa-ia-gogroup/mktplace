/**
 * Pagina de marca no padrao da Gerencial: os 4 cartoes da Situacao (GMV, Pedidos,
 * Ticket, Ad Spend) saem do MESMO dado do periodo; ausencia nunca vira zero; pilula
 * e "antes" so' com periodo anterior REAL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cartoesSituacao, valorCurto, valorExato } from "../src/lib/brand/situacao-cartoes.ts";
import { summarize } from "../src/lib/brand-daily-summary.ts";
import type { DailyRow } from "../src/lib/mock-daily.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const TODOS = ["tiktok", "ml", "shopee"];

function dia(n: number, gmv: number, orders: number, ad: number | null): DailyRow {
  return { date: `2026-10-${String(n).padStart(2, "0")}`, tiktok_gmv: null, ml_gmv: gmv, shopee_gmv: null, total_gmv: gmv, orders, avg_ticket: orders > 0 ? gmv / orders : null, ad_spend: ad };
}
const ATUAL = [dia(1, 1000, 10, 100), dia(2, 2000, 20, 200), dia(3, 3000, 30, 300), dia(4, 4000, 40, 400)];
const ANTERIOR = [dia(1, 5000, 50, 500), dia(2, 5000, 50, 500)];
const c = (cur: DailyRow[], prev: DailyRow[], tem: boolean, ok = true) =>
  cartoesSituacao(summarize(cur, TODOS, ok), summarize(prev, TODOS, ok), cur, tem);

test("valores, periodo anterior e variacao do mesmo dado do periodo", () => {
  const [gmv, pedidos, ticket, ads] = c(ATUAL, ANTERIOR, true);
  assert.deepEqual([gmv.valor, gmv.antes, Math.round(gmv.deltaPct!)], [10000, 10000, 0]);
  assert.deepEqual([pedidos.valor, pedidos.antes], [100, 100]);
  assert.equal(ticket.valor, 100);
  assert.equal(ads.valor, 1000);
  assert.deepEqual(gmv.serie, [1000, 2000, 3000, 4000]);
});

test("sem comparacao ou sem janela anterior real: nada de pilula nem 'antes'", () => {
  for (const x of c(ATUAL, ANTERIOR, false)) assert.deepEqual([x.antes, x.deltaPct], [null, null], x.chave);
  for (const x of c(ATUAL, [], true)) assert.deepEqual([x.antes, x.deltaPct], [null, null], x.chave);
});

test("ausencia nunca vira zero: pedidos nao confiaveis, 0 pedidos e sem Ad Spend", () => {
  const demo = c(ATUAL, ANTERIOR, true, false);
  assert.equal(demo[1].valor, null, "pedidos N/D na selecao parcial do demo");
  assert.equal(demo[2].valor, null, "ticket N/D junto");
  assert.deepEqual(demo[1].serie, []);
  const zero = c([dia(1, 0, 0, null)], [], false);
  assert.equal(zero[2].valor, null, "ticket de 0 pedidos nao e' R$ 0");
  assert.equal(zero[3].valor, null, "sem Ad Spend e' ausencia");
  assert.deepEqual(zero[3].serie, []);
});

test("formato da casa no cartao e valor exato no detalhe", () => {
  assert.equal(valorCurto("pedidos", 58600), "58,6 mil");
  assert.match(valorCurto("gmv", 4_900_000), /^R\$\s4,9 ?mi|R\$\s4,90 mi/);
  assert.equal(valorExato("pedidos", 58612), "58.612");
  assert.match(valorExato("gmv", 4903211.5), /^R\$\s4\.903\.211,50$/);
});

test("pagina: cartoes gerenciais, so' as identidades existentes, dialogo unico com icone e cor do cartao", () => {
  const COMP = ler("src/components/brand/SituacaoCartoes.tsx");
  const PAG = ler("app/brand/[brand]/page.tsx");
  assert.equal((COMP.match(/variante="gerencial"/g) ?? []).length, 1);
  assert.deepEqual([...COMP.matchAll(/identidade: "([a-z]+)"/g)].map((m) => m[1]), ["gmv", "pedidos", "ticket", "ads"]);
  assert.ok(!PAG.includes("<KpiCard") && !PAG.includes("SkeletonKpiCard"), "sem cartao legado");
  assert.ok(PAG.includes("<FaixaCarregando cartoes={4}"));
  assert.equal((PAG.match(/<KpiDrilldownDialog/g) ?? []).length, 1);
  assert.ok(PAG.includes("identidade={dialog?.kind === \"kpi\" ? VISUAL_SITUACAO[dialog.chave].identidade : undefined}"));
});
