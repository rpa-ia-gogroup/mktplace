import assert from "node:assert/strict";
import { test } from "node:test";

import { linhasCsvProdutos, type ProdutosMarcas } from "../src/lib/marcas-menores.ts";

test("CSV das demais marcas: marca x SKU x canal; sem quebra usa o total; filtro de marca", () => {
  const r = {
    disponivel: true, completo: true, pedidos_total: 2, pedidos_lidos: 2,
    marcas: [
      { id: "yenzah", label: "Yenzah", status: "ok", produtos: [{ sku: "Y1", produto: "Óleo", quantidade: 5, receita: 100 }],
        itens_por_canal: [
          { sku: "Y1", produto: "Óleo", quantidade: 3, receita: 60.004, plataforma: "SHOPEE", pedidos: 2 },
          { sku: "Y1", produto: "Óleo", quantidade: 2, receita: 40, plataforma: "TIKTOK", pedidos: 1 },
        ] },
      { id: "aua", label: "Auá", status: "ok", produtos: [{ sku: "A1", produto: "Sérum", quantidade: 1, receita: null }] },
    ],
  } as unknown as ProdutosMarcas;
  const l = linhasCsvProdutos(r);
  assert.equal(l.length, 3);
  assert.deepEqual(l[0], { "Marca": "Yenzah", "SKU": "Y1", "Produto": "Óleo", "Canal": "Shopee", "Quantidade": 3, "Pedidos": 2, "Receita (R$)": 60 });
  assert.equal(l[1]["Canal"], "TikTok Shop");
  assert.deepEqual([l[2]["Canal"], l[2]["Receita (R$)"], l[2]["Pedidos"]], ["", null, null]);
  assert.equal(linhasCsvProdutos(r, ["aua"]).length, 1);
});
