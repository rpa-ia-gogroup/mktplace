import assert from "node:assert/strict";
import { test } from "node:test";

import { filtrar, porMarca, totais, type SkuSlowMoving } from "../src/lib/full-slow-moving.ts";

const sku = (marca: string, s: string, descricao: string, estoque: number | null, valor: number, venda: number): SkuSlowMoving =>
  ({ marca, sku: s, descricao, categoria: "Fragrances", curva: "B", status: "Ativo", estoque, custo_unitario: 1,
     valor_parado: valor, venda_dia: venda, cobertura_dias: venda ? (estoque ?? 0) / venda : null, serie: {}, receita_15d: {} });

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

test("ritmo, tendencia e canal: TikTok separado; media movel de 7", async () => {
  const { ritmo, serieDo, passaTendencia, serieDaLista, faturamento15d, mediaMovel7 } = await import("../src/lib/full-slow-moving.ts");
  const base = sku("barbours", "BB02084", "Kiss", 100, 10, 2);
  const s = { ...base, serie: { MKT: [...Array(15).fill(1), ...Array(15).fill(2)], TT: [...Array(15).fill(0), ...Array(15).fill(1)] }, receita_15d: { MKT: 30, TT: 10 } };
  assert.deepEqual(ritmo(s, 30), { m15: 3, m15p: 1, tendencia: 200 });
  assert.equal(serieDo(s, 30, "TT")[29], 1);
  assert.ok(passaTendencia(s, 30, "melhorando") && !passaTendencia(s, 30, "piorando"));
  assert.equal(passaTendencia({ ...base, serie: {}, receita_15d: {} }, 30, "melhorando"), false); // sem base nao entra
  assert.equal(serieDaLista([s, s], 30, "MKT")[0], 2);
  assert.equal(faturamento15d([s], "todos"), 40);
  assert.deepEqual(mediaMovel7([7, 0, 0, 0, 0, 0, 0, 7]), [7, 3.5, 7 / 3, 1.75, 1.4, 7 / 6, 1, 1]);
});
