/**
 * GRADE-CURVA — curva x marca nas abas Estoque ML e Estoque Shopee.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fmtPermanencia, linhaDaCurva, montarGrade, TOTAL, type ItemGrade } from "../src/lib/estoque-grade-curva.ts";

const it = (o: Partial<ItemGrade>): ItemGrade => ({
  brand: "barbours", curva: "A", disponivel: 100, mediaDiaria: 10, classe: null, ...o,
});

test("linhas: AA e A juntas, sem curva nunca vira C", () => {
  assert.equal(linhaDaCurva("AA"), "aa_a");
  assert.equal(linhaDaCurva("A"), "aa_a");
  assert.equal(linhaDaCurva("B"), "b");
  assert.equal(linhaDaCurva("C"), "c");
  assert.equal(linhaDaCurva(null), "sem");
  assert.equal(linhaDaCurva(undefined), "sem");
});

test("permanencia ponderada (soma/soma), so' itens com venda; contagens por classe", () => {
  const g = montarGrade([
    it({ disponivel: 100, mediaDiaria: 10, classe: "excesso" }),
    it({ disponivel: 0, mediaDiaria: "5", classe: "ruptura" }),
    it({ disponivel: 50, mediaDiaria: 0 }), // sem venda: entra no disponivel, fora da permanencia
    it({ brand: "kokeshi", curva: "C", disponivel: 30, mediaDiaria: 1, classe: "baixo" }),
  ], ["barbours", "kokeshi"]);
  const c = g.celulas.aa_a.barbours;
  assert.equal(c.disponivel, 150);
  assert.equal(c.permanencia, 100 / 15); // nao (10 + 0) / 2
  assert.deepEqual([c.ruptura, c.baixo, c.excesso, c.itens], [1, 0, 1, 3]);
  assert.equal(g.celulas.c.kokeshi.baixo, 1);
  assert.equal(g.celulas.aa_a[TOTAL].disponivel, 150);
  assert.equal(g.totalMarca[TOTAL].disponivel, 180);
  assert.equal(g.totalMarca[TOTAL].permanencia, 130 / 16);
});

test("ausencia nunca vira zero", () => {
  const g = montarGrade([
    it({ disponivel: null }),
    it({ curva: "B", disponivel: 10, mediaDiaria: 0 }),
  ], ["barbours", "lescent"]);
  assert.equal(g.celulas.aa_a.barbours.disponivel, null); // so' sem leitura
  assert.equal(g.celulas.b.barbours.permanencia, null); // sem venda
  assert.equal(g.celulas.c.barbours.itens, 0); // celula vazia -> "—" na tela
  assert.equal(g.totalMarca.lescent.disponivel, null);
  assert.equal(fmtPermanencia(null), "—");
  assert.equal(fmtPermanencia(37.6), "38 d");
});

test("marca fora das colunas nao entra no total", () => {
  const g = montarGrade([it({ brand: "apice" }), it({})], ["barbours"]);
  assert.equal(g.totalMarca[TOTAL].itens, 1);
});

test("as duas abas usam a grade com o recorte dos cartoes", () => {
  const ml = readFileSync(join(import.meta.dirname, "../app/estoque-ml-full/MLFullEstoqueClient.tsx"), "utf8");
  const sh = readFileSync(join(import.meta.dirname, "../app/estoque-full/EstoqueFullClient.tsx"), "utf8");
  assert.match(ml, /<GradeCurvaMarca/);
  assert.match(ml, /i\.eh_full && !i\.situacao/);
  assert.match(sh, /<GradeCurvaMarca/);
  assert.match(sh, /!p\.situacao && !p\.is_kit/);
});
