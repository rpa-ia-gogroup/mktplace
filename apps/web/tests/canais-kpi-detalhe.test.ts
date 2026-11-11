/**
 * Canais no padrao da Gerencial: os 12 cartoes (TikTok 4, Mercado Livre 3, Shopee 5)
 * e o detalhe por marca que o clique abre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { KPI_CANAL, linhasPorMarca, textoDoCartao, type KpiCanalChave } from "../src/lib/canais-kpi-detalhe.ts";
import type { CanaisBrandRow, CanaisKpis } from "../src/lib/api-client.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

const KPIS = {
  tiktok_video_pct: 54.5,
  tiktok_live_pct: 30,
  tiktok_card_pct: null,
  tiktok_gmv_video: 35_500,
  tiktok_gmv_live: 20_000,
  tiktok_gmv_card: null,
  tiktok_conversion_rate: 1.25,
  tiktok_customers: 1_240,
  ml_new_buyer_pct: 88.1,
  ml_new_buyers: 12_300,
  ml_repeat_buyer_rate_pct: 11.9,
  ml_repeat_buyers: 900,
  ml_gmv_per_buyer: 143.27,
  ml_unique_buyers: 14_000,
  shopee_new_buyer_pct: null,
  shopee_new_buyers: null,
  shopee_repeat_buyer_rate_pct: null,
  shopee_repeat_buyers: null,
  shopee_gmv_per_buyer: null,
  shopee_unique_buyers: null,
  shopee_visitors: 35_500,
  shopee_conversion_rate: null,
} as unknown as CanaisKpis;

const marca = (brand: string, label: string, extra: Partial<CanaisBrandRow>) => ({ brand, label, ...extra }) as unknown as CanaisBrandRow;

test("cartao: formato pt-BR da casa, nunca K/M com ponto", () => {
  assert.equal(textoDoCartao("tiktok_video", KPIS).valor, "54,5%");
  assert.equal(textoDoCartao("tiktok_video", KPIS).comparacao, "R$ 35,5 mil");
  assert.equal(textoDoCartao("ml_novos", KPIS).comparacao, "12,3 mil novos");
  assert.equal(textoDoCartao("ml_gmv_comprador", KPIS).valor, "R$ 143,27");
  assert.equal(textoDoCartao("shopee_visitantes", KPIS).valor, "35,5 mil");
  assert.equal(textoDoCartao("shopee_visitantes", KPIS).comparacao, "Visitas ao perfil no mês");
  for (const chave of Object.keys(KPI_CANAL) as KpiCanalChave[]) {
    const t = textoDoCartao(chave, KPIS);
    assert.doesNotMatch(`${t.valor} ${t.comparacao ?? ""}`, /\d\.\d[KM]\b|\d\.\d%/, chave);
  }
});

test("cartao: ausencia nunca vira zero", () => {
  const sem = textoDoCartao("shopee_novos", KPIS);
  assert.deepEqual([sem.valor, sem.ausente, sem.comparacao], ["—", true, undefined]);
  assert.equal(textoDoCartao("tiktok_card", KPIS).valor, "—");
  const semKpis = textoDoCartao("ml_novos", null);
  assert.deepEqual([semKpis.valor, semKpis.ausente], ["—", true]);
  // "Compradores / Visitantes" e' texto fixo da definicao, nao dado: aparece mesmo sem valor.
  assert.equal(textoDoCartao("shopee_conversao", KPIS).comparacao, "Compradores / Visitantes");
});

test("detalhe por marca: com valor primeiro (maior -> menor), sem dado depois, barra coerente", () => {
  const marcas = [
    marca("kokeshi", "KOKESHI", { ml_new_buyer_pct: 70, ml_new_buyers: 1_000 }),
    marca("lescent", "LESCENT", { ml_new_buyer_pct: null }),
    marca("barbours", "BARBOURS", { ml_new_buyer_pct: 90.5, ml_new_buyers: 12_300 }),
  ];
  const l = linhasPorMarca("ml_novos", marcas);
  assert.deepEqual(l.map((x) => x.label), ["BARBOURS", "KOKESHI", "LESCENT"]);
  assert.equal(l[0].valor, "90,5% · 12,3 mil novos");
  assert.equal(l[0].pct, 90.5); // percentual: a barra e' o proprio valor
  assert.deepEqual([l[2].valor, l[2].ausente, l[2].pct], ["Sem dado", true, null]);
});

test("detalhe por marca: em reais a barra e' relativa ao maior; zero real continua zero, nao 'sem dado'", () => {
  const marcas = [
    marca("a", "A", { ml_gmv_per_buyer: 200, ml_unique_buyers: 10 }),
    marca("b", "B", { ml_gmv_per_buyer: 100, ml_unique_buyers: 10 }),
    marca("c", "C", { ml_gmv_per_buyer: 0, ml_unique_buyers: 0 }),
  ];
  const l = linhasPorMarca("ml_gmv_comprador", marcas);
  assert.deepEqual(l.map((x) => x.pct), [100, 50, 0]);
  assert.equal(l[2].ausente, false);
  assert.equal(l[2].valor, "R$ 0,00 · 0 compradores (soma diária)");
});

test("pagina de Canais: os 12 cartoes vem do padrao, sem StatCard, e o detalhe usa o dialogo unico", () => {
  const pag = ler("app/canais/page.tsx");
  assert.ok(!pag.includes("StatCard"), "nenhum StatCard na pagina");
  assert.equal((pag.match(/<KpiDrilldownDialog/g) ?? []).length, 1, "um dialogo na pagina");
  assert.ok(pag.includes("<KpiCanalDrilldownContent") && pag.includes("icone={kpiAberto ?"));
  for (const c of ["CHAVES_TIKTOK", "CHAVES_ML", "CHAVES_SHOPEE"]) assert.ok(pag.includes(c), c);
  assert.equal((pag.match(/<FaixaCarregando/g) ?? []).length, 3, "esqueleto no formato do cartao nas 3 faixas");
  // 4 + 3 + 5 = 12 chaves, todas com definicao
  const chaves = [...pag.matchAll(/const CHAVES_(?:TIKTOK|ML|SHOPEE): KpiCanalChave\[\] = \[([^\]]*)\]/g)].flatMap((m) => m[1].match(/"[a-z_]+"/g) ?? []);
  assert.equal(chaves.length, 12);
  for (const c of chaves) assert.ok(c.slice(1, -1) in KPI_CANAL, c);
});

test("cartao de Canais: so' as 7 identidades existentes; canal e' ponto, nao cor", () => {
  const cartao = ler("src/components/canais/CartaoKpiCanal.tsx");
  const usadas = [...cartao.matchAll(/identidade: "([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(usadas.length, 12);
  for (const id of new Set(usadas)) assert.ok(["gmv", "pedidos", "ticket", "ads", "roas", "prazo", "atendimento"].includes(id), id);
  assert.ok(cartao.includes('variante="gerencial"') && cartao.includes("onAbrir={() => onAbrir(chave)}"));
  assert.ok(cartao.includes("PONTO_DO_CANAL[def.canal]"));
});

test("modais da Gerencial e de Canais usam os formatadores da casa (nada de 35.5K)", () => {
  for (const f of ["src/components/KpiDrilldownContent.tsx", "src/components/ChannelComparisonDialogContent.tsx", "src/components/canais/KpiCanalDrilldownContent.tsx"]) {
    const src = ler(f);
    assert.ok(!/\bfmtNumber\(|\bfmtBrl\(/.test(src), `${f} nao usa fmtNumber/fmtBrl (formato K/M com ponto)`);
  }
});

test("KpiCardSkeleton: faixa anuncia uma vez (cartao mudo) e o cartao avulso continua anunciando", () => {
  const src = ler("src/components/ui/KpiCardSkeleton.tsx");
  assert.ok(src.includes("anunciar = true") && src.includes('role={anunciar ? "status" : undefined}'));
});
