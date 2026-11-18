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

test("ritmo, tendencia e canal: ML/Shopee/TikTok e Full/normal; media movel de 7", async () => {
  const { ritmo, serieDo, passaTendencia, seriesPorMarketplace, faturamento15d, mediaMovel7, pecas15dPorMarketplace } = await import("../src/lib/full-slow-moving.ts");
  const base = sku("barbours", "BB02084", "Kiss", 100, 10, 2);
  const s = { ...base,
    serie: { "ML-F": [...Array(15).fill(1), ...Array(15).fill(2)], "SP-N": [...Array(15).fill(0), ...Array(15).fill(1)] },
    receita_15d: { "ML-F": 30, "SP-N": 10 } };
  assert.deepEqual(ritmo(s, 30), { m15: 3, m15p: 1, tendencia: 200 });
  assert.equal(serieDo(s, 30, "SP")[29], 1);
  assert.equal(serieDo(s, 30, "todos", "F")[29], 2);
  assert.ok(passaTendencia(s, 30, "melhorando") && !passaTendencia(s, 30, "piorando"));
  assert.equal(passaTendencia({ ...base, serie: {}, receita_15d: {} }, 30, "melhorando"), false); // sem base nao entra
  const ser = seriesPorMarketplace([s, s], 30, "todos", "todos");
  assert.deepEqual([ser.ML[29], ser.SP[29], ser.TT[29]], [4, 2, 0]);
  assert.equal(seriesPorMarketplace([s], 30, "SP", "todos").ML[29], 0); // filtro de canal zera os outros
  assert.equal(faturamento15d([s]), 40);
  assert.equal(faturamento15d([s], "ML", "N"), 0);
  assert.deepEqual(pecas15dPorMarketplace(s, 30), { ML: 30, SP: 15, TT: 0 });
  assert.deepEqual(mediaMovel7([7, 0, 0, 0, 0, 0, 0, 7]), [7, 3.5, 7 / 3, 1.75, 1.4, 7 / 6, 1, 1]);
});

test("slow moving: canal e envio recortam venda, tendencia e quem aparece na lista", async () => {
  const { ritmo, vendeNoCanal, tendenciaDaLista } = await import("../src/lib/full-slow-moving.ts");
  const n = 30;
  const zeros = new Array(n).fill(0);
  const s = {
    marca: "kokeshi", sku: "X", descricao: "x", categoria: null, curva: "C", status: null, estoque: 100,
    custo_unitario: 1, valor_parado: 100, venda_dia: 9, cobertura_dias: 200,
    serie: { "ML-F": new Array(n).fill(2), "TT-N": [...new Array(15).fill(0), ...new Array(15).fill(4)] },
    receita_15d: {},
  } as never;
  assert.equal(ritmo(s, n, "ML").m15, 2);
  assert.equal(ritmo(s, n, "TT").m15, 4);
  assert.equal(ritmo(s, n, "TT").tendencia, null); // sem base nos 15 dias anteriores
  assert.equal(vendeNoCanal(s, n, "SP", "todos"), false);
  assert.equal(vendeNoCanal(s, n, "ML", "F"), true);
  assert.equal(vendeNoCanal(s, n, "ML", "N"), false);
  assert.equal(vendeNoCanal({ ...(s as object), serie: { "ML-F": zeros } } as never, n, "todos", "todos"), true);
  assert.equal(tendenciaDaLista([s], n, "ML"), 0);
});
