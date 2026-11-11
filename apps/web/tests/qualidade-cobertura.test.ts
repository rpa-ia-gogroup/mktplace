// T-0088 (C2-01) — Qualidade: devolucao Shopee sem dado aparece como "—" e o
// cartao de devolucao consolidado parcial diz "parcial (N de M marcas)".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { avisoCoberturaDevolucao, fmtRate } from "../app/qualidade/cobertura-devolucao.ts";

const fonte = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const MARCAS = [
  { brand: "apice", label: "APICE" },
  { brand: "barbours", label: "BARBOURS" },
  { brand: "kokeshi", label: "KOKESHI" },
  { brand: "lescent", label: "LESCENT" },
  { brand: "rituaria", label: "RITUARIA" },
];

test("T-0088 taxa nula vira — (nunca 0,0%)", () => {
  assert.equal(fmtRate(null), "—");
  assert.equal(fmtRate(0.38), "0,4%");
});

test("T-0088 devolucao parcial mostra 1 de 5 marcas e quem ficou fora", () => {
  const aviso = avisoCoberturaDevolucao(
    {
      status: "parcial", marcas_com_dado: 1, marcas_total: 5,
      marcas_sem_dado: ["apice", "barbours", "lescent", "rituaria"],
    },
    MARCAS,
  );
  assert.ok(aviso);
  assert.equal(aviso.texto, "Devolução: parcial (1 de 5 marcas)");
  assert.match(aviso.dica, /APICE, BARBOURS, LESCENT, RITUARIA/);
});

test("T-0088 cobertura completa, sem dado ou ausente nao gera aviso", () => {
  assert.equal(avisoCoberturaDevolucao({ status: "completa", marcas_com_dado: 5, marcas_total: 5, marcas_sem_dado: [] }), null);
  assert.equal(avisoCoberturaDevolucao({ status: "sem_dado", marcas_com_dado: 0, marcas_total: 5 }), null);
  assert.equal(avisoCoberturaDevolucao(null), null);
  assert.equal(avisoCoberturaDevolucao(undefined), null);
});

test("T-0088 a pagina usa o helper na linha Devol.% e no aviso do cartao", () => {
  const src = fonte("app/qualidade/page.tsx");
  assert.ok(src.includes('from "./cobertura-devolucao"'));
  assert.ok(src.includes("{fmtRate(b.shopee_return_rate_pct ?? null)}"));
  assert.ok(src.includes("avisoCoberturaDevolucao(displayKpis?.shopee_return_cobertura, displayBrands)"));
  assert.doesNotMatch(src, /function fmtRate\(/, "fmtRate vem do helper testado");
});

test("T-0088 o tipo publica shopee_return_cobertura como opcional", () => {
  const src = fonte("src/lib/api-client.ts");
  assert.ok(src.includes("shopee_return_cobertura?: CoberturaMarcas | null;"));
});
