import { test } from "node:test";
import assert from "node:assert/strict";

import { corDaPlataforma, fatias, nomeDaPlataforma } from "../src/lib/marcas-menores.ts";

const m = (por: [string, number][]) => ({
  id: "x", label: "X", total: por.length ? por.reduce((a, [, v]) => a + v, 0) : null,
  por_plataforma: por.map(([plataforma, faturamento]) => ({ plataforma, faturamento })), serie: [],
});

test("fatias somam 1 e seguem a ordem da quebra", () => {
  const f = fatias(m([["MELI", 75], ["SHOPEE", 25]]));
  assert.deepEqual(f, [{ plataforma: "MELI", frac: 0.75 }, { plataforma: "SHOPEE", frac: 0.25 }]);
});

test("sem dado nao ha fatia (nunca 0%)", () => {
  assert.deepEqual(fatias(m([])), []);
});

test("nome e cor por plataforma; desconhecida cai no neutro", () => {
  assert.equal(nomeDaPlataforma("MELI"), "Mercado Livre");
  assert.equal(corDaPlataforma("TIKTOK"), "rgb(var(--tc-canal-tiktok))");
  assert.equal(corDaPlataforma("SHEIN"), "rgb(var(--tc-canal-shein))");
  assert.equal(nomeDaPlataforma("MAGALU"), "Magalu");
  assert.equal(nomeDaPlataforma("NETSHOES"), "Netshoes");
  assert.equal(nomeDaPlataforma("DAFITI"), "Dafiti");
  assert.equal(corDaPlataforma("MAGALU"), "rgb(var(--tc-faint))");
  assert.equal(corDaPlataforma("XYZ"), "rgb(var(--tc-faint))");
});
