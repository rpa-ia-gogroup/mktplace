/** Top produtos por marca (Gerencial) — contas puras do detalhe. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { agrupar, comparacaoValida, eixoTicket, rotuloPeriodo, ticketMedio, variacao } from "../src/lib/gerencial/top-produtos.ts";

test("comparacao: so' hoje contra ontem inteiro nao vale; rotulo diz o periodo", () => {
  const hoje = "2026-11-06";
  assert.equal(comparacaoValida({ inicio: hoje, fim: hoje, comparacao_inicio: "2026-11-05" }, hoje), false);
  assert.equal(comparacaoValida({ inicio: "2026-11-01", fim: hoje, comparacao_inicio: "2026-10-26" }, hoje), true);
  assert.equal(comparacaoValida({ inicio: "2026-11-05", fim: "2026-11-05", comparacao_inicio: "2026-11-04" }, hoje), true);
  assert.equal(comparacaoValida({ inicio: hoje, fim: hoje, comparacao_inicio: null }, hoje), false);
  assert.equal(rotuloPeriodo("2026-11-05", "2026-11-05"), "05/11");
  assert.equal(rotuloPeriodo("2026-10-26", "2026-10-31"), "26/10–31/10");
});

const serie = [
  { dia: "2026-10-31", pecas: 2, receita: 20 },
  { dia: "2026-11-01", pecas: 1, receita: 10 },
  { dia: "2026-11-05", pecas: 3, receita: 30 },
];

test("dia: 30 barras ate o fim, dia sem venda vira zero", () => {
  const b = agrupar(serie, "2026-11-05", "dia");
  assert.equal(b.length, 30);
  assert.equal(b.at(-1)?.rotulo, "05/11");
  assert.equal(b.at(-1)?.receita, 30);
  assert.equal(b.at(-2)?.receita, 0);
  assert.equal(b.reduce((s, x) => s + x.pecas, 0), 6);
});

test("semana: blocos de 7 dias terminando no fim", () => {
  const b = agrupar(serie, "2026-11-05", "semana");
  assert.equal(b.length, 12);
  assert.deepEqual([b.at(-1)?.rotulo, b.at(-1)?.receita], ["30/10", 60]);
});

test("mes: 12 meses de calendario, virada de ano", () => {
  const b = agrupar(serie, "2026-11-05", "mes");
  assert.equal(b.length, 12);
  assert.deepEqual([b[0].rotulo, b.at(-1)?.rotulo], ["dez/25", "nov/26"]);
  assert.deepEqual([b.at(-2)?.receita, b.at(-1)?.receita], [20, 40]);
});

test("variacao sem base nao inventa 100%", () => {
  assert.equal(variacao(150, 100), 50);
  assert.equal(variacao(10, 0), null);
  assert.equal(variacao(10, null), null);
});

test("ticket medio: R$ por peca na barra; sem venda e' ausente, nunca zero", () => {
  assert.equal(ticketMedio({ pecas: 4, receita: 100 }), 25);
  assert.equal(ticketMedio({ pecas: 0, receita: 0 }), null);
  // segue o agrupamento: semana com 3 pecas e R$ 30 -> R$ 10; dia sem venda -> null
  const dias = agrupar(
    [{ dia: "2026-11-05", pecas: 3, receita: 30 }, { dia: "2026-11-03", pecas: 1, receita: 40 }],
    "2026-11-05", "dia",
  ).map(ticketMedio);
  assert.deepEqual(dias.slice(-3), [40, null, 10]);
  const semana = agrupar([{ dia: "2026-11-05", pecas: 3, receita: 30 }, { dia: "2026-11-03", pecas: 1, receita: 40 }], "2026-11-05", "semana");
  assert.equal(ticketMedio(semana.at(-1)!), 70 / 4, "receita / pecas da semana, nao media dos dias");
});

test("eixoTicket: preco constante ganha folga redonda; serie que varia fica no auto", () => {
  assert.deepEqual(eixoTicket([99.9, null, 99.9]), { domain: [95, 105], ticks: [95, 97.5, 100, 102.5, 105] }, "5% de cada lado, passos de 2,50");
  assert.deepEqual(eixoTicket([99.9, 99.92]).domain, [95, 105], "quase constante tambem");
  assert.deepEqual(eixoTicket([2, 2]).domain, [1, 3], "minimo de R$ 1");
  assert.deepEqual(eixoTicket([0.5]).domain, [0, 2], "nunca abaixo de zero");
  assert.deepEqual(eixoTicket([80, 120]), { domain: ["auto", "auto"] });
  assert.deepEqual(eixoTicket([null, null]), { domain: ["auto", "auto"] });
});

// COMPARAR-CANAIS: regras do selo, achados e celulas (spec do Prumo).
import { readFileSync } from "node:fs";
import {
  achadosDaMarca, fmtFatia, seloDoProduto, type CanalTop, type MarcaComparada, type ProdutoComparado,
} from "../src/lib/gerencial/top-produtos.ts";

const prod = (chave: string, f: Partial<Record<CanalTop, number>>): ProdutoComparado => ({
  chave, produto: `Kit ${chave}`, kit: true,
  celulas: Object.entries(f).map(([canal, fatia]) => ({ canal: canal as CanalTop, fatia: fatia!, sku: chave })),
});
const TRES: CanalTop[] = ["tiktok", "ml", "shopee"];

test("comparar: selo forte exige 2x, 3 p.p. e piso de 3%", () => {
  assert.deepEqual(seloDoProduto(prod("a", { ml: 0.15, shopee: 0.02, tiktok: 0.01 }), TRES)?.tipo, "forte");
  assert.equal(seloDoProduto(prod("b", { ml: 0.15, shopee: 0.08, tiktok: 0.01 }), TRES), null, "menos de 2x");
  assert.equal(seloDoProduto(prod("c", { ml: 0.05, shopee: 0.025, tiktok: 0.01 }), TRES), null, "so' 2,5 p.p.");
  assert.equal(seloDoProduto(prod("d", { ml: 0.029, shopee: 0.001, tiktok: 0.001 }), TRES), null, "abaixo de 3%");
});

test("comparar: sem venda vem antes e so' com 3% em algum canal", () => {
  assert.deepEqual(seloDoProduto(prod("e", { tiktok: 0.09, shopee: 0.08 }), TRES), { tipo: "sem_venda", canal: "ml", forte: "tiktok" });
  assert.equal(seloDoProduto(prod("f", { tiktok: 0.02 }), TRES), null);
  // Canal que a marca nao tem nao vira "sem venda".
  assert.equal(seloDoProduto(prod("g", { tiktok: 0.09, ml: 0.08 }), ["tiktok", "ml"]), null);
});

test("comparar: achados — sem venda primeiro, depois maior diferenca; ate' 3; ausencia nunca e' 0%", () => {
  const m: MarcaComparada = {
    marca: "x", canais: TRES.map((canal) => ({ canal, cobertura: 1 })),
    produtos: [
      prod("forte1", { ml: 0.1, shopee: 0.02, tiktok: 0.01 }),
      prod("forte2", { ml: 0.2, shopee: 0.02, tiktok: 0.01 }),
      prod("sem", { tiktok: 0.09, shopee: 0.08 }),
      prod("forte3", { shopee: 0.07, ml: 0.01, tiktok: 0.01 }),
    ],
  };
  const a = achadosDaMarca(m);
  assert.deepEqual(a.map((x) => x.chave), ["sem", "forte2", "forte1"]);
  assert.equal(a[0].texto, "Kit sem: 9% da receita no TikTok · sem venda no ML · 8% na Shopee");
  assert.ok(!a.some((x) => / 0% /.test(x.texto)));
  assert.deepEqual(achadosDaMarca({ ...m, produtos: [prod("z", { ml: 0.05, shopee: 0.04, tiktok: 0.03 })] }), []);
});

test("comparar: fatia formatada sem zero falso", () => {
  assert.equal(fmtFatia(0.15), "15%");
  assert.equal(fmtFatia(0.0233), "2,3%");
  assert.equal(fmtFatia(0.0001), "<0,1%");
});

test("comparar: tabela so' com colunas dos canais da marca e traco para ausencia", () => {
  const src = readFileSync(new URL("../src/components/gerencial/TopProdutosComparar.tsx", import.meta.url), "utf8");
  assert.match(src, /const canais = m\.canais\.map/, "colunas vem dos canais da marca");
  assert.match(src, /f === undefined[\s\S]*?—[\s\S]*?sem venda/, "ausencia e' traco com o motivo");
  const card = readFileSync(new URL("../src/components/gerencial/TopProdutosMarca.tsx", import.meta.url), "utf8");
  assert.match(card, /canal === "todos" && !fonte \? modoEscolhido : "ranking"/, "um canal so' volta ao ranking");
});

test("comparar: busca de novo uma vez se falhar; cancelada nao repete", async () => {
  const { buscarComparacao } = await import("../src/lib/gerencial/top-produtos.ts");
  const q = new URLSearchParams({ date_from: "2026-10-10", date_to: "2026-11-08" });
  let n = 0;
  const vazio = { inicio: "2026-10-10", fim: "2026-11-08", marcas: [] };
  const falhaUmaVez = async () => { n += 1; if (n === 1) throw new Error("503"); return vazio; };
  assert.deepEqual(await buscarComparacao(q, new AbortController().signal, falhaUmaVez), vazio);
  assert.equal(n, 2);
  n = 0;
  await assert.rejects(buscarComparacao(q, new AbortController().signal, async () => { n += 1; throw new Error("503"); }));
  assert.equal(n, 2, "so' uma nova tentativa");
  n = 0;
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(buscarComparacao(q, ac.signal, async () => { n += 1; throw new DOMException("x", "AbortError"); }));
  assert.equal(n, 1, "cancelada nao repete");
});
