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
