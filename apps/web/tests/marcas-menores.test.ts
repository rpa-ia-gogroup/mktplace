import { test } from "node:test";
import assert from "node:assert/strict";

import { corDaPlataforma, fatias, nomeDaPlataforma, variacaoPct } from "../src/lib/marcas-menores.ts";

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

test("so' tres canais: nome e cor de canal; desconhecida capitalizada na cor neutra", () => {
  assert.equal(nomeDaPlataforma("MELI"), "Mercado Livre");
  assert.equal(corDaPlataforma("TIKTOK"), "rgb(var(--tc-canal-tiktok))");
  assert.equal(corDaPlataforma("MELI"), "rgb(var(--tc-canal-ml))");
  assert.equal(nomeDaPlataforma("DAFITI"), "Dafiti");
  assert.equal(corDaPlataforma("XYZ"), "rgb(var(--tc-faint))");
});

test("variacao contra o periodo anterior; sem base nao inventa", () => {
  assert.equal(variacaoPct(110, 100), 10);
  assert.equal(variacaoPct(50, 100), -50);
  assert.equal(variacaoPct(10, null), null);
  assert.equal(variacaoPct(10, 0), null);
  assert.equal(variacaoPct(null, 100), null);
});
