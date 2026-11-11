// T-0089 — com os tres canais como padrao global, visao cuja fonte nao tem um
// canal avisa "sem dado nesta visão" em vez de calar ou mostrar 0.
// Roda via `node --test` com type-stripping nativo do Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { avisoCanaisSemDado, canaisSemDadoNaVisao } from "../src/lib/filters/channel-coverage.ts";
import { resolveFilters } from "../src/lib/filters/url-state.ts";
import { CONSOLIDADO_SELECTION, DEFAULT_MARKETPLACE_SELECTION } from "../src/lib/marketplace-filter.ts";

const RAIZ = join(import.meta.dirname, "..");
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

test("helper: padrao global numa visao so' Shopee (CX) avisa TikTok e ML sem dado, sem numero", () => {
  const aviso = avisoCanaisSemDado(DEFAULT_MARKETPLACE_SELECTION, ["shopee"]);
  assert.equal(aviso, "TikTok Shop e Mercado Livre sem dado nesta visão · mostrando só Shopee");
  assert.doesNotMatch(aviso!, /\d/, "sem dado nao vira 0");
  assert.deepEqual(canaisSemDadoNaVisao(DEFAULT_MARKETPLACE_SELECTION, ["shopee"]), ["tiktok", "ml"]);
});

test("helper: so' o TikTok fora da fonte", () => {
  assert.equal(
    avisoCanaisSemDado(DEFAULT_MARKETPLACE_SELECTION, ["ml", "shopee"]),
    "TikTok Shop sem dado nesta visão · mostrando só Mercado Livre e Shopee",
  );
});

test("helper: nada a avisar quando todo canal selecionado tem dado", () => {
  assert.equal(avisoCanaisSemDado(CONSOLIDADO_SELECTION, ["ml", "shopee"]), null);
  assert.equal(avisoCanaisSemDado(["shopee"], ["shopee"]), null);
});

test("helper: nenhum canal coberto -> so' o 'sem dado', sem 'mostrando'", () => {
  assert.equal(avisoCanaisSemDado(["tiktok"], ["shopee"]), "TikTok Shop sem dado nesta visão");
});

test("B1-05: aviso de Pedidos segue a selecao (ML + Shopee nao cita o TikTok)", () => {
  const pedidos = ["tiktok", "ml"] as const;
  assert.equal(
    avisoCanaisSemDado(CONSOLIDADO_SELECTION, pedidos),
    "Shopee sem dado nesta visão · mostrando só Mercado Livre",
  );
  assert.equal(
    avisoCanaisSemDado(DEFAULT_MARKETPLACE_SELECTION, pedidos),
    "Shopee sem dado nesta visão · mostrando só TikTok Shop e Mercado Livre",
  );
});

test("Gerencial: CX (so' Shopee) recebe os canais do filtro e mostra o aviso com o padrao global", () => {
  const cx = fonte("src/components/gerencial/CxResumo.tsx");
  assert.match(cx, /const CX_CANAIS_COBERTOS: readonly Marketplace\[\] = \["shopee"\];/);
  assert.match(cx, /<AvisoCanaisSemDado selecao=\{canais\} cobertos=\{CX_CANAIS_COBERTOS\}/);
  assert.match(fonte("app/page.tsx"), /<CxResumo\s+brands=\{filters\.brands\}\s+canais=\{filters\.channels\}/);

  // URL vazia (padrao global) -> o CX monta (Shopee no filtro) e o aviso aparece.
  const canais = resolveFilters(new URLSearchParams(), { defaultPreset: "mes_atual", defaultCompare: true }).channels;
  assert.ok(canais.includes("shopee"));
  assert.match(avisoCanaisSemDado(canais, ["shopee"]) ?? "", /^TikTok Shop .*sem dado nesta visão/);
  // URL explicita so' com Shopee -> sem aviso.
  const soShopee = resolveFilters(new URLSearchParams("channels=shopee"), {}).channels;
  assert.equal(avisoCanaisSemDado(soShopee, ["shopee"]), null);
});

test("Pedidos: o aviso fixo 'Shopee fora: só TikTok Shop e Mercado Livre' saiu; usa o helper", () => {
  const src = fonte("app/pedidos/page.tsx");
  assert.doesNotMatch(src, /Shopee fora: só TikTok Shop e Mercado Livre/);
  assert.match(src, /showShopeeMixed && <AvisoCanaisSemDado selecao=\{filters\.channels\} cobertos=\{PEDIDOS_CANAIS_COBERTOS\}/);
  assert.match(src, /PEDIDOS_CANAIS_COBERTOS: readonly Marketplace\[\] = \["tiktok", "ml"\]/);
});
