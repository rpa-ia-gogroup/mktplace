/**
 * Qualidade no padrao da Gerencial: cartoes por canal e detalhe por marca. Logica em
 * `src/lib/qualidade-cartoes.ts`; sem periodo anterior nem serie nesta fonte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CARTOES_DO_CANAL,
  DEF_QUALIDADE,
  fmtDias,
  linhasPorMarca,
  textoDoCartao,
  tituloDoDetalhe,
  type ChaveQualidade,
} from "../src/lib/qualidade-cartoes.ts";
import type { QualityBrandRow, QualityKpis } from "../src/lib/api-client.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const marca = (brand: string, label: string, x: Partial<QualityBrandRow>) => ({ brand, label, ...x }) as unknown as QualityBrandRow;

const KPIS = {
  tiktok_avg_delivery_days: 5.2, ml_cancel_rate_pct: 3.1, ml_not_delivered_rate_pct: 0.8, ml_avg_delivery_days: 3.9,
  shopee_cancel_rate_pct: null, shopee_return_rate_pct: 0,
} as unknown as QualityKpis;

test("formato da casa: '5,2 dias' e '3,1%', nunca '5.2d' nem '3.1%'", () => {
  assert.equal(fmtDias(5.2), "5,2 dias");
  assert.equal(fmtDias(1), "1,0 dia");
  assert.equal(fmtDias(null), "—");
  assert.equal(textoDoCartao("tk_entrega", KPIS).valor, "5,2 dias");
  assert.equal(textoDoCartao("ml_cancelamento", KPIS).valor, "3,1%");
  assert.equal(textoDoCartao("ml_entrega", KPIS).valor, "3,9 dias");
});

test("ausencia nunca vira zero; zero medido continua zero", () => {
  const sem = textoDoCartao("sh_cancelamento", KPIS);
  assert.deepEqual([sem.valor, sem.ausente], ["—", true]);
  const zero = textoDoCartao("sh_devolucao", KPIS);
  assert.deepEqual([zero.valor, zero.ausente], ["0,0%", false]);
  assert.deepEqual([textoDoCartao("ml_cancelamento", null).valor, textoDoCartao("ml_cancelamento", null).ausente], ["—", true]);
});

test("cartoes por canal: 1 + 3 + 2 definidos, todos com definicao; titulo do detalhe mantem o canal", () => {
  assert.deepEqual(Object.values(CARTOES_DO_CANAL).map((l) => l.length), [1, 3, 2]);
  for (const chave of Object.values(CARTOES_DO_CANAL).flat() as ChaveQualidade[]) assert.ok(chave in DEF_QUALIDADE, chave);
  assert.equal(tituloDoDetalhe("ml_cancelamento"), "Cancelamento · Mercado Livre");
  assert.equal(tituloDoDetalhe("sh_devolucao"), "Devolução · Shopee");
  assert.equal(tituloDoDetalhe("tk_entrega"), "Entrega · TikTok Shop");
  for (const d of Object.values(DEF_QUALIDADE)) assert.doesNotMatch(d.rotulo, /TikTok|ML|Shopee|TK|SH/, "rotulo curto: o grupo ja diz o canal");
});

test("ressalvas vao para o ⓘ (nao para o cartao): proxy de nao entregue e inicio dos dados do TikTok", () => {
  assert.equal(DEF_QUALIDADE.ml_nao_entregue.dica, "Proxy: pagos − entregues");
  assert.match(DEF_QUALIDADE.tk_entrega.dica!, /abr\/26/);
});

test("detalhe por marca: com valor primeiro (maior -> menor), 'Sem dado' depois, base do indicador na linha", () => {
  const marcas = [
    marca("k", "KOKESHI", { ml_cancel_rate_pct: 1.5, ml_cancelled_orders: 30, ml_total_orders: 2_000 }),
    marca("l", "LESCENT", { ml_cancel_rate_pct: null }),
    marca("b", "BARBOURS", { ml_cancel_rate_pct: 3.1, ml_cancelled_orders: 68, ml_total_orders: 2_194 }),
  ];
  const l = linhasPorMarca("ml_cancelamento", marcas);
  assert.deepEqual(l.map((x) => x.valor), ["3,1% · 68 de 2,2 mil pedidos", "1,5% · 30 de 2,0 mil pedidos", "Sem dado"]);
  assert.equal(l[0].pct, 100);
  assert.deepEqual([l[2].ausente, l[2].pct], [true, null]);
});

test("detalhe por marca: dias e devolucao; marca com 0 medido aparece como 0, nao como Sem dado", () => {
  const dias = linhasPorMarca("ml_entrega", [marca("a", "A", { ml_avg_delivery_days: 4.2 }), marca("b", "B", { ml_avg_delivery_days: 2.1 })]);
  assert.deepEqual(dias.map((x) => x.valor), ["4,2 dias", "2,1 dias"]);
  const dev = linhasPorMarca("sh_devolucao", [marca("a", "A", { shopee_return_rate_pct: 0, shopee_returned_orders: 0, shopee_orders: 900 }), marca("b", "B", {})]);
  assert.equal(dev[0].valor, "0,0% · 0 de 900 pedidos");
  assert.equal(dev[0].ausente, false);
  assert.equal(dev[1].valor, "Sem dado");
});

test("pagina de Qualidade: sem KpiCard legado, sem toFixed, dialogo unico, estados via StateBlock, esqueleto no formato do cartao", () => {
  const pag = ler("app/qualidade/page.tsx");
  assert.ok(!pag.includes("KpiCard") && !/\.toFixed\(/.test(pag), "sem KpiCard legado nem ponto decimal");
  assert.equal((pag.match(/<KpiDrilldownDialog/g) ?? []).length, 1);
  assert.ok(pag.includes("icone={detalhe ?") && pag.includes("identidade={detalhe ?") && pag.includes("{detalhe && dataIsFresh && ("));
  assert.ok(pag.includes('tipo="erro"') && !pag.includes("bg-rose-50 border border-rose-200"), "erro via StateBlock, sem a caixa rosa a mao");
  assert.ok(pag.includes("<FaixaCarregando cartoes={totalDeCartoes("));
  assert.ok(pag.includes("showTiktok && <GrupoQualidade") && pag.includes("showMl && <GrupoQualidade") && pag.includes("showShopee && <GrupoQualidade"), "so' canais selecionados");
});

test("cartoes de Qualidade: so' as 7 identidades; cartoes N/D do TikTok sem clique, com o motivo visivel (Gate DQ2)", () => {
  const src = ler("src/components/qualidade/QualidadeCartoes.tsx");
  const usadas = [...src.matchAll(/identidade[:=]\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(usadas.length >= 7);
  for (const id of new Set(usadas)) assert.ok(["gmv", "pedidos", "ticket", "ads", "roas", "prazo", "atendimento"].includes(id), id);
  assert.ok(src.includes("TIKTOK_UNAVAILABLE_QUALITY_METRICS.map"), "os dois cartoes N/D do TikTok continuam");
  const nd = src.slice(src.indexOf("TIKTOK_UNAVAILABLE_QUALITY_METRICS.map"));
  assert.ok(nd.includes("valor={m.value}") && nd.includes("comparacao={m.subvalue}") && nd.includes('tom="ausente"') && !nd.includes("onAbrir"));
  assert.ok(src.includes("onAbrir={t.ausente ? undefined : () => onAbrir(chave)}"), "sem valor, sem clique");
});
