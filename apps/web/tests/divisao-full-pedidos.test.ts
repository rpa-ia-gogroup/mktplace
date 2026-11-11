// Pedidos Full x sem Full por marca (modal de Pedidos da Gerencial): contagem
// real das fatos, sem medida nunca vira "sem Full", janela parcial vira proporcao.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fullDaMarca, fullPedidosDaMarca } from "../src/lib/gerencial/divisao-full.ts";

const medido = (gmv: Parameters<typeof fullDaMarca>[0], share: Parameters<typeof fullDaMarca>[1]) => fullDaMarca(gmv, share);

test("periodo fechado: Full e' a contagem real e sem Full e' o resto (TikTok incluso)", () => {
  const d = medido({ ml: 100, tiktok: 50 }, { ml: 0.8 });
  assert.deepEqual(fullPedidosDaMarca(1000, { ml: 0.8, pedFull: 300 }, false, d), { full: 300, semFull: 700 });
});

test("janela parcial (dia em andamento): vale a proporcao medida, aplicada aos pedidos do periodo", () => {
  const d = medido({ ml: 100 }, { ml: 0.5 });
  // ate' ontem: 200 Full em 400 pedidos (50%); periodo todo tem 600.
  assert.deepEqual(fullPedidosDaMarca(600, { ml: 0.5, pedFull: 200, pedBase: 400 }, true, d), { full: 300, semFull: 300 });
});

test("sem medida nao vira zero nem 'tudo sem Full'", () => {
  const d = medido({ ml: 100 }, { ml: 0.5 });
  assert.equal(fullPedidosDaMarca(600, { ml: 0.5 }, false, d), null); // sem contagem de Full
  assert.equal(fullPedidosDaMarca(600, { ml: 0.5, pedFull: 200 }, true, d), null); // janela sem base
  assert.equal(fullPedidosDaMarca(600, undefined, false, d), null);
  // Shopee vendendo sem modalidade (Kokeshi): canal sem dado -> marca sem divisao.
  const k = medido({ ml: 100, shopee: 100 }, { ml: 0.5, shopee: null });
  assert.equal(fullPedidosDaMarca(600, { ml: 0.5, pedFull: 200 }, false, k), null);
  assert.equal(fullPedidosDaMarca(0, { pedFull: 0 }, false, d), null);
});

test("Full contado acima dos pedidos (definicoes diferentes) nao passa de 100%", () => {
  const d = medido({ ml: 100 }, { ml: 1 });
  assert.deepEqual(fullPedidosDaMarca(100, { ml: 1, pedFull: 120 }, false, d), { full: 100, semFull: 0 });
});
