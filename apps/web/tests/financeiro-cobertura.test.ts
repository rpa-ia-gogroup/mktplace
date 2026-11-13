// T-0085 — Financeiro: ausencia de taxa/repasse aparece como "—", sem barra, e
// o % consolidado parcial diz "parcial (N de M marcas)".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { textoCoberturaFinanceiro, textoParcialMarcas } from "../src/lib/full-visao-geral.ts";

const fonte = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("T-0085 consolidado parcial mostra N de M marcas", () => {
  // Shopee out/26: so' a kokeshi com taxa, 5 marcas com GMV.
  assert.equal(
    textoCoberturaFinanceiro({ status: "parcial", marcas_com_dado: 1, marcas_total: 5 }),
    "parcial (1 de 5 marcas)",
  );
  assert.equal(textoParcialMarcas(2, 4), "parcial (2 de 4 marcas)");
});

test("T-0085 cobertura completa, sem dado ou ausente nao gera aviso", () => {
  assert.equal(textoCoberturaFinanceiro({ status: "completa", marcas_com_dado: 5, marcas_total: 5 }), null);
  // sem dado: o % ja' vem nulo e a tela mostra "—"; nao ha' "parcial" a dizer.
  assert.equal(textoCoberturaFinanceiro({ status: "sem_dado", marcas_com_dado: 0, marcas_total: 5 }), null);
  assert.equal(textoCoberturaFinanceiro(null), null);
  assert.equal(textoCoberturaFinanceiro(undefined), null);
});

test("T-0085 a pagina liga a cobertura aos cartoes de taxa e mostra — para % nulo", () => {
  const src = fonte("app/financeiro/page.tsx");
  for (const campo of ["tiktok_fee_cobertura", "tiktok_settlement_cobertura", "ml_fee_cobertura", "shopee_fee_cobertura"]) {
    assert.ok(src.includes(`textoCoberturaFinanceiro(k?.${campo})`) || src.includes(`textoCoberturaFinanceiro(k.${campo})`), campo);
  }
  // % nulo vira travessao; a barra so' existe com pct numerico.
  assert.match(src, /pctTexto: k\?\.shopee_avg_fee_pct != null \? fmtPct\(k\.shopee_avg_fee_pct\) : "—"/);
  assert.match(src, /function fmtPct\(v: number \| null\): string \{\s*return v == null \? "—"/);
  const painel = fonte("src/components/financeiro/ChannelCostPanel.tsx");
  assert.match(painel, /l\.pct != null &&/, "sem pct, sem barra");
});

test("T-0085 o tipo publica os campos de cobertura como opcionais", () => {
  const src = fonte("src/lib/api-client.ts");
  for (const campo of ["tiktok_fee_cobertura", "tiktok_settlement_cobertura", "ml_fee_cobertura", "shopee_fee_cobertura", "shopee_settlement_cobertura"]) {
    assert.ok(src.includes(`${campo}?: CoberturaMarcas | null;`), campo);
  }
});

// ---------------------------------------------------------------------------
// T-0115 — "parcial sem aviso" (VAL-B1 B1-07/B1-08, VAL-A1 A1-12/A1-14)
// ---------------------------------------------------------------------------
import { buildKpiBand, notaAdsShopeeParcial } from "../src/lib/gerencial/kpi-band.ts";
import { buildChannelDiagnosis } from "../src/lib/channel-signal-reasons.ts";
import type { CanaisChannelRow, OverviewData } from "../src/lib/api-client.ts";

const ADS_SHOPEE_NOV = {
  status: "parcial", marcas_com_dado: 1, marcas_total: 5,
  marcas_sem_dado: ["apice", "barbours", "lescent", "rituaria"],
};

function overviewNov(patch: Partial<OverviewData> = {}): OverviewData {
  return {
    gmv: 4_047_474.97, tiktok_gmv: null, ml_gmv: null, shopee_gmv: 4_047_474.97,
    orders: 1000, avg_ticket: 40, ad_spend: 84_864.07,
    ml_roas: null, ml_cancel_rate_pct: null, shopee_roas: 13.52,
    tiktok_customers: null, ml_unique_buyers: null, shopee_unique_buyers: null,
    gmv_mom_pct: null, prev_gmv: null,
    ...patch,
  };
}

test("T-0115 B1-08 o cartao de Ads da home declara Ads Shopee parcial", () => {
  const band = buildKpiBand(overviewNov({ shopee_ads_cobertura: ADS_SHOPEE_NOV }), ["shopee"]);
  const ads = band.find((k) => k.key === "ad_spend")!;
  assert.match(ads.coverageNote ?? "", /Ads Shopee parcial \(1 de 5 marcas\)/);
  // cobertura completa ou API antiga (sem o campo): nenhuma nota de parcial
  const completa = buildKpiBand(
    overviewNov({ shopee_ads_cobertura: { status: "completa", marcas_com_dado: 5, marcas_total: 5 } }), ["shopee"],
  ).find((k) => k.key === "ad_spend")!;
  assert.doesNotMatch(completa.coverageNote ?? "", /parcial/);
  assert.equal(notaAdsShopeeParcial(undefined), null);
});

test("T-0115 B1-08 o Financeiro liga a cobertura do Ads Shopee ao cartao e o tipo a publica", () => {
  const src = fonte("app/financeiro/page.tsx");
  assert.ok(src.includes("textoCoberturaFinanceiro(k?.shopee_ads_cobertura)"));
  const tipos = fonte("src/lib/api-client.ts");
  assert.ok(tipos.includes("shopee_ads_cobertura?: CoberturaMarcas | null;"));
  assert.ok(tipos.includes("shopee_ads_cobertura: raw.current.shopee_ads_cobertura ?? null"));
  assert.equal(textoCoberturaFinanceiro(ADS_SHOPEE_NOV), "parcial (1 de 5 marcas)");
});

test("T-0115 A1-12 marca TikTok com repasse maturando: motivo de maturacao, sem 'custo alto'", () => {
  // Forma da linha que a API publica agora (custo indisponivel + aviso de maturacao).
  const row = {
    brand: "barbours", label: "BARBOURS", channel: "tiktok", channel_label: "TikTok Shop",
    gmv: 900_000, orders: 100, ad_spend: null, ad_revenue: null, ads_gmv_pct: null, roas: null,
    acos_pct: null, marketplace_cost_pct: null, seller_shipping_pct: null,
    ads_available: false, marketplace_cost_available: false, seller_shipping_available: false,
    ads_applicable: true, marketplace_cost_applicable: true, seller_shipping_applicable: false,
    ads_missing_reason: null,
    data_warning: "Repasse do TikTok ainda nao consolidado para esta marca no periodo",
    signals: ["sem_dado"],
  } as CanaisChannelRow;
  assert.ok(!row.signals.includes("custo_alto"));
  const d = buildChannelDiagnosis(row, null);
  assert.doesNotMatch(d.headline, /custo alto/i);
  assert.match(d.explanations.map((e) => e.reason).join(" "), /Repasse do TikTok ainda nao consolidado/);
});
