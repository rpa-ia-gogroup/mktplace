import assert from "node:assert/strict";
import { test } from "node:test";

import { filtrar, porMarca, totais, type SkuSlowMoving } from "../src/lib/full-slow-moving.ts";

const sku = (marca: string, s: string, descricao: string, estoque: number | null, valor: number, venda: number): SkuSlowMoving =>
  ({ marca, sku: s, descricao, categoria: "Fragrances", curva: "B", status: "Ativo", estoque, custo_unitario: 1,
     valor_parado: valor, venda_dia: venda, cobertura_dias: venda ? (estoque ?? 0) / venda : null });

const L = [
  sku("barbours", "BB02084", "Deo Bd Spl Kiss In Paradise", 12000, 100, 30),
  sku("kokeshi", "KS03042", "Creme Gel Pele Plena", 24000, 300, 170),
  sku("barbours", "BB02008", "Pó Compacto", null, 50, 10),
];

test("totais: cobertura so' com estoque conhecido; precisa vender = estoque / meta", () => {
  const t = totais(L, 120);
  assert.equal(t.skus, 3);
  assert.equal(t.valor, 450);
  assert.equal(t.estoque, 36000);
  assert.equal(t.cobertura, 36000 / 200);
  assert.equal(t.precisaDia, 300);
  assert.equal(totais([], 120).cobertura, null);
});

test("por marca: maior R$ primeiro; filtro de marca e busca sem acento", () => {
  assert.deepEqual(porMarca(L, 120).map((m) => m.marca), ["kokeshi", "barbours"]);
  assert.deepEqual(filtrar(L, ["barbours"], "").map((s) => s.sku), ["BB02084", "BB02008"]);
  assert.deepEqual(filtrar(L, [], "po compacto").map((s) => s.sku), ["BB02008"]);
  assert.deepEqual(filtrar(L, [], "fragrances kiss").map((s) => s.sku), ["BB02084"]);
});
