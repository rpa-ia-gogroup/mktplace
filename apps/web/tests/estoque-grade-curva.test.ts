/**
 * GRADE-CURVA — curva x marca nas abas Estoque ML e Estoque Shopee.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { passaCurva, rotuloDasCurvas } from "../src/lib/estoque-curva.ts";
import { abrirCategoria, CARDS_NA_CURVA, CATEGORIAS_ML, contagensNaCurva } from "../src/lib/estoque-categorias.ts";
import { descreverPartes, fmtPermanencia, linhaDaCurva, montarGrade, ordenarPorAcao, TOTAL, type ItemGrade } from "../src/lib/estoque-grade-curva.ts";

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

test("lista da pilula: marca/curva/classe; ruptura por menos cobertura, excesso por mais; TOTAL = todas as marcas", async () => {
  const { itensDaCelula } = await import("../src/lib/estoque-grade-curva.ts");
  const xs: ItemGrade[] = [
    it({ rotulo: "r2", classe: "ruptura", cobertura: "2" }),
    it({ rotulo: "r0", classe: "ruptura", cobertura: 0 }),
    it({ rotulo: "rsem", classe: "ruptura", cobertura: null }),
    it({ rotulo: "e5", classe: "excesso", cobertura: 95 }),
    it({ rotulo: "e9", classe: "excesso", cobertura: 190 }),
    it({ rotulo: "kB", brand: "kokeshi", classe: "ruptura", cobertura: 1 }),
    it({ rotulo: "outraCurva", curva: "C", classe: "ruptura" }),
  ];
  const marcas = ["barbours", "kokeshi"];
  assert.deepEqual(itensDaCelula(xs, marcas, "barbours", "aa_a", "ruptura").map((i) => i.rotulo), ["r0", "r2", "rsem"]);
  assert.deepEqual(itensDaCelula(xs, marcas, "barbours", "aa_a", "excesso").map((i) => i.rotulo), ["e9", "e5"]);
  assert.deepEqual(itensDaCelula(xs, marcas, TOTAL, "aa_a", "ruptura").map((i) => i.rotulo), ["r0", "kB", "r2", "rsem"]);
});

test("demais = itens sem ruptura/baixo/excesso; a barra fecha com o total de itens", () => {
  const g = montarGrade([
    it({ classe: "ruptura" }), it({ classe: "baixo" }), it({ classe: "excesso" }), it({}), it({}),
  ], ["barbours"]);
  const c = g.totalMarca.barbours;
  assert.deepEqual([c.ruptura, c.baixo, c.excesso, c.demais, c.itens], [1, 1, 1, 2, 5]);
  assert.equal(c.ruptura + c.baixo + c.excesso + c.demais, c.itens);
});

test("marcas: mais ruptura primeiro, depois mais baixo; sem itens por ultimo; empate mantem a ordem", () => {
  const g = montarGrade([
    it({ brand: "a", classe: "baixo" }),
    it({ brand: "b", classe: "ruptura" }),
    it({ brand: "c", classe: "ruptura" }), it({ brand: "c", classe: "ruptura" }),
    it({ brand: "e", classe: "baixo" }),
  ], ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ordenarPorAcao(["a", "b", "c", "d", "e"], g.totalMarca), ["c", "b", "a", "e", "d"]);
});

test("curva Todas: a lista da pilula junta todas as curvas", async () => {
  const { itensDaCelula } = await import("../src/lib/estoque-grade-curva.ts");
  const xs = [it({ rotulo: "a", classe: "ruptura" }), it({ rotulo: "c", curva: "C", classe: "ruptura" }), it({ rotulo: "s", curva: null, classe: "ruptura" })];
  assert.equal(itensDaCelula(xs, ["barbours"], "barbours", "todas", "ruptura").length, 3);
  assert.equal(itensDaCelula(xs, ["barbours"], "barbours", "aa_a", "ruptura").length, 1);
});

test("texto da barra: so' o que existe, singular e plural", () => {
  assert.equal(descreverPartes({ itens: 1, ruptura: 1, baixo: 0, excesso: 0, demais: 0 }), "1 item: 1 em ruptura");
  assert.equal(descreverPartes({ itens: 12, ruptura: 3, baixo: 2, excesso: 0, demais: 7 }), "12 itens: 3 em ruptura, 2 com estoque baixo, 7 demais");
});

test("Visao geral: a matriz Onde doi substitui a visao rapida; grade nao rola na horizontal", () => {
  const vg = readFileSync(join(import.meta.dirname, "../app/full/VisaoGeralFull.tsx"), "utf8");
  const grade = readFileSync(join(import.meta.dirname, "../src/components/full/GradeCurvaMarca.tsx"), "utf8");
  assert.doesNotMatch(vg, /VisaoRapidaEstoque|titulo="Ruptura por marca"/);
  assert.ok(vg.indexOf('titulo="Onde dói (R$/dia potencial)"') < vg.indexOf('titulo="Sem estoque por curva"'));
  assert.doesNotMatch(grade, /TableScrollHint|min-w-max/); // so o seletor de curva rola, a lista de marcas nao
  assert.match(grade, /<LegendaBarra/);
});

test("barra: excesso em tom fraco (nao o roxo cheio); na visao rapida vira demais", async () => {
  const barra = readFileSync(join(import.meta.dirname, "../src/components/full/BarraItens.tsx"), "utf8");
  assert.match(barra, /chave: "excesso", cor: "bg-accent-excesso"/);
  assert.doesNotMatch(barra, /chave: "excesso", cor: "bg-accent"/);
  // token proprio por tema (o projeto proibe `dark:` solto): no escuro mais forte, a ponta roxa nao some no cinza do "demais"
  const css = readFileSync(join(import.meta.dirname, "../app/globals.css"), "utf8");
  const [claro, escuro] = [...css.matchAll(/--tc-accent-excesso:\s*(\d+) (\d+) (\d+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  assert.ok(claro && escuro && escuro[0] < claro[0], "token de excesso existe nos dois temas e o escuro e' mais saturado");
  assert.equal(descreverPartes({ itens: 5, ruptura: 0, baixo: 0, excesso: 0, demais: 5 }), "5 itens: 5 demais");
});

test("curva unica: a grade segue o filtro do topo (varias curvas juntas; vazio = todas)", () => {
  const xs = [
    it({ curva: "AA", classe: "ruptura" }), it({ curva: "A", classe: "baixo" }),
    it({ curva: "B", classe: "ruptura" }), it({ curva: "C" }), it({ curva: null, classe: "excesso" }),
  ];
  const total = (f: Parameters<typeof passaCurva>[1]) => montarGrade(xs.filter((i) => passaCurva(i.curva, f)), ["barbours"]).totalMarca.barbours;
  assert.deepEqual([total([]).itens, total([]).ruptura], [5, 2]); // sem filtro: todas
  assert.deepEqual([total(["aa_a"]).itens, total(["aa_a"]).ruptura, total(["aa_a"]).baixo], [2, 1, 1]);
  assert.deepEqual([total(["aa_a", "b"]).itens, total(["aa_a", "b"]).ruptura], [3, 2]); // multi-escolha da caixa
  assert.equal(total(["sem"]).excesso, 1);
});

test("curva unica: o painel nao tem filtro proprio e as duas abas passam o filtro do topo", () => {
  const grade = readFileSync(join(import.meta.dirname, "../src/components/full/GradeCurvaMarca.tsx"), "utf8");
  const ml = readFileSync(join(import.meta.dirname, "../app/estoque-ml-full/MLFullEstoqueClient.tsx"), "utf8");
  const sh = readFileSync(join(import.meta.dirname, "../app/estoque-full/EstoqueFullClient.tsx"), "utf8");
  assert.doesNotMatch(grade, /Segmented|setCurva/);
  assert.match(grade, /descricao=\{comCurva/); // a curva escolhida aparece no subtitulo do painel
  assert.match(ml, /<GradeCurvaMarca[\s\S]*?curvas=\{curvas\}/);
  assert.match(sh, /<GradeCurvaMarca[\s\S]*?curvas=\{curvas\}/);
});

test("subtitulo do painel: Curva AA/A / Curvas AA/A + B / Todas as curvas", () => {
  assert.equal(rotuloDasCurvas([]), "Todas as curvas");
  assert.equal(rotuloDasCurvas(["aa_a"]), "Curva AA/A");
  assert.equal(rotuloDasCurvas(["b", "aa_a"]), "Curvas AA/A + B"); // ordem da caixa, nao do clique
  assert.equal(rotuloDasCurvas(["sem"]), "Curva Sem curva");
});

test("cards de contagem seguem a curva: numero = lista que o card abre, no recorte da curva", () => {
  const inv = (curva: "AA" | "A" | "B" | "C" | null, c: string) => ({ curva, classificacao_torre: c, eh_full: true } as never);
  const todos = [inv("AA", "RUPTURA_CANDIDATA"), inv("A", "BAIXO_CANDIDATO"), inv("B", "RUPTURA_CANDIDATA"), inv("C", "EXCESSO_CANDIDATO"), inv(null, "RUPTURA_CANDIDATA"), inv("AA", "SUFICIENTE")];
  const naCurva = todos.filter((i: { curva: never }) => passaCurva(i.curva, ["aa_a"]));
  const n = contagensNaCurva(CATEGORIAS_ML, CARDS_NA_CURVA, naCurva);
  assert.deepEqual(n, { "exigem-acao": 2, ruptura: 1, baixo: 1, excesso: 0 }); // so' AA/A
  for (const k of CARDS_NA_CURVA) {
    const cat = CATEGORIAS_ML.find((c) => c.chave === k)!;
    assert.equal(n[k], abrirCategoria(naCurva, cat).length); // card = lista
  }
  const todas = contagensNaCurva(CATEGORIAS_ML, CARDS_NA_CURVA, todos);
  assert.deepEqual(todas, { "exigem-acao": 4, ruptura: 3, baixo: 1, excesso: 1 }); // sem filtro: o recorte inteiro
  assert.deepEqual(CARDS_NA_CURVA, ["exigem-acao", "ruptura", "baixo", "excesso"]);
});

test("cards seguem a curva: as duas abas usam o recorte e so' sem lista truncada", () => {
  const ml = readFileSync(join(import.meta.dirname, "../app/estoque-ml-full/MLFullEstoqueClient.tsx"), "utf8");
  const sh = readFileSync(join(import.meta.dirname, "../app/estoque-full/EstoqueFullClient.tsx"), "utf8");
  for (const t of [ml, sh]) {
    assert.match(t, /contagensNaCurva\(CATEGORIAS_\w+, CARDS_NA_CURVA, naCurva\)/);
    assert.match(t, /!payload\.truncado/);
    assert.match(t, /cards=\{cards\w+\(payload, naCurvaCards\)\}/);
  }
});

test("com curva escolhida, os chips que nao seguem a curva dizem 'Todas as curvas:'", () => {
  const faixa = readFileSync(join(import.meta.dirname, "../src/components/full/CategoriasEstoque.tsx"), "utf8");
  const ml = readFileSync(join(import.meta.dirname, "../app/estoque-ml-full/MLFullEstoqueClient.tsx"), "utf8");
  const sh = readFileSync(join(import.meta.dirname, "../app/estoque-full/EstoqueFullClient.tsx"), "utf8");
  assert.match(faixa, /chipsDeTodasAsCurvas && <span[^>]*>Todas as curvas:<\/span>/);
  assert.match(ml, /chipsDeTodasAsCurvas=\{filtroCurva\.length > 0\}/);
  assert.match(sh, /chipsDeTodasAsCurvas=\{filtroCurva\.length > 0\}/);
});
