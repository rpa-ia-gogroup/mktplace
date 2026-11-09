/**
 * Avaliacoes de produto da Shopee na aba CX (src/lib/cx-avaliacoes.ts):
 * ausencia nunca vira zero, truncado = piso, as duas ordens da lista.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ROTA_API_AVALIACOES,
  carregarAvaliacoes,
  contagem,
  linhaAvaliacoes,
  nomeProduto,
  ordenarProdutos,
  problemaNoPayloadAvaliacoes,
  urlAvaliacoes,
  type AvaliacoesMarca,
  type AvaliacoesProduto,
} from "../src/lib/cx-avaliacoes.ts";

const marca = (o: Partial<AvaliacoesMarca>): AvaliacoesMarca => ({
  marca: "barbours", estado: "dado", motivo: null, itens: 10, avaliacoes: 43246, com_nota: 43246,
  nota_media: 4.84, pct_1a3: 4.4, pct_respondidas: 0, truncado: false, varrido_em: null, ...o,
});
const produto = (item_id: string, nota_media: number | null, avaliacoes_1a3: number): AvaliacoesProduto => ({
  marca: "lescent", item_id, nome: null, avaliacoes: 100, com_nota: 100, nota_media, avaliacoes_1a3, pct_1a3: avaliacoes_1a3, truncado: false,
});

test("marca sem dado: '—' com motivo, nunca zero", () => {
  const l = linhaAvaliacoes(marca({ marca: "apice", estado: "sem_fonte", motivo: "Ainda não varrida", avaliacoes: null, com_nota: null, nota_media: null, pct_1a3: null, pct_respondidas: null }), "ÁPICE");
  assert.deepEqual([l.nota, l.pct1a3, l.pctRespondidas, l.avaliacoes], ["—", "—", "—", "—"]);
  assert.equal(l.ausente, true);
  assert.equal(l.nota_extra, "Ainda não varrida");
});

test("marca com dado: nota 2 casas, % 1 casa, 0% respondidas e' zero medido", () => {
  const l = linhaAvaliacoes(marca({}), "BARBOURS");
  assert.equal(l.nota, "4,84");
  assert.equal(l.pct1a3, "4,4%");
  assert.equal(l.pctRespondidas, "0,0%");
  assert.equal(l.avaliacoes, "43.246");
  assert.equal(l.nota_extra, null);
});

test("respostas nao coletadas: a coluna sai e o ⓘ diz por que", async () => {
  const { ajudaAvaliacoes } = await import("../src/lib/cx-avaliacoes.ts");
  const base = { gerado_em: "", estado: "dado" as const, motivo_indisponivel: null, fonte: "F", varrido_em: null, completa_em: null,
    aviso_frescor: null, minimo_avaliacoes: 20, marcas: [], total: null, produtos: [] };
  assert.match(ajudaAvaliacoes({ ...base, respostas_medidas: false }, (m) => m), /Respostas da loja: ainda não coletadas/);
  assert.doesNotMatch(ajudaAvaliacoes({ ...base, respostas_medidas: true }, (m) => m), /ainda não coletadas/);
  const src = readFileSync(new URL("../app/cx/AvaliacoesProduto.tsx", import.meta.url), "utf-8");
  assert.match(src, /d\.respostas_medidas \? \["% respondidas"\] : \[\]/);
});

test("truncado: contagem com '≥' e motivo do piso", () => {
  assert.equal(contagem(12345, true), "≥ 12.345");
  assert.equal(contagem(null, true), "—");
  assert.match(linhaAvaliacoes(marca({ truncado: true }), "X").nota_extra ?? "", /piso/);
});

test("ordem 'pior': nota asc, desempate por 1–3 ★ desc; '1a3': 1–3 ★ desc", () => {
  const itens = [produto("a", 4.9, 50), produto("b", 4.5, 3), produto("c", 4.5, 9), produto("d", null, 99)];
  assert.deepEqual(ordenarProdutos(itens, "pior").map((p) => p.item_id), ["c", "b", "a", "d"]);
  assert.deepEqual(ordenarProdutos(itens, "1a3").map((p) => p.item_id), ["d", "a", "c", "b"]);
  assert.deepEqual(itens.map((p) => p.item_id), ["a", "b", "c", "d"], "nao muta a lista");
});

test("produto fora do catalogo vira 'Produto {item_id}'", () => {
  assert.equal(nomeProduto(produto("123", 4, 1)), "Produto 123");
  assert.equal(nomeProduto({ ...produto("1", 4, 1), nome: " Shampoo " }), "Shampoo");
});

test("url so' leva a marca; payload sem listas e' invalido", async () => {
  assert.equal(urlAvaliacoes("/torre-api", { marca: null }), `/torre-api${ROTA_API_AVALIACOES}`);
  assert.equal(urlAvaliacoes("", { marca: "lescent" }), `${ROTA_API_AVALIACOES}?brands=lescent`);
  assert.equal(problemaNoPayloadAvaliacoes({ estado: "dado" }), "listas ausentes");
  const falso = (async () => new Response("{}", { status: 503 })) as typeof fetch;
  assert.deepEqual(await carregarAvaliacoes({ marca: null }, falso, ""), { ok: false, motivo: "A API respondeu 503." });
});

test("aba CX: avaliacoes depois de 'Atendimento por loja', nos tres estados", () => {
  const src = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf-8");
  assert.match(src, /const avaliacoes = <AvaliacoesProduto filtros=\{filtros\} \/>;/);
  const corpo = src.slice(src.indexOf("function Corpo"));
  assert.ok(corpo.indexOf("<AtendimentoPorLoja") < corpo.indexOf("{avaliacoes}"));
});
