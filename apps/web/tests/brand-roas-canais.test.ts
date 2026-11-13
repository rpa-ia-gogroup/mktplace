// T-0113 (A1-18): ROAS da Marca 360 so' sobre os canais selecionados COM Ads.
// Numerador e denominador saem do mesmo conjunto de canais; Ads null != Ads 0;
// nenhum canal com Ads => null, nunca 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roasPorCanaisComAds, rotuloCanaisRoas, type LinhaRoasCanal } from "../src/lib/brand-roas.ts";
import type { DailyRow } from "../src/lib/mock-daily.ts";

const TODOS = ["tiktok", "ml", "shopee"];

function linha(o: Partial<LinhaRoasCanal>): LinhaRoasCanal {
  return { tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, ...o };
}

test("3 canais, Ads so' na Shopee: ROAS usa so' o GMV da Shopee, nao o GMV total", () => {
  // Estilo Apice: TikTok domina o GMV e nao tem Ads. Pela regra antiga,
  // (2.400.000 + 80.000 + 120.000) / 10.000 = 260x. O real e' 120.000 / 10.000 = 12x.
  const linhas = [
    linha({ tiktok_gmv: 1_200_000, ml_gmv: 40_000, shopee_gmv: 60_000, tiktok_ad_spend: null, ml_ad_spend: null, shopee_ad_spend: 4_000 }),
    linha({ tiktok_gmv: 1_200_000, ml_gmv: 40_000, shopee_gmv: 60_000, tiktok_ad_spend: null, ml_ad_spend: null, shopee_ad_spend: 6_000 }),
  ];
  const r = roasPorCanaisComAds(linhas, TODOS);
  assert.equal(r.roas, 12);
  assert.notEqual(r.roas, (2_400_000 + 80_000 + 120_000) / 10_000);
  assert.deepEqual(r.canais, ["shopee"]);
  assert.equal(r.rotulo, "só Shopee");
});

test("Ads nos 3 canais: ROAS = GMV total / Ads total", () => {
  const linhas = [
    linha({ tiktok_gmv: 1000, ml_gmv: 500, shopee_gmv: 300, tiktok_ad_spend: 100, ml_ad_spend: 50, shopee_ad_spend: 30 }),
    linha({ tiktok_gmv: 2000, ml_gmv: 700, shopee_gmv: 500, tiktok_ad_spend: 200, ml_ad_spend: 70, shopee_ad_spend: 50 }),
  ];
  const r = roasPorCanaisComAds(linhas, TODOS);
  assert.equal(r.roas, (1000 + 500 + 300 + 2000 + 700 + 500) / (100 + 50 + 30 + 200 + 70 + 50));
  assert.deepEqual(r.canais, ["tiktok", "ml", "shopee"]);
  assert.equal(r.rotulo, "TikTok Shop + Mercado Livre + Shopee");
});

test("nenhum Ads (null, 0 ou ausente em todos): roas null, nunca 0", () => {
  const linhas = [
    linha({ tiktok_gmv: 1000, ml_gmv: 500, shopee_gmv: 300, tiktok_ad_spend: null, ml_ad_spend: 0, shopee_ad_spend: null }),
    linha({ tiktok_gmv: 1000, ml_gmv: 500, shopee_gmv: 300, ml_ad_spend: 0 }),
  ];
  const r = roasPorCanaisComAds(linhas, TODOS);
  assert.equal(r.roas, null);
  assert.deepEqual(r.canais, []);
  assert.equal(r.rotulo, "");
  assert.equal(roasPorCanaisComAds([], TODOS).roas, null);
});

test("canal com Ads fora da selecao nao entra", () => {
  const linhas = [
    linha({ tiktok_gmv: 9000, ml_gmv: 800, shopee_gmv: 300, tiktok_ad_spend: 10, ml_ad_spend: 100, shopee_ad_spend: 30 }),
  ];
  const r = roasPorCanaisComAds(linhas, ["ml"]);
  assert.equal(r.roas, 8);
  assert.deepEqual(r.canais, ["ml"]);
  assert.equal(r.rotulo, "só Mercado Livre");

  const consolidado = roasPorCanaisComAds(linhas, ["ml", "shopee"]);
  assert.equal(consolidado.roas, (800 + 300) / (100 + 30));
  assert.equal(consolidado.rotulo, "Mercado Livre + Shopee");
});

test("Ads null num canal e > 0 em outro: so' o canal com gasto entra; GMV do periodo inteiro", () => {
  const linhas = [
    // ML com Ads so' no dia 1; o GMV do dia 2 (sem Ads) tambem conta para o ML.
    linha({ ml_gmv: 1000, shopee_gmv: 5000, ml_ad_spend: 100, shopee_ad_spend: null }),
    linha({ ml_gmv: 500, shopee_gmv: 5000, ml_ad_spend: null, shopee_ad_spend: null }),
  ];
  const r = roasPorCanaisComAds(linhas, ["ml", "shopee"]);
  assert.equal(r.roas, 15);
  assert.deepEqual(r.canais, ["ml"]);
  assert.equal(r.rotulo, "só Mercado Livre");
});

test("mesmo helper para o periodo anterior: entrada diferente, mesma regra", () => {
  const atual = [linha({ ml_gmv: 1000, shopee_gmv: 900, ml_ad_spend: 100 })];
  const anterior = [linha({ ml_gmv: 600, shopee_gmv: 900, ml_ad_spend: 50, shopee_ad_spend: 90 })];
  assert.equal(roasPorCanaisComAds(atual, TODOS).roas, 10);
  assert.equal(roasPorCanaisComAds(anterior, TODOS).roas, (600 + 900) / (50 + 90));
});

test("NaN/Infinity em Ads ou GMV nao vira numero", () => {
  const linhas = [linha({ ml_gmv: Number.NaN, ml_ad_spend: Number.NaN, shopee_gmv: 400, shopee_ad_spend: Number.POSITIVE_INFINITY })];
  const r = roasPorCanaisComAds(linhas, TODOS);
  assert.equal(r.roas, null);
});

test("DailyRow de hoje (so' `ad_spend` combinado) nao e' atribuido a canal nenhum", () => {
  // O `ad_spend` combinado nao diz de que canal veio o gasto: o helper nao le esse campo.
  const hoje: DailyRow[] = [
    { date: "2026-10-01", tiktok_gmv: 9000, ml_gmv: 800, shopee_gmv: 300, total_gmv: 10100, orders: 10, avg_ticket: 1010, ad_spend: 100 },
  ];
  assert.equal(roasPorCanaisComAds(hoje, TODOS).roas, null);
});

test("rotulo segue a ordem canonica e os nomes de exibicao", () => {
  assert.equal(rotuloCanaisRoas(["shopee"]), "só Shopee");
  assert.equal(rotuloCanaisRoas(["tiktok"]), "só TikTok Shop");
  assert.equal(rotuloCanaisRoas(["ml", "shopee"]), "Mercado Livre + Shopee");
  assert.equal(rotuloCanaisRoas([]), "");
});
