// T-0089 — a Gerencial (home) abre com os TRES canais, e o "GMV do periodo"
// e' a soma de TikTok + ML + Shopee. As outras telas seguem no Consolidado.
// Roda via `node --test` com type-stripping nativo do Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_FILTER_DEFAULTS } from "../src/lib/filters/home-defaults.ts";
import { computeDefaultFilters, filtersToSearchParams, resolveFilters } from "../src/lib/filters/url-state.ts";
import { DEFAULT_MARKETPLACE_SELECTION, serializeMarketplaceSelection } from "../src/lib/marketplace-filter.ts";
import { buildKpiBand } from "../src/lib/gerencial/kpi-band.ts";
import { fmtBrlFull } from "../src/lib/formatters.ts";
import type { OverviewData } from "../src/lib/api-client.ts";

// Data fixa: 2026-11-11 (quarta).
const now = () => new Date(2026, 10, 11);

test("home: URL vazia abre com os tres canais, TikTok incluso", () => {
  const f = resolveFilters(new URLSearchParams(), { ...HOME_FILTER_DEFAULTS, now });
  assert.deepEqual(f.channels, ["tiktok", "ml", "shopee"]);
  assert.ok(f.channels.includes("tiktok"));
  // Periodo e comparacao da home nao mudaram.
  assert.deepEqual([f.dateFrom, f.dateTo, f.compare], ["2026-11-01", "2026-11-10", true]);
});

test("home: o padrao materializado na URL e' channels=all e relido igual (sem refetch espurio)", () => {
  const defaults = computeDefaultFilters({ ...HOME_FILTER_DEFAULTS, now });
  const params = filtersToSearchParams(defaults);
  assert.equal(params.get("channels"), "all");
  assert.deepEqual(resolveFilters(params, { ...HOME_FILTER_DEFAULTS, now }), defaults);
});

test("home: channels explicito na URL continua mandando", () => {
  const f = resolveFilters(new URLSearchParams("channels=ml%2Cshopee"), { ...HOME_FILTER_DEFAULTS, now });
  assert.deepEqual(f.channels, ["ml", "shopee"]);
});

test("outras telas: sem defaultChannels o padrao segue o Consolidado (ML + Shopee)", () => {
  assert.deepEqual(DEFAULT_MARKETPLACE_SELECTION, ["ml", "shopee"]);
  const f = computeDefaultFilters({ defaultPreset: "mes_anterior", now });
  assert.deepEqual(f.channels, ["ml", "shopee"]);
});

test("home: o KPI de GMV e' a soma dos 3 canais no periodo", () => {
  const channels = computeDefaultFilters({ ...HOME_FILTER_DEFAULTS, now }).channels;
  // O /overview e' pedido com a selecao serializada: os 3 canais = "all".
  assert.equal(serializeMarketplaceSelection(channels), "all");

  // Fixture: resposta do /overview com marketplace=all no periodo.
  const tiktok = 312_450.5;
  const ml = 1_204_300.25;
  const shopee = 845_120;
  const overview: OverviewData = {
    gmv: tiktok + ml + shopee,
    tiktok_gmv: tiktok, ml_gmv: ml, shopee_gmv: shopee,
    orders: 21_000, avg_ticket: 112.5, ad_spend: 50_000,
    ml_roas: 8, ml_cancel_rate_pct: 2, shopee_roas: 9,
    tiktok_customers: 3_000, ml_unique_buyers: 9_000, shopee_unique_buyers: 8_000,
    gmv_mom_pct: 4, prev_gmv: 2_270_000,
  };

  const gmv = buildKpiBand(overview, channels).find((k) => k.key === "gmv");
  assert.ok(gmv);
  assert.equal(gmv.exactValue, fmtBrlFull(tiktok + ml + shopee));
  // A quebra do card mostra os tres canais — o TikTok nao some.
  assert.equal(
    gmv.subvalue,
    `TK ${fmtBrlFull(tiktok)} · ML ${fmtBrlFull(ml)} · SH ${fmtBrlFull(shopee)}`,
  );
});
