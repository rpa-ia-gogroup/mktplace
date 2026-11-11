import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canaisSemBase,
  corDaPlataforma,
  fatias,
  nomeDaPlataforma,
  variacaoConsolidada,
  variacaoDaMarca,
  variacaoPct,
} from "../src/lib/marcas-menores.ts";

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

// C1-03: periodo anterior so' com TikTok, atual com Shopee + TikTok (a Shopee entra no Bling em 22/10/2026).
const comAnt = (por: [string, number][], ant: Record<string, number>) => ({
  ...m(por),
  total_anterior: Object.keys(ant).length ? Object.values(ant).reduce((a, v) => a + v, 0) : null,
  por_plataforma_anterior: ant,
});

test("canal sem base no anterior: sem percentual, com motivo (ausencia nao vira 0)", () => {
  const yenzah = comAnt([["SHOPEE", 8834.46], ["TIKTOK", 8013.8]], { TIKTOK: 1715.2 });
  assert.deepEqual(canaisSemBase(yenzah.por_plataforma, yenzah.por_plataforma_anterior), ["SHOPEE"]);
  assert.deepEqual(variacaoDaMarca(yenzah), { pct: null, motivo: "sem dado de Shopee no período anterior" });
  const aua = comAnt([["TIKTOK", 1835.68]], { TIKTOK: 760.96 });
  const c = variacaoConsolidada([aua, yenzah]);
  assert.equal(c.pct, null);
  assert.equal(c.motivo, "sem dado de Shopee no período anterior");
});

test("caso normal: os dois canais nos dois periodos, variacao inalterada", () => {
  const y = comAnt([["SHOPEE", 150], ["TIKTOK", 50]], { SHOPEE: 100, TIKTOK: 60 });
  assert.deepEqual(canaisSemBase(y.por_plataforma, y.por_plataforma_anterior), []);
  assert.deepEqual(variacaoDaMarca(y), { pct: variacaoPct(200, 160), motivo: null });
  const a = comAnt([["TIKTOK", 30]], { TIKTOK: 20 });
  assert.deepEqual(variacaoConsolidada([y, a]), { pct: variacaoPct(230, 180), motivo: null });
});

test("sem anterior nenhum: nada a avisar (nem percentual, nem motivo)", () => {
  assert.deepEqual(variacaoDaMarca(comAnt([["SHOPEE", 10]], {})), { pct: null, motivo: null });
  assert.deepEqual(variacaoConsolidada([comAnt([["SHOPEE", 10]], {})]), { pct: null, motivo: null });
});
