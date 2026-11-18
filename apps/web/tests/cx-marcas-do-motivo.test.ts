import assert from "node:assert/strict";
import { test } from "node:test";

import { marcasDoMotivo, type PedidosMotivoResponse } from "../src/lib/cx.ts";

test("Pareto -> marca -> SKU: pedidos por marca e por produto; pedido sem itens conta na marca", () => {
  const p = (marca: string, itens: { sku: string; produto: string; quantidade: number }[]) =>
    ({ marca, pedido: null, devolucao: null, dia: null, situacao: null, valor: null, itens });
  const d = { pedidos: [
    p("apice", [{ sku: "20910", produto: "Shampoo", quantidade: 2 }, { sku: "20911", produto: "Cond", quantidade: 1 }]),
    p("apice", [{ sku: "20910", produto: "Shampoo", quantidade: 1 }]),
    p("barbours", []),
  ] } as unknown as PedidosMotivoResponse;
  const m = marcasDoMotivo(d, (x) => x.toUpperCase());
  assert.deepEqual(m.map((x) => [x.rotulo, x.pedidos, x.semItens]), [["APICE", 2, 0], ["BARBOURS", 1, 1]]);
  assert.deepEqual(m[0].skus.map((s) => [s.sku, s.pedidos, s.unidades]), [["20910", 2, 3], ["20911", 1, 1]]);
  assert.equal(Math.round(m[0].pct), 67);
});
