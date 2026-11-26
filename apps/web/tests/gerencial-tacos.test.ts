/**
 * Gerencial: o cartao "ACOS por canal" virou "TACOS por canal" (pedido do
 * Planejamento, 26/11/2026). O TACOS vem pronto da API (Ads / GMV total das
 * marcas com Ads); o front so' formata. Sem Ads = sem dado, nunca 0; marca sem
 * Ads = cobertura parcial no ⓘ, como o Ads Shopee de hoje.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildKpiBand, NOTA_TACOS } from "../src/lib/gerencial/kpi-band.ts";
import type { OverviewData } from "../src/lib/api-client.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

function ov(patch: Partial<OverviewData> = {}): OverviewData {
  return {
    gmv: 1000, tiktok_gmv: 400, ml_gmv: 400, shopee_gmv: 200, orders: 50, avg_ticket: 20, ad_spend: 100,
    ml_roas: 10, ml_cancel_rate_pct: 5, shopee_roas: 13, tiktok_customers: null, ml_unique_buyers: null,
    shopee_unique_buyers: null, gmv_mom_pct: null, prev_gmv: null,
    ml_tacos_pct: 4.88, shopee_tacos_pct: 6.48,
    ...patch,
  } as OverviewData;
}

const tacos = (o: OverviewData, canais = ["tiktok", "ml", "shopee"] as const) =>
  buildKpiBand(o, [...canais]).find((k) => k.key === "roas")!;

test("TACOS por canal: valor da API, nao o ACOS derivado do ROAS", () => {
  const k = tacos(ov());
  assert.equal(k.label, "TACOS por canal");
  const v = Object.fromEntries(k.channelValues!.map((c) => [c.channel, c.value]));
  assert.deepEqual(v, { ml: "4,9%", shopee: "6,5%" }); // TikTok nao aparece (regra do Planejamento)
  assert.ok(k.coverageNote?.startsWith(NOTA_TACOS));
});

test("sem TACOS na API (antiga ou canal sem Ads) = sem dado, nunca 0", () => {
  const k = tacos(ov({ ml_tacos_pct: null, shopee_tacos_pct: undefined }));
  assert.ok(k.channelValues!.every((c) => c.value == null));
  assert.equal(k.unavailableReason, "Sem TACOS disponível nos canais selecionados.");
});

test("marca sem Ads: cobertura parcial no ⓘ, ML e Shopee", () => {
  const parcial = { status: "parcial", marcas_com_dado: 3, marcas_total: 4, marcas_sem_dado: ["lescent"] };
  const k = tacos(ov({ ml_ads_cobertura: parcial, shopee_ads_cobertura: { ...parcial, marcas_com_dado: 4, marcas_total: 5 } }));
  assert.match(k.coverageNote ?? "", /Ads ML parcial \(3 de 4 marcas\)/);
  assert.match(k.coverageNote ?? "", /Ads Shopee parcial \(4 de 5 marcas\)/);
  // canal fora do filtro nao avisa
  assert.doesNotMatch(tacos(ov({ ml_ads_cobertura: parcial }), ["shopee"]).coverageNote ?? "", /Ads ML/);
});

test("o rodape e o detalhe falam TACOS; o ACOS da analise por produto nao muda", () => {
  assert.ok(ler("src/components/gerencial/KpiBand.tsx").includes("<span>TACOS {CANAL_CURTO"));
  const det = ler("src/components/KpiDrilldownContent.tsx");
  assert.ok(det.includes("overview.ml_tacos_pct") && !det.includes("acosDoRoas"));
  assert.ok(det.includes('kind !== "roas" && ('), "detalhe do TACOS sem numero grande '—'");
  assert.ok(ler("src/components/MercadoLivreProductTable.tsx").includes("ACOS"));
});
