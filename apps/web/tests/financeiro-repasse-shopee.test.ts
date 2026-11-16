// T-0124 — Financeiro: selo "parcial" no repasse Shopee da marca e procedencia
// do repasse vinda do `aviso` da API, com o texto fixo como reserva.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AJUDA_REPASSE_SHOPEE_PADRAO,
  procedenciaRepasseShopee,
  seloRepasseShopee,
} from "../app/financeiro/repasse-shopee.ts";

const fonte = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const AVISO_API = "Repasse do escrow (escrow_amount), antes de ajustes posteriores";

test("T-0124 repasse parcial ganha selo; completo, ausente ou valor novo nao", () => {
  // kokeshi out/26: escrow em 67581 de 67695 pedidos -> parcial.
  assert.equal(seloRepasseShopee({ shopee_settlement: 2_296_007.01, shopee_settlement_status: "parcial" }), "parcial");
  assert.equal(seloRepasseShopee({ shopee_settlement: 2_296_007.01, shopee_settlement_status: "completa" }), null);
  assert.equal(seloRepasseShopee({ shopee_settlement: 2_296_007.01 }), null, "API antiga sem o campo");
  assert.equal(seloRepasseShopee({ shopee_settlement: 1, shopee_settlement_status: "outro" }), null);
});

test("T-0124 sem_dado continua so' o travessao, sem selo", () => {
  assert.equal(seloRepasseShopee({ shopee_settlement: null, shopee_settlement_status: "sem_dado" }), null);
  // valor nulo nunca ganha selo, mesmo com status inconsistente
  assert.equal(seloRepasseShopee({ shopee_settlement: null, shopee_settlement_status: "parcial" }), null);
});

test("T-0124 procedencia vem do aviso da API, com o texto fixo como reserva", () => {
  assert.equal(procedenciaRepasseShopee({ shopee_settlement_aviso: AVISO_API }), AVISO_API);
  assert.equal(procedenciaRepasseShopee({ shopee_settlement_aviso: null }), AJUDA_REPASSE_SHOPEE_PADRAO);
  assert.equal(procedenciaRepasseShopee({ shopee_settlement_aviso: "  " }), AJUDA_REPASSE_SHOPEE_PADRAO);
  assert.equal(procedenciaRepasseShopee({}), AJUDA_REPASSE_SHOPEE_PADRAO);
  assert.equal(procedenciaRepasseShopee(null), AJUDA_REPASSE_SHOPEE_PADRAO);
  assert.match(AJUDA_REPASSE_SHOPEE_PADRAO, /escrow_amount, antes de ajustes posteriores/);
});

test("T-0124 a pagina liga o selo a tabela Shopee e o aviso a ajuda do painel", () => {
  const src = fonte("app/financeiro/page.tsx");
  assert.ok(src.includes("seloRepasseShopee(b)"), "selo na linha da marca");
  assert.ok(src.includes('<Chip tom="atencao"'), "reaproveita o Chip de selo");
  assert.ok(src.includes("Total Global (pedidos): ${procedenciaRepasseShopee(k)}"), "ajuda usa o aviso");
  assert.ok(src.includes('fmtBrlCurto(b.shopee_settlement) : "—"'), "sem repasse continua —");
});

test("T-0124 o tipo publica status e aviso como opcionais", () => {
  const src = fonte("src/lib/api-client.ts");
  assert.ok(src.includes("shopee_settlement_status?: string | null;"));
  assert.ok(src.includes("shopee_settlement_aviso?: string | null;"));
});
